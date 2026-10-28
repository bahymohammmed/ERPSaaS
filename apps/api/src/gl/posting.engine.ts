import { Injectable } from '@nestjs/common';
import {
  convertToBase,
  fitsMinorUnits,
  type JournalLineInput,
  Money,
  type ModuleCode,
  type MoneyValue,
  roundToMinor,
  sumAmounts,
  toMoney,
  toStorage,
} from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { descendantIds } from '../common/hierarchy';
import type { CompanyContext } from '../common/request-context';
import type { Tx } from '../db/db.service';
import { FiscalService, type PeriodRow } from './fiscal.service';
import { findRate } from './masters.service';

export type CompanyInfo = {
  id: string;
  base_currency: string;
  base_minor_units: number;
  require_approval: boolean;
  approval_threshold: string | null;
  rounding_account_id: string | null;
  retained_earnings_account_id: string | null;
  fx_gain_account_id: string | null;
  fx_loss_account_id: string | null;
  budget_control: 'NONE' | 'WARN' | 'BLOCK';
  control_budget_id: string | null;
};

export type PostWarning = { code: 'BUDGET_EXCEEDED'; params: Record<string, string> };

export type EntryRow = {
  id: string;
  journal_type_id: string;
  journal_type_code: string;
  fiscal_year_id: string;
  fiscal_year_code: string;
  period_id: string;
  entry_date: string;
  status: string;
  source_module: ModuleCode;
  created_by: string;
  version: number;
  auto_reverse_date: string | null;
};

export type PostOptions = {
  /** Keep stored base amounts instead of recomputing them from the rate (reversals, revaluation). */
  preserveBase?: boolean;
  /** Allow lines with a base amount but no transaction amount (FX revaluation adjustments). */
  allowZeroTx?: boolean;
  /** Engine-generated entry: control-account ownership and user cost-center scope do not apply. */
  systemEntry?: boolean;
};

type LineRow = {
  id: string;
  line_no: number;
  account_id: string;
  cost_center_id: string | null;
  description: string | null;
  currency_code: string;
  exchange_rate: string;
  debit: string;
  credit: string;
  debit_base: string;
  credit_base: string;
  distribution_template_id: string | null;
  distribution: { cost_center_id: string; percent?: string; amount?: string }[] | null;
  is_rounding: boolean;
};

type AccountInfo = {
  id: string;
  code: string;
  is_posting: boolean;
  is_active: boolean;
  is_control: boolean;
  control_module: string | null;
  allowed_currencies: string[] | null;
  cost_center_rule: 'REQUIRED' | 'OPTIONAL' | 'NOT_ALLOWED';
};

type CostCenterInfo = { id: string; code: string; is_posting: boolean; is_active: boolean; valid_from: string | null; valid_to: string | null };

export const loadCompany = async (tx: Tx, companyId: string): Promise<CompanyInfo> =>
  tx.one<CompanyInfo>(
    `SELECT c.id, c.base_currency, cur.minor_units AS base_minor_units, c.require_approval, c.approval_threshold,
            c.rounding_account_id, c.retained_earnings_account_id, c.fx_gain_account_id, c.fx_loss_account_id,
            c.budget_control, c.control_budget_id
     FROM core.companies c JOIN core.currencies cur ON cur.code = c.base_currency WHERE c.id = $1`,
    [companyId],
  );

/**
 * The single path by which anything reaches the ledger. Validates every rule, expands
 * cost-center distributions, adds currency rounding, assigns the gapless number and
 * updates the balance summary — all inside the caller's transaction.
 */
@Injectable()
export class PostingEngine {
  constructor(
    private readonly fiscal: FiscalService,
    private readonly audit: AuditService,
  ) {}

