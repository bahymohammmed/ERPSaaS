import { Injectable } from '@nestjs/common';
import {
  type AccountType,
  type BilingualText,
  type ConsolidationGroupInput,
  isProfitAndLoss,
  Money,
  type MoneyValue,
  type RateType,
  type ReportColumn,
  type ReportDocument,
  type ReportRow,
  sumAmounts,
  toMoney,
} from '@erp/shared';
import type { z } from 'zod';
import type { consolidationAdjustmentSchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { RequestContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { findRate } from './masters.service';
import { type Account, AccountTree, OPERATING_BALANCES, t } from './reports.service';

type Group = { id: string; code: string; name_ar: string; name_en: string; parent_company_id: string; presentation_currency: string; minor_units: number };
type Member = { company_id: string; code: string; name_ar: string; name_en: string; base_currency: string };
type CodeAccount = Account & { company_code: string };
/** Debit-positive amounts per account code. */
type Amounts = Map<string, MoneyValue>;

const add = (map: Amounts, code: string, value: MoneyValue) => map.set(code, (map.get(code) ?? new Money(0)).plus(value));
const total = (map: Amounts, codes?: Iterable<string>) => [...(codes ?? map.keys())].reduce((acc, c) => acc.plus(map.get(c) ?? 0), new Money(0));

/**
 * Multi-entity consolidation within a tenant. Members' balances are aggregated by account code
 * onto the parent's chart, translated into the presentation currency (balance sheet at the
 * closing rate, profit or loss at the average rate, from the parent's rate table), intercompany
 * balances created through linked intercompany entries are eliminated, and manual consolidation
 * adjustments are applied. Nothing is written to any company's ledger.
 */
@Injectable()
export class ConsolidationService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- groups

  listGroups(ctx: RequestContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT g.*, COALESCE(array_agg(m.company_id) FILTER (WHERE m.company_id IS NOT NULL), '{}') AS member_company_ids
         FROM gl.consolidation_groups g LEFT JOIN gl.consolidation_members m ON m.group_id = g.id
         GROUP BY g.tenant_id, g.id ORDER BY g.code`,
      ),
    );
  }

  saveGroup(ctx: RequestContext, input: ConsolidationGroupInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const parent = await tx.maybeOne<{ base_currency: string }>('SELECT base_currency FROM core.companies WHERE id = $1', [input.parent_company_id]);
      if (!parent) throw notFound('company');
      // Translation uses the parent's rate table, which is quoted in the parent's base currency.
      if (parent.base_currency !== input.presentation_currency) {
        throw new AppError('VALIDATION_FAILED', {}, [{ path: 'presentation_currency', message: "Must be the parent company's base currency" }]);
      }
      const members = [...new Set([input.parent_company_id, ...input.member_company_ids])];
      const found = await tx.query('SELECT id FROM core.companies WHERE id = ANY($1::uuid[])', [members]);
      if (found.length !== members.length) throw notFound('company');
      const params = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.parent_company_id, input.presentation_currency, input.is_active];
      const row = id
        ? await tx.maybeOne<{ id: string }>(
            `UPDATE gl.consolidation_groups SET code = $2, name_ar = $3, name_en = $4, parent_company_id = $5, presentation_currency = $6, is_active = $7
             WHERE id = $1 RETURNING id`,
            [id, ...params],
          )
        : await tx.one<{ id: string }>(
            `INSERT INTO gl.consolidation_groups (tenant_id, code, name_ar, name_en, parent_company_id, presentation_currency, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [ctx.tenantId, ...params],
          );
      if (!row) throw notFound('consolidation group');
      await tx.query('DELETE FROM gl.consolidation_members WHERE group_id = $1', [row.id]);
      for (const companyId of members) {
        await tx.query('INSERT INTO gl.consolidation_members (tenant_id, group_id, company_id) VALUES ($1, $2, $3)', [ctx.tenantId, row.id, companyId]);
      }
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'consolidation_group', entityId: row.id, newData: input });
      return row;
    });
  }

  listAdjustments(ctx: RequestContext, groupId: string) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query('SELECT * FROM gl.consolidation_adjustments WHERE group_id = $1 ORDER BY adjustment_date DESC, created_at DESC', [groupId]),
    );
  }

  saveAdjustment(ctx: RequestContext, groupId: string, input: z.infer<typeof consolidationAdjustmentSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.group(tx, groupId);
      const debit = sumAmounts(input.lines.map((l) => l.debit));
      const credit = sumAmounts(input.lines.map((l) => l.credit));
      if (!debit.equals(credit)) throw new AppError('JOURNAL_UNBALANCED', { debit: debit.toString(), credit: credit.toString() });
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.consolidation_adjustments (tenant_id, group_id, adjustment_date, description, lines, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [ctx.tenantId, groupId, input.adjustment_date, input.description, JSON.stringify(input.lines), ctx.userId],
      );
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'consolidation_adjustment', entityId: row.id, newData: input });
      return row;
    });
  }

  removeAdjustment(ctx: RequestContext, groupId: string, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const rows = await tx.query('DELETE FROM gl.consolidation_adjustments WHERE group_id = $1 AND id = $2 RETURNING id', [groupId, id]);
      if (!rows.length) throw notFound('adjustment');
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'consolidation_adjustment', entityId: id });
      return { deleted: true };
    });
  }

  // ---------------------------------------------------------------- reports

  /** Consolidated trial balance as at a date: one column per member, then eliminations and adjustments. */
  worksheet(ctx: RequestContext, groupId: string, asOf: string) {
    return this.db.withTenant(ctx, async (tx) => {
      this.assertUnscoped(ctx);
      const group = await this.group(tx, groupId);
      const data = await this.position(tx, group, asOf);
      const minor = group.minor_units;
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('الحساب', 'Account'), kind: 'bilingual', width: 30 },
        ...data.members.map((m) => ({ key: `m_${m.company_id}`, label: t(m.code, m.code), kind: 'amount' as const })),
        { key: 'elim', label: t('الاستبعادات', 'Eliminations'), kind: 'amount' },
        { key: 'adj', label: t('التسويات', 'Adjustments'), kind: 'amount' },
        { key: 'total', label: t('الموحد', 'Consolidated'), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      for (const account of data.accounts.filter((a) => a.is_posting)) {
        const cells: Record<string, string> = {};
        let any = false;
        for (const m of data.members) {
          const v = data.byMember.get(m.company_id)?.get(account.code) ?? new Money(0);
          if (!v.isZero()) any = true;
          cells[`m_${m.company_id}`] = v.toFixed(minor);
        }
        const elim = data.eliminations.get(account.code) ?? new Money(0);
        const adj = data.adjustments.get(account.code) ?? new Money(0);
        if (!any && elim.isZero() && adj.isZero()) continue;
        rows.push({ cells: { code: account.code, name: t(account.name_ar, account.name_en), ...cells, elim: elim.toFixed(minor), adj: adj.toFixed(minor), total: (data.consolidated.get(account.code) ?? new Money(0)).toFixed(minor) } });
      }
      if (!data.icDifference.isZero()) {
        rows.push({ cells: { name: t('فروقات بين الشركات غير مطابقة', 'Unreconciled intercompany differences'), elim: data.icDifference.toFixed(minor), total: data.icDifference.toFixed(minor) }, style: 'header' });
      }
      const totals: Record<string, string> = {};
      for (const m of data.members) totals[`m_${m.company_id}`] = total(data.byMember.get(m.company_id) ?? new Map()).toFixed(minor);
      rows.push({
        cells: { name: t('الإجمالي (يجب أن يساوي صفراً)', 'Total (should be zero)'), ...totals, elim: total(data.eliminations).plus(data.icDifference).toFixed(minor), adj: total(data.adjustments).toFixed(minor), total: total(data.consolidated).plus(data.icDifference).toFixed(minor) },
        style: 'grandTotal',
      });
      return this.document('consolidation-worksheet', t('ورقة عمل التوحيد', 'Consolidation worksheet'), group, columns, rows, [t(`كما في ${asOf} — المبالغ مدين (+)`, `As at ${asOf} — amounts debit (+)`)], data.notes);
    });
  }

  balanceSheet(ctx: RequestContext, groupId: string, asOf: string) {
    return this.db.withTenant(ctx, async (tx) => {
      this.assertUnscoped(ctx);
      const group = await this.group(tx, groupId);
      const data = await this.position(tx, group, asOf);
      const minor = group.minor_units;
      const tree = new AccountTree(data.accounts);
      const signed = (code: string, type: AccountType) => {
        const v = data.consolidated.get(code) ?? new Money(0);
        return type === 'ASSET' ? v : v.negated();
      };
      const agg = tree.aggregate((code) => [signed(code, tree.get(code).account_type)], 1);
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('البند', 'Line item'), kind: 'bilingual', width: 44 },
        { key: 'current', label: t(`كما في ${asOf}`, `As at ${asOf}`), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      const typeTotal = (type: AccountType) => tree.roots().filter((r) => r.account_type === type).reduce((acc, r) => acc.plus(agg.get(r.id)?.[0] ?? 0), new Money(0));
      const section = (type: AccountType, title: BilingualText) => {
        rows.push({ cells: { name: title }, style: 'section' });
        for (const node of tree.walk(3, type)) {
          if (node.depth === 1) continue;
          const v = agg.get(node.account.id)?.[0] ?? new Money(0);
          if (v.isZero()) continue;
          rows.push({ cells: { code: node.account.code, name: t(node.account.name_ar, node.account.name_en), current: v.toFixed(minor) }, level: node.depth - 2, style: node.account.is_posting || node.depth === 3 ? 'normal' : 'header' });
        }
      };
      section('ASSET', t('الموجودات', 'Assets'));
      const assets = typeTotal('ASSET');
      rows.push({ cells: { name: t('مجموع الموجودات', 'Total assets'), current: assets.toFixed(minor) }, style: 'grandTotal' });
      section('LIABILITY', t('المطلوبات', 'Liabilities'));
      const liabilities = typeTotal('LIABILITY');
      rows.push({ cells: { name: t('مجموع المطلوبات', 'Total liabilities'), current: liabilities.toFixed(minor) }, style: 'subtotal' });
      section('EQUITY', t('حقوق الملكية', 'Equity'));
      const result = data.accounts.filter((a) => a.is_posting && isProfitAndLoss(a.account_type)).reduce((acc, a) => acc.minus(data.consolidated.get(a.code) ?? 0), new Money(0));
      rows.push({ cells: { name: t('أرباح غير موزعة (غير مقفلة)', 'Unappropriated (unclosed) result'), current: result.toFixed(minor) } });
      if (!data.icDifference.isZero()) rows.push({ cells: { name: t('فروقات بين الشركات غير مطابقة', 'Unreconciled intercompany differences'), current: data.icDifference.negated().toFixed(minor) } });
      const equity = typeTotal('EQUITY').plus(result).minus(data.icDifference);
      rows.push({ cells: { name: t('مجموع حقوق الملكية', 'Total equity'), current: equity.toFixed(minor) }, style: 'subtotal' });
      rows.push({ cells: { name: t('مجموع المطلوبات وحقوق الملكية', 'Total liabilities and equity'), current: liabilities.plus(equity).toFixed(minor) }, style: 'grandTotal' });
      const balanced = assets.equals(liabilities.plus(equity));
      return this.document('consolidated-balance-sheet', t('بيان المركز المالي الموحد', 'Consolidated statement of financial position'), group, columns, rows, [t(`كما في ${asOf}`, `As at ${asOf}`)], [
        balanced ? t('القائمة متوازنة', 'The statement balances') : t('تحذير: القائمة غير متوازنة', 'Warning: the statement does not balance'),
        ...data.notes,
      ]);
    });
  }

  incomeStatement(ctx: RequestContext, groupId: string, from: string, to: string) {
    return this.db.withTenant(ctx, async (tx) => {
      this.assertUnscoped(ctx);
      if (from > to) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'to', message: 'End date before start date' }]);
      const group = await this.group(tx, groupId);
      const members = await this.members(tx, group.id);
      const accounts = await this.chart(tx, group, members);
      const notes: BilingualText[] = [];
      const consolidated: Amounts = new Map();
      const columnsByMember = new Map<string, Amounts>();
      for (const m of members) {
        const rate = await this.rate(tx, group, m, to, 'AVERAGE', notes);
        const rows = await tx.query<{ code: string; net: string }>(
          `SELECT a.code, sum(b.debit_base - b.credit_base) AS net
           FROM ${OPERATING_BALANCES} b JOIN gl.fiscal_periods p ON p.id = b.period_id JOIN gl.accounts a ON a.id = b.account_id
           WHERE b.company_id = $1 AND a.account_type IN ('REVENUE', 'EXPENSE') AND p.start_date >= $2 AND p.end_date <= $3
           GROUP BY a.code`,
          [m.company_id, from, to],
        );
        const amounts: Amounts = new Map();
        for (const r of rows) {
          const v = toMoney(r.net).times(rate).toDecimalPlaces(group.minor_units);
          add(amounts, r.code, v);
          add(consolidated, r.code, v);
        }
        columnsByMember.set(m.company_id, amounts);
      }
      const adjustments = await this.adjustmentAmounts(tx, group.id, from, to);
      for (const [code, v] of adjustments) if (isProfitAndLoss(accounts.find((a) => a.code === code)?.account_type ?? 'ASSET')) add(consolidated, code, v);

      const minor = group.minor_units;
      const tree = new AccountTree(accounts);
      const natural = (code: string) => {
        const v = consolidated.get(code) ?? new Money(0);
        return tree.get(code).account_type === 'REVENUE' ? v.negated() : v;
      };
      const agg = tree.aggregate((code) => [natural(code)], 1);
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text', width: 10 },
        { key: 'name', label: t('البند', 'Line item'), kind: 'bilingual', width: 44 },
        { key: 'current', label: t('الموحد', 'Consolidated'), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      const sectionTotal = (type: AccountType) => tree.roots().filter((r) => r.account_type === type).reduce((acc, r) => acc.plus(agg.get(r.id)?.[0] ?? 0), new Money(0));
      for (const type of ['REVENUE', 'EXPENSE'] as const) {
        rows.push({ cells: { name: type === 'REVENUE' ? t('الإيرادات', 'Revenue') : t('المصروفات', 'Expenses') }, style: 'section' });
        for (const node of tree.walk(3, type)) {
          if (node.depth === 1) continue;
          const v = agg.get(node.account.id)?.[0] ?? new Money(0);
          if (v.isZero()) continue;
          rows.push({ cells: { code: node.account.code, name: t(node.account.name_ar, node.account.name_en), current: v.toFixed(minor) }, level: node.depth - 2, style: node.account.is_posting || node.depth === 3 ? 'normal' : 'header' });
        }
        rows.push({ cells: { name: type === 'REVENUE' ? t('إجمالي الإيرادات', 'Total revenue') : t('إجمالي المصروفات', 'Total expenses'), current: sectionTotal(type).toFixed(minor) }, style: 'subtotal' });
      }
      rows.push({ cells: { name: t('صافي الربح الموحد', 'Consolidated net profit'), current: sectionTotal('REVENUE').minus(sectionTotal('EXPENSE')).toFixed(minor) }, style: 'grandTotal' });
      return this.document('consolidated-income-statement', t('بيان الأرباح أو الخسائر الموحد', 'Consolidated statement of profit or loss'), group, columns, rows, [t(`من ${from} إلى ${to}`, `From ${from} to ${to}`)], [
        ...notes,
        t('الإيرادات والمصروفات بين شركات المجموعة تستبعد بالتسويات اليدوية', 'Intra-group revenue and expenses are eliminated through manual adjustments'),
      ]);
    });
  }

  // ---------------------------------------------------------------- internals

  /** Everything as at a date, translated at the closing rate, with eliminations and adjustments. */
  private async position(tx: Tx, group: Group, asOf: string) {
    const members = await this.members(tx, group.id);
    const accounts = await this.chart(tx, group, members);
    const notes: BilingualText[] = [];
    const byMember = new Map<string, Amounts>();
    const consolidated: Amounts = new Map();
    const rates = new Map<string, MoneyValue>();
    const retained = await tx.maybeOne<{ code: string }>(
      'SELECT a.code FROM core.companies c JOIN gl.accounts a ON a.id = c.retained_earnings_account_id WHERE c.id = $1',
      [group.parent_company_id],
    );
    for (const m of members) {
      const rate = await this.rate(tx, group, m, asOf, 'CLOSING', notes);
      rates.set(m.company_id, rate);
      const rows = await tx.query<{ code: string; net: string }>(
        `SELECT a.code, sum(b.debit_base - b.credit_base) AS net
         FROM gl.account_balances b JOIN gl.fiscal_periods p ON p.id = b.period_id JOIN gl.accounts a ON a.id = b.account_id
         WHERE b.company_id = $1 AND p.end_date <= $2 GROUP BY a.code`,
        [m.company_id, asOf],
      );
      const amounts: Amounts = new Map();
      for (const r of rows) {
        const v = toMoney(r.net).times(rate).toDecimalPlaces(group.minor_units);
        add(amounts, r.code, v);
        add(consolidated, r.code, v);
      }
      // Rounding after translation can leave a member a few fils off zero; book it to retained earnings.
      const residue = total(amounts);
      if (!residue.isZero() && retained) {
        add(amounts, retained.code, residue.negated());
        add(consolidated, retained.code, residue.negated());
      }
      byMember.set(m.company_id, amounts);
    }

    // Eliminate intercompany balances between members, from linked intercompany entries.
    const memberIds = members.map((m) => m.company_id);
    const eliminations: Amounts = new Map();
    const icRows = await tx.query<{ company_id: string; code: string; net: string }>(
      `SELECT l.company_id, a.code, sum(l.debit_base - l.credit_base) AS net
       FROM gl.journal_lines l
       JOIN gl.journal_entries e ON e.id = l.entry_id
       JOIN gl.intercompany_links k ON k.id::text = e.source_doc_id
       JOIN gl.intercompany_partners p ON p.company_id = l.company_id
         AND p.partner_company_id = CASE WHEN k.source_company_id = l.company_id THEN k.target_company_id ELSE k.source_company_id END
         AND l.account_id IN (p.due_from_account_id, p.due_to_account_id)
       JOIN gl.accounts a ON a.id = l.account_id
       WHERE e.source_doc_type = 'INTERCOMPANY' AND e.status IN ('POSTED', 'REVERSED') AND e.entry_date <= $1
         AND k.source_company_id = ANY($2::uuid[]) AND k.target_company_id = ANY($2::uuid[])
       GROUP BY l.company_id, a.code`,
      [asOf, memberIds],
    );
    for (const r of icRows) {
      const v = toMoney(r.net).times(rates.get(r.company_id) ?? 1).toDecimalPlaces(group.minor_units).negated();
      add(eliminations, r.code, v);
      add(consolidated, r.code, v);
    }
    // Whatever the eliminations do not cancel is an unreconciled difference, shown separately.
    const icDifference = total(eliminations).negated();

    const adjustments = await this.adjustmentAmounts(tx, group.id, null, asOf);
    for (const [code, v] of adjustments) add(consolidated, code, v);

    const known = new Set(accounts.map((a) => a.code));
    const unknown = [...consolidated.keys()].filter((c) => !known.has(c));
    if (unknown.length) notes.push(t(`رموز حسابات غير معرفة في دليل الشركة الأم: ${unknown.join('، ')}`, `Account codes missing from the parent's chart: ${unknown.join(', ')}`));
    return { members, accounts, byMember, eliminations, adjustments, consolidated, icDifference, notes };
  }

  /** Parent chart plus member accounts whose codes the parent lacks, keyed by code. */
  private async chart(tx: Tx, group: Group, members: Member[]): Promise<CodeAccount[]> {
    const rows = await tx.query<CodeAccount & { parent_code: string | null; company_id: string }>(
      `SELECT a.code AS id, a.code, a.name_ar, a.name_en, pa.code AS parent_code, a.is_posting, a.account_type, a.normal_balance, a.company_id, c.code AS company_code
       FROM gl.accounts a LEFT JOIN gl.accounts pa ON pa.id = a.parent_id JOIN core.companies c ON c.id = a.company_id
       WHERE a.company_id = ANY($1::uuid[])
       ORDER BY (a.company_id = $2) DESC, a.code`,
      [members.map((m) => m.company_id), group.parent_company_id],
    );
    const byCode = new Map<string, CodeAccount>();
    for (const r of rows) {
      if (byCode.has(r.code)) continue;
      byCode.set(r.code, { ...r, id: r.code, parent_id: r.parent_code });
    }
    for (const a of byCode.values()) if (a.parent_id && !byCode.has(a.parent_id)) a.parent_id = null;
    return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  }

  private async rate(tx: Tx, group: Group, member: Member, date: string, type: RateType, notes: BilingualText[]): Promise<MoneyValue> {
    if (member.base_currency === group.presentation_currency) return new Money(1);
    for (const candidate of [type, 'CLOSING', 'SPOT'] as RateType[]) {
      const rate = await findRate(tx, group.parent_company_id, member.base_currency, date, candidate).catch(() => null);
      if (rate) {
        notes.push(t(`${member.code}: ${member.base_currency} بسعر ${toMoney(rate).toString()} (${candidate})`, `${member.code}: ${member.base_currency} at ${toMoney(rate).toString()} (${candidate})`));
        return toMoney(rate);
      }
    }
    throw new AppError('RATE_NOT_FOUND', { currency: member.base_currency, date });
  }

  private async adjustmentAmounts(tx: Tx, groupId: string, from: string | null, to: string): Promise<Amounts> {
    const rows = await tx.query<{ lines: { account_code: string; debit: string; credit: string }[] }>(
      'SELECT lines FROM gl.consolidation_adjustments WHERE group_id = $1 AND adjustment_date <= $2 AND ($3::date IS NULL OR adjustment_date >= $3)',
      [groupId, to, from],
    );
    const amounts: Amounts = new Map();
    for (const r of rows) for (const l of r.lines) add(amounts, l.account_code, toMoney(l.debit).minus(l.credit));
    return amounts;
  }

  private async group(tx: Tx, id: string): Promise<Group> {
    const group = await tx.maybeOne<Group>(
      `SELECT g.id, g.code, g.name_ar, g.name_en, g.parent_company_id, g.presentation_currency, c.minor_units
       FROM gl.consolidation_groups g JOIN core.currencies c ON c.code = g.presentation_currency WHERE g.id = $1`,
      [id],
    );
    if (!group) throw notFound('consolidation group');
    return group;
  }

  private members(tx: Tx, groupId: string): Promise<Member[]> {
    return tx.query<Member>(
      `SELECT c.id AS company_id, c.code, c.name_ar, c.name_en, c.base_currency FROM gl.consolidation_members m
       JOIN core.companies c ON c.id = m.company_id WHERE m.group_id = $1 ORDER BY c.code`,
      [groupId],
    );
  }

  private assertUnscoped(ctx: RequestContext): void {
    if (ctx.costCenterScope) throw new AppError('OUT_OF_SCOPE');
  }

  private document(reportKey: string, title: BilingualText, group: Group, columns: ReportColumn[], rows: ReportRow[], subtitle: BilingualText[], notes: BilingualText[]): ReportDocument {
    return {
      reportKey,
      title,
      company: t(group.name_ar, group.name_en),
      subtitle,
      currency: group.presentation_currency,
      minorUnits: group.minor_units,
      columns,
      rows,
      notes: [...notes, t(`المبالغ بعملة العرض (${group.presentation_currency})`, `Amounts in presentation currency (${group.presentation_currency})`)],
      generatedAt: new Date().toISOString(),
    };
  }
}
