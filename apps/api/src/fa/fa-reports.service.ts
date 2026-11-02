import { Injectable } from '@nestjs/common';
import { type BilingualText, Money, type MoneyValue, type ReportColumn, type ReportRow, toMoney } from '@erp/shared';
import { addDays, addMonths, MONTH_NAMES_AR, MONTH_NAMES_EN, monthIndex, yearOf } from '../common/dates';
import type { CompanyContext } from '../common/request-context';
import { DbService } from '../db/db.service';
import { notFound } from '../common/app-error';
import { ReportsService, t } from '../gl/reports.service';
import { depreciationFor } from './depreciation';
import type { Category } from './fixed-assets.service';

type AssetFacts = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  category_id: string;
  cost_center_code: string;
  acquisition_date: string;
  in_service_date: string;
  cost: string;
  residual_value: string;
  method: 'STRAIGHT_LINE' | 'DECLINING_BALANCE' | 'NONE';
  useful_life_months: number | null;
  declining_rate: string | null;
  opening_accum_dep: string;
  depreciated_to: string | null;
  status: string;
  disposal_date: string | null;
};
type DepLine = { asset_id: string; to_date: string; amount: string };
type Disposal = { asset_id: string; catch_up: string; accumulated: string };

const zero = () => new Money(0);

/** Fixed asset reports: register, IAS 16 movement schedule and depreciation forecast. */
@Injectable()
export class FaReportsService {
  constructor(
    private readonly db: DbService,
    private readonly reports: ReportsService,
  ) {}

  register(ctx: CompanyContext, q: { as_of: string; category_id?: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const minor = company.minor_units;
      const { assets, lines, categories } = await this.facts(tx, ctx.companyId, q.as_of);
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text' },
        { key: 'name', label: t('الأصل', 'Asset'), kind: 'bilingual', width: 30 },
        { key: 'cost_center', label: t('مركز التكلفة', 'Cost center'), kind: 'text' },
        { key: 'in_service', label: t('بداية الاستخدام', 'In service'), kind: 'date' },
        { key: 'cost', label: t('التكلفة', 'Cost'), kind: 'amount' },
        { key: 'accumulated', label: t('مجمع الاستهلاك', 'Accumulated depreciation'), kind: 'amount' },
        { key: 'nbv', label: t('صافي القيمة الدفترية', 'Net book value'), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      const grand = { cost: zero(), acc: zero() };
      for (const category of categories) {
        if (q.category_id && category.id !== q.category_id) continue;
        const members = assets.filter((a) => a.category_id === category.id && !(a.disposal_date && a.disposal_date <= q.as_of));
        if (!members.length) continue;
        rows.push({ cells: { name: t(category.name_ar, category.name_en) }, style: 'section' });
        const sub = { cost: zero(), acc: zero() };
        for (const a of members) {
          const acc = toMoney(a.opening_accum_dep).plus(sumLines(lines, a.id, (d) => d <= q.as_of));
          sub.cost = sub.cost.plus(a.cost);
          sub.acc = sub.acc.plus(acc);
          rows.push({
            cells: {
              code: a.code,
              name: t(a.name_ar, a.name_en),
              cost_center: a.cost_center_code,
              in_service: a.in_service_date,
              cost: toMoney(a.cost).toFixed(minor),
              accumulated: acc.toFixed(minor),
              nbv: toMoney(a.cost).minus(acc).toFixed(minor),
            },
            level: 1,
          });
        }
        rows.push({ cells: { name: t(`إجمالي ${category.name_ar}`, `Total ${category.name_en}`), cost: sub.cost.toFixed(minor), accumulated: sub.acc.toFixed(minor), nbv: sub.cost.minus(sub.acc).toFixed(minor) }, style: 'subtotal' });
        grand.cost = grand.cost.plus(sub.cost);
        grand.acc = grand.acc.plus(sub.acc);
      }
      rows.push({ cells: { name: t('الإجمالي', 'Total'), cost: grand.cost.toFixed(minor), accumulated: grand.acc.toFixed(minor), nbv: grand.cost.minus(grand.acc).toFixed(minor) }, style: 'grandTotal' });
      return this.reports.document('fa-register', t('سجل الأصول الثابتة', 'Fixed asset register'), company, columns, rows, [t(`كما في ${q.as_of}`, `As at ${q.as_of}`)], [
        t('يشمل الاستهلاك المرحل حتى تاريخ التقرير', 'Includes depreciation posted up to the report date'),
      ]);
    });
  }

