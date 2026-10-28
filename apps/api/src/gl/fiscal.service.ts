import { Injectable } from '@nestjs/common';
import { MODULES, type ModuleCode, type PeriodStatus } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { addDays, addMonths, MONTH_NAMES_AR, MONTH_NAMES_EN, monthIndex } from '../common/dates';
import { assertPermission, type CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';

export type PeriodRow = {
  id: string;
  fiscal_year_id: string;
  period_no: number;
  code: string;
  name_ar: string;
  name_en: string;
  start_date: string;
  end_date: string;
  is_adjustment: boolean;
};

@Injectable()
export class FiscalService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  listYears(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query('SELECT * FROM gl.fiscal_years WHERE company_id = $1 ORDER BY start_date DESC', [ctx.companyId]),
    );
  }

  listPeriods(ctx: CompanyContext, fiscalYearId?: string) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT p.*, fy.code AS fiscal_year_code,
                COALESCE(jsonb_object_agg(s.module, s.status) FILTER (WHERE s.module IS NOT NULL), '{}') AS statuses
         FROM gl.fiscal_periods p
         JOIN gl.fiscal_years fy ON fy.id = p.fiscal_year_id
         LEFT JOIN gl.period_statuses s ON s.period_id = p.id
         WHERE p.company_id = $1 AND ($2::uuid IS NULL OR p.fiscal_year_id = $2)
         GROUP BY p.tenant_id, p.id, fy.code
         ORDER BY p.start_date, p.period_no`,
        [ctx.companyId, fiscalYearId ?? null],
      ),
    );
  }

  createYear(ctx: CompanyContext, input: { code: string; start_date: string; with_adjustment_period: boolean }) {
    return this.db.withTenant(ctx, async (tx) => {
      const year = await this.createYearTx(tx, ctx, input);
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'fiscal_year', entityId: year.id, companyId: ctx.companyId, newData: input });
      return year;
    });
  }

  /** Creates a 12-month fiscal year (+ optional adjustment period 13) with all module statuses OPEN. */
  async createYearTx(
    tx: Tx,
    ctx: Pick<CompanyContext, 'tenantId' | 'companyId'>,
    input: { code: string; start_date: string; with_adjustment_period: boolean },
  ): Promise<{ id: string; start_date: string; end_date: string }> {
    if (!input.start_date.endsWith('-01')) {
      throw new AppError('VALIDATION_FAILED', {}, [{ path: 'start_date', message: 'A fiscal year starts on the first day of a month' }]);
    }
    const endDate = addDays(addMonths(input.start_date, 12), -1);
    const overlap = await tx.maybeOne(
      'SELECT 1 FROM gl.fiscal_years WHERE company_id = $1 AND start_date <= $3 AND end_date >= $2',
      [ctx.companyId, input.start_date, endDate],
    );
    if (overlap) throw new AppError('FISCAL_YEAR_OVERLAP');

    const year = await tx.one<{ id: string; start_date: string; end_date: string }>(
      `INSERT INTO gl.fiscal_years (tenant_id, company_id, code, start_date, end_date)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, start_date, end_date`,
      [ctx.tenantId, ctx.companyId, input.code, input.start_date, endDate],
    );

    const periods: { no: number; start: string; end: string; code: string; ar: string; en: string; adj: boolean }[] = [];
    for (let i = 0; i < 12; i++) {
      const start = addMonths(input.start_date, i);
      const end = addDays(addMonths(input.start_date, i + 1), -1);
      const month = monthIndex(start);
      periods.push({
        no: i + 1,
        start,
        end,
        code: start.slice(0, 7),
        ar: `${MONTH_NAMES_AR[month]} ${start.slice(0, 4)}`,
        en: `${MONTH_NAMES_EN[month]} ${start.slice(0, 4)}`,
        adj: false,
      });
    }
    if (input.with_adjustment_period) {
      periods.push({
        no: 13,
        start: endDate,
        end: endDate,
        code: `${input.code}-13`,
        ar: `فترة التسويات ${input.code}`,
        en: `Adjustments ${input.code}`,
        adj: true,
      });
    }

    for (const p of periods) {
      const period = await tx.one<{ id: string }>(
        `INSERT INTO gl.fiscal_periods (tenant_id, company_id, fiscal_year_id, period_no, code, name_ar, name_en, start_date, end_date, is_adjustment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [ctx.tenantId, ctx.companyId, year.id, p.no, p.code, p.ar, p.en, p.start, p.end, p.adj],
      );
      await tx.query(
        `INSERT INTO gl.period_statuses (tenant_id, company_id, period_id, module, status)
         SELECT $1, $2, $3, m, 'OPEN' FROM unnest($4::text[]) AS m`,
        [ctx.tenantId, ctx.companyId, period.id, MODULES],
      );
    }
    return year;
  }

  setPeriodStatus(ctx: CompanyContext, periodId: string, module: ModuleCode, status: PeriodStatus) {
    return this.db.withTenant(ctx, async (tx) => {
      const period = await tx.maybeOne<PeriodRow>('SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND id = $2', [ctx.companyId, periodId]);
      if (!period) throw notFound('period');
      const current = await tx.one<{ status: PeriodStatus }>(
        'SELECT status FROM gl.period_statuses WHERE period_id = $1 AND module = $2 FOR UPDATE',
        [periodId, module],
      );
      if (current.status === status) return { period_id: periodId, module, status, warnings: [] };
      if (current.status === 'LOCKED') assertPermission(ctx, 'gl.period.unlock');

      const warnings: { code: string; params: Record<string, string | number> }[] = [];
      if (status !== 'OPEN' && module === 'GL') {
        const pending = await tx.one<{ count: number }>(
          `SELECT count(*)::int AS count FROM gl.journal_entries
           WHERE company_id = $1 AND period_id = $2 AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')`,
          [ctx.companyId, periodId],
        );
        if (pending.count > 0) warnings.push({ code: 'PERIOD_HAS_UNPOSTED', params: { period: period.code, count: pending.count } });
      }

      await tx.query(
        `UPDATE gl.period_statuses SET status = $3, updated_by = $4, updated_at = now() WHERE period_id = $1 AND module = $2`,
        [periodId, module, status, ctx.userId],
      );
      await this.audit.record(tx, ctx, {
        action: 'period_status',
        entityType: 'fiscal_period',
        entityId: periodId,
        companyId: ctx.companyId,
        oldData: { module, status: current.status },
        newData: { module, status },
      });
      return { period_id: periodId, module, status, warnings };
    });
  }

  /** Finds the posting period for a date (or the adjustment period when requested). */
  async resolvePeriod(tx: Tx, companyId: string, date: string, adjustment = false): Promise<PeriodRow> {
    if (adjustment) {
      const adj = await tx.maybeOne<PeriodRow>(
        'SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND is_adjustment AND end_date = $2',
        [companyId, date],
      );
      if (!adj) throw new AppError('ADJUSTMENT_PERIOD_DATE');
      return adj;
    }
    const period = await tx.maybeOne<PeriodRow>(
      'SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND NOT is_adjustment AND $2::date BETWEEN start_date AND end_date',
      [companyId, date],
    );
    if (!period) throw new AppError('PERIOD_NOT_FOUND', { date });
    return period;
  }

  async assertPeriodOpen(tx: Tx, period: PeriodRow, module: ModuleCode): Promise<void> {
    const row = await tx.maybeOne<{ status: PeriodStatus; year_status: string }>(
      `SELECT s.status, fy.status AS year_status
       FROM gl.period_statuses s JOIN gl.fiscal_years fy ON fy.id = $3
       WHERE s.period_id = $1 AND s.module = $2`,
      [period.id, module, period.fiscal_year_id],
    );
    const status = row?.year_status === 'CLOSED' ? 'CLOSED' : (row?.status ?? 'CLOSED');
    if (status !== 'OPEN') throw new AppError('PERIOD_NOT_OPEN', { period: period.code, status, module });
  }
}
