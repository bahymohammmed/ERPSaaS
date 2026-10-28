import { Injectable } from '@nestjs/common';
import {
  amountInWords,
  type BilingualText,
  isProfitAndLoss,
  Money,
  type MoneyValue,
  type ReportColumn,
  type ReportRow,
  type StatementInput,
  toMoney,
  type WordsCurrency,
} from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import type { CompanyContext } from '../common/request-context';
import { AuditService } from '../common/audit.service';
import { DbService } from '../db/db.service';
import { ensureCompanyDefaults } from './defaults';
import { type Account, AccountTree, type DC, type Period, periodKeyAtLeast, periodKeyAtMost, ReportsService, t } from './reports.service';

type StatementRow = {
  line_no: number;
  row_key: string | null;
  label_ar: string;
  label_en: string;
  row_type: 'HEADER' | 'ACCOUNTS' | 'FORMULA' | 'RESULT' | 'SPACER';
  accounts: string | null;
  sign: 'DEBIT' | 'CREDIT';
  formula: string | null;
  show_detail: boolean;
  bold: boolean;
  indent: number;
};

/** Natural-key comparison so that "4201" < "4204" and "120101" sorts within "1201". */
const compareCodes = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

/** Parses "41,4201-4204" into a predicate over account codes. */
export const accountMatcher = (spec: string): ((code: string) => boolean) => {
  const tokens = spec
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return (code) =>
    tokens.some((token) => {
      const [from, to] = token.split('-').map((x) => x.trim());
      if (!from) return false;
      if (!to) return code.startsWith(from);
      const head = code.slice(0, Math.max(from.length, to.length));
      return compareCodes(head, from) >= 0 && compareCodes(head, to) <= 0;
    });
};

const net = (v: DC | undefined, sign: 'DEBIT' | 'CREDIT'): MoneyValue => {
  if (!v) return new Money(0);
  return sign === 'DEBIT' ? v.debit.minus(v.credit) : v.credit.minus(v.debit);
};

