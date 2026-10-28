import { Injectable } from '@nestjs/common';
import {
  type AccountType,
  type BilingualText,
  isProfitAndLoss,
  Money,
  type MoneyValue,
  type ReportColumn,
  type ReportDocument,
  type ReportRow,
  toMoney,
} from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { descendantIds } from '../common/hierarchy';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { scopedCostCenterIds } from './cost-centers.service';

type Period = { id: string; fiscal_year_id: string; period_no: number; code: string; name_ar: string; name_en: string; start_date: string; end_date: string };
type FiscalYear = { id: string; code: string; start_date: string; end_date: string };
type Account = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  is_posting: boolean;
  account_type: AccountType;
  normal_balance: 'DEBIT' | 'CREDIT';
};
type Company = { name_ar: string; name_en: string; base_currency: string; minor_units: number };
type DC = { debit: MoneyValue; credit: MoneyValue };

const zero = (): DC => ({ debit: new Money(0), credit: new Money(0) });
const t = (ar: string, en: string): BilingualText => ({ ar, en });
const net = (v: DC): MoneyValue => v.debit.minus(v.credit);

const TYPE_TITLES: Record<AccountType, BilingualText> = {
  ASSET: t('الأصول', 'Assets'),
  LIABILITY: t('المطلوبات', 'Liabilities'),
  EQUITY: t('حقوق الملكية', 'Equity'),
  REVENUE: t('الإيرادات', 'Revenue'),
  EXPENSE: t('المصروفات', 'Expenses'),
};

/** Ordering key of a period: (start_date, period_no) puts the adjustment period after month 12. */
const periodKeyBefore = (alias: string, n: number) => `(${alias}.start_date, ${alias}.period_no) < ($${n}::date, $${n + 1}::int)`;
const periodKeyAtMost = (alias: string, n: number) => `(${alias}.start_date, ${alias}.period_no) <= ($${n}::date, $${n + 1}::int)`;
const periodKeyAtLeast = (alias: string, n: number) => `(${alias}.start_date, ${alias}.period_no) >= ($${n}::date, $${n + 1}::int)`;

@Injectable()
export class ReportsService {
  constructor(private readonly db: DbService) {}

  // ================================================================ Trial balance

