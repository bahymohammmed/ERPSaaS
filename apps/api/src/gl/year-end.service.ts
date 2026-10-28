import { Injectable } from '@nestjs/common';
import { type AppropriationRuleInput, Money, type MoneyValue, roundToMinor, toMoney, toStorage } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { ensureCompanyDefaults } from './defaults';
import type { PeriodRow } from './fiscal.service';
import { type CompanyInfo, loadCompany, PostingEngine } from './posting.engine';

type FiscalYear = { id: string; code: string; start_date: string; end_date: string; status: 'OPEN' | 'CLOSED' };
type Rule = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  sequence: number;
  stage: 'EXPENSE' | 'RESERVE';
  base: 'PROFIT' | 'AFTER_RESERVE';
  percent: string;
  cap_percent_of_capital: string | null;
  capital_account_id: string | null;
  debit_account_id: string;
  credit_account_id: string;
};
type RuleAmount = Rule & { base_amount: string; computed: string; already_posted: string; amount: string; capped: boolean };

/** Entries that close the year carry these source types so reports and reopening can find them. */
export const YEAR_END_APPROPRIATION = 'YEAR_END';
export const YEAR_END_CLOSE = 'YEAR_END_CLOSE';

/**
 * Year-end close: statutory appropriations (KFAS, NLST, Zakat charged to profit; statutory reserve
 * transferred from retained earnings), then a closing entry that zeroes every revenue and expense
 * balance into retained earnings. Everything is posted in the adjustment period and can be reversed
 * by reopening the year.
 */