  /** IAS 16 roll-forward per category, checked against the general ledger balances. */
  movement(ctx: CompanyContext, q: { from: string; to: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const minor = company.minor_units;
      const { assets, lines, disposals, categories } = await this.facts(tx, ctx.companyId, q.to);
      const keys = ['cost_open', 'additions', 'cost_disposals', 'cost_close', 'acc_open', 'charge', 'acc_disposals', 'acc_close', 'nbv'] as const;
      type Totals = Record<(typeof keys)[number], MoneyValue>;
      const empty = (): Totals => Object.fromEntries(keys.map((k) => [k, zero()])) as Totals;
      const columns: ReportColumn[] = [
        { key: 'name', label: t('الفئة', 'Category'), kind: 'bilingual', width: 24 },
        { key: 'cost_open', label: t('التكلفة أول المدة', 'Cost, opening'), kind: 'amount' },
        { key: 'additions', label: t('إضافات', 'Additions'), kind: 'amount' },
        { key: 'cost_disposals', label: t('استبعادات', 'Disposals'), kind: 'amount' },
        { key: 'cost_close', label: t('التكلفة آخر المدة', 'Cost, closing'), kind: 'amount' },
        { key: 'acc_open', label: t('مجمع الاستهلاك أول المدة', 'Depreciation, opening'), kind: 'amount' },
        { key: 'charge', label: t('استهلاك الفترة', 'Charge for the period'), kind: 'amount' },
        { key: 'acc_disposals', label: t('مجمع استهلاك المستبعد', 'On disposals'), kind: 'amount' },
        { key: 'acc_close', label: t('مجمع الاستهلاك آخر المدة', 'Depreciation, closing'), kind: 'amount' },
        { key: 'nbv', label: t('صافي القيمة الدفترية', 'Net book value'), kind: 'amount' },
      ];
      const rows: ReportRow[] = [];
      const grand = empty();
      for (const category of categories) {
        const tot = empty();
        let any = false;
        for (const a of assets.filter((x) => x.category_id === category.id)) {
          if (a.disposal_date && a.disposal_date < q.from) continue;
          any = true;
          const before = a.acquisition_date < q.from;
          const disposedIn = !!a.disposal_date && a.disposal_date <= q.to;
          const disposal = disposals.find((d) => d.asset_id === a.id);
          const opening = toMoney(a.opening_accum_dep);
          const depBefore = sumLines(lines, a.id, (d) => d < q.from);
          let charge = sumLines(lines, a.id, (d) => d >= q.from && d <= q.to);
          if (disposedIn && disposal) charge = charge.plus(disposal.catch_up);
          if (before) {
            tot.cost_open = tot.cost_open.plus(a.cost);
            tot.acc_open = tot.acc_open.plus(opening).plus(depBefore);
          } else {
            tot.additions = tot.additions.plus(a.cost);
            charge = charge.plus(opening).plus(depBefore);
          }
          tot.charge = tot.charge.plus(charge);
          if (disposedIn) {
            tot.cost_disposals = tot.cost_disposals.plus(a.cost);
            tot.acc_disposals = tot.acc_disposals.plus(disposal?.accumulated ?? '0');
          }
        }
        if (!any) continue;
        tot.cost_close = tot.cost_open.plus(tot.additions).minus(tot.cost_disposals);
        tot.acc_close = tot.acc_open.plus(tot.charge).minus(tot.acc_disposals);
        tot.nbv = tot.cost_close.minus(tot.acc_close);
        for (const k of keys) grand[k] = grand[k].plus(tot[k]);
        rows.push({ cells: { name: t(category.name_ar, category.name_en), ...Object.fromEntries(keys.map((k) => [k, tot[k].toFixed(minor)])) } });
      }
      rows.push({ cells: { name: t('الإجمالي', 'Total'), ...Object.fromEntries(keys.map((k) => [k, grand[k].toFixed(minor)])) }, style: 'grandTotal' });

      // The register should agree with the ledger when its accounts are used by this module only.
      const used = categories.filter((c) => assets.some((a) => a.category_id === c.id));
      const ledger = await tx.one<{ cost: string; acc: string }>(
        `SELECT COALESCE(sum(CASE WHEN l.account_id = ANY($2::uuid[]) THEN l.debit_base - l.credit_base END), 0) AS cost,
                COALESCE(sum(CASE WHEN l.account_id = ANY($3::uuid[]) THEN l.credit_base - l.debit_base END), 0) AS acc
         FROM gl.journal_lines l JOIN gl.journal_entries e ON e.id = l.entry_id
         WHERE l.company_id = $1 AND e.status IN ('POSTED', 'REVERSED') AND e.entry_date <= $4`,
        [ctx.companyId, [...new Set(used.map((c) => c.asset_account_id))], [...new Set(used.flatMap((c) => (c.accum_dep_account_id ? [c.accum_dep_account_id] : [])))], q.to],
      );
      const costDiff = toMoney(ledger.cost).minus(grand.cost_close);
      const accDiff = toMoney(ledger.acc).minus(grand.acc_close);
      const notes: BilingualText[] = [
        costDiff.isZero() && accDiff.isZero()
          ? t('يتطابق مع أرصدة الأستاذ العام', 'Agrees with the general ledger balances')
          : t(
              `فرق مع الأستاذ العام: التكلفة ${costDiff.toFixed(minor)}، مجمع الاستهلاك ${accDiff.toFixed(minor)}`,
              `Difference with the general ledger: cost ${costDiff.toFixed(minor)}, accumulated depreciation ${accDiff.toFixed(minor)}`,
            ),
      ];
      return this.reports.document('fa-movement', t('جدول حركة الممتلكات والمعدات', 'Property and equipment movement schedule'), company, columns, rows, [
        t(`من ${q.from} إلى ${q.to}`, `From ${q.from} to ${q.to}`),
      ], notes);
    });
  }

  /** Projected depreciation by category and month for assets in service now. */
  forecast(ctx: CompanyContext, q: { period_id: string; months: number }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const minor = company.minor_units;
      const period = await tx.maybeOne<{ start_date: string }>('SELECT start_date FROM gl.fiscal_periods WHERE company_id = $1 AND id = $2', [ctx.companyId, q.period_id]);
      if (!period) throw notFound('period');
      const start = `${period.start_date.slice(0, 7)}-01`;
      const months = Array.from({ length: q.months }, (_, i) => {
        const first = addMonths(start, i);
        return { key: `m${i}`, first, last: addDays(addMonths(first, 1), -1) };
      });
      const { assets, lines, categories } = await this.facts(tx, ctx.companyId, '9999-12-31');
      const columns: ReportColumn[] = [
        { key: 'name', label: t('الفئة', 'Category'), kind: 'bilingual', width: 22 },
        ...months.map((m) => ({ key: m.key, label: t(`${MONTH_NAMES_AR[monthIndex(m.first)]} ${yearOf(m.first)}`, `${MONTH_NAMES_EN[monthIndex(m.first)]?.slice(0, 3)} ${yearOf(m.first)}`), kind: 'amount' as const })),
        { key: 'total', label: t('الإجمالي', 'Total'), kind: 'amount' },
      ];
      const byCategory = new Map<string, MoneyValue[]>();
      for (const a of assets) {
        if (a.method === 'NONE' || (a.status !== 'ACTIVE' && a.status !== 'FULLY_DEPRECIATED')) continue;
        let accumulated = toMoney(a.opening_accum_dep).plus(sumLines(lines, a.id, () => true));
        let depreciatedTo = a.depreciated_to ?? addDays(a.in_service_date, -1);
        const amounts = byCategory.get(a.category_id) ?? months.map(() => zero());
        months.forEach((m, i) => {
          const candidates = [m.first, addDays(depreciatedTo, 1), a.in_service_date].sort();
          const from = candidates[2] ?? m.first;
          if (from > m.last) return;
          const amount = depreciationFor({ ...a, accumulated }, from, m.last, minor);
          accumulated = accumulated.plus(amount);
          depreciatedTo = m.last;
          amounts[i] = (amounts[i] ?? zero()).plus(amount);
        });
        byCategory.set(a.category_id, amounts);
      }
      const rows: ReportRow[] = [];
      const grand = months.map(() => zero());
      for (const category of categories) {
        const amounts = byCategory.get(category.id);
        if (!amounts) continue;
        amounts.forEach((v, i) => (grand[i] = (grand[i] ?? zero()).plus(v)));
        rows.push({
          cells: {
            name: t(category.name_ar, category.name_en),
            ...Object.fromEntries(months.map((m, i) => [m.key, (amounts[i] ?? zero()).toFixed(minor)])),
            total: amounts.reduce((acc, v) => acc.plus(v), zero()).toFixed(minor),
          },
        });
      }
      rows.push({
        cells: { name: t('الإجمالي', 'Total'), ...Object.fromEntries(months.map((m, i) => [m.key, (grand[i] ?? zero()).toFixed(minor)])), total: grand.reduce((acc, v) => acc.plus(v), zero()).toFixed(minor) },
        style: 'grandTotal',
      });
      return this.reports.document('fa-forecast', t('توقعات الاستهلاك', 'Depreciation forecast'), company, columns, rows, [
        t(`${q.months} شهراً ابتداءً من ${start.slice(0, 7)}`, `${q.months} months from ${start.slice(0, 7)}`),
      ], [t('للأصول قيد الاستخدام حالياً، دون إضافات أو استبعادات مستقبلية', 'Assets currently in service; future additions and disposals are not included')]);
    });
  }

  /** Assets in service (not drafts) acquired by `until`, their posted depreciation and disposals. */
  private async facts(tx: import('../db/db.service').Tx, companyId: string, until: string) {
    const categories = await tx.query<Category>('SELECT * FROM fa.categories WHERE company_id = $1 ORDER BY code', [companyId]);
    const assets = await tx.query<AssetFacts>(
      `SELECT a.id, a.code, a.name_ar, a.name_en, a.category_id, cc.code AS cost_center_code, a.acquisition_date, a.in_service_date, a.cost,
              a.residual_value, a.method, a.useful_life_months, a.declining_rate, a.opening_accum_dep, a.depreciated_to, a.status, a.disposal_date
       FROM fa.assets a JOIN gl.cost_centers cc ON cc.id = a.cost_center_id
       WHERE a.company_id = $1 AND a.status <> 'DRAFT' AND a.acquisition_date <= $2 ORDER BY a.code`,
      [companyId, until],
    );
    const lines = await tx.query<DepLine>(
      `SELECT l.asset_id, l.to_date, l.amount FROM fa.depreciation_lines l JOIN fa.depreciation_runs r ON r.id = l.run_id
       WHERE l.company_id = $1 AND r.status = 'POSTED'`,
      [companyId],
    );
    const disposals = await tx.query<Disposal>(
      `SELECT DISTINCT ON (ev.asset_id) ev.asset_id, ev.details->>'catch_up' AS catch_up, ev.details->>'accumulated' AS accumulated
       FROM fa.asset_events ev JOIN fa.assets a ON a.id = ev.asset_id
       WHERE ev.company_id = $1 AND ev.event_type = 'DISPOSE' AND a.status = 'DISPOSED'
       ORDER BY ev.asset_id, ev.created_at DESC`,
      [companyId],
    );
    return { categories, assets, lines, disposals };
  }
}

const sumLines = (lines: DepLine[], assetId: string, include: (toDate: string) => boolean): MoneyValue =>
  lines.filter((l) => l.asset_id === assetId && include(l.to_date)).reduce((acc, l) => acc.plus(l.amount), new Money(0));
