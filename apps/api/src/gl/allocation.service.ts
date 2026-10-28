import { Injectable } from '@nestjs/common';
import { type AllocationRuleInput, Money, type MoneyValue, roundToMinor, sumAmounts, toMoney, toStorage } from '@erp/shared';
import type { z } from 'zod';
import type { driverSchema, driverValuesSchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { descendantIds } from '../common/hierarchy';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import type { PeriodRow } from './fiscal.service';
import { type CompanyInfo, loadCompany, PostingEngine } from './posting.engine';

type Rule = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  step_no: number;
  method: 'FIXED' | 'DRIVER';
  driver_id: string | null;
  source_account_ids: string[];
  source_cost_center_ids: string[];
  target_account_id: string | null;
  targets: { cost_center_id: string; percent: string | null }[];
};

type PlannedLine = { account_id: string; cost_center_id: string; debit: MoneyValue; credit: MoneyValue };

export type RuleResult = {
  rule_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  step_no: number;
  allocated: string;
  entry_id: string | null;
  lines: { account_code: string; cost_center_code: string; debit: string; credit: string }[];
};

/**
 * Periodic reallocation of support cost-center costs to receiving cost centers, by fixed
 * percentages or by statistical drivers. Rules run in step order inside one transaction, so a
 * later step allocates what earlier steps moved into its source cost centers (step-down).
 */