  /** Inserts draft lines, resolving currency, rate and base amounts. Returns base totals. */
  async insertLines(
    tx: Tx,
    ctx: CompanyContext,
    company: CompanyInfo,
    entryId: string,
    entryDate: string,
    lines: JournalLineInput[],
  ): Promise<{ debit: MoneyValue; credit: MoneyValue }> {
    const minorUnits = await this.currencyMinorUnits(tx, lines.map((l) => l.currency_code ?? company.base_currency));
    let totalDebit = new Money(0);
    let totalCredit = new Money(0);

    for (const [index, line] of lines.entries()) {
      const lineNo = index + 1;
      const currency = line.currency_code ?? company.base_currency;
      const minor = minorUnits.get(currency);
      if (minor === undefined) throw new AppError('CURRENCY_INACTIVE', { currency });
      for (const amount of [line.debit, line.credit]) {
        if (!fitsMinorUnits(amount, minor)) throw new AppError('JOURNAL_LINE_PRECISION', { line: lineNo, currency, minor });
      }
      const rate = currency === company.base_currency ? '1' : (line.exchange_rate ?? (await findRate(tx, ctx.companyId, currency, entryDate)));
      const debitBase = convertToBase(line.debit, rate, company.base_minor_units);
      const creditBase = convertToBase(line.credit, rate, company.base_minor_units);
      totalDebit = totalDebit.plus(debitBase);
      totalCredit = totalCredit.plus(creditBase);

      const inserted = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description,
           currency_code, exchange_rate, debit, credit, debit_base, credit_base, distribution_template_id, distribution)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [
          ctx.tenantId,
          ctx.companyId,
          entryId,
          lineNo,
          line.account_id,
          line.distribution?.length || line.distribution_template_id ? null : (line.cost_center_id ?? null),
          line.description ?? null,
          currency,
          rate,
          toStorage(line.debit),
          toStorage(line.credit),
          toStorage(debitBase),
          toStorage(creditBase),
          line.distribution_template_id ?? null,
          line.distribution?.length ? JSON.stringify(line.distribution) : null,
        ],
      );
      for (const dim of line.dimensions) {
        await tx.query(
          `INSERT INTO gl.journal_line_dimensions (tenant_id, company_id, line_id, dimension_type_id, dimension_value_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [ctx.tenantId, ctx.companyId, inserted.id, dim.dimension_type_id, dim.dimension_value_id],
        );
      }
    }
    return { debit: totalDebit, credit: totalCredit };
  }

  async lockEntry(tx: Tx, companyId: string, entryId: string): Promise<EntryRow> {
    const entry = await tx.maybeOne<EntryRow>(
      `SELECT e.id, e.journal_type_id, jt.code AS journal_type_code, e.fiscal_year_id, fy.code AS fiscal_year_code,
              e.period_id, e.entry_date, e.status, e.source_module, e.created_by, e.version, e.auto_reverse_date
       FROM gl.journal_entries e
       JOIN gl.journal_types jt ON jt.id = e.journal_type_id
       JOIN gl.fiscal_years fy ON fy.id = e.fiscal_year_id
       WHERE e.company_id = $1 AND e.id = $2
       FOR UPDATE OF e`,
      [companyId, entryId],
    );
    if (!entry) throw notFound('journal entry');
    return entry;
  }

  /**
   * Full validation without side effects (used by submit and post).
   * Distributions are validated as they will be expanded.
   */
  async validate(tx: Tx, ctx: CompanyContext, company: CompanyInfo, entry: EntryRow): Promise<void> {
    const period = await this.period(tx, ctx.companyId, entry.period_id);
    await this.fiscal.assertPeriodOpen(tx, period, entry.source_module);
    const lines = await this.expandedLines(tx, ctx.companyId, company, entry.id);
    await this.validateLines(tx, ctx, entry, lines, {});
    this.balance(company, lines, false);
  }

  /** Posts a validated-or-not entry; caller has locked it and checked the workflow transition. */
  async post(tx: Tx, ctx: CompanyContext, company: CompanyInfo, entry: EntryRow, options: PostOptions = {}): Promise<{ entry_no: string; warnings: PostWarning[] }> {
    const period = await this.period(tx, ctx.companyId, entry.period_id);
    await this.fiscal.assertPeriodOpen(tx, period, entry.source_module);

    let lines = await this.expandedLines(tx, ctx.companyId, company, entry.id, options.preserveBase);
    await this.validateLines(tx, ctx, entry, lines, options);
    const rounding = this.balance(company, lines, true);
    if (rounding) lines = [...lines, rounding];
    const warnings = options.systemEntry ? [] : await this.checkBudget(tx, ctx, company, entry, period, lines);

    await this.rewriteLines(tx, ctx, entry.id, lines);

    const seq = await this.nextNumber(tx, ctx, entry);
    const entryNo = `${entry.journal_type_code}-${entry.fiscal_year_code}-${String(seq).padStart(6, '0')}`;
    const totalDebit = sumAmounts(lines.map((l) => l.debit_base));
    const totalCredit = sumAmounts(lines.map((l) => l.credit_base));

    await this.updateBalances(tx, ctx, entry.period_id, lines);
    await tx.query(
      `UPDATE gl.journal_entries
       SET status = 'POSTED', entry_seq = $3, entry_no = $4, total_debit = $5, total_credit = $6,
           posted_by = $7, posted_at = now(), updated_by = $7, version = version + 1
       WHERE company_id = $1 AND id = $2`,
      [ctx.companyId, entry.id, seq, entryNo, toStorage(totalDebit), toStorage(totalCredit), ctx.userId],
    );
    await this.audit.record(tx, ctx, {
      action: 'post',
      entityType: 'journal_entry',
      entityId: entry.id,
      companyId: ctx.companyId,
      newData: { entry_no: entryNo, total: toStorage(totalDebit) },
    });
    if (entry.auto_reverse_date) {
      await this.reverse(tx, ctx, company, entry.id, {
        date: entry.auto_reverse_date,
        description: `عكس تلقائي للقيد ${entryNo} / Auto-reversal of ${entryNo}`,
      });
    }
    return { entry_no: entryNo, warnings };
  }

  /**
   * Budget control: year-to-date actual (including this entry) per expense account — per cost
   * center when the budget is kept by cost center — must not exceed the year-to-date budget.
   * Unbudgeted accounts are not controlled. WARN returns warnings; BLOCK rejects the posting.
   */
  private async checkBudget(tx: Tx, ctx: CompanyContext, company: CompanyInfo, entry: EntryRow, period: PeriodRow, lines: LineRow[]): Promise<PostWarning[]> {
    if (company.budget_control === 'NONE' || !company.control_budget_id) return [];
    const budget = await tx.maybeOne<{ fiscal_year_id: string; status: string }>('SELECT fiscal_year_id, status FROM gl.budgets WHERE id = $1', [company.control_budget_id]);
    if (!budget || budget.status !== 'APPROVED' || budget.fiscal_year_id !== entry.fiscal_year_id) return [];

    const increases = new Map<string, { account_id: string; cost_center_id: string | null; amount: MoneyValue }>();
    for (const l of lines) {
      const amount = toMoney(l.debit_base).minus(l.credit_base);
      if (!amount.isPositive() || amount.isZero()) continue;
      const key = `${l.account_id}|${l.cost_center_id ?? ''}`;
      const current = increases.get(key);
      increases.set(key, { account_id: l.account_id, cost_center_id: l.cost_center_id, amount: (current?.amount ?? new Money(0)).plus(amount) });
    }
    if (increases.size === 0) return [];

    const warnings: PostWarning[] = [];
    const checked = new Set<string>();
    for (const inc of increases.values()) {
      const account = await tx.one<{ code: string; account_type: string }>('SELECT code, account_type FROM gl.accounts WHERE id = $1', [inc.account_id]);
      if (account.account_type !== 'EXPENSE') continue;
      // Budget kept for this cost center? Otherwise fall back to the account-level budget.
      const byCostCenter = inc.cost_center_id
        ? await tx.maybeOne<{ total: string }>(
            `SELECT sum(l.amount) AS total FROM gl.budget_lines l JOIN gl.fiscal_periods p ON p.id = l.period_id
             WHERE l.budget_id = $1 AND l.account_id = $2 AND l.cost_center_id = $3 AND p.period_no <= $4 HAVING count(*) > 0`,
            [company.control_budget_id, inc.account_id, inc.cost_center_id, period.period_no],
          )
        : null;
      const level = byCostCenter ? 'cc' : 'account';
      const key = level === 'cc' ? `${inc.account_id}|${inc.cost_center_id}` : inc.account_id;
      if (checked.has(key)) continue;
      checked.add(key);
      const budgetRow =
        byCostCenter ??
        (await tx.maybeOne<{ total: string }>(
          `SELECT sum(l.amount) AS total FROM gl.budget_lines l JOIN gl.fiscal_periods p ON p.id = l.period_id
           WHERE l.budget_id = $1 AND l.account_id = $2 AND p.period_no <= $3 HAVING count(*) > 0`,
          [company.control_budget_id, inc.account_id, period.period_no],
        ));
      if (!budgetRow) continue;
      const actual = await tx.one<{ net: string }>(
        `SELECT COALESCE(sum(b.debit_base - b.credit_base), 0) AS net FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id
         WHERE b.company_id = $1 AND b.account_id = $2 AND p.fiscal_year_id = $3 AND p.period_no <= $4
           AND ($5::uuid IS NULL OR b.cost_center_id = $5)`,
        [ctx.companyId, inc.account_id, entry.fiscal_year_id, period.period_no, level === 'cc' ? inc.cost_center_id : null],
      );
      const thisEntry = [...increases.values()]
        .filter((x) => x.account_id === inc.account_id && (level === 'account' || x.cost_center_id === inc.cost_center_id))
        .reduce((acc, x) => acc.plus(x.amount), new Money(0));
      const projected = toMoney(actual.net).plus(thisEntry);
      if (projected.lessThanOrEqualTo(budgetRow.total)) continue;
      const ccCode = level === 'cc' ? (await tx.one<{ code: string }>('SELECT code FROM gl.cost_centers WHERE id = $1', [inc.cost_center_id])).code : '';
      const warning: PostWarning = {
        code: 'BUDGET_EXCEEDED',
        params: {
          account: account.code,
          costCenter: ccCode ? ` / ${ccCode}` : '',
          actual: projected.toFixed(company.base_minor_units),
          budget: toMoney(budgetRow.total).toFixed(company.base_minor_units),
        },
      };
      if (company.budget_control === 'BLOCK') throw new AppError('BUDGET_EXCEEDED', warning.params);
      warnings.push(warning);
    }
    return warnings;
  }

  /**
   * Posts a mirror entry (debits and credits swapped, same rates and base amounts) and marks
   * the original REVERSED. Returns the reversal's id.
   */
  async reverse(
    tx: Tx,
    ctx: CompanyContext,
    company: CompanyInfo,
    entryId: string,
    input: { date?: string; description?: string; period?: PeriodRow },
  ): Promise<string> {
    const original = await this.lockEntry(tx, ctx.companyId, entryId);
    if (original.status === 'REVERSED') throw new AppError('JOURNAL_ALREADY_REVERSED');
    if (original.status !== 'POSTED') throw new AppError('JOURNAL_INVALID_TRANSITION', { action: 'reverse', status: original.status });

    const header = await tx.one<{ entry_no: string; reference: string | null; source_doc_type: string | null; source_doc_id: string | null }>(
      'SELECT entry_no, reference, source_doc_type, source_doc_id FROM gl.journal_entries WHERE id = $1',
      [entryId],
    );
    // An explicit period lets year-end reversals land in the adjustment period rather than month 12.
    const reversalDate = input.period?.end_date ?? input.date ?? original.entry_date;
    const period = input.period ?? (await this.fiscal.resolvePeriod(tx, ctx.companyId, reversalDate));
    const revType = await tx.one<{ id: string }>("SELECT id FROM gl.journal_types WHERE company_id = $1 AND code = 'REV'", [ctx.companyId]);
    const reversal = await tx.one<{ id: string }>(
      `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date,
         description, reference, source_module, source_doc_type, source_doc_id, reversal_of_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        ctx.tenantId,
        ctx.companyId,
        revType.id,
        period.fiscal_year_id,
        period.id,
        reversalDate,
        input.description ?? `عكس القيد ${header.entry_no} / Reversal of ${header.entry_no}`,
        header.reference,
        original.source_module,
        header.source_doc_type,
        header.source_doc_id,
        entryId,
        ctx.userId,
      ],
    );
    const lines = await tx.query<{ id: string }>('SELECT id FROM gl.journal_lines WHERE entry_id = $1 ORDER BY line_no', [entryId]);
    for (const line of lines) {
      const copy = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description,
           currency_code, exchange_rate, debit, credit, debit_base, credit_base, is_rounding)
         SELECT tenant_id, company_id, $2, line_no, account_id, cost_center_id, description, currency_code, exchange_rate,
                credit, debit, credit_base, debit_base, is_rounding
         FROM gl.journal_lines WHERE id = $1 RETURNING id`,
        [line.id, reversal.id],
      );
      await tx.query(
        `INSERT INTO gl.journal_line_dimensions (tenant_id, company_id, line_id, dimension_type_id, dimension_value_id)
         SELECT tenant_id, company_id, $2, dimension_type_id, dimension_value_id FROM gl.journal_line_dimensions WHERE line_id = $1`,
        [line.id, copy.id],
      );
    }
    const reversalEntry = await this.lockEntry(tx, ctx.companyId, reversal.id);
    // A reversal mirrors what was posted, so it is exempt from rules that may have changed since.
    await this.post(tx, ctx, company, reversalEntry, { preserveBase: true, allowZeroTx: true, systemEntry: true });
    await tx.query(
      `UPDATE gl.journal_entries SET status = 'REVERSED', reversed_by_id = $3, updated_by = $4, version = version + 1
       WHERE company_id = $1 AND id = $2`,
      [ctx.companyId, entryId, reversal.id, ctx.userId],
    );
    await this.audit.record(tx, ctx, { action: 'reverse', entityType: 'journal_entry', entityId: entryId, companyId: ctx.companyId, newData: { reversal_id: reversal.id } });
    return reversal.id;
  }

  // ---------------------------------------------------------------- internals

  private async period(tx: Tx, companyId: string, periodId: string): Promise<PeriodRow> {
    return tx.one<PeriodRow>('SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND id = $2', [companyId, periodId]);
  }

  private async currencyMinorUnits(tx: Tx, codes: string[]): Promise<Map<string, number>> {
    const rows = await tx.query<{ code: string; minor_units: number }>(
      'SELECT code, minor_units FROM core.currencies WHERE code = ANY($1::text[]) AND is_active',
      [[...new Set(codes)]],
    );
    return new Map(rows.map((r) => [r.code, r.minor_units]));
  }

  /** Lines as they will be posted: distributions split into one line per cost center. */
  private async expandedLines(tx: Tx, companyId: string, company: CompanyInfo, entryId: string, preserveBase = false): Promise<(LineRow & { dimensions: { dimension_type_id: string; dimension_value_id: string }[] })[]> {
    const rows = await tx.query<LineRow & { dimensions: { dimension_type_id: string; dimension_value_id: string }[] }>(
      `SELECT l.id, l.line_no, l.account_id, l.cost_center_id, l.description, l.currency_code, l.exchange_rate, l.debit, l.credit,
              l.debit_base, l.credit_base, l.distribution_template_id, l.distribution, l.is_rounding,
              COALESCE(json_agg(json_build_object('dimension_type_id', d.dimension_type_id, 'dimension_value_id', d.dimension_value_id))
                       FILTER (WHERE d.line_id IS NOT NULL), '[]') AS dimensions
       FROM gl.journal_lines l LEFT JOIN gl.journal_line_dimensions d ON d.line_id = l.id
       WHERE l.company_id = $1 AND l.entry_id = $2
       GROUP BY l.tenant_id, l.id ORDER BY l.line_no`,
      [companyId, entryId],
    );
    const minorUnits = await this.currencyMinorUnits(tx, rows.map((r) => r.currency_code));
    const result: typeof rows = [];

    for (const row of rows) {
      const minor = minorUnits.get(row.currency_code) ?? 2;
      if (!preserveBase && !row.is_rounding) {
        row.debit_base = convertToBase(row.debit, row.exchange_rate, company.base_minor_units).toFixed(company.base_minor_units);
        row.credit_base = convertToBase(row.credit, row.exchange_rate, company.base_minor_units).toFixed(company.base_minor_units);
      }
      let split: { cost_center_id: string; percent?: string; amount?: string }[] | null = row.distribution;
      if (row.distribution_template_id) {
        split = await tx.query<{ cost_center_id: string; percent: string }>(
          'SELECT cost_center_id, percent FROM gl.distribution_template_lines WHERE template_id = $1 ORDER BY line_no',
          [row.distribution_template_id],
        );
      }
      if (!split?.length) {
        result.push(row);
        continue;
      }
      result.push(...splitLine(row, split, minor, company.base_minor_units));
    }
    return result;
  }

  private async validateLines(
    tx: Tx,
    ctx: CompanyContext,
    entry: EntryRow,
    lines: (LineRow & { dimensions: { dimension_type_id: string; dimension_value_id: string }[] })[],
    options: PostOptions,
  ): Promise<void> {
    if (lines.length < 2) throw new AppError('JOURNAL_TOO_FEW_LINES');

    const accounts = new Map(
      (
        await tx.query<AccountInfo>(
          `SELECT id, code, is_posting, is_active, is_control, control_module, allowed_currencies, cost_center_rule
           FROM gl.accounts WHERE company_id = $1 AND id = ANY($2::uuid[])`,
          [ctx.companyId, [...new Set(lines.map((l) => l.account_id))]],
        )
      ).map((a) => [a.id, a]),
    );
    const ccIds = [...new Set(lines.map((l) => l.cost_center_id).filter((id): id is string => !!id))];
    const costCenters = new Map(
      (
        await tx.query<CostCenterInfo>(
          'SELECT id, code, is_posting, is_active, valid_from, valid_to FROM gl.cost_centers WHERE company_id = $1 AND id = ANY($2::uuid[])',
          [ctx.companyId, ccIds],
        )
      ).map((c) => [c.id, c]),
    );
    const whitelistRows = await tx.query<{ account_id: string; cost_center_id: string }>(
      'SELECT account_id, cost_center_id FROM gl.account_cost_centers WHERE company_id = $1 AND account_id = ANY($2::uuid[])',
      [ctx.companyId, [...accounts.keys()]],
    );
    const whitelist = new Map<string, Set<string>>();
    for (const accountId of new Set(whitelistRows.map((w) => w.account_id))) {
      const roots = whitelistRows.filter((w) => w.account_id === accountId).map((w) => w.cost_center_id);
      whitelist.set(accountId, new Set(await descendantIds(tx, 'gl.cost_centers', ctx.companyId, roots)));
    }
    const dimensionRules = await tx.query<{ account_id: string; dimension_type_id: string; rule: string; name_ar: string; name_en: string }>(
      `SELECT r.account_id, r.dimension_type_id, r.rule, t.name_ar, t.name_en
       FROM gl.account_dimension_rules r JOIN gl.dimension_types t ON t.id = r.dimension_type_id
       WHERE r.company_id = $1 AND r.account_id = ANY($2::uuid[])`,
      [ctx.companyId, [...accounts.keys()]],
    );
    const dimensionValueIds = [...new Set(lines.flatMap((l) => l.dimensions.map((d) => d.dimension_value_id)))];
    const activeValues = new Set(
      (
        await tx.query<{ id: string }>(
          `SELECT v.id FROM gl.dimension_values v JOIN gl.dimension_types t ON t.id = v.dimension_type_id
           WHERE v.company_id = $1 AND v.id = ANY($2::uuid[]) AND v.is_active AND t.is_active`,
          [ctx.companyId, dimensionValueIds],
        )
      ).map((r) => r.id),
    );
    const scope = ctx.costCenterScope && !options.systemEntry ? new Set(await descendantIds(tx, 'gl.cost_centers', ctx.companyId, ctx.costCenterScope)) : null;

    for (const [index, line] of lines.entries()) {
      const lineNo = index + 1;
      const account = accounts.get(line.account_id);
      if (!account || !account.is_posting || (!account.is_active && !options.systemEntry)) {
        throw new AppError('LINE_ACCOUNT_INVALID', { line: lineNo, code: account?.code ?? '?' });
      }
      const debit = toMoney(line.debit);
      const credit = toMoney(line.credit);
      const baseOnly = options.allowZeroTx && debit.isZero() && credit.isZero();
      const amountsInvalid = baseOnly
        ? toMoney(line.debit_base).isZero() === toMoney(line.credit_base).isZero()
        : debit.isNegative() || credit.isNegative() || debit.isZero() === credit.isZero();
      if (amountsInvalid) throw new AppError('JOURNAL_LINE_AMOUNT', { line: lineNo });
      // Engine-generated entries derive from balances already in the ledger; master-data rules
      // that may have changed since (inactive cost centers, new restrictions) do not apply to them.
      if (line.is_rounding || options.systemEntry) continue;

      if (account.allowed_currencies && !account.allowed_currencies.includes(line.currency_code)) {
        throw new AppError('LINE_ACCOUNT_CURRENCY', { line: lineNo, code: account.code, currency: line.currency_code });
      }
      if (account.is_control && account.control_module !== entry.source_module) {
        throw new AppError('LINE_CONTROL_ACCOUNT', { line: lineNo, code: account.code, module: account.control_module ?? '' });
      }

      if (account.cost_center_rule === 'REQUIRED' && !line.cost_center_id) {
        throw new AppError('LINE_COST_CENTER_REQUIRED', { line: lineNo, code: account.code });
      }
      if (account.cost_center_rule === 'NOT_ALLOWED' && line.cost_center_id) {
        throw new AppError('LINE_COST_CENTER_NOT_ALLOWED', { line: lineNo, code: account.code });
      }
      if (line.cost_center_id) {
        const cc = costCenters.get(line.cost_center_id);
        const outsideDates = !!cc && ((cc.valid_from && entry.entry_date < cc.valid_from) || (cc.valid_to && entry.entry_date > cc.valid_to));
        if (!cc || !cc.is_posting || !cc.is_active || outsideDates) {
          throw new AppError('LINE_COST_CENTER_INVALID', { line: lineNo, code: cc?.code ?? '?' });
        }
        const allowed = whitelist.get(account.id);
        if (allowed && !allowed.has(cc.id)) {
          throw new AppError('LINE_COST_CENTER_RESTRICTED', { line: lineNo, code: cc.code, account: account.code });
        }
        if (scope && !scope.has(cc.id)) throw new AppError('OUT_OF_SCOPE');
      }

      const lineDims = new Set(line.dimensions.map((d) => d.dimension_type_id));
      for (const rule of dimensionRules.filter((r) => r.account_id === account.id)) {
        const dimension = rule.name_en || rule.name_ar;
        if (rule.rule === 'REQUIRED' && !lineDims.has(rule.dimension_type_id)) {
          throw new AppError('LINE_DIMENSION_REQUIRED', { line: lineNo, code: account.code, dimension });
        }
        if (rule.rule === 'NOT_ALLOWED' && lineDims.has(rule.dimension_type_id)) {
          throw new AppError('LINE_DIMENSION_NOT_ALLOWED', { line: lineNo, code: account.code, dimension });
        }
      }
      if (line.dimensions.some((d) => !activeValues.has(d.dimension_value_id))) {
        throw new AppError('LINE_DIMENSION_INVALID', { line: lineNo });
      }
    }
  }

  /**
   * Checks the entry balances. Single-currency entries must balance in transaction currency;
   * every entry must balance in base currency, where a difference of at most one base minor
   * unit per line is attributed to currency rounding and booked to the rounding account.
   */
  private balance(company: CompanyInfo, lines: LineRow[], createRounding: boolean): (LineRow & { dimensions: [] }) | null {
    const currencies = new Set(lines.map((l) => l.currency_code));
    if (currencies.size === 1) {
      const debit = sumAmounts(lines.map((l) => l.debit));
      const credit = sumAmounts(lines.map((l) => l.credit));
      if (!debit.equals(credit)) throw new AppError('JOURNAL_UNBALANCED', { debit: debit.toString(), credit: credit.toString() });
    }
    const debitBase = sumAmounts(lines.map((l) => l.debit_base));
    const creditBase = sumAmounts(lines.map((l) => l.credit_base));
    const diff = debitBase.minus(creditBase);
    if (diff.isZero()) return null;

    const tolerance = new Money(10).pow(-company.base_minor_units).times(lines.length);
    if (diff.abs().greaterThan(tolerance)) {
      throw new AppError('JOURNAL_UNBALANCED', { debit: debitBase.toString(), credit: creditBase.toString() });
    }
    if (!company.rounding_account_id) throw new AppError('ROUNDING_ACCOUNT_MISSING');
    if (!createRounding) return null;
    const amount = roundToMinor(diff.abs(), company.base_minor_units).toFixed(company.base_minor_units);
    return {
      id: '',
      line_no: lines.length + 1,
      account_id: company.rounding_account_id,
      cost_center_id: null,
      description: 'Currency rounding / فروقات تقريب العملة',
      currency_code: company.base_currency,
      exchange_rate: '1',
      debit: diff.isNegative() ? amount : '0',
      credit: diff.isNegative() ? '0' : amount,
      debit_base: diff.isNegative() ? amount : '0',
      credit_base: diff.isNegative() ? '0' : amount,
      distribution_template_id: null,
      distribution: null,
      is_rounding: true,
      dimensions: [],
    };
  }

  /** Replaces the draft lines with the final posted lines (expanded, recalculated, renumbered). */
  private async rewriteLines(
    tx: Tx,
    ctx: CompanyContext,
    entryId: string,
    lines: (LineRow & { dimensions: { dimension_type_id: string; dimension_value_id: string }[] })[],
  ): Promise<void> {
    await tx.query('DELETE FROM gl.journal_lines WHERE company_id = $1 AND entry_id = $2', [ctx.companyId, entryId]);
    for (const [index, line] of lines.entries()) {
      const inserted = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description,
           currency_code, exchange_rate, debit, credit, debit_base, credit_base, is_rounding)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          ctx.tenantId,
          ctx.companyId,
          entryId,
          index + 1,
          line.account_id,
          line.cost_center_id,
          line.description,
          line.currency_code,
          line.exchange_rate,
          toStorage(line.debit),
          toStorage(line.credit),
          toStorage(line.debit_base),
          toStorage(line.credit_base),
          line.is_rounding,
        ],
      );
      for (const dim of line.dimensions) {
        await tx.query(
          `INSERT INTO gl.journal_line_dimensions (tenant_id, company_id, line_id, dimension_type_id, dimension_value_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [ctx.tenantId, ctx.companyId, inserted.id, dim.dimension_type_id, dim.dimension_value_id],
        );
      }
    }
  }

  /** Gapless: the counter row is locked until the posting transaction commits or rolls back. */
  private async nextNumber(tx: Tx, ctx: CompanyContext, entry: EntryRow): Promise<number> {
    await tx.query(
      `INSERT INTO gl.number_sequences (tenant_id, company_id, journal_type_id, fiscal_year_id, last_no)
       VALUES ($1, $2, $3, $4, 0) ON CONFLICT DO NOTHING`,
      [ctx.tenantId, ctx.companyId, entry.journal_type_id, entry.fiscal_year_id],
    );
    const row = await tx.one<{ last_no: number }>(
      `UPDATE gl.number_sequences SET last_no = last_no + 1
       WHERE company_id = $1 AND journal_type_id = $2 AND fiscal_year_id = $3 RETURNING last_no`,
      [ctx.companyId, entry.journal_type_id, entry.fiscal_year_id],
    );
    return row.last_no;
  }

  private async updateBalances(tx: Tx, ctx: CompanyContext, periodId: string, lines: LineRow[]): Promise<void> {
    const groups = new Map<string, { account: string; cc: string | null; currency: string; d: MoneyValue; c: MoneyValue; db: MoneyValue; cb: MoneyValue }>();
    for (const l of lines) {
      const key = `${l.account_id}|${l.cost_center_id ?? ''}|${l.currency_code}`;
      const g = groups.get(key) ?? { account: l.account_id, cc: l.cost_center_id, currency: l.currency_code, d: new Money(0), c: new Money(0), db: new Money(0), cb: new Money(0) };
      g.d = g.d.plus(l.debit);
      g.c = g.c.plus(l.credit);
      g.db = g.db.plus(l.debit_base);
      g.cb = g.cb.plus(l.credit_base);
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      await tx.query(
        `INSERT INTO gl.account_balances (tenant_id, company_id, period_id, account_id, cost_center_id, currency_code, debit, credit, debit_base, credit_base)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT ON CONSTRAINT account_balances_key DO UPDATE SET
           debit = account_balances.debit + EXCLUDED.debit,
           credit = account_balances.credit + EXCLUDED.credit,
           debit_base = account_balances.debit_base + EXCLUDED.debit_base,
           credit_base = account_balances.credit_base + EXCLUDED.credit_base`,
        [ctx.tenantId, ctx.companyId, periodId, g.account, g.cc, g.currency, toStorage(g.d), toStorage(g.c), toStorage(g.db), toStorage(g.cb)],
      );
    }
  }
}

