import { Injectable } from '@nestjs/common';
import { Money, type MoneyValue, type ReportColumn, type ReportRow, roundToMinor, type TaxCodeInput, toMoney } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { DbService } from '../db/db.service';
import { ReportsService, t } from '../gl/reports.service';

/** Sales and purchase tax codes, and the tax return report built from posted documents. */
@Injectable()
export class TaxService {
  constructor(
    private readonly db: DbService,
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT tc.*, sa.code AS sales_account_code, pa.code AS purchase_account_code,
                EXISTS (SELECT 1 FROM sl.document_lines l WHERE l.tax_code_id = tc.id) AS in_use
         FROM sl.tax_codes tc LEFT JOIN gl.accounts sa ON sa.id = tc.sales_account_id LEFT JOIN gl.accounts pa ON pa.id = tc.purchase_account_id
         WHERE tc.company_id = $1 ORDER BY tc.code`,
        [ctx.companyId],
      ),
    );
  }

  save(ctx: CompanyContext, input: TaxCodeInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      if (toMoney(input.rate).gt(0) && !input.sales_account_id && !input.purchase_account_id) {
        throw new AppError('VALIDATION_FAILED', {}, [{ path: 'sales_account_id', message: 'A tax account is required' }]);
      }
      for (const accountId of [input.sales_account_id, input.purchase_account_id]) {
        if (!accountId) continue;
        const account = await tx.maybeOne<{ is_posting: boolean; is_control: boolean }>('SELECT is_posting, is_control FROM gl.accounts WHERE company_id = $1 AND id = $2', [ctx.companyId, accountId]);
        if (!account?.is_posting || account.is_control) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'sales_account_id', message: 'Use a posting account that is not a control account' }]);
      }
      const values = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.rate, input.sales_account_id ?? null, input.purchase_account_id ?? null, input.is_active];
      if (id) {
        const existing = await tx.maybeOne<{ rate: string }>('SELECT rate FROM sl.tax_codes WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
        if (!existing) throw notFound('tax code');
        // Drafts pick up the new rate when saved again; posted documents keep the rate on their lines.
      }
      const row = id
        ? await tx.one(
            'UPDATE sl.tax_codes SET code = $2, name_ar = $3, name_en = $4, rate = $5, sales_account_id = $6, purchase_account_id = $7, is_active = $8 WHERE id = $1 RETURNING *',
            [id, ...values],
          )
        : await tx.one(
            `INSERT INTO sl.tax_codes (tenant_id, company_id, code, name_ar, name_en, rate, sales_account_id, purchase_account_id, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
            [ctx.tenantId, ctx.companyId, ...values],
          );
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'tax_code', entityId: (row as { id: string }).id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  remove(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const used = await tx.maybeOne('SELECT 1 FROM sl.document_lines WHERE tax_code_id = $1 LIMIT 1', [id]);
      if (used) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'id', message: 'The tax code is used on documents; deactivate it instead' }]);
      const row = await tx.maybeOne('DELETE FROM sl.tax_codes WHERE company_id = $1 AND id = $2 RETURNING id', [ctx.companyId, id]);
      if (!row) throw notFound('tax code');
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'tax_code', entityId: id, companyId: ctx.companyId });
      return { deleted: true };
    });
  }

  /**
   * Tax return: net amounts and tax per code for posted sales and purchase documents dated in
   * the range, in base currency at each document's rate. Credit and debit notes reduce the totals.
   */
  report(ctx: CompanyContext, q: { from: string; to: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const minor = company.minor_units;
      const lines = await tx.query<{ side: 'AR' | 'AP'; doc_type: string; rate: string; amount: string; tax_amount: string; tax_code_id: string | null }>(
        `SELECT d.side, d.doc_type, d.exchange_rate AS rate, l.amount, l.tax_amount, l.tax_code_id
         FROM sl.document_lines l JOIN sl.documents d ON d.id = l.document_id
         WHERE d.company_id = $1 AND d.status = 'POSTED' AND d.doc_date BETWEEN $2 AND $3`,
        [ctx.companyId, q.from, q.to],
      );
      const codes = await tx.query<{ id: string; code: string; name_ar: string; name_en: string; rate: string }>(
        'SELECT id, code, name_ar, name_en, rate FROM sl.tax_codes WHERE company_id = $1 ORDER BY code',
        [ctx.companyId],
      );
      const keys = ['sales', 'output', 'purchases', 'input'] as const;
      type Sums = Record<(typeof keys)[number], MoneyValue>;
      const empty = (): Sums => ({ sales: new Money(0), output: new Money(0), purchases: new Money(0), input: new Money(0) });
      const byCode = new Map<string, Sums>();
      for (const l of lines) {
        const key = l.tax_code_id ?? '';
        const sums = byCode.get(key) ?? empty();
        const sign = l.doc_type === 'INVOICE' ? 1 : -1;
        const net = roundToMinor(toMoney(l.amount).times(l.rate), minor).times(sign);
        const tax = roundToMinor(toMoney(l.tax_amount).times(l.rate), minor).times(sign);
        if (l.side === 'AR') {
          sums.sales = sums.sales.plus(net);
          sums.output = sums.output.plus(tax);
        } else {
          sums.purchases = sums.purchases.plus(net);
          sums.input = sums.input.plus(tax);
        }
        byCode.set(key, sums);
      }
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text' },
        { key: 'name', label: t('الضريبة', 'Tax'), kind: 'bilingual', width: 24 },
        { key: 'rate', label: t('النسبة %', 'Rate %'), kind: 'rate' },
        { key: 'sales', label: t('المبيعات (صافي)', 'Sales (net)'), kind: 'amount' },
        { key: 'output', label: t('ضريبة المخرجات', 'Output tax'), kind: 'amount' },
        { key: 'purchases', label: t('المشتريات (صافي)', 'Purchases (net)'), kind: 'amount' },
        { key: 'input', label: t('ضريبة المدخلات', 'Input tax'), kind: 'amount' },
      ];
      const fmt = (s: Sums) => Object.fromEntries(keys.map((k) => [k, s[k].toFixed(minor)]));
      const total = empty();
      const rows: ReportRow[] = [];
      const entries: { code: string; name: ReturnType<typeof t>; rate: string; sums: Sums }[] = codes
        .filter((c) => byCode.has(c.id))
        .map((c) => ({ code: c.code, name: t(c.name_ar, c.name_en), rate: toMoney(c.rate).toFixed(2), sums: byCode.get(c.id) ?? empty() }));
      if (byCode.has('')) entries.push({ code: '—', name: t('بدون ضريبة', 'No tax'), rate: '', sums: byCode.get('') ?? empty() });
      for (const e of entries) {
        for (const k of keys) total[k] = total[k].plus(e.sums[k]);
        rows.push({ cells: { code: e.code, name: e.name, rate: e.rate, ...fmt(e.sums) } });
      }
      rows.push({ cells: { name: t('الإجمالي', 'Total'), ...fmt(total) }, style: 'total' });
      const net = total.output.minus(total.input);
      rows.push({
        cells: { name: net.gte(0) ? t('صافي الضريبة المستحقة', 'Net tax payable') : t('صافي الضريبة المستردة', 'Net tax refundable'), input: net.abs().toFixed(minor) },
        style: 'grandTotal',
      });
      return this.reports.document('tax-report', t('تقرير الضريبة', 'Tax report'), company, columns, rows, [t(`من ${q.from} إلى ${q.to}`, `From ${q.from} to ${q.to}`)], [
        t('المستندات المرحّلة فقط؛ الإشعارات الدائنة والمدينة تُخصم', 'Posted documents only; credit and debit notes are deducted'),
      ]);
    });
  }
}
