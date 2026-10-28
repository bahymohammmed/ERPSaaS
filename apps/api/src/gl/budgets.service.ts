import { Injectable } from '@nestjs/common';
import { roundToMinor, toMoney } from '@erp/shared';
import type { z } from 'zod';
import type { budgetGenerateSchema, budgetLinesSchema, budgetSchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { loadCompany } from './posting.engine';

type Budget = { id: string; code: string; fiscal_year_id: string; status: 'DRAFT' | 'APPROVED' };

/**
 * Budget versions per fiscal year. Lines are account × cost center (optional) × period, in the
 * account's natural sign: revenue and expenses are both entered as positive amounts.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT b.id, b.code, b.name_ar, b.name_en, b.fiscal_year_id, fy.code AS fiscal_year_code, b.status, b.created_at,
                (SELECT count(*)::int FROM gl.budget_lines l WHERE l.budget_id = b.id) AS line_count
         FROM gl.budgets b JOIN gl.fiscal_years fy ON fy.id = b.fiscal_year_id
         WHERE b.company_id = $1 ORDER BY fy.start_date DESC, b.code`,
        [ctx.companyId],
      ),
    );
  }

  save(ctx: CompanyContext, input: z.infer<typeof budgetSchema>, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      if (id) await this.editable(tx, ctx.companyId, id);
      const params = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.fiscal_year_id];
      const row = id
        ? await tx.one<{ id: string }>(
            'UPDATE gl.budgets SET code = $3, name_ar = $4, name_en = $5, fiscal_year_id = $6 WHERE company_id = $1 AND id = $2 RETURNING *',
            [ctx.companyId, id, ...params],
          )
        : await tx.one<{ id: string }>(
            'INSERT INTO gl.budgets (tenant_id, company_id, code, name_ar, name_en, fiscal_year_id, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [ctx.tenantId, ctx.companyId, ...params, ctx.userId],
          );
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'budget', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  remove(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.editable(tx, ctx.companyId, id);
      await tx.query('DELETE FROM gl.budgets WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'budget', entityId: id, companyId: ctx.companyId });
      return { deleted: true };
    });
  }

  setStatus(ctx: CompanyContext, id: string, status: 'DRAFT' | 'APPROVED') {
    return this.db.withTenant(ctx, async (tx) => {
      await this.find(tx, ctx.companyId, id);
      const row = await tx.one('UPDATE gl.budgets SET status = $3 WHERE company_id = $1 AND id = $2 RETURNING *', [ctx.companyId, id, status]);
      await this.audit.record(tx, ctx, { action: status === 'APPROVED' ? 'approve' : 'reopen', entityType: 'budget', entityId: id, companyId: ctx.companyId });
      return row;
    });
  }

  /** Lines for one cost center (or the company-level lines without a cost center). */
  lines(ctx: CompanyContext, id: string, costCenterId: string | null) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.find(tx, ctx.companyId, id);
      return tx.query(
        `SELECT account_id, cost_center_id, period_id, amount FROM gl.budget_lines
         WHERE budget_id = $1 AND cost_center_id IS NOT DISTINCT FROM $2::uuid`,
        [id, costCenterId],
      );
    });
  }

  /** Upserts lines; a zero amount removes the line. */
  saveLines(ctx: CompanyContext, id: string, input: z.infer<typeof budgetLinesSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      const budget = await this.editable(tx, ctx.companyId, id);
      const periods = new Set(
        (await tx.query<{ id: string }>('SELECT id FROM gl.fiscal_periods WHERE fiscal_year_id = $1', [budget.fiscal_year_id])).map((p) => p.id),
      );
      for (const line of input.lines) {
        if (!periods.has(line.period_id)) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'period_id', message: 'Period outside the budget year' }]);
        if (toMoney(line.amount).isZero()) {
          await tx.query(
            'DELETE FROM gl.budget_lines WHERE budget_id = $1 AND account_id = $2 AND cost_center_id IS NOT DISTINCT FROM $3::uuid AND period_id = $4',
            [id, line.account_id, line.cost_center_id ?? null, line.period_id],
          );
          continue;
        }
        await tx.query(
          `INSERT INTO gl.budget_lines (tenant_id, company_id, budget_id, account_id, cost_center_id, period_id, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT ON CONSTRAINT budget_lines_key DO UPDATE SET amount = EXCLUDED.amount`,
          [ctx.tenantId, ctx.companyId, id, line.account_id, line.cost_center_id ?? null, line.period_id, line.amount],
        );
      }
      await this.audit.record(tx, ctx, { action: 'save', entityType: 'budget_lines', entityId: id, companyId: ctx.companyId, newData: { count: input.lines.length } });
      return { saved: input.lines.length };
    });
  }

  /** Replaces all lines with a source year's P&L actuals (same period numbers), adjusted by a percentage. */
  generateFromActuals(ctx: CompanyContext, id: string, input: z.infer<typeof budgetGenerateSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      const budget = await this.editable(tx, ctx.companyId, id);
      const company = await loadCompany(tx, ctx.companyId);
      const actuals = await tx.query<{ account_id: string; cost_center_id: string | null; period_no: number; net: string; account_type: string }>(
        `SELECT b.account_id, ${input.by_cost_center ? 'b.cost_center_id' : 'NULL::uuid AS cost_center_id'}, p.period_no, a.account_type,
                sum(b.debit_base - b.credit_base) AS net
         FROM gl.account_balances b
         JOIN gl.fiscal_periods p ON p.id = b.period_id
         JOIN gl.accounts a ON a.id = b.account_id
         WHERE b.company_id = $1 AND p.fiscal_year_id = $2 AND NOT p.is_adjustment AND a.account_type IN ('REVENUE', 'EXPENSE')
         GROUP BY b.account_id, ${input.by_cost_center ? 'b.cost_center_id, ' : ''}p.period_no, a.account_type`,
        [ctx.companyId, input.source_fiscal_year_id],
      );
      const targetPeriods = new Map(
        (await tx.query<{ id: string; period_no: number }>('SELECT id, period_no FROM gl.fiscal_periods WHERE fiscal_year_id = $1 AND NOT is_adjustment', [budget.fiscal_year_id])).map(
          (p) => [p.period_no, p.id],
        ),
      );
      await tx.query('DELETE FROM gl.budget_lines WHERE budget_id = $1', [id]);
      const factor = toMoney(String(input.adjust_percent)).dividedBy(100).plus(1);
      let count = 0;
      for (const a of actuals) {
        const periodId = targetPeriods.get(a.period_no);
        if (!periodId) continue;
        const natural = a.account_type === 'REVENUE' ? toMoney(a.net).negated() : toMoney(a.net);
        const amount = roundToMinor(natural.times(factor), company.base_minor_units);
        if (amount.isZero()) continue;
        await tx.query(
          `INSERT INTO gl.budget_lines (tenant_id, company_id, budget_id, account_id, cost_center_id, period_id, amount)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [ctx.tenantId, ctx.companyId, id, a.account_id, a.cost_center_id, periodId, amount.toFixed(4)],
        );
        count++;
      }
      await this.audit.record(tx, ctx, { action: 'generate', entityType: 'budget', entityId: id, companyId: ctx.companyId, newData: input });
      return { lines: count };
    });
  }

  private async find(tx: Tx, companyId: string, id: string): Promise<Budget> {
    const row = await tx.maybeOne<Budget>('SELECT id, code, fiscal_year_id, status FROM gl.budgets WHERE company_id = $1 AND id = $2 FOR UPDATE', [companyId, id]);
    if (!row) throw notFound('budget');
    return row;
  }

  private async editable(tx: Tx, companyId: string, id: string): Promise<Budget> {
    const budget = await this.find(tx, companyId, id);
    if (budget.status === 'APPROVED') throw new AppError('BUDGET_APPROVED');
    return budget;
  }
}