/**
 * Splits one line across cost centers. Every piece is rounded to the currency's minor
 * units; the last piece takes the remainder so the pieces sum exactly to the original
 * in both transaction and base currency.
 */
export const splitLine = <L extends LineRow>(
  line: L,
  split: { cost_center_id: string; percent?: string; amount?: string }[],
  txMinor: number,
  baseMinor: number,
): L[] => {
  const isDebit = !toMoney(line.debit).isZero();
  const total = toMoney(isDebit ? line.debit : line.credit);
  const totalBase = toMoney(isDebit ? line.debit_base : line.credit_base);

  const byAmount = split.every((s) => s.amount !== undefined && s.amount !== null);
  if (byAmount) {
    if (!sumAmounts(split.map((s) => s.amount ?? '0')).equals(total)) {
      throw new AppError('DISTRIBUTION_AMOUNTS_MISMATCH', { line: line.line_no });
    }
  } else if (!sumAmounts(split.map((s) => s.percent ?? '0')).equals(100)) {
    throw new AppError('DISTRIBUTION_NOT_100');
  }

  let remaining = total;
  let remainingBase = totalBase;
  return split.map((s, i) => {
    const last = i === split.length - 1;
    const share = byAmount ? toMoney(s.amount).dividedBy(total.isZero() ? 1 : total) : toMoney(s.percent).dividedBy(100);
    const amount = last ? remaining : roundToMinor(byAmount ? toMoney(s.amount) : total.times(share), txMinor);
    const base = last ? remainingBase : roundToMinor(totalBase.times(share), baseMinor);
    remaining = remaining.minus(amount);
    remainingBase = remainingBase.minus(base);
    return {
      ...line,
      cost_center_id: s.cost_center_id,
      distribution: null,
      distribution_template_id: null,
      debit: isDebit ? amount.toString() : '0',
      credit: isDebit ? '0' : amount.toString(),
      debit_base: isDebit ? base.toString() : '0',
      credit_base: isDebit ? '0' : base.toString(),
    };
  });
};