  trialBalance(ctx: CompanyContext, q: { from_period_id: string; to_period_id: string; cost_center_id?: string; level?: number; include_zero: boolean }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.company(tx, ctx.companyId);
      const [from, to] = await this.periodRange(tx, ctx.companyId, q.from_period_id, q.to_period_id);
      const fy = await this.fiscalYear(tx, from.fiscal_year_id);
      const ccIds = await this.costCenterFilter(tx, ctx, q.cost_center_id);
      const accounts = await this.accounts(tx, ctx.companyId);

      const before = await this.sums(tx, ctx.companyId, periodKeyBefore('p', 2), [from.start_date, from.period_no], ccIds);
      const beforeYear = await this.sums(tx, ctx.companyId, 'p.start_date < $2::date', [fy.start_date], ccIds);
      const movement = await this.sums(tx, ctx.companyId, `${periodKeyAtLeast('p', 2)} AND ${periodKeyAtMost('p', 4)}`, [from.start_date, from.period_no, to.start_date, to.period_no], ccIds);

      // P&L accounts open at zero each fiscal year; their earlier results sit in "prior years' result".
      const opening = new Map<string, DC>();
      let priorResult = new Money(0);
      for (const a of accounts.filter((x) => x.is_posting)) {
        const all = before.get(a.id) ?? zero();
        if (isProfitAndLoss(a.account_type)) {
          const prior = beforeYear.get(a.id) ?? zero();
          opening.set(a.id, { debit: all.debit.minus(prior.debit), credit: all.credit.minus(prior.credit) });
          priorResult = priorResult.plus(net(prior));
        } else {
          opening.set(a.id, all);
        }
      }

      const tree = new AccountTree(accounts);
      const values = (id: string) => {
        const o = net(opening.get(id) ?? zero());
        const m = movement.get(id) ?? zero();
        return { o, md: m.debit, mc: m.credit };
      };
      const agg = tree.aggregate((id) => {
        const v = values(id);
        return [v.o, v.md, v.mc];
      }, 3);

      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 12 },
        { key: 'name', label: t('اسم الحساب', 'Account name'), kind: 'bilingual', width: 40 },
        { key: 'od', label: t('رصيد أول المدة مدين', 'Opening debit'), kind: 'amount' },
        { key: 'oc', label: t('رصيد أول المدة دائن', 'Opening credit'), kind: 'amount' },
        { key: 'md', label: t('حركة مدينة', 'Period debit'), kind: 'amount' },
        { key: 'mc', label: t('حركة دائنة', 'Period credit'), kind: 'amount' },
        { key: 'cd', label: t('رصيد آخر المدة مدين', 'Closing debit'), kind: 'amount' },
        { key: 'cc', label: t('رصيد آخر المدة دائن', 'Closing credit'), kind: 'amount' },
      ];
      const minor = company.minor_units;
      const cells = (o: MoneyValue, md: MoneyValue, mc: MoneyValue) => {
        const closing = o.plus(md).minus(mc);
        return {
          od: o.isPositive() && !o.isZero() ? o.toFixed(minor) : null,
          oc: o.isNegative() ? o.abs().toFixed(minor) : null,
          md: md.toFixed(minor),
          mc: mc.toFixed(minor),
          cd: closing.isPositive() && !closing.isZero() ? closing.toFixed(minor) : null,
          cc: closing.isNegative() ? closing.abs().toFixed(minor) : null,
        };
      };

      const rows: ReportRow[] = [];
      for (const node of tree.walk(q.level)) {
        const vector = agg.get(node.account.id);
        const o = vector?.[0] ?? new Money(0);
        const md = vector?.[1] ?? new Money(0);
        const mc = vector?.[2] ?? new Money(0);
        if (!q.include_zero && o.isZero() && md.isZero() && mc.isZero()) continue;
        const showAsLeaf = node.account.is_posting || node.depth === q.level;
        rows.push({
          cells: { code: node.account.code, name: t(node.account.name_ar, node.account.name_en), ...cells(o, md, mc) },
          level: node.depth - 1,
          style: showAsLeaf ? 'normal' : 'header',
          drill: node.account.is_posting ? { kind: 'account', id: node.account.id } : undefined,
        });
      }

      let totalMd = new Money(0);
      let totalMc = new Money(0);
      for (const a of accounts.filter((x) => x.is_posting)) {
        const v = values(a.id);
        totalMd = totalMd.plus(v.md);
        totalMc = totalMc.plus(v.mc);
      }
      if (!priorResult.isZero()) {
        rows.push({
          cells: { code: '', name: t('نتائج سنوات سابقة غير مقفلة', "Prior years' unclosed result"), ...cells(priorResult, new Money(0), new Money(0)) },
          level: 0,
          style: 'normal',
        });
      }
      // Totals show gross sides so that debit = credit can be checked.
      const sideTotals = (fn: (v: ReturnType<typeof values>) => MoneyValue) => {
        let debit = priorResult.isPositive() ? priorResult : new Money(0);
        let credit = priorResult.isNegative() ? priorResult.abs() : new Money(0);
        for (const a of accounts.filter((x) => x.is_posting)) {
          const value = fn(values(a.id));
          if (value.isNegative()) credit = credit.plus(value.abs());
          else debit = debit.plus(value);
        }
        return { debit, credit };
      };
      const openingSides = sideTotals((v) => v.o);
      const closingSides = sideTotals((v) => v.o.plus(v.md).minus(v.mc));
      rows.push({
        cells: {
          code: '',
          name: t('الإجمالي', 'Total'),
          od: openingSides.debit.toFixed(minor),
          oc: openingSides.credit.toFixed(minor),
          md: totalMd.toFixed(minor),
          mc: totalMc.toFixed(minor),
          cd: closingSides.debit.toFixed(minor),
          cc: closingSides.credit.toFixed(minor),
        },
        style: 'grandTotal',
      });

      const balanced = closingSides.debit.equals(closingSides.credit) && totalMd.equals(totalMc);
      return this.document('trial-balance', t('ميزان المراجعة', 'Trial balance'), company, columns, rows, [
        t(`من ${from.name_ar} إلى ${to.name_ar}`, `From ${from.name_en} to ${to.name_en}`),
        ...(await this.costCenterSubtitle(tx, ctx.companyId, q.cost_center_id)),
      ], [balanced ? t('الميزان متوازن', 'The trial balance is balanced') : t('تحذير: الميزان غير متوازن', 'Warning: the trial balance does not balance')]);
    });
  }

  // ================================================================ General ledger (account statement)

  ledger(ctx: CompanyContext, q: { account_id: string; from: string; to: string; cost_center_id?: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      if (q.from > q.to) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'to', message: 'End date before start date' }]);
      const company = await this.company(tx, ctx.companyId);
      const accounts = await this.accounts(tx, ctx.companyId);
      const account = accounts.find((a) => a.id === q.account_id);
      if (!account) throw notFound('account');
      const accountIds = (await descendantIds(tx, 'gl.accounts', ctx.companyId, [account.id])).filter((id) => accounts.find((a) => a.id === id)?.is_posting);
      const ccIds = await this.costCenterFilter(tx, ctx, q.cost_center_id);
      const sign = account.normal_balance === 'DEBIT' ? 1 : -1;

      // P&L accounts restart each fiscal year.
      let openingFrom: string | null = null;
      if (isProfitAndLoss(account.account_type)) {
        const fy = await tx.maybeOne<FiscalYear>('SELECT * FROM gl.fiscal_years WHERE company_id = $1 AND $2::date BETWEEN start_date AND end_date', [ctx.companyId, q.from]);
        openingFrom = fy?.start_date ?? null;
      }
      const openingRow = await tx.one<{ debit: string; credit: string }>(
        `SELECT COALESCE(sum(l.debit_base), 0) AS debit, COALESCE(sum(l.credit_base), 0) AS credit
         FROM gl.journal_lines l JOIN gl.journal_entries e ON e.id = l.entry_id
         WHERE l.company_id = $1 AND l.account_id = ANY($2::uuid[]) AND e.status IN ('POSTED', 'REVERSED')
           AND e.entry_date < $3 AND ($4::date IS NULL OR e.entry_date >= $4)
           AND ($5::uuid[] IS NULL OR l.cost_center_id = ANY($5))`,
        [ctx.companyId, accountIds, q.from, openingFrom, ccIds],
      );
      const lines = await tx.query<{
        entry_id: string; entry_no: string; entry_date: string; description: string | null; entry_description: string | null;
        account_code: string; cc_code: string | null; currency_code: string; exchange_rate: string; debit: string; credit: string;
        debit_base: string; credit_base: string;
      }>(
        `SELECT e.id AS entry_id, e.entry_no, e.entry_date, l.description, e.description AS entry_description, a.code AS account_code,
                c.code AS cc_code, l.currency_code, l.exchange_rate, l.debit, l.credit, l.debit_base, l.credit_base
         FROM gl.journal_lines l
         JOIN gl.journal_entries e ON e.id = l.entry_id
         JOIN gl.accounts a ON a.id = l.account_id
         LEFT JOIN gl.cost_centers c ON c.id = l.cost_center_id
         WHERE l.company_id = $1 AND l.account_id = ANY($2::uuid[]) AND e.status IN ('POSTED', 'REVERSED')
           AND e.entry_date BETWEEN $3 AND $4 AND ($5::uuid[] IS NULL OR l.cost_center_id = ANY($5))
         ORDER BY e.entry_date, e.entry_no, l.line_no
         LIMIT 20000`,
        [ctx.companyId, accountIds, q.from, q.to, ccIds],
      );

      const minor = company.minor_units;
      const multiAccount = accountIds.length > 1;
      const columns: ReportColumn[] = [
        { key: 'date', label: t('التاريخ', 'Date'), kind: 'date', width: 11 },
        { key: 'entry_no', label: t('رقم القيد', 'Entry no.'), kind: 'text', width: 16 },
        ...(multiAccount ? [{ key: 'account', label: t('الحساب', 'Account'), kind: 'text' as const, width: 10 }] : []),
        { key: 'description', label: t('البيان', 'Description'), kind: 'text', width: 36 },
        { key: 'cost_center', label: t('مركز التكلفة', 'Cost center'), kind: 'text', width: 10 },
        { key: 'fx', label: t('المبلغ بالعملة', 'Foreign amount'), kind: 'text', width: 16 },
        { key: 'debit', label: t('مدين', 'Debit'), kind: 'amount' },
        { key: 'credit', label: t('دائن', 'Credit'), kind: 'amount' },
        { key: 'balance', label: t('الرصيد', 'Balance'), kind: 'amount' },
      ];
      let balance = toMoney(openingRow.debit).minus(openingRow.credit).times(sign);
      const rows: ReportRow[] = [
        { cells: { description: t('رصيد أول المدة', 'Opening balance'), balance: balance.toFixed(minor) }, style: 'subtotal' },
      ];
      let totalDebit = new Money(0);
      let totalCredit = new Money(0);
      for (const l of lines) {
        balance = balance.plus(toMoney(l.debit_base).minus(l.credit_base).times(sign));
        totalDebit = totalDebit.plus(l.debit_base);
        totalCredit = totalCredit.plus(l.credit_base);
        const foreign = l.currency_code !== company.base_currency;
        rows.push({
          cells: {
            date: l.entry_date,
            entry_no: l.entry_no,
            account: l.account_code,
            description: l.description || l.entry_description || '',
            cost_center: l.cc_code ?? '',
            fx: foreign ? `${toMoney(l.debit).isZero() ? '-' : ''}${toMoney(l.debit).plus(l.credit).toString()} ${l.currency_code} @ ${toMoney(l.exchange_rate).toString()}` : '',
            debit: toMoney(l.debit_base).isZero() ? null : toMoney(l.debit_base).toFixed(minor),
            credit: toMoney(l.credit_base).isZero() ? null : toMoney(l.credit_base).toFixed(minor),
            balance: balance.toFixed(minor),
          },
          drill: { kind: 'entry', id: l.entry_id },
        });
      }
      rows.push({
        cells: { description: t('الإجمالي / الرصيد الختامي', 'Totals / closing balance'), debit: totalDebit.toFixed(minor), credit: totalCredit.toFixed(minor), balance: balance.toFixed(minor) },
        style: 'grandTotal',
      });

      return this.document('ledger', t('كشف حساب', 'Account statement'), company, columns, rows, [
        t(`${account.code} - ${account.name_ar}`, `${account.code} - ${account.name_en}`),
        t(`من ${q.from} إلى ${q.to}`, `From ${q.from} to ${q.to}`),
        ...(await this.costCenterSubtitle(tx, ctx.companyId, q.cost_center_id)),
      ], lines.length >= 20000 ? [t('تم عرض أول 20000 حركة فقط', 'Only the first 20,000 lines are shown')] : []);
    });
  }

  // ================================================================ Journal register

  journalRegister(ctx: CompanyContext, q: { from: string; to: string; journal_type_id?: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.company(tx, ctx.companyId);
      const ccIds = await this.costCenterFilter(tx, ctx);
      const lines = await tx.query<{
        entry_id: string; entry_no: string; entry_date: string; entry_description: string | null; jt_code: string;
        account_code: string; name_ar: string; name_en: string; cc_code: string | null; description: string | null;
        debit_base: string; credit_base: string;
      }>(
        `SELECT e.id AS entry_id, e.entry_no, e.entry_date, e.description AS entry_description, jt.code AS jt_code,
                a.code AS account_code, a.name_ar, a.name_en, c.code AS cc_code, l.description, l.debit_base, l.credit_base
         FROM gl.journal_entries e
         JOIN gl.journal_types jt ON jt.id = e.journal_type_id
         JOIN gl.journal_lines l ON l.entry_id = e.id
         JOIN gl.accounts a ON a.id = l.account_id
         LEFT JOIN gl.cost_centers c ON c.id = l.cost_center_id
         WHERE e.company_id = $1 AND e.status IN ('POSTED', 'REVERSED') AND e.entry_date BETWEEN $2 AND $3
           AND ($4::uuid IS NULL OR e.journal_type_id = $4)
           AND ($5::uuid[] IS NULL OR EXISTS (SELECT 1 FROM gl.journal_lines s WHERE s.entry_id = e.id AND s.cost_center_id = ANY($5)))
         ORDER BY e.entry_date, e.entry_no, l.line_no
         LIMIT 50000`,
        [ctx.companyId, q.from, q.to, q.journal_type_id ?? null, ccIds],
      );
      const minor = company.minor_units;
      const columns: ReportColumn[] = [
        { key: 'account', label: t('الحساب', 'Account'), kind: 'text', width: 12 },
        { key: 'name', label: t('اسم الحساب', 'Account name'), kind: 'bilingual', width: 30 },
        { key: 'cost_center', label: t('مركز التكلفة', 'Cost center'), kind: 'text', width: 10 },
        { key: 'description', label: t('البيان', 'Description'), kind: 'text', width: 30 },
        { key: 'debit', label: t('مدين', 'Debit'), kind: 'amount' },
        { key: 'credit', label: t('دائن', 'Credit'), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      let current: string | null = null;
      let entryDebit = new Money(0);
      let entryCredit = new Money(0);
      let totalDebit = new Money(0);
      let totalCredit = new Money(0);
      const closeEntry = () => {
        if (current === null) return;
        rows.push({ cells: { description: t('إجمالي القيد', 'Entry total'), debit: entryDebit.toFixed(minor), credit: entryCredit.toFixed(minor) }, style: 'subtotal' });
      };
      for (const l of lines) {
        if (l.entry_id !== current) {
          closeEntry();
          current = l.entry_id;
          entryDebit = new Money(0);
          entryCredit = new Money(0);
          rows.push({
            cells: { account: l.entry_no, name: t(`${l.entry_date} — ${l.entry_description ?? ''}`, `${l.entry_date} — ${l.entry_description ?? ''}`) },
            style: 'section',
            drill: { kind: 'entry', id: l.entry_id },
          });
        }
        entryDebit = entryDebit.plus(l.debit_base);
        entryCredit = entryCredit.plus(l.credit_base);
        totalDebit = totalDebit.plus(l.debit_base);
        totalCredit = totalCredit.plus(l.credit_base);
        rows.push({
          cells: {
            account: l.account_code,
            name: t(l.name_ar, l.name_en),
            cost_center: l.cc_code ?? '',
            description: l.description ?? '',
            debit: toMoney(l.debit_base).isZero() ? null : toMoney(l.debit_base).toFixed(minor),
            credit: toMoney(l.credit_base).isZero() ? null : toMoney(l.credit_base).toFixed(minor),
          },
          level: 1,
        });
      }
      closeEntry();
      rows.push({ cells: { description: t('الإجمالي العام', 'Grand total'), debit: totalDebit.toFixed(minor), credit: totalCredit.toFixed(minor) }, style: 'grandTotal' });
      return this.document('journal-register', t('سجل القيود اليومية', 'Journal register'), company, columns, rows, [
        t(`من ${q.from} إلى ${q.to}`, `From ${q.from} to ${q.to}`),
      ], []);
    });
  }

  // ================================================================ Cost center reports

  /** Rows = P&L accounts, columns = child cost centers (each rolled up over its subtree). */
  costCenterMatrix(ctx: CompanyContext, q: { from_period_id: string; to_period_id: string; parent_cost_center_id?: string; account_scope: 'PL' | 'EXPENSE' | 'REVENUE' }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.company(tx, ctx.companyId);
      const [from, to] = await this.periodRange(tx, ctx.companyId, q.from_period_id, q.to_period_id);
      const scope = await scopedCostCenterIds(tx, ctx);
      const ccs = await tx.query<{ id: string; code: string; name_ar: string; name_en: string; parent_id: string | null }>(
        'SELECT id, code, name_ar, name_en, parent_id FROM gl.cost_centers WHERE company_id = $1 ORDER BY code',
        [ctx.companyId],
      );
      let columnsCc = ccs.filter((c) => c.parent_id === (q.parent_cost_center_id ?? null));
      if (q.parent_cost_center_id && columnsCc.length === 0) {
        const self = ccs.find((c) => c.id === q.parent_cost_center_id);
        if (!self) throw notFound('cost center');
        columnsCc = [self];
      }
      const subtree = new Map<string, Set<string>>();
      for (const c of columnsCc) {
        const ids = await descendantIds(tx, 'gl.cost_centers', ctx.companyId, [c.id]);
        subtree.set(c.id, new Set(scope ? ids.filter((id) => scope.includes(id)) : ids));
      }
      if (scope) columnsCc = columnsCc.filter((c) => (subtree.get(c.id)?.size ?? 0) > 0);

      const types: AccountType[] = q.account_scope === 'PL' ? ['REVENUE', 'EXPENSE'] : [q.account_scope];
      const rowsData = await tx.query<{ account_id: string; cost_center_id: string | null; debit: string; credit: string }>(
        `SELECT b.account_id, b.cost_center_id, sum(b.debit_base) AS debit, sum(b.credit_base) AS credit
         FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id JOIN gl.accounts a ON a.id = b.account_id
         WHERE b.company_id = $1 AND a.account_type = ANY($6::text[]) AND ${periodKeyAtLeast('p', 2)} AND ${periodKeyAtMost('p', 4)}
         GROUP BY b.account_id, b.cost_center_id`,
        [ctx.companyId, from.start_date, from.period_no, to.start_date, to.period_no, types],
      );
      const accounts = (await this.accounts(tx, ctx.companyId)).filter((a) => a.is_posting && types.includes(a.account_type));
      const showUnassigned = !q.parent_cost_center_id && !scope;
      const minor = company.minor_units;

      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('الحساب', 'Account'), kind: 'bilingual', width: 30 },
        ...columnsCc.map((c) => ({ key: `cc_${c.id}`, label: t(`${c.code} ${c.name_ar}`, `${c.code} ${c.name_en}`), kind: 'amount' as const })),
        ...(showUnassigned ? [{ key: 'none', label: t('بدون مركز', 'Unassigned'), kind: 'amount' as const }] : []),
        { key: 'total', label: t('الإجمالي', 'Total'), kind: 'amount' },
      ];

      const rows: ReportRow[] = [];
      const sectionTotals = new Map<AccountType, Map<string, MoneyValue>>();
      for (const type of types) {
        rows.push({ cells: { name: TYPE_TITLES[type] }, style: 'section' });
        const totals = new Map<string, MoneyValue>();
        for (const a of accounts.filter((x) => x.account_type === type)) {
          const sign = type === 'REVENUE' ? -1 : 1;
          const cells: Record<string, string | null> = {};
          let rowTotal = new Money(0);
          const add = (key: string, value: MoneyValue) => {
            cells[key] = value.isZero() ? null : value.toFixed(minor);
            totals.set(key, (totals.get(key) ?? new Money(0)).plus(value));
          };
          for (const c of columnsCc) {
            const set = subtree.get(c.id) ?? new Set();
            const value = rowsData
              .filter((r) => r.account_id === a.id && r.cost_center_id && set.has(r.cost_center_id))
              .reduce((acc, r) => acc.plus(toMoney(r.debit).minus(r.credit).times(sign)), new Money(0));
            add(`cc_${c.id}`, value);
            rowTotal = rowTotal.plus(value);
          }
          if (showUnassigned) {
            const value = rowsData
              .filter((r) => r.account_id === a.id && !r.cost_center_id)
              .reduce((acc, r) => acc.plus(toMoney(r.debit).minus(r.credit).times(sign)), new Money(0));
            add('none', value);
            rowTotal = rowTotal.plus(value);
          }
          add('total', rowTotal);
          if (rowTotal.isZero() && Object.values(cells).every((v) => v === null)) continue;
          rows.push({ cells: { code: a.code, name: t(a.name_ar, a.name_en), ...cells }, level: 1, drill: { kind: 'account', id: a.id } });
        }
        sectionTotals.set(type, totals);
        rows.push({ cells: { name: t(`إجمالي ${TYPE_TITLES[type].ar}`, `Total ${TYPE_TITLES[type].en.toLowerCase()}`), ...fixed(totals, minor) }, style: 'subtotal' });
      }
      if (types.length === 2) {
        const result = new Map<string, MoneyValue>();
        for (const key of columns.filter((c) => c.kind === 'amount').map((c) => c.key)) {
          result.set(key, (sectionTotals.get('REVENUE')?.get(key) ?? new Money(0)).minus(sectionTotals.get('EXPENSE')?.get(key) ?? new Money(0)));
        }
        rows.push({ cells: { name: t('صافي الربح (الخسارة)', 'Net profit (loss)'), ...fixed(result, minor) }, style: 'grandTotal' });
      }
      return this.document('cost-center-matrix', t('تحليل مراكز التكلفة', 'Cost center analysis'), company, columns, rows, [
        t(`من ${from.name_ar} إلى ${to.name_ar}`, `From ${from.name_en} to ${to.name_en}`),
      ], []);
    });
  }

  /** Rows = cost center hierarchy (rolled up), columns = revenue, expense, net. */
  costCenterSummary(ctx: CompanyContext, q: { from_period_id: string; to_period_id: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.company(tx, ctx.companyId);
      const [from, to] = await this.periodRange(tx, ctx.companyId, q.from_period_id, q.to_period_id);
      const scope = await scopedCostCenterIds(tx, ctx);
      const ccs = await tx.query<{ id: string; code: string; name_ar: string; name_en: string; parent_id: string | null; is_posting: boolean }>(
        'SELECT id, code, name_ar, name_en, parent_id, is_posting FROM gl.cost_centers WHERE company_id = $1 ORDER BY code',
        [ctx.companyId],
      );
      const data = await tx.query<{ cost_center_id: string; account_type: AccountType; debit: string; credit: string }>(
        `SELECT b.cost_center_id, a.account_type, sum(b.debit_base) AS debit, sum(b.credit_base) AS credit
         FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id JOIN gl.accounts a ON a.id = b.account_id
         WHERE b.company_id = $1 AND b.cost_center_id IS NOT NULL AND a.account_type IN ('REVENUE', 'EXPENSE')
           AND ${periodKeyAtLeast('p', 2)} AND ${periodKeyAtMost('p', 4)}
         GROUP BY b.cost_center_id, a.account_type`,
        [ctx.companyId, from.start_date, from.period_no, to.start_date, to.period_no],
      );
      const own = new Map<string, { rev: MoneyValue; exp: MoneyValue }>();
      for (const d of data) {
        const v = own.get(d.cost_center_id) ?? { rev: new Money(0), exp: new Money(0) };
        if (d.account_type === 'REVENUE') v.rev = v.rev.plus(toMoney(d.credit).minus(d.debit));
        else v.exp = v.exp.plus(toMoney(d.debit).minus(d.credit));
        own.set(d.cost_center_id, v);
      }
      const children = new Map<string | null, typeof ccs>();
      for (const c of ccs) children.set(c.parent_id, [...(children.get(c.parent_id) ?? []), c]);
      const rolled = new Map<string, { rev: MoneyValue; exp: MoneyValue }>();
      const roll = (id: string): { rev: MoneyValue; exp: MoneyValue } => {
        const base = own.get(id) ?? { rev: new Money(0), exp: new Money(0) };
        let rev = scope && !scope.includes(id) ? new Money(0) : base.rev;
        let exp = scope && !scope.includes(id) ? new Money(0) : base.exp;
        for (const child of children.get(id) ?? []) {
          const c = roll(child.id);
          rev = rev.plus(c.rev);
          exp = exp.plus(c.exp);
        }
        rolled.set(id, { rev, exp });
        return { rev, exp };
      };
      const roots = children.get(null) ?? [];
      roots.forEach((r) => roll(r.id));

      const minor = company.minor_units;
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('مركز التكلفة', 'Cost center'), kind: 'bilingual', width: 36 },
        { key: 'revenue', label: t('الإيرادات', 'Revenue'), kind: 'amount' },
        { key: 'expense', label: t('المصروفات', 'Expenses'), kind: 'amount' },
        { key: 'net', label: t('الصافي', 'Net'), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      const visit = (node: (typeof ccs)[number], depth: number) => {
        const v = rolled.get(node.id) ?? { rev: new Money(0), exp: new Money(0) };
        if (!v.rev.isZero() || !v.exp.isZero()) {
          rows.push({
            cells: { code: node.code, name: t(node.name_ar, node.name_en), revenue: v.rev.toFixed(minor), expense: v.exp.toFixed(minor), net: v.rev.minus(v.exp).toFixed(minor) },
            level: depth,
            style: node.is_posting ? 'normal' : 'header',
            drill: { kind: 'costCenter', id: node.id },
          });
        }
        for (const child of children.get(node.id) ?? []) visit(child, depth + 1);
      };
      roots.forEach((r) => visit(r, 0));
      const total = roots.reduce((acc, r) => {
        const v = rolled.get(r.id) ?? { rev: new Money(0), exp: new Money(0) };
        return { rev: acc.rev.plus(v.rev), exp: acc.exp.plus(v.exp) };
      }, { rev: new Money(0), exp: new Money(0) });
      rows.push({ cells: { name: t('الإجمالي', 'Total'), revenue: total.rev.toFixed(minor), expense: total.exp.toFixed(minor), net: total.rev.minus(total.exp).toFixed(minor) }, style: 'grandTotal' });

      return this.document('cost-center-summary', t('ملخص مراكز التكلفة', 'Cost center summary'), company, columns, rows, [
        t(`من ${from.name_ar} إلى ${to.name_ar}`, `From ${from.name_en} to ${to.name_en}`),
      ], [t('يشمل الحركات المحملة على مراكز التكلفة فقط', 'Includes only lines assigned to a cost center')]);
    });
  }

  // ================================================================ Income statement

  incomeStatement(ctx: CompanyContext, q: { from_period_id: string; to_period_id: string; cost_center_id?: string; level?: number; compare: 'none' | 'prior_year' }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.company(tx, ctx.companyId);
      const [from, to] = await this.periodRange(tx, ctx.companyId, q.from_period_id, q.to_period_id);
      const ccIds = await this.costCenterFilter(tx, ctx, q.cost_center_id);
      const accounts = await this.accounts(tx, ctx.companyId);
      const range = (f: Period, t2: Period) =>
        this.sums(tx, ctx.companyId, `${periodKeyAtLeast('p', 2)} AND ${periodKeyAtMost('p', 4)}`, [f.start_date, f.period_no, t2.start_date, t2.period_no], ccIds);
      const current = await range(from, to);
      const prior = q.compare === 'prior_year' ? await this.priorYearRange(tx, ctx.companyId, from, to) : null;
      const priorSums = prior ? await range(prior[0], prior[1]) : null;

      const minor = company.minor_units;
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('البند', 'Line item'), kind: 'bilingual', width: 44 },
        { key: 'current', label: t('الفترة الحالية', 'Current period'), kind: 'amount' },
        ...(priorSums ? [{ key: 'prior', label: t('نفس الفترة من السنة السابقة', 'Same period last year'), kind: 'amount' as const }] : []),
      ];
      const tree = new AccountTree(accounts);
      const signed = (sums: Map<string, DC>, a: Account) => {
        const v = net(sums.get(a.id) ?? zero());
        return a.account_type === 'REVENUE' ? v.negated() : v;
      };
      const aggCurrent = tree.aggregate((id) => [signed(current, tree.get(id))], 1);
      const aggPrior = priorSums ? tree.aggregate((id) => [signed(priorSums, tree.get(id))], 1) : null;

      const rows: ReportRow[] = [];
      const sectionTotal = (type: AccountType, agg: Map<string, MoneyValue[]> | null) =>
        tree.roots().filter((r) => r.account_type === type).reduce((acc, r) => acc.plus(agg?.get(r.id)?.[0] ?? 0), new Money(0));

      for (const type of ['REVENUE', 'EXPENSE'] as const) {
        rows.push({ cells: { name: TYPE_TITLES[type] }, style: 'section' });
        for (const node of tree.walk(q.level, type)) {
          const cur = aggCurrent.get(node.account.id)?.[0] ?? new Money(0);
          const pri = aggPrior?.get(node.account.id)?.[0] ?? new Money(0);
          if (cur.isZero() && pri.isZero()) continue;
          if (node.depth === 1) continue; // the root is represented by the section heading and total
          rows.push({
            cells: { code: node.account.code, name: t(node.account.name_ar, node.account.name_en), current: cur.toFixed(minor), ...(aggPrior ? { prior: pri.toFixed(minor) } : {}) },
            level: node.depth - 2,
            style: node.account.is_posting || node.depth === q.level ? 'normal' : 'header',
            drill: node.account.is_posting ? { kind: 'account', id: node.account.id } : undefined,
          });
        }
        rows.push({
          cells: {
            name: t(`إجمالي ${TYPE_TITLES[type].ar}`, `Total ${TYPE_TITLES[type].en.toLowerCase()}`),
            current: sectionTotal(type, aggCurrent).toFixed(minor),
            ...(aggPrior ? { prior: sectionTotal(type, aggPrior).toFixed(minor) } : {}),
          },
          style: 'subtotal',
        });
      }
      const netCurrent = sectionTotal('REVENUE', aggCurrent).minus(sectionTotal('EXPENSE', aggCurrent));
      const netPrior = aggPrior ? sectionTotal('REVENUE', aggPrior).minus(sectionTotal('EXPENSE', aggPrior)) : null;
      rows.push({
        cells: { name: t('صافي ربح (خسارة) الفترة', 'Net profit (loss) for the period'), current: netCurrent.toFixed(minor), ...(netPrior ? { prior: netPrior.toFixed(minor) } : {}) },
        style: 'grandTotal',
      });
      return this.document('income-statement', t('قائمة الدخل', 'Income statement'), company, columns, rows, [
        t(`من ${from.name_ar} إلى ${to.name_ar}`, `From ${from.name_en} to ${to.name_en}`),
        ...(await this.costCenterSubtitle(tx, ctx.companyId, q.cost_center_id)),
      ], q.compare === 'prior_year' && !prior ? [t('لا توجد بيانات للسنة السابقة', 'No prior-year periods to compare')] : []);
    });
  }

  // ================================================================ Balance sheet

  balanceSheet(ctx: CompanyContext, q: { period_id: string; level?: number; compare: 'none' | 'prior_year' }) {
    return this.db.withTenant(ctx, async (tx) => {
      if (ctx.costCenterScope) throw new AppError('OUT_OF_SCOPE');
      const company = await this.company(tx, ctx.companyId);
      const period = await this.period(tx, ctx.companyId, q.period_id);
      const accounts = await this.accounts(tx, ctx.companyId);
      const priorPeriod = q.compare === 'prior_year' ? await this.samePeriodPriorYear(tx, ctx.companyId, period) : null;

      const snapshot = async (p: Period) => {
        const fy = await this.fiscalYear(tx, p.fiscal_year_id);
        const upTo = await this.sums(tx, ctx.companyId, periodKeyAtMost('p', 2), [p.start_date, p.period_no], null);
        const beforeYear = await this.sums(tx, ctx.companyId, 'p.start_date < $2::date', [fy.start_date], null);
        let currentResult = new Money(0);
        let priorResult = new Money(0);
        for (const a of accounts.filter((x) => x.is_posting && isProfitAndLoss(x.account_type))) {
          const all = net(upTo.get(a.id) ?? zero()).negated();
          const prior = net(beforeYear.get(a.id) ?? zero()).negated();
          priorResult = priorResult.plus(prior);
          currentResult = currentResult.plus(all.minus(prior));
        }
        return { upTo, currentResult, priorResult };
      };
      const cur = await snapshot(period);
      const pri = priorPeriod ? await snapshot(priorPeriod) : null;

      const tree = new AccountTree(accounts);
      const signed = (sums: Map<string, DC>, a: Account) => {
        const v = net(sums.get(a.id) ?? zero());
        return a.account_type === 'ASSET' ? v : v.negated();
      };
      const aggCur = tree.aggregate((id) => [signed(cur.upTo, tree.get(id))], 1);
      const aggPri = pri ? tree.aggregate((id) => [signed(pri.upTo, tree.get(id))], 1) : null;
      const minor = company.minor_units;

      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('البند', 'Line item'), kind: 'bilingual', width: 44 },
        { key: 'current', label: t(`كما في ${period.end_date}`, `As at ${period.end_date}`), kind: 'amount' },
        ...(priorPeriod ? [{ key: 'prior', label: t(`كما في ${priorPeriod.end_date}`, `As at ${priorPeriod.end_date}`), kind: 'amount' as const }] : []),
      ];
      const rows: ReportRow[] = [];
      const typeTotal = (type: AccountType, agg: Map<string, MoneyValue[]> | null) =>
        tree.roots().filter((r) => r.account_type === type).reduce((acc, r) => acc.plus(agg?.get(r.id)?.[0] ?? 0), new Money(0));
      const amount = (value: MoneyValue | null | undefined) => (value ? value.toFixed(minor) : null);

      const emitSection = (type: AccountType) => {
        rows.push({ cells: { name: TYPE_TITLES[type] }, style: 'section' });
        for (const node of tree.walk(q.level, type)) {
          if (node.depth === 1) continue;
          const c = aggCur.get(node.account.id)?.[0] ?? new Money(0);
          const p = aggPri?.get(node.account.id)?.[0] ?? new Money(0);
          if (c.isZero() && p.isZero()) continue;
          rows.push({
            cells: { code: node.account.code, name: t(node.account.name_ar, node.account.name_en), current: amount(c), ...(aggPri ? { prior: amount(p) } : {}) },
            level: node.depth - 2,
            style: node.account.is_posting || node.depth === q.level ? 'normal' : 'header',
            drill: node.account.is_posting ? { kind: 'account', id: node.account.id } : undefined,
          });
        }
      };

      emitSection('ASSET');
      const assetsCur = typeTotal('ASSET', aggCur);
      const assetsPri = aggPri ? typeTotal('ASSET', aggPri) : null;
      rows.push({ cells: { name: t('إجمالي الأصول', 'Total assets'), current: amount(assetsCur), ...(aggPri ? { prior: amount(assetsPri) } : {}) }, style: 'grandTotal' });

      emitSection('LIABILITY');
      const liabCur = typeTotal('LIABILITY', aggCur);
      const liabPri = aggPri ? typeTotal('LIABILITY', aggPri) : null;
      rows.push({ cells: { name: t('إجمالي المطلوبات', 'Total liabilities'), current: amount(liabCur), ...(aggPri ? { prior: amount(liabPri) } : {}) }, style: 'subtotal' });

      emitSection('EQUITY');
      if (!cur.priorResult.isZero() || (pri && !pri.priorResult.isZero())) {
        rows.push({
          cells: { name: t('نتائج سنوات سابقة غير مقفلة', "Prior years' unclosed result"), current: amount(cur.priorResult), ...(pri ? { prior: amount(pri.priorResult) } : {}) },
          level: 0,
        });
      }
      rows.push({
        cells: { name: t('صافي ربح (خسارة) السنة الحالية', 'Current year profit (loss)'), current: amount(cur.currentResult), ...(pri ? { prior: amount(pri.currentResult) } : {}) },
        level: 0,
      });
      const equityCur = typeTotal('EQUITY', aggCur).plus(cur.priorResult).plus(cur.currentResult);
      const equityPri = aggPri && pri ? typeTotal('EQUITY', aggPri).plus(pri.priorResult).plus(pri.currentResult) : null;
      rows.push({ cells: { name: t('إجمالي حقوق الملكية', 'Total equity'), current: amount(equityCur), ...(aggPri ? { prior: amount(equityPri) } : {}) }, style: 'subtotal' });
      const leCur = liabCur.plus(equityCur);
      rows.push({
        cells: { name: t('إجمالي المطلوبات وحقوق الملكية', 'Total liabilities and equity'), current: amount(leCur), ...(aggPri && liabPri && equityPri ? { prior: amount(liabPri.plus(equityPri)) } : {}) },
        style: 'grandTotal',
      });

      const balanced = assetsCur.equals(leCur);
      return this.document('balance-sheet', t('قائمة المركز المالي', 'Statement of financial position'), company, columns, rows, [
        t(`كما في ${period.end_date} (${period.name_ar})`, `As at ${period.end_date} (${period.name_en})`),
      ], [balanced ? t('القائمة متوازنة', 'The statement balances') : t('تحذير: الأصول لا تساوي المطلوبات وحقوق الملكية', 'Warning: assets do not equal liabilities and equity')]);
    });
  }

  // ================================================================ helpers

  private document(reportKey: string, title: BilingualText, company: Company, columns: ReportColumn[], rows: ReportRow[], subtitle: BilingualText[], notes: BilingualText[]): ReportDocument {
    return {
      reportKey,
      title,
      company: t(company.name_ar, company.name_en),
      subtitle,
      currency: company.base_currency,
      minorUnits: company.minor_units,
      columns,
      rows,
      notes: [...notes, t(`المبالغ بالعملة الأساسية (${company.base_currency})`, `Amounts in base currency (${company.base_currency})`)],
      generatedAt: new Date().toISOString(),
    };
  }

  private company(tx: Tx, companyId: string): Promise<Company> {
    return tx.one<Company>(
      `SELECT c.name_ar, c.name_en, c.base_currency, cur.minor_units FROM core.companies c JOIN core.currencies cur ON cur.code = c.base_currency WHERE c.id = $1`,
      [companyId],
    );
  }

  private accounts(tx: Tx, companyId: string): Promise<Account[]> {
    return tx.query<Account>(
      'SELECT id, code, name_ar, name_en, parent_id, is_posting, account_type, normal_balance FROM gl.accounts WHERE company_id = $1 ORDER BY code',
      [companyId],
    );
  }

  private async period(tx: Tx, companyId: string, id: string): Promise<Period> {
    const p = await tx.maybeOne<Period>('SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND id = $2', [companyId, id]);
    if (!p) throw notFound('period');
    return p;
  }

  private async periodRange(tx: Tx, companyId: string, fromId: string, toId: string): Promise<[Period, Period]> {
    const from = await this.period(tx, companyId, fromId);
    const to = await this.period(tx, companyId, toId);
    if (from.start_date > to.start_date || (from.start_date === to.start_date && from.period_no > to.period_no)) {
      throw new AppError('VALIDATION_FAILED', {}, [{ path: 'to_period_id', message: 'End period before start period' }]);
    }
    return [from, to];
  }

  private fiscalYear(tx: Tx, id: string): Promise<FiscalYear> {
    return tx.one<FiscalYear>('SELECT id, code, start_date, end_date FROM gl.fiscal_years WHERE id = $1', [id]);
  }

  private async priorFiscalYear(tx: Tx, companyId: string, fiscalYearId: string): Promise<FiscalYear | null> {
    return tx.maybeOne<FiscalYear>(
      `SELECT p.id, p.code, p.start_date, p.end_date FROM gl.fiscal_years c
       JOIN gl.fiscal_years p ON p.company_id = c.company_id AND p.end_date = c.start_date - 1
       WHERE c.company_id = $1 AND c.id = $2`,
      [companyId, fiscalYearId],
    );
  }

  private async samePeriodPriorYear(tx: Tx, companyId: string, period: Period): Promise<Period | null> {
    const prior = await this.priorFiscalYear(tx, companyId, period.fiscal_year_id);
    if (!prior) return null;
    return tx.maybeOne<Period>('SELECT * FROM gl.fiscal_periods WHERE fiscal_year_id = $1 AND period_no = $2', [prior.id, period.period_no]);
  }

  private async priorYearRange(tx: Tx, companyId: string, from: Period, to: Period): Promise<[Period, Period] | null> {
    const f = await this.samePeriodPriorYear(tx, companyId, from);
    const t2 = await this.samePeriodPriorYear(tx, companyId, to);
    return f && t2 ? [f, t2] : null;
  }

  /** Cost center filter combining the requested subtree with the user's scope; null = no filter. */
  private async costCenterFilter(tx: Tx, ctx: CompanyContext, costCenterId?: string): Promise<string[] | null> {
    const scope = await scopedCostCenterIds(tx, ctx);
    if (!costCenterId) return scope;
    const requested = await descendantIds(tx, 'gl.cost_centers', ctx.companyId, [costCenterId]);
    if (requested.length === 0) throw notFound('cost center');
    if (!scope) return requested;
    const allowed = requested.filter((id) => scope.includes(id));
    if (allowed.length === 0) throw new AppError('OUT_OF_SCOPE');
    return allowed;
  }

  private async costCenterSubtitle(tx: Tx, companyId: string, costCenterId?: string): Promise<BilingualText[]> {
    if (!costCenterId) return [];
    const cc = await tx.maybeOne<{ code: string; name_ar: string; name_en: string }>('SELECT code, name_ar, name_en FROM gl.cost_centers WHERE company_id = $1 AND id = $2', [companyId, costCenterId]);
    return cc ? [t(`مركز التكلفة: ${cc.code} ${cc.name_ar}`, `Cost center: ${cc.code} ${cc.name_en}`)] : [];
  }

  /** Base-currency debit/credit per posting account from the balance summary, for periods matching the filter. */
  private async sums(tx: Tx, companyId: string, periodFilter: string, filterParams: unknown[], ccIds: string[] | null): Promise<Map<string, DC>> {
    const ccParam = filterParams.length + 2;
    const rows = await tx.query<{ account_id: string; debit: string; credit: string }>(
      `SELECT b.account_id, sum(b.debit_base) AS debit, sum(b.credit_base) AS credit
       FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id
       WHERE b.company_id = $1 AND ${periodFilter} AND ($${ccParam}::uuid[] IS NULL OR b.cost_center_id = ANY($${ccParam}))
       GROUP BY b.account_id`,
      [companyId, ...filterParams, ccIds],
    );
    return new Map(rows.map((r) => [r.account_id, { debit: toMoney(r.debit), credit: toMoney(r.credit) }]));
  }
}