/** Budget vs actual, designed financial statements and the printable journal voucher. */
@Injectable()
export class AnalysisReportsService {
  constructor(
    private readonly db: DbService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  // ================================================================ Budget vs actual

  budgetVsActual(ctx: CompanyContext, q: { budget_id: string; from_period_id: string; to_period_id: string; cost_center_id?: string; level?: number }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const budget = await tx.maybeOne<{ id: string; code: string; name_ar: string; name_en: string; fiscal_year_id: string; status: string }>(
        'SELECT * FROM gl.budgets WHERE company_id = $1 AND id = $2',
        [ctx.companyId, q.budget_id],
      );
      if (!budget) throw notFound('budget');
      const [from, to] = await this.reports.periodRange(tx, ctx.companyId, q.from_period_id, q.to_period_id);
      const ccIds = await this.reports.costCenterFilter(tx, ctx, q.cost_center_id);
      const range = `${periodKeyAtLeast('p', 2)} AND ${periodKeyAtMost('p', 4)}`;
      const params = [from.start_date, from.period_no, to.start_date, to.period_no];

      const budgetRows = await tx.query<{ account_id: string; amount: string }>(
        `SELECT l.account_id, sum(l.amount) AS amount FROM gl.budget_lines l JOIN gl.fiscal_periods p ON p.id = l.period_id
         WHERE l.company_id = $1 AND l.budget_id = $6 AND ${range} AND ($7::uuid[] IS NULL OR l.cost_center_id = ANY($7))
         GROUP BY l.account_id`,
        [ctx.companyId, ...params, budget.id, ccIds],
      );
      const budgetByAccount = new Map(budgetRows.map((r) => [r.account_id, toMoney(r.amount)]));
      const actual = await this.reports.sums(tx, ctx.companyId, range, params, ccIds, true);
      const accounts = await this.reports.accounts(tx, ctx.companyId);
      const tree = new AccountTree(accounts);
      const natural = (a: Account) => (a.account_type === 'REVENUE' ? net(actual.get(a.id), 'CREDIT') : net(actual.get(a.id), 'DEBIT'));
      const agg = tree.aggregate((id) => [budgetByAccount.get(id) ?? new Money(0), natural(tree.get(id))], 2);

      const minor = company.minor_units;
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('البند', 'Line item'), kind: 'bilingual', width: 40 },
        { key: 'budget', label: t('الموازنة', 'Budget'), kind: 'amount' },
        { key: 'actual', label: t('الفعلي', 'Actual'), kind: 'amount' },
        { key: 'variance', label: t('الانحراف (موجب = ملائم)', 'Variance (+ favourable)'), kind: 'amount' },
        { key: 'pct', label: t('نسبة التحقق %', 'Achieved %'), kind: 'text', width: 10 },
      ];
      const cells = (type: 'REVENUE' | 'EXPENSE', b: MoneyValue, a: MoneyValue) => ({
        budget: b.toFixed(minor),
        actual: a.toFixed(minor),
        variance: (type === 'REVENUE' ? a.minus(b) : b.minus(a)).toFixed(minor),
        pct: b.isZero() ? '' : `${a.dividedBy(b).times(100).toFixed(1)}%`,
      });
      const rows: ReportRow[] = [];
      const totals: Record<'REVENUE' | 'EXPENSE', [MoneyValue, MoneyValue]> = { REVENUE: [new Money(0), new Money(0)], EXPENSE: [new Money(0), new Money(0)] };
      for (const type of ['REVENUE', 'EXPENSE'] as const) {
        rows.push({ cells: { name: type === 'REVENUE' ? t('الإيرادات', 'Revenue') : t('المصروفات', 'Expenses') }, style: 'section' });
        for (const node of tree.walk(q.level, type)) {
          const [b = new Money(0), a = new Money(0)] = agg.get(node.account.id) ?? [];
          if (node.depth === 1) {
            totals[type] = [totals[type][0].plus(b), totals[type][1].plus(a)];
            continue;
          }
          if (b.isZero() && a.isZero()) continue;
          rows.push({
            cells: { code: node.account.code, name: t(node.account.name_ar, node.account.name_en), ...cells(type, b, a) },
            level: node.depth - 2,
            style: node.account.is_posting || node.depth === q.level ? 'normal' : 'header',
            drill: node.account.is_posting ? { kind: 'account', id: node.account.id } : undefined,
          });
        }
        rows.push({ cells: { name: type === 'REVENUE' ? t('إجمالي الإيرادات', 'Total revenue') : t('إجمالي المصروفات', 'Total expenses'), ...cells(type, ...totals[type]) }, style: 'subtotal' });
      }
      const [rb, ra] = totals.REVENUE;
      const [eb, ea] = totals.EXPENSE;
      rows.push({ cells: { name: t('صافي الربح', 'Net profit'), ...cells('REVENUE', rb.minus(eb), ra.minus(ea)) }, style: 'grandTotal' });