@Injectable()
export class YearEndService {
  constructor(
    private readonly db: DbService,
    private readonly engine: PostingEngine,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- rules

  listRules(ctx: CompanyContext) {
    return this.db.withTenant(ctx, async (tx) => {
      await ensureCompanyDefaults(tx, ctx.tenantId, ctx.companyId);
      return tx.query('SELECT * FROM gl.appropriation_rules WHERE company_id = $1 ORDER BY sequence, code', [ctx.companyId]);
    });
  }

  saveRule(ctx: CompanyContext, input: AppropriationRuleInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const params = [
        input.code,
        input.name_ar || input.name_en,
        input.name_en || input.name_ar,
        input.sequence,
        input.stage,
        input.base,
        input.percent,
        input.cap_percent_of_capital ?? null,
        input.capital_account_id ?? null,
        input.debit_account_id,
        input.credit_account_id,
        input.is_active,
      ];
      const row = id
        ? await tx.maybeOne<{ id: string }>(
            `UPDATE gl.appropriation_rules SET code = $3, name_ar = $4, name_en = $5, sequence = $6, stage = $7, base = $8, percent = $9,
               cap_percent_of_capital = $10, capital_account_id = $11, debit_account_id = $12, credit_account_id = $13, is_active = $14
             WHERE company_id = $1 AND id = $2 RETURNING id`,
            [ctx.companyId, id, ...params],
          )
        : await tx.one<{ id: string }>(
            `INSERT INTO gl.appropriation_rules (tenant_id, company_id, code, name_ar, name_en, sequence, stage, base, percent,
               cap_percent_of_capital, capital_account_id, debit_account_id, credit_account_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [ctx.tenantId, ctx.companyId, ...params],
          );
      if (!row) throw notFound('appropriation rule');
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'appropriation_rule', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- close

  preview(ctx: CompanyContext, fiscalYearId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      await ensureCompanyDefaults(tx, ctx.tenantId, ctx.companyId);
      const company = await loadCompany(tx, ctx.companyId);
      const year = await this.year(tx, ctx.companyId, fiscalYearId);
      return this.compute(tx, ctx, company, year);
    });
  }

  close(ctx: CompanyContext, fiscalYearId: string, applyAppropriations: boolean) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      if (!company.retained_earnings_account_id) throw new AppError('RETAINED_EARNINGS_MISSING');
      const year = await this.year(tx, ctx.companyId, fiscalYearId, true);
      if (year.status === 'CLOSED') throw new AppError('YEAR_ALREADY_CLOSED', { year: year.code });
      const summary = await this.compute(tx, ctx, company, year);
      if (summary.unposted > 0) throw new AppError('YEAR_HAS_UNPOSTED', { year: year.code, count: summary.unposted });
      const period = await this.closingPeriod(tx, ctx.companyId, year.id);
      const entries: { kind: string; entry_id: string }[] = [];

      if (applyAppropriations) {
        const charges = summary.rules.filter((r) => r.stage === 'EXPENSE' && !toMoney(r.amount).isZero());
        if (charges.length) {
          const id = await this.postEntry(tx, ctx, company, period, YEAR_END_APPROPRIATION, year.id, 'CLS',
            `الاستقطاعات القانونية ${year.code} / Statutory contributions ${year.code}`,
            charges.flatMap((r) => [
              { account_id: r.debit_account_id, cost_center_id: null, debit: toMoney(r.amount), credit: new Money(0), description: r.name_en },
              { account_id: r.credit_account_id, cost_center_id: null, debit: new Money(0), credit: toMoney(r.amount), description: r.name_en },
            ]),
          );
          entries.push({ kind: 'contributions', entry_id: id });
        }
      }

      // Closing entry: every revenue/expense balance (per cost center) against retained earnings.
      const balances = await tx.query<{ account_id: string; cost_center_id: string | null; net: string }>(
        `SELECT b.account_id, b.cost_center_id, sum(b.debit_base - b.credit_base) AS net
         FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id JOIN gl.accounts a ON a.id = b.account_id
         WHERE b.company_id = $1 AND p.fiscal_year_id = $2 AND a.account_type IN ('REVENUE', 'EXPENSE')
         GROUP BY b.account_id, b.cost_center_id HAVING sum(b.debit_base - b.credit_base) <> 0`,
        [ctx.companyId, year.id],
      );
      if (balances.length) {
        const zero = new Money(0);
        let total = new Money(0);
        const lines = balances.map((b) => {
          const net = toMoney(b.net);
          total = total.plus(net);
          return { account_id: b.account_id, cost_center_id: b.cost_center_id, debit: net.isNegative() ? net.abs() : zero, credit: net.isPositive() ? net : zero, description: null as string | null };
        });
        // Debit balances (a loss) close against a debit to retained earnings, and vice versa.
        lines.push({
          account_id: company.retained_earnings_account_id,
          cost_center_id: null,
          debit: total.isPositive() ? total : zero,
          credit: total.isNegative() ? total.abs() : zero,
          description: 'Result for the year / نتيجة السنة',
        });
        const id = await this.postEntry(tx, ctx, company, period, YEAR_END_CLOSE, year.id, 'CLS', `قيد إقفال السنة ${year.code} / Year-end closing ${year.code}`, lines);
        entries.push({ kind: 'closing', entry_id: id });
      }

      if (applyAppropriations) {
        const reserves = summary.rules.filter((r) => r.stage === 'RESERVE' && !toMoney(r.amount).isZero());
        if (reserves.length) {
          const id = await this.postEntry(tx, ctx, company, period, YEAR_END_APPROPRIATION, year.id, 'CLS',
            `تحويل إلى الاحتياطيات ${year.code} / Transfer to reserves ${year.code}`,
            reserves.flatMap((r) => [
              { account_id: r.debit_account_id, cost_center_id: null, debit: toMoney(r.amount), credit: new Money(0), description: r.name_en },
              { account_id: r.credit_account_id, cost_center_id: null, debit: new Money(0), credit: toMoney(r.amount), description: r.name_en },
            ]),
          );
          entries.push({ kind: 'reserves', entry_id: id });
        }
      }

      await tx.query("UPDATE gl.fiscal_years SET status = 'CLOSED', closed_at = now(), closed_by = $2 WHERE id = $1", [year.id, ctx.userId]);
      await tx.query(
        `UPDATE gl.period_statuses s SET status = 'CLOSED', updated_by = $2, updated_at = now()
         FROM gl.fiscal_periods p WHERE p.id = s.period_id AND p.fiscal_year_id = $1 AND s.module = 'GL' AND s.status = 'OPEN'`,
        [year.id, ctx.userId],
      );
      await this.audit.record(tx, ctx, { action: 'close_year', entityType: 'fiscal_year', entityId: year.id, companyId: ctx.companyId, newData: { entries } });
      return { ...summary, status: 'CLOSED', entries };
    });
  }

  /** Reverses the year-end entries and reopens the year (the adjustment period stays open). */
  reopen(ctx: CompanyContext, fiscalYearId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const year = await this.year(tx, ctx.companyId, fiscalYearId, true);
      if (year.status !== 'CLOSED') throw new AppError('YEAR_NOT_CLOSED', { year: year.code });
      const later = await tx.maybeOne<{ code: string }>("SELECT code FROM gl.fiscal_years WHERE company_id = $1 AND start_date > $2 AND status = 'CLOSED' LIMIT 1", [
        ctx.companyId,
        year.start_date,
      ]);
      if (later) throw new AppError('YEAR_ALREADY_CLOSED', { year: later.code });

      const period = await this.closingPeriod(tx, ctx.companyId, year.id);
      await tx.query("UPDATE gl.fiscal_years SET status = 'OPEN', closed_at = NULL, closed_by = NULL WHERE id = $1", [year.id]);
      await tx.query("UPDATE gl.period_statuses SET status = 'OPEN', updated_by = $2, updated_at = now() WHERE period_id = $1 AND module = 'GL'", [period.id, ctx.userId]);
      const entries = await tx.query<{ id: string }>(
        `SELECT id FROM gl.journal_entries WHERE company_id = $1 AND source_doc_type IN ($3, $4) AND source_doc_id = $2
           AND status = 'POSTED' AND reversal_of_id IS NULL ORDER BY posted_at DESC, entry_seq DESC`,
        [ctx.companyId, year.id, YEAR_END_APPROPRIATION, YEAR_END_CLOSE],
      );
      for (const e of entries) await this.engine.reverse(tx, ctx, company, e.id, { period });
      await this.audit.record(tx, ctx, { action: 'reopen_year', entityType: 'fiscal_year', entityId: year.id, companyId: ctx.companyId, newData: { reversed: entries.length } });
      return { reopened: true, reversed: entries.length };
    });
  }

  // ---------------------------------------------------------------- internals

  private async compute(tx: Tx, ctx: CompanyContext, company: CompanyInfo, year: FiscalYear) {
    const minor = company.base_minor_units;
    const unposted = await tx.one<{ count: number }>(
      "SELECT count(*)::int AS count FROM gl.journal_entries WHERE company_id = $1 AND fiscal_year_id = $2 AND status IN ('DRAFT', 'SUBMITTED', 'APPROVED')",
      [ctx.companyId, year.id],
    );
    const rules = await tx.query<Rule>('SELECT * FROM gl.appropriation_rules WHERE company_id = $1 AND is_active ORDER BY sequence, code', [ctx.companyId]);
    const yearNet = async (accountIds: string[] | null) =>
      toMoney(
        (
          await tx.one<{ net: string }>(
            `SELECT COALESCE(sum(b.credit_base - b.debit_base), 0) AS net
             FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id JOIN gl.accounts a ON a.id = b.account_id
             WHERE b.company_id = $1 AND p.fiscal_year_id = $2 AND a.account_type IN ('REVENUE', 'EXPENSE')
               AND ($3::uuid[] IS NULL OR b.account_id = ANY($3))`,
            [ctx.companyId, year.id, accountIds],
          )
        ).net,
      );
    const balanceUpTo = async (accountId: string) =>
      toMoney(
        (
          await tx.one<{ net: string }>(
            `SELECT COALESCE(sum(b.credit_base - b.debit_base), 0) AS net FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id
             WHERE b.company_id = $1 AND b.account_id = $2 AND p.end_date <= $3`,
            [ctx.companyId, accountId, year.end_date],
          )
        ).net,
      );

    const expenseRules = rules.filter((r) => r.stage === 'EXPENSE');
    const netProfit = await yearNet(null);
    // Contributions already charged (e.g. manually) are added back to get the profit they are based on.
    const alreadyCharged = expenseRules.length ? (await yearNet(expenseRules.map((r) => r.debit_account_id))).negated() : new Money(0);
    const profitBefore = netProfit.plus(alreadyCharged);
    const positive = profitBefore.isPositive() && !profitBefore.isZero();

    const results: RuleAmount[] = [];
    let reserveTotal = new Money(0);
    for (const rule of rules.filter((r) => r.stage === 'RESERVE')) {
      let amount = positive ? roundToMinor(profitBefore.times(rule.percent).dividedBy(100), minor) : new Money(0);
      const computed = amount;
      let capped = false;
      if (rule.cap_percent_of_capital && rule.capital_account_id) {
        const cap = (await balanceUpTo(rule.capital_account_id)).times(rule.cap_percent_of_capital).dividedBy(100);
        const room = Money.max(cap.minus(await balanceUpTo(rule.credit_account_id)), 0);
        if (amount.greaterThan(room)) {
          amount = roundToMinor(room, minor);
          capped = true;
        }
      }
      reserveTotal = reserveTotal.plus(amount);
      results.push({ ...rule, base_amount: profitBefore.toFixed(minor), computed: computed.toFixed(minor), already_posted: '0', amount: amount.toFixed(minor), capped });
    }
    let expenseTotal = new Money(0);
    for (const rule of expenseRules) {
      const base = rule.base === 'AFTER_RESERVE' ? profitBefore.minus(reserveTotal) : profitBefore;
      const computed = positive && base.isPositive() ? roundToMinor(base.times(rule.percent).dividedBy(100), minor) : new Money(0);
      const posted = (await yearNet([rule.debit_account_id])).negated();
      const amount = Money.max(computed.minus(posted), 0);
      expenseTotal = expenseTotal.plus(computed);
      results.push({ ...rule, base_amount: base.toFixed(minor), computed: computed.toFixed(minor), already_posted: posted.toFixed(minor), amount: amount.toFixed(minor), capped: false });
    }
    results.sort((a, b) => a.sequence - b.sequence);
    return {
      fiscal_year_id: year.id,
      fiscal_year_code: year.code,
      status: year.status,
      unposted: unposted.count,
      profit_before_contributions: profitBefore.toFixed(minor),
      contributions_total: expenseTotal.toFixed(minor),
      net_profit: profitBefore.minus(expenseTotal).toFixed(minor),
      reserves_total: reserveTotal.toFixed(minor),
      rules: results,
    };
  }

  private async postEntry(
    tx: Tx,
    ctx: CompanyContext,
    company: CompanyInfo,
    period: PeriodRow,
    sourceType: string,
    yearId: string,
    journalCode: string,
    description: string,
    lines: { account_id: string; cost_center_id: string | null; debit: MoneyValue; credit: MoneyValue; description: string | null }[],
  ): Promise<string> {
    const type = await tx.one<{ id: string }>('SELECT id FROM gl.journal_types WHERE company_id = $1 AND code = $2', [ctx.companyId, journalCode]);
    const entry = await tx.one<{ id: string }>(
      `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date, description,
         source_module, source_doc_type, source_doc_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'GL', $8, $9, $10) RETURNING id`,
      [ctx.tenantId, ctx.companyId, type.id, period.fiscal_year_id, period.id, period.end_date, description, sourceType, yearId, ctx.userId],
    );
    for (const [index, l] of lines.entries()) {
      await tx.query(
        `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description, currency_code,
           exchange_rate, debit, credit, debit_base, credit_base)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $9, $10)`,
        [ctx.tenantId, ctx.companyId, entry.id, index + 1, l.account_id, l.cost_center_id, l.description, company.base_currency, toStorage(l.debit), toStorage(l.credit)],
      );
    }
    const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
    await this.engine.post(tx, ctx, company, locked, { systemEntry: true });
    return entry.id;
  }

  /** The adjustment period when the year has one, otherwise its last month. */
  private async closingPeriod(tx: Tx, companyId: string, yearId: string): Promise<PeriodRow> {
    return tx.one<PeriodRow>('SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND fiscal_year_id = $2 ORDER BY period_no DESC LIMIT 1', [companyId, yearId]);
  }

  private async year(tx: Tx, companyId: string, id: string, lock = false): Promise<FiscalYear> {
    const row = await tx.maybeOne<FiscalYear>(`SELECT id, code, start_date, end_date, status FROM gl.fiscal_years WHERE company_id = $1 AND id = $2 ${lock ? 'FOR UPDATE' : ''}`, [
      companyId,
      id,
    ]);
    if (!row) throw notFound('fiscal year');
    return row;
  }
}
