import { Injectable } from '@nestjs/common';
import { type RateType, sumAmounts } from '@erp/shared';
import type { z } from 'zod';
import type {
  dimensionTypeSchema,
  dimensionValueSchema,
  distributionTemplateSchema,
  exchangeRateSchema,
  journalTypeSchema,
} from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';

type DimensionTypeInput = z.infer<typeof dimensionTypeSchema>;
type DimensionValueInput = z.infer<typeof dimensionValueSchema>;
type JournalTypeInput = z.infer<typeof journalTypeSchema>;
type TemplateInput = z.infer<typeof distributionTemplateSchema>;
type RateInput = z.infer<typeof exchangeRateSchema>;

/** Smaller GL master data: dimensions, journal types, distribution templates, currencies and rates. */
@Injectable()
export class MastersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- dimensions

  listDimensionTypes(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT t.id, t.code, t.name_ar, t.name_en, t.is_active,
                COALESCE(json_agg(json_build_object('id', v.id, 'code', v.code, 'name_ar', v.name_ar, 'name_en', v.name_en, 'is_active', v.is_active)
                         ORDER BY v.code) FILTER (WHERE v.id IS NOT NULL), '[]') AS values
         FROM gl.dimension_types t LEFT JOIN gl.dimension_values v ON v.dimension_type_id = t.id
         WHERE t.company_id = $1 GROUP BY t.tenant_id, t.id ORDER BY t.code`,
        [ctx.companyId],
      ),
    );
  }

  saveDimensionType(ctx: CompanyContext, input: DimensionTypeInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const row = id
        ? await tx.maybeOne(
            `UPDATE gl.dimension_types SET code = $3, name_ar = $4, name_en = $5, is_active = $6 WHERE company_id = $1 AND id = $2 RETURNING *`,
            [ctx.companyId, id, input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.is_active],
          )
        : await tx.one(
            `INSERT INTO gl.dimension_types (tenant_id, company_id, code, name_ar, name_en, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
            [ctx.tenantId, ctx.companyId, input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.is_active],
          );
      if (!row) throw notFound('dimension');
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'dimension_type', entityId: row.id as string, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  saveDimensionValue(ctx: CompanyContext, input: DimensionValueInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const type = await tx.maybeOne('SELECT 1 FROM gl.dimension_types WHERE company_id = $1 AND id = $2', [ctx.companyId, input.dimension_type_id]);
      if (!type) throw notFound('dimension');
      const params = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.is_active];
      const row = id
        ? await tx.maybeOne(
            `UPDATE gl.dimension_values SET code = $3, name_ar = $4, name_en = $5, is_active = $6 WHERE company_id = $1 AND id = $2 RETURNING *`,
            [ctx.companyId, id, ...params],
          )
        : await tx.one(
            `INSERT INTO gl.dimension_values (tenant_id, company_id, dimension_type_id, code, name_ar, name_en, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [ctx.tenantId, ctx.companyId, input.dimension_type_id, ...params],
          );
      if (!row) throw notFound('dimension value');
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'dimension_value', entityId: row.id as string, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- journal types

  listJournalTypes(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) => tx.query('SELECT * FROM gl.journal_types WHERE company_id = $1 ORDER BY is_system, code', [ctx.companyId]));
  }

  saveJournalType(ctx: CompanyContext, input: JournalTypeInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      if (id) {
        const existing = await tx.maybeOne<{ is_system: boolean }>('SELECT is_system FROM gl.journal_types WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
        if (!existing) throw notFound('journal type');
        // System types keep their code; only names and the active flag may change.
        const row = await tx.one(
          `UPDATE gl.journal_types SET code = CASE WHEN is_system THEN code ELSE $3 END, name_ar = $4, name_en = $5, is_active = $6
           WHERE company_id = $1 AND id = $2 RETURNING *`,
          [ctx.companyId, id, input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.is_active],
        );
        await this.audit.record(tx, ctx, { action: 'update', entityType: 'journal_type', entityId: id, companyId: ctx.companyId, newData: input });
        return row;
      }
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_types (tenant_id, company_id, code, name_ar, name_en, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [ctx.tenantId, ctx.companyId, input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.is_active],
      );
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'journal_type', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- distribution templates

  listTemplates(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT t.id, t.code, t.name_ar, t.name_en, t.is_active,
                COALESCE(json_agg(json_build_object('cost_center_id', l.cost_center_id, 'percent', l.percent) ORDER BY l.line_no)
                         FILTER (WHERE l.line_no IS NOT NULL), '[]') AS lines
         FROM gl.distribution_templates t LEFT JOIN gl.distribution_template_lines l ON l.template_id = t.id
         WHERE t.company_id = $1 GROUP BY t.tenant_id, t.id ORDER BY t.code`,
        [ctx.companyId],
      ),
    );
  }

  saveTemplate(ctx: CompanyContext, input: TemplateInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      if (!sumAmounts(input.lines.map((l) => l.percent)).equals(100)) throw new AppError('DISTRIBUTION_NOT_100');
      await assertPostingCostCenters(tx, ctx.companyId, input.lines.map((l) => l.cost_center_id));
      const names = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.is_active];
      const row = id
        ? await tx.maybeOne<{ id: string }>(
            'UPDATE gl.distribution_templates SET code = $3, name_ar = $4, name_en = $5, is_active = $6 WHERE company_id = $1 AND id = $2 RETURNING *',
            [ctx.companyId, id, ...names],
          )
        : await tx.one<{ id: string }>(
            'INSERT INTO gl.distribution_templates (tenant_id, company_id, code, name_ar, name_en, is_active) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
            [ctx.tenantId, ctx.companyId, ...names],
          );
      if (!row) throw notFound('distribution template');
      await tx.query('DELETE FROM gl.distribution_template_lines WHERE template_id = $1', [row.id]);
      for (const [index, line] of input.lines.entries()) {
        await tx.query(
          `INSERT INTO gl.distribution_template_lines (tenant_id, company_id, template_id, line_no, cost_center_id, percent)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [ctx.tenantId, ctx.companyId, row.id, index + 1, line.cost_center_id, line.percent],
        );
      }
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'distribution_template', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- currencies & rates

  listCurrencies(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) => tx.query('SELECT * FROM core.currencies WHERE is_active ORDER BY code'));
  }

  listRates(ctx: CompanyContext, currency?: string) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT id, currency_code, rate_date, rate_type, rate FROM gl.exchange_rates
         WHERE company_id = $1 AND ($2::text IS NULL OR currency_code = $2)
         ORDER BY rate_date DESC, currency_code LIMIT 500`,
        [ctx.companyId, currency ?? null],
      ),
    );
  }

  saveRate(ctx: CompanyContext, input: RateInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const base = await tx.one<{ base_currency: string }>('SELECT base_currency FROM core.companies WHERE id = $1', [ctx.companyId]);
      if (base.base_currency === input.currency_code) {
        throw new AppError('VALIDATION_FAILED', {}, [{ path: 'currency_code', message: 'Base currency rate is always 1' }]);
      }
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.exchange_rates (tenant_id, company_id, currency_code, rate_date, rate_type, rate, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, company_id, currency_code, rate_type, rate_date) DO UPDATE SET rate = EXCLUDED.rate
         RETURNING id, currency_code, rate_date, rate_type, rate`,
        [ctx.tenantId, ctx.companyId, input.currency_code, input.rate_date, input.rate_type, input.rate, ctx.userId],
      );
      await this.audit.record(tx, ctx, { action: 'save', entityType: 'exchange_rate', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  deleteRate(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await tx.query('DELETE FROM gl.exchange_rates WHERE company_id = $1 AND id = $2 RETURNING *', [ctx.companyId, id]);
      if (!rows.length) throw notFound('exchange rate');
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'exchange_rate', entityId: id, companyId: ctx.companyId, oldData: rows[0] });
      return { deleted: true };
    });
  }
}

/** Latest rate on or before the date. */
export const findRate = async (tx: Tx, companyId: string, currency: string, date: string, type: RateType = 'SPOT'): Promise<string> => {
  const row = await tx.maybeOne<{ rate: string }>(
    `SELECT rate FROM gl.exchange_rates WHERE company_id = $1 AND currency_code = $2 AND rate_type = $3 AND rate_date <= $4
     ORDER BY rate_date DESC LIMIT 1`,
    [companyId, currency, type, date],
  );
  if (!row) throw new AppError('RATE_NOT_FOUND', { currency, date });
  return row.rate;
};

const assertPostingCostCenters = async (tx: Tx, companyId: string, ids: string[]): Promise<void> => {
  const rows = await tx.query<{ id: string }>(
    'SELECT id FROM gl.cost_centers WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_posting AND is_active',
    [companyId, ids],
  );
  if (rows.length !== new Set(ids).size) {
    throw new AppError('VALIDATION_FAILED', {}, [{ path: 'lines', message: 'Every cost center must be an active posting cost center' }]);
  }
};