const fixed = (values: Map<string, MoneyValue>, minor: number): Record<string, string> =>
  Object.fromEntries([...values.entries()].map(([k, v]) => [k, v.toFixed(minor)]));

/** In-memory chart of accounts with roll-up and ordered traversal. */
class AccountTree {
  private readonly byId = new Map<string, Account>();
  private readonly children = new Map<string | null, Account[]>();

  constructor(accounts: Account[]) {
    for (const a of accounts) {
      this.byId.set(a.id, a);
      this.children.set(a.parent_id, [...(this.children.get(a.parent_id) ?? []), a]);
    }
  }

  get(id: string): Account {
    const a = this.byId.get(id);
    if (!a) throw notFound('account');
    return a;
  }

  roots(): Account[] {
    return this.children.get(null) ?? [];
  }

  /** Sums a vector of values from posting accounts up through every ancestor. */
  aggregate(valueOf: (postingAccountId: string) => MoneyValue[], width: number): Map<string, MoneyValue[]> {
    const result = new Map<string, MoneyValue[]>();
    const visit = (a: Account): MoneyValue[] => {
      let total: MoneyValue[] = Array.from({ length: width }, () => new Money(0));
      if (a.is_posting) total = valueOf(a.id).map((v) => toMoney(v));
      for (const child of this.children.get(a.id) ?? []) {
        const c = visit(child);
        total = total.map((v, i) => v.plus(c[i] ?? 0));
      }
      result.set(a.id, total);
      return total;
    };
    this.roots().forEach(visit);
    return result;
  }

  /** Depth-first, code-ordered traversal; depth starts at 1 for roots. Stops below maxDepth. */
  *walk(maxDepth?: number, type?: AccountType): Generator<{ account: Account; depth: number }> {
    const stack: { account: Account; depth: number }[] = this.roots()
      .filter((r) => !type || r.account_type === type)
      .reverse()
      .map((account) => ({ account, depth: 1 }));
    while (stack.length) {
      const node = stack.pop();
      if (!node) break;
      yield node;
      if (maxDepth && node.depth >= maxDepth) continue;
      const kids = this.children.get(node.account.id) ?? [];
      for (let i = kids.length - 1; i >= 0; i--) {
        const kid = kids[i];
        if (kid) stack.push({ account: kid, depth: node.depth + 1 });
      }
    }
  }
}