      return this.reports.document('budget-vs-actual', t('الموازنة مقابل الفعلي', 'Budget vs actual'), company, columns, rows, [
        t(`الموازنة: ${budget.code} ${budget.name_ar}`, `Budget: ${budget.code} ${budget.name_en}`),
        t(`من ${from.name_ar} إلى ${to.name_ar}`, `From ${from.name_en} to ${to.name_en}`),
        ...(await this.reports.costCenterSubtitle(tx, ctx.companyId, q.cost_center_id)),
      ], budget.status === 'DRAFT' ? [t('الموازنة غير معتمدة بعد', 'The budget is not yet approved')] : []);
    });
  }

  // ================================================================ Designed statements

  listStatements(ctx: CompanyContext) {
    return this.db.withTenant(ctx, async (tx) => {
      await ensureCompanyDefaults(tx, ctx.tenantId, ctx.companyId);
      return tx.query(
        `SELECT s.*, COALESCE(json_agg(r ORDER BY r.line_no) FILTER (WHERE r.line_no IS NOT NULL), '[]') AS rows
         FROM gl.statements s LEFT JOIN gl.statement_rows r ON r.statement_id = s.id
         WHERE s.company_id = $1 GROUP BY s.tenant_id, s.id ORDER BY s.code`,
        [ctx.companyId],
      );
    });
  }

  saveStatement(ctx: CompanyContext, input: StatementInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const keys = input.rows.map((r) => r.row_key).filter((k): k is string => !!k);
      if (new Set(keys).size !== keys.length) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'rows', message: 'Row keys must be unique' }]);
      for (const [index, row] of input.rows.entries()) {
        for (const match of (row.row_type === 'FORMULA' ? (row.formula ?? '') : '').matchAll(/([A-Za-z0-9_]+)/g)) {
          if (!keys.includes(match[1] ?? '')) throw new AppError('STATEMENT_FORMULA', { row: index + 1, ref: match[1] ?? '' });
        }
      }
      const params = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.basis, input.is_active];
      const row = id
        ? await tx.maybeOne<{ id: string }>(
            'UPDATE gl.statements SET code = $3, name_ar = $4, name_en = $5, basis = $6, is_active = $7 WHERE company_id = $1 AND id = $2 RETURNING id',
            [ctx.companyId, id, ...params],
          )
        : await tx.one<{ id: string }>(
            'INSERT INTO gl.statements (tenant_id, company_id, code, name_ar, name_en, basis, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
            [ctx.tenantId, ctx.companyId, ...params],
          );
      if (!row) throw notFound('statement');
      await tx.query('DELETE FROM gl.statement_rows WHERE statement_id = $1', [row.id]);
      for (const [index, r] of input.rows.entries()) {
        await tx.query(
          `INSERT INTO gl.statement_rows (tenant_id, company_id, statement_id, line_no, row_key, label_ar, label_en, row_type, accounts, sign,
             formula, show_detail, bold, indent)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [ctx.tenantId, ctx.companyId, row.id, index + 1, r.row_key || null, r.label_ar, r.label_en, r.row_type, r.accounts ?? null, r.sign, r.formula ?? null, r.show_detail, r.bold, r.indent],
        );
      }
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'statement', entityId: row.id, companyId: ctx.companyId, newData: { code: input.code } });
      return row;
    });
  }

  removeStatement(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await tx.query('DELETE FROM gl.statements WHERE company_id = $1 AND id = $2 RETURNING code', [ctx.companyId, id]);
      if (!rows.length) throw notFound('statement');
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'statement', entityId: id, companyId: ctx.companyId, oldData: rows[0] });
      return { deleted: true };
    });
  }

  statement(ctx: CompanyContext, q: { statement_id: string; from_period_id?: string; to_period_id?: string; period_id?: string; cost_center_id?: string; compare: 'none' | 'prior_year' }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const statement = await tx.maybeOne<{ id: string; name_ar: string; name_en: string; basis: 'PERIOD' | 'POSITION' }>(
        'SELECT id, name_ar, name_en, basis FROM gl.statements WHERE company_id = $1 AND id = $2',
        [ctx.companyId, q.statement_id],
      );
      if (!statement) throw notFound('statement');
      const rows = await tx.query<StatementRow>('SELECT * FROM gl.statement_rows WHERE statement_id = $1 ORDER BY line_no', [statement.id]);
      const accounts = (await this.reports.accounts(tx, ctx.companyId)).filter((a) => a.is_posting);

      let ranges: { current: [Period, Period]; prior: [Period, Period] | null };
      let subtitle: BilingualText;
      if (statement.basis === 'PERIOD') {
        if (!q.from_period_id || !q.to_period_id) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'from_period_id', message: 'Period range required' }]);
        const [from, to] = await this.reports.periodRange(tx, ctx.companyId, q.from_period_id, q.to_period_id);
        ranges = { current: [from, to], prior: q.compare === 'prior_year' ? await this.reports.priorYearRange(tx, ctx.companyId, from, to) : null };
        subtitle = t(`من ${from.name_ar} إلى ${to.name_ar}`, `From ${from.name_en} to ${to.name_en}`);
      } else {
        const periodId = q.period_id ?? q.to_period_id;
        if (!periodId) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'period_id', message: 'Period required' }]);
        const period = await this.reports.period(tx, ctx.companyId, periodId);
        const prior = q.compare === 'prior_year' ? await this.reports.samePeriodPriorYear(tx, ctx.companyId, period) : null;
        ranges = { current: [period, period], prior: prior ? [prior, prior] : null };
        subtitle = t(`كما في ${period.end_date}`, `As at ${period.end_date}`);
      }
      const ccIds = statement.basis === 'PERIOD' ? await this.reports.costCenterFilter(tx, ctx, q.cost_center_id) : null;
      const balancesFor = async ([from, to]: [Period, Period]) =>
        statement.basis === 'PERIOD'
          ? this.reports.sums(tx, ctx.companyId, `${periodKeyAtLeast('p', 2)} AND ${periodKeyAtMost('p', 4)}`, [from.start_date, from.period_no, to.start_date, to.period_no], ccIds, true)
          : this.reports.sums(tx, ctx.companyId, periodKeyAtMost('p', 2), [to.start_date, to.period_no], null);
      const current = this.evaluate(rows, accounts, await balancesFor(ranges.current));
      const prior = ranges.prior ? this.evaluate(rows, accounts, await balancesFor(ranges.prior)) : null;

      const minor = company.minor_units;
      const columns: ReportColumn[] = [
        { key: 'name', label: t('البيان', 'Line item'), kind: 'bilingual', width: 50 },
        { key: 'current', label: statement.basis === 'PERIOD' ? t('الفترة الحالية', 'Current period') : t(`كما في ${ranges.current[1].end_date}`, `As at ${ranges.current[1].end_date}`), kind: 'amount' },
        ...(prior && ranges.prior ? [{ key: 'prior', label: statement.basis === 'PERIOD' ? t('السنة السابقة', 'Prior year') : t(`كما في ${ranges.prior[1].end_date}`, `As at ${ranges.prior[1].end_date}`), kind: 'amount' as const }] : []),
      ];
      const out: ReportRow[] = [];
      for (const row of rows) {
        const label = t(row.label_ar || row.label_en, row.label_en || row.label_ar);
        if (row.row_type === 'SPACER') {
          out.push({ cells: { name: '' } });
          continue;
        }
        if (row.row_type === 'HEADER') {
          out.push({ cells: { name: label }, style: 'section', level: row.indent });
          continue;
        }
        const value = current.values.get(row.line_no) ?? new Money(0);
        const priorValue = prior?.values.get(row.line_no);
        out.push({
          cells: { name: label, current: value.toFixed(minor), ...(prior ? { prior: (priorValue ?? new Money(0)).toFixed(minor) } : {}) },
          style: row.bold ? 'subtotal' : row.row_type === 'FORMULA' ? 'header' : 'normal',
          level: row.indent,
        });
        if (row.show_detail && row.row_type === 'ACCOUNTS') {
          for (const account of current.matches.get(row.line_no) ?? []) {
            const v = net(current.balances.get(account.id), row.sign);
            const pv = prior ? net(prior.balances.get(account.id), row.sign) : null;
            if (v.isZero() && (!pv || pv.isZero())) continue;
            out.push({
              cells: { name: t(`${account.code} ${account.name_ar}`, `${account.code} ${account.name_en}`), current: v.toFixed(minor), ...(pv ? { prior: pv.toFixed(minor) } : {}) },
              level: row.indent + 1,
              drill: { kind: 'account', id: account.id },
            });
          }
        }
      }
      const notes: BilingualText[] = [];
      if (current.unmapped.length) {
        notes.push(t(`حسابات لها أرصدة غير مدرجة في القائمة: ${current.unmapped.join('، ')}`, `Accounts with balances not mapped to any line: ${current.unmapped.join(', ')}`));
      }
      if (current.duplicates.length) {
        notes.push(t(`حسابات مدرجة في أكثر من سطر: ${current.duplicates.join('، ')}`, `Accounts mapped to more than one line: ${current.duplicates.join(', ')}`));
      }
      return this.reports.document(`statement-${statement.id}`, t(statement.name_ar, statement.name_en), company, columns, out, [
        subtitle,
        ...(await this.reports.costCenterSubtitle(tx, ctx.companyId, statement.basis === 'PERIOD' ? q.cost_center_id : undefined)),
      ], notes);
    });
  }

  /** Computes every row's value; formulas may reference rows above or below them. */
  private evaluate(rows: StatementRow[], accounts: Account[], balances: Map<string, DC>) {
    const values = new Map<number, MoneyValue>();
    const matches = new Map<number, Account[]>();
    const byKey = new Map(rows.filter((r) => r.row_key).map((r) => [r.row_key as string, r]));
    const matchCount = new Map<string, number>();

    for (const row of rows.filter((r) => r.row_type === 'ACCOUNTS')) {
      const matcher = accountMatcher(row.accounts ?? '');
      const matched = accounts.filter((a) => matcher(a.code));
      matches.set(row.line_no, matched);
      matched.forEach((a) => matchCount.set(a.id, (matchCount.get(a.id) ?? 0) + 1));
      values.set(row.line_no, matched.reduce((acc, a) => acc.plus(net(balances.get(a.id), row.sign)), new Money(0)));
    }
    for (const row of rows.filter((r) => r.row_type === 'RESULT')) {
      // Unclosed result: revenue less expenses, shown credit-positive (negated for a DEBIT-signed row).
      const result = accounts.filter((a) => isProfitAndLoss(a.account_type)).reduce((acc, a) => acc.plus(net(balances.get(a.id), 'CREDIT')), new Money(0));
      values.set(row.line_no, row.sign === 'DEBIT' ? result.negated() : result);
    }
    const resolving = new Set<number>();
    const resolve = (row: StatementRow): MoneyValue => {
      const known = values.get(row.line_no);
      if (known) return known;
      if (row.row_type !== 'FORMULA') return new Money(0);
      if (resolving.has(row.line_no)) throw new AppError('STATEMENT_FORMULA', { row: row.line_no, ref: row.row_key ?? '' });
      resolving.add(row.line_no);
      let total = new Money(0);
      for (const match of (row.formula ?? '').matchAll(/([+-]?)\s*([A-Za-z0-9_]+)/g)) {
        const ref = byKey.get(match[2] ?? '');
        if (!ref) throw new AppError('STATEMENT_FORMULA', { row: row.line_no, ref: match[2] ?? '' });
        const v = resolve(ref);
        total = match[1] === '-' ? total.minus(v) : total.plus(v);
      }
      values.set(row.line_no, total);
      return total;
    };
    rows.forEach(resolve);

    const relevant = (a: Account) => (rows.some((r) => r.row_type === 'RESULT') ? !isProfitAndLoss(a.account_type) : isProfitAndLoss(a.account_type));
    const hasBalance = (a: Account) => !net(balances.get(a.id), 'DEBIT').isZero();
    const unmapped = accounts.filter((a) => relevant(a) && hasBalance(a) && !matchCount.has(a.id)).map((a) => a.code);
    const duplicates = accounts.filter((a) => (matchCount.get(a.id) ?? 0) > 1).map((a) => a.code);
    return { values, matches, balances, unmapped, duplicates };
  }

  // ================================================================ Journal voucher

  voucher(ctx: CompanyContext, entryId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const entry = await tx.maybeOne<{
        entry_no: string | null; entry_date: string; status: string; description: string | null; reference: string | null; total_debit: string;
        jt_ar: string; jt_en: string; created_by: string | null; approved_by: string | null; posted_by: string | null;
      }>(
        `SELECT e.entry_no, e.entry_date, e.status, e.description, e.reference, e.total_debit, jt.name_ar AS jt_ar, jt.name_en AS jt_en,
                cu.full_name AS created_by, au.full_name AS approved_by, pu.full_name AS posted_by
         FROM gl.journal_entries e JOIN gl.journal_types jt ON jt.id = e.journal_type_id
         LEFT JOIN core.users cu ON cu.id = e.created_by LEFT JOIN core.users au ON au.id = e.approved_by LEFT JOIN core.users pu ON pu.id = e.posted_by
         WHERE e.company_id = $1 AND e.id = $2`,
        [ctx.companyId, entryId],
      );
      if (!entry) throw notFound('journal entry');
      const lines = await tx.query<{ code: string; name_ar: string; name_en: string; cc: string | null; description: string | null; currency_code: string; debit: string; credit: string; debit_base: string; credit_base: string; exchange_rate: string }>(
        `SELECT a.code, a.name_ar, a.name_en, c.code AS cc, l.description, l.currency_code, l.debit, l.credit, l.debit_base, l.credit_base, l.exchange_rate
         FROM gl.journal_lines l JOIN gl.accounts a ON a.id = l.account_id LEFT JOIN gl.cost_centers c ON c.id = l.cost_center_id
         WHERE l.entry_id = $1 ORDER BY l.line_no`,
        [entryId],
      );
      const currency = await tx.one<WordsCurrency>('SELECT minor_units, name_ar, name_en, minor_name_ar, minor_name_en FROM core.currencies WHERE code = $1', [company.base_currency]);
      const minor = company.minor_units;
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الحساب', 'Account'), kind: 'text', width: 10 },
        { key: 'name', label: t('اسم الحساب', 'Account name'), kind: 'bilingual', width: 30 },
        { key: 'cc', label: t('مركز التكلفة', 'Cost center'), kind: 'text', width: 8 },
        { key: 'description', label: t('البيان', 'Description'), kind: 'text', width: 30 },
        { key: 'debit', label: t('مدين', 'Debit'), kind: 'amount' },
        { key: 'credit', label: t('دائن', 'Credit'), kind: 'amount' },
      ];
      let debit = new Money(0);
      let credit = new Money(0);
      const rows: ReportRow[] = lines.map((l) => {
        debit = debit.plus(l.debit_base);
        credit = credit.plus(l.credit_base);
        const fx = l.currency_code !== company.base_currency ? ` (${toMoney(l.debit).plus(l.credit).toString()} ${l.currency_code} @ ${toMoney(l.exchange_rate).toString()})` : '';
        return {
          cells: {
            code: l.code,
            name: t(l.name_ar, l.name_en),
            cc: l.cc ?? '',
            description: `${l.description ?? ''}${fx}`,
            debit: toMoney(l.debit_base).isZero() ? null : toMoney(l.debit_base).toFixed(minor),
            credit: toMoney(l.credit_base).isZero() ? null : toMoney(l.credit_base).toFixed(minor),
          },
        };
      });
      rows.push({ cells: { name: t('الإجمالي', 'Total'), debit: debit.toFixed(minor), credit: credit.toFixed(minor) }, style: 'grandTotal' });
      const people = [
        entry.created_by && t(`أعدّه: ${entry.created_by}`, `Prepared by: ${entry.created_by}`),
        entry.approved_by && t(`اعتمده: ${entry.approved_by}`, `Approved by: ${entry.approved_by}`),
        entry.posted_by && t(`رحّله: ${entry.posted_by}`, `Posted by: ${entry.posted_by}`),
      ].filter((x): x is BilingualText => !!x);
      return this.reports.document('journal-voucher', t('سند قيد', 'Journal voucher'), company, columns, rows, [
        t(`رقم القيد: ${entry.entry_no ?? 'مسودة'} — التاريخ: ${entry.entry_date} — ${entry.jt_ar}`, `Entry no.: ${entry.entry_no ?? 'Draft'} — Date: ${entry.entry_date} — ${entry.jt_en}`),
        ...(entry.description ? [t(entry.description, entry.description)] : []),
        ...(entry.reference ? [t(`المرجع: ${entry.reference}`, `Reference: ${entry.reference}`)] : []),
      ], [t(amountInWords(debit, currency, 'ar'), amountInWords(debit, currency, 'en')), ...people]);
    });
  }
}