@Injectable()
export class AllocationService {
  constructor(
    private readonly db: DbService,
    private readonly engine: PostingEngine,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- drivers

  listDrivers(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) => tx.query('SELECT * FROM gl.statistical_drivers WHERE company_id = $1 ORDER BY code', [ctx.companyId]));
  }

  saveDriver(ctx: CompanyContext, input: z.infer<typeof driverSchema>, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const params = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.unit, input.is_active];
      const row = id
        ? await tx.maybeOne<{ id: string }>(
            'UPDATE gl.statistical_drivers SET code = $3, name_ar = $4, name_en = $5, unit = $6, is_active = $7 WHERE company_id = $1 AND id = $2 RETURNING *',
            [ctx.companyId, id, ...params],
          )
        : await tx.one<{ id: string }>(
            'INSERT INTO gl.statistical_drivers (tenant_id, company_id, code, name_ar, name_en, unit, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [ctx.tenantId, ctx.companyId, ...params],
          );
      if (!row) throw notFound('driver');
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'statistical_driver', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  driverValues(ctx: CompanyContext, driverId: string, periodId: string) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query('SELECT cost_center_id, value FROM gl.driver_values WHERE company_id = $1 AND driver_id = $2 AND period_id = $3', [ctx.companyId, driverId, periodId]),
    );
  }

  /** Replaces the driver's values for one period. */
  setDriverValues(ctx: CompanyContext, driverId: string, input: z.infer<typeof driverValuesSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      const driver = await tx.maybeOne('SELECT 1 FROM gl.statistical_drivers WHERE company_id = $1 AND id = $2', [ctx.companyId, driverId]);
      if (!driver) throw notFound('driver');
      await tx.query('DELETE FROM gl.driver_values WHERE company_id = $1 AND driver_id = $2 AND period_id = $3', [ctx.companyId, driverId, input.period_id]);
      for (const v of input.values) {
        if (toMoney(v.value).isZero()) continue;
        await tx.query(
          `INSERT INTO gl.driver_values (tenant_id, company_id, driver_id, period_id, cost_center_id, value) VALUES ($1, $2, $3, $4, $5, $6)`,
          [ctx.tenantId, ctx.companyId, driverId, input.period_id, v.cost_center_id, v.value],
        );
      }
      await this.audit.record(tx, ctx, { action: 'save', entityType: 'driver_values', entityId: driverId, companyId: ctx.companyId, newData: input });
      return { saved: input.values.length };
    });
  }

  // ---------------------------------------------------------------- rules

  listRules(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) => this.loadRules(tx, ctx.companyId, false));
  }

  saveRule(ctx: CompanyContext, input: AllocationRuleInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      if (input.method === 'FIXED' && !sumAmounts(input.targets.map((t) => t.percent ?? '0')).equals(100)) throw new AppError('DISTRIBUTION_NOT_100');
      const sources = new Set(await descendantIds(tx, 'gl.cost_centers', ctx.companyId, input.source_cost_center_ids));
      if (input.targets.some((t) => sources.has(t.cost_center_id))) throw new AppError('ALLOCATION_TARGET_IS_SOURCE', { rule: input.code });
      const params = [
        input.code,
        input.name_ar || input.name_en,
        input.name_en || input.name_ar,
        input.step_no,
        input.method,
        input.method === 'DRIVER' ? input.driver_id : null,
        input.source_account_ids,
        input.source_cost_center_ids,
        input.target_account_id ?? null,
        input.is_active,
      ];
      const row = id
        ? await tx.maybeOne<{ id: string }>(
            `UPDATE gl.allocation_rules SET code = $3, name_ar = $4, name_en = $5, step_no = $6, method = $7, driver_id = $8,
               source_account_ids = $9, source_cost_center_ids = $10, target_account_id = $11, is_active = $12
             WHERE company_id = $1 AND id = $2 RETURNING id`,
            [ctx.companyId, id, ...params],
          )
        : await tx.one<{ id: string }>(
            `INSERT INTO gl.allocation_rules (tenant_id, company_id, code, name_ar, name_en, step_no, method, driver_id,
               source_account_ids, source_cost_center_ids, target_account_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
            [ctx.tenantId, ctx.companyId, ...params],
          );
      if (!row) throw notFound('allocation rule');
      await tx.query('DELETE FROM gl.allocation_targets WHERE rule_id = $1', [row.id]);
      for (const t of input.targets) {
        await tx.query(
          'INSERT INTO gl.allocation_targets (tenant_id, company_id, rule_id, cost_center_id, percent) VALUES ($1, $2, $3, $4, $5)',
          [ctx.tenantId, ctx.companyId, row.id, t.cost_center_id, input.method === 'FIXED' ? t.percent : null],
        );
      }
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'allocation_rule', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  removeRule(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await tx.query('DELETE FROM gl.allocation_rules WHERE company_id = $1 AND id = $2 RETURNING code', [ctx.companyId, id]);
      if (!rows.length) throw notFound('allocation rule');
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'allocation_rule', entityId: id, companyId: ctx.companyId, oldData: rows[0] });
      return { deleted: true };
    });
  }

  // ---------------------------------------------------------------- runs

  listRuns(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT r.id, r.period_id, p.code AS period_code, r.status, r.created_at, u.full_name AS created_by_name,
                (SELECT count(*)::int FROM gl.journal_entries e WHERE e.source_doc_type = 'ALLOCATION' AND e.source_doc_id = r.id::text AND e.reversal_of_id IS NULL) AS entries,
                (SELECT COALESCE(sum(e.total_debit), 0) FROM gl.journal_entries e WHERE e.source_doc_type = 'ALLOCATION' AND e.source_doc_id = r.id::text AND e.reversal_of_id IS NULL) AS total
         FROM gl.allocation_runs r JOIN gl.fiscal_periods p ON p.id = r.period_id LEFT JOIN core.users u ON u.id = r.created_by
         WHERE r.company_id = $1 ORDER BY r.created_at DESC`,
        [ctx.companyId],
      ),
    );
  }

  /** Executes the full run and rolls it back, returning exactly what would be posted. */
  preview(ctx: CompanyContext, periodId: string) {
    return this.db.previewWithTenant(ctx, (tx) => this.execute(tx, ctx, periodId));
  }

  run(ctx: CompanyContext, periodId: string) {
    return this.db.withTenant(ctx, (tx) => this.execute(tx, ctx, periodId));
  }

  reverseRun(ctx: CompanyContext, runId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const run = await tx.maybeOne<{ id: string; status: string; period_id: string }>(
        'SELECT id, status, period_id FROM gl.allocation_runs WHERE company_id = $1 AND id = $2 FOR UPDATE',
        [ctx.companyId, runId],
      );
      if (!run) throw notFound('allocation run');
      if (run.status !== 'POSTED') throw new AppError('JOURNAL_ALREADY_REVERSED');
      const company = await loadCompany(tx, ctx.companyId);
      const period = await tx.one<PeriodRow>('SELECT * FROM gl.fiscal_periods WHERE id = $1', [run.period_id]);
      const entries = await tx.query<{ id: string }>(
        `SELECT id FROM gl.journal_entries WHERE company_id = $1 AND source_doc_type = 'ALLOCATION' AND source_doc_id = $2
           AND reversal_of_id IS NULL AND status = 'POSTED' ORDER BY entry_seq DESC`,
        [ctx.companyId, runId],
      );
      for (const e of entries) await this.engine.reverse(tx, ctx, company, e.id, { period });
      await tx.query("UPDATE gl.allocation_runs SET status = 'REVERSED', reversed_by = $2, reversed_at = now() WHERE id = $1", [runId, ctx.userId]);
      await this.audit.record(tx, ctx, { action: 'reverse', entityType: 'allocation_run', entityId: runId, companyId: ctx.companyId });
      return { reversed: entries.length };
    });
  }

  private async execute(tx: Tx, ctx: CompanyContext, periodId: string): Promise<{ run_id: string; period_code: string; rules: RuleResult[] }> {
    const period = await tx.maybeOne<PeriodRow>('SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND id = $2', [ctx.companyId, periodId]);
    if (!period) throw notFound('period');
    const live = await tx.maybeOne('SELECT 1 FROM gl.allocation_runs WHERE company_id = $1 AND period_id = $2 AND status = $3', [ctx.companyId, periodId, 'POSTED']);
    if (live) throw new AppError('ALLOCATION_ALREADY_RUN');

    const company = await loadCompany(tx, ctx.companyId);
    const run = await tx.one<{ id: string }>('INSERT INTO gl.allocation_runs (tenant_id, company_id, period_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [
      ctx.tenantId,
      ctx.companyId,
      periodId,
      ctx.userId,
    ]);
    const type = await tx.one<{ id: string }>("SELECT id FROM gl.journal_types WHERE company_id = $1 AND code = 'ALC'", [ctx.companyId]);
    const codes = new Map(
      (await tx.query<{ id: string; code: string }>('SELECT id, code FROM gl.accounts WHERE company_id = $1 UNION ALL SELECT id, code FROM gl.cost_centers WHERE company_id = $1', [ctx.companyId])).map(
        (r) => [r.id, r.code],
      ),
    );

    const results: RuleResult[] = [];
    for (const rule of await this.loadRules(tx, ctx.companyId, true)) {
      const planned = await this.plan(tx, ctx, company, rule, period);
      const result: RuleResult = { rule_id: rule.id, code: rule.code, name_ar: rule.name_ar, name_en: rule.name_en, step_no: rule.step_no, allocated: '0', entry_id: null, lines: [] };
      results.push(result);
      if (planned.length === 0) continue;

      const entry = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date, description,
           source_module, source_doc_type, source_doc_id, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'GL', 'ALLOCATION', $8, $9) RETURNING id`,
        [
          ctx.tenantId,
          ctx.companyId,
          type.id,
          period.fiscal_year_id,
          period.id,
          period.end_date,
          `${rule.name_ar} ${period.code} / ${rule.name_en} ${period.code}`,
          run.id,
          ctx.userId,
        ],
      );
      for (const [index, l] of planned.entries()) {
        await tx.query(
          `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description, currency_code,
             exchange_rate, debit, credit, debit_base, credit_base)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $9, $10)`,
          [ctx.tenantId, ctx.companyId, entry.id, index + 1, l.account_id, l.cost_center_id, rule.code, company.base_currency, toStorage(l.debit), toStorage(l.credit)],
        );
      }
      const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
      await this.engine.post(tx, ctx, company, locked, { systemEntry: true });
      result.entry_id = entry.id;
      result.allocated = sumAmounts(planned.map((l) => l.credit)).toFixed(company.base_minor_units);
      result.lines = planned.map((l) => ({
        account_code: codes.get(l.account_id) ?? '',
        cost_center_code: codes.get(l.cost_center_id) ?? '',
        debit: l.debit.toFixed(company.base_minor_units),
        credit: l.credit.toFixed(company.base_minor_units),
      }));
    }
    if (results.every((r) => !r.entry_id)) throw new AppError('NOTHING_TO_PROCESS');
    await this.audit.record(tx, ctx, { action: 'run', entityType: 'allocation_run', entityId: run.id, companyId: ctx.companyId, newData: { period: period.code } });
    return { run_id: run.id, period_code: period.code, rules: results };
  }

  /** Lines for one rule from the period's current balances (including earlier steps of this run). */
  private async plan(tx: Tx, ctx: CompanyContext, company: CompanyInfo, rule: Rule, period: PeriodRow): Promise<PlannedLine[]> {
    const accountIds = await this.postingDescendants(tx, ctx.companyId, rule.source_account_ids);
    const sourceCcs = await descendantIds(tx, 'gl.cost_centers', ctx.companyId, rule.source_cost_center_ids);
    if (rule.targets.some((t) => sourceCcs.includes(t.cost_center_id))) throw new AppError('ALLOCATION_TARGET_IS_SOURCE', { rule: rule.code });

    let weights: { cost_center_id: string; weight: MoneyValue }[];
    if (rule.method === 'FIXED') {
      weights = rule.targets.map((t) => ({ cost_center_id: t.cost_center_id, weight: toMoney(t.percent) }));
    } else {
      const values = await tx.query<{ cost_center_id: string; value: string }>(
        'SELECT cost_center_id, value FROM gl.driver_values WHERE driver_id = $1 AND period_id = $2 AND cost_center_id = ANY($3::uuid[])',
        [rule.driver_id, period.id, rule.targets.map((t) => t.cost_center_id)],
      );
      weights = values.filter((v) => !toMoney(v.value).isZero()).map((v) => ({ cost_center_id: v.cost_center_id, weight: toMoney(v.value) }));
      if (weights.length === 0) throw new AppError('ALLOCATION_NO_DRIVER_VALUES', { rule: rule.code });
    }
    const totalWeight = sumAmounts(weights.map((w) => w.weight));

    const balances = await tx.query<{ account_id: string; cost_center_id: string; net: string }>(
      `SELECT account_id, cost_center_id, sum(debit_base - credit_base) AS net FROM gl.account_balances
       WHERE company_id = $1 AND period_id = $2 AND account_id = ANY($3::uuid[]) AND cost_center_id = ANY($4::uuid[])
       GROUP BY account_id, cost_center_id HAVING sum(debit_base - credit_base) <> 0
       ORDER BY account_id, cost_center_id`,
      [ctx.companyId, period.id, accountIds, sourceCcs],
    );

    const lines: PlannedLine[] = [];
    for (const b of balances) {
      const net = roundToMinor(b.net, company.base_minor_units);
      if (net.isZero()) continue;
      const zero = new Money(0);
      lines.push({ account_id: b.account_id, cost_center_id: b.cost_center_id, debit: net.isNegative() ? net.abs() : zero, credit: net.isPositive() ? net : zero });
      let remaining = net;
      weights.forEach((w, i) => {
        const share = i === weights.length - 1 ? remaining : roundToMinor(net.times(w.weight).dividedBy(totalWeight), company.base_minor_units);
        remaining = remaining.minus(share);
        if (share.isZero()) return;
        lines.push({
          account_id: rule.target_account_id ?? b.account_id,
          cost_center_id: w.cost_center_id,
          debit: share.isPositive() ? share : zero,
          credit: share.isNegative() ? share.abs() : zero,
        });
      });
    }
    return lines;
  }

  private async postingDescendants(tx: Tx, companyId: string, roots: string[]): Promise<string[]> {
    const ids = await descendantIds(tx, 'gl.accounts', companyId, roots);
    const rows = await tx.query<{ id: string }>('SELECT id FROM gl.accounts WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_posting', [companyId, ids]);
    return rows.map((r) => r.id);
  }

  private async loadRules(tx: Tx, companyId: string, activeOnly: boolean): Promise<Rule[]> {
    return tx.query<Rule>(
      `SELECT r.id, r.code, r.name_ar, r.name_en, r.step_no, r.method, r.driver_id, r.source_account_ids, r.source_cost_center_ids,
              r.target_account_id, r.is_active,
              COALESCE(json_agg(json_build_object('cost_center_id', t.cost_center_id, 'percent', t.percent)) FILTER (WHERE t.rule_id IS NOT NULL), '[]') AS targets
       FROM gl.allocation_rules r LEFT JOIN gl.allocation_targets t ON t.rule_id = r.id
       WHERE r.company_id = $1 AND (NOT $2 OR r.is_active)
       GROUP BY r.tenant_id, r.id ORDER BY r.step_no, r.code`,
      [companyId, activeOnly],
    );
  }
}
