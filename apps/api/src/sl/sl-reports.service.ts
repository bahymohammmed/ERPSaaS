import { Injectable } from '@nestjs/common';
import { amountInWords, type BilingualText, type LedgerSide, Money, type MoneyValue, type ReportColumn, type ReportRow, toMoney, type WordsCurrency } from '@erp/shared';
import { notFound } from '../common/app-error';
import type { CompanyContext } from '../common/request-context';
import { DbService } from '../db/db.service';
import { ReportsService, t } from '../gl/reports.service';
import { SIDES } from './subledger.service';

const BUCKETS = [
  { key: 'current', label: t('غير مستحق', 'Not due'), min: -Infinity, max: 0 },
  { key: 'd30', label: t('1–30 يوماً', '1–30 days'), min: 1, max: 30 },
  { key: 'd60', label: t('31–60 يوماً', '31–60 days'), min: 31, max: 60 },
  { key: 'd90', label: t('61–90 يوماً', '61–90 days'), min: 61, max: 90 },
  { key: 'older', label: t('أكثر من 90 يوماً', 'Over 90 days'), min: 91, max: Infinity },
] as const;

/** SQL: the allocation was in place on the report date ($3). */
const ALLOC_AS_OF = `al.alloc_date <= $3 AND (al.is_active OR al.removed_on > $3)`;

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Ageing, party statements and printable documents for the customer and supplier ledgers. */
@Injectable()
export class SlReportsService {
  constructor(
    private readonly db: DbService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * Open invoices by days past due as at a date, in base currency at the invoice rate. Notes and
   * receipts / payments not yet applied are shown separately so the total equals the balance owed.
   */
  aging(ctx: CompanyContext, side: LedgerSide, q: { as_of: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const minor = company.minor_units;
      const invoices = await tx.query<{ party_id: string; due_date: string; open: string; rate: string }>(
        `SELECT d.party_id, d.due_date, d.exchange_rate AS rate,
                d.total - COALESCE((SELECT sum(al.amount) FROM sl.allocations al
                   WHERE al.target_document_id = d.id AND ${ALLOC_AS_OF}), 0) AS open
         FROM sl.documents d
         WHERE d.company_id = $1 AND d.side = $2 AND d.doc_type = 'INVOICE' AND d.status = 'POSTED' AND d.doc_date <= $3`,
        [ctx.companyId, side, q.as_of],
      );
      const unapplied = await tx.query<{ party_id: string; amount: string }>(
        `SELECT n.party_id, (n.total - COALESCE((SELECT sum(al.amount) FROM sl.allocations al WHERE al.source_document_id = n.id AND ${ALLOC_AS_OF}), 0)) * n.exchange_rate AS amount
         FROM sl.documents n WHERE n.company_id = $1 AND n.side = $2 AND n.doc_type <> 'INVOICE' AND n.status = 'POSTED' AND n.doc_date <= $3
         UNION ALL
         SELECT s.party_id, (s.amount - COALESCE((SELECT sum(al.amount) FROM sl.allocations al WHERE al.settlement_id = s.id AND ${ALLOC_AS_OF}), 0)) * s.exchange_rate
         FROM sl.settlements s WHERE s.company_id = $1 AND s.side = $2 AND s.status = 'POSTED' AND s.settle_date <= $3`,
        [ctx.companyId, side, q.as_of],
      );
      const parties = await tx.query<{ id: string; code: string; name_ar: string; name_en: string }>(
        'SELECT id, code, name_ar, name_en FROM sl.parties WHERE company_id = $1 AND side = $2 ORDER BY code',
        [ctx.companyId, side],
      );
      const columns: ReportColumn[] = [
        { key: 'code', label: t('الرمز', 'Code'), kind: 'text' },
        { key: 'name', label: t(SIDES[side].label.ar, side === 'AR' ? 'Customer' : 'Supplier'), kind: 'bilingual', width: 26 },
        ...BUCKETS.map((b) => ({ key: b.key, label: b.label, kind: 'amount' as const })),
        { key: 'unapplied', label: t('غير مخصص', 'Unapplied'), kind: 'amount' },
        { key: 'total', label: t('الرصيد', 'Balance'), kind: 'amount' },
      ];
      const zero = () => new Money(0);
      const grand: Record<string, MoneyValue> = Object.fromEntries([...BUCKETS.map((b) => b.key), 'unapplied', 'total'].map((k) => [k, zero()]));
      const rows: ReportRow[] = [];
      for (const p of parties) {
        const sums: Record<string, MoneyValue> = Object.fromEntries([...BUCKETS.map((b) => b.key), 'unapplied', 'total'].map((k) => [k, zero()]));
        for (const inv of invoices.filter((i) => i.party_id === p.id)) {
          const open = toMoney(inv.open);
          if (open.lte(0)) continue;
          const base = open.times(inv.rate).toDecimalPlaces(minor);
          const late = daysBetween(inv.due_date, q.as_of);
          const bucket = BUCKETS.find((b) => late >= b.min && late <= b.max) ?? BUCKETS[0];
          sums[bucket.key] = (sums[bucket.key] ?? zero()).plus(base);
        }
        for (const u of unapplied.filter((x) => x.party_id === p.id)) sums.unapplied = (sums.unapplied ?? zero()).minus(toMoney(u.amount).toDecimalPlaces(minor));
        sums.total = Object.entries(sums).filter(([k]) => k !== 'total').reduce((acc, [, v]) => acc.plus(v), zero());
        if (Object.values(sums).every((v) => v.isZero())) continue;
        for (const [k, v] of Object.entries(sums)) grand[k] = (grand[k] ?? zero()).plus(v);
        rows.push({ cells: { code: p.code, name: t(p.name_ar, p.name_en), ...Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, v.toFixed(minor)])) } });
      }
      rows.push({ cells: { name: t('الإجمالي', 'Total'), ...Object.fromEntries(Object.entries(grand).map(([k, v]) => [k, v.toFixed(minor)])) }, style: 'grandTotal' });

      // The ageing total should equal the control accounts in the ledger.
      const ledger = await tx.one<{ balance: string }>(
        `SELECT COALESCE(sum(l.debit_base - l.credit_base), 0) AS balance FROM gl.journal_lines l JOIN gl.journal_entries e ON e.id = l.entry_id
         WHERE l.company_id = $1 AND e.status IN ('POSTED', 'REVERSED') AND e.entry_date <= $2 AND e.source_module = $3
           AND l.account_id IN (SELECT DISTINCT control_account_id FROM sl.parties WHERE company_id = $1 AND side = $3)`,
        [ctx.companyId, q.as_of, side],
      );
      const ledgerBalance = side === 'AR' ? toMoney(ledger.balance) : toMoney(ledger.balance).negated();
      const total = grand.total ?? zero();
      const diff = ledgerBalance.minus(total);
      const notes: BilingualText[] = [
        diff.abs().lte(new Money(10).pow(-minor).times(Math.max(1, invoices.length)))
          ? t('يتطابق مع حساب المراقبة في الأستاذ العام', 'Agrees with the control account in the general ledger')
          : t(`فرق مع الأستاذ العام: ${diff.toFixed(minor)} (فروقات عملة غير محققة أو قيود يدوية)`, `Difference with the general ledger: ${diff.toFixed(minor)} (unrealised FX or manual entries)`),
        t('المبالغ بسعر صرف المستند', 'Amounts at the document exchange rate'),
      ];
      const title = side === 'AR' ? t('أعمار ديون العملاء', 'Receivables ageing') : t('أعمار أرصدة الموردين', 'Payables ageing');
      return this.reports.document(side === 'AR' ? 'ar-aging' : 'ap-aging', title, company, columns, rows, [t(`كما في ${q.as_of}`, `As at ${q.as_of}`)], notes);
    });
  }

  /** Statement of account in the party's currency: opening balance, each document, running balance. */
  statement(ctx: CompanyContext, side: LedgerSide, q: { party_id: string; from: string; to: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const party = await tx.maybeOne<{ code: string; name_ar: string; name_en: string; currency_code: string; minor_units: number }>(
        'SELECT p.code, p.name_ar, p.name_en, p.currency_code, c.minor_units FROM sl.parties p JOIN core.currencies c ON c.code = p.currency_code WHERE p.company_id = $1 AND p.side = $2 AND p.id = $3',
        [ctx.companyId, side, q.party_id],
      );
      if (!party) throw notFound('party');
      const minor = party.minor_units;
      // Signed so that a positive balance is what the customer owes us / what we owe the supplier.
      const movements = await tx.query<{ doc_date: string; doc_no: string; kind: string; reference: string | null; amount: string; id: string; created_at: string }>(
        `SELECT d.doc_date, d.doc_no, d.doc_type AS kind, d.reference, CASE WHEN d.doc_type = 'INVOICE' THEN d.total ELSE -d.total END AS amount, d.entry_id AS id, d.created_at
         FROM sl.documents d WHERE d.party_id = $1 AND d.status = 'POSTED' AND d.doc_date <= $2
         UNION ALL
         SELECT s.settle_date, s.doc_no, 'SETTLEMENT', s.reference, -s.amount, s.entry_id, s.created_at
         FROM sl.settlements s WHERE s.party_id = $1 AND s.status = 'POSTED' AND s.settle_date <= $2
         ORDER BY 1, 7`,
        [q.party_id, q.to],
      );
      const names: Record<string, BilingualText> = {
        INVOICE: t('فاتورة', 'Invoice'),
        CREDIT_NOTE: t('إشعار دائن', 'Credit note'),
        DEBIT_NOTE: t('إشعار مدين', 'Debit note'),
        SETTLEMENT: side === 'AR' ? t('سند قبض', 'Receipt') : t('سند صرف', 'Payment'),
      };
      const columns: ReportColumn[] = [
        { key: 'date', label: t('التاريخ', 'Date'), kind: 'date' },
        { key: 'doc_no', label: t('المستند', 'Document'), kind: 'text' },
        { key: 'kind', label: t('النوع', 'Type'), kind: 'bilingual' },
        { key: 'reference', label: t('المرجع', 'Reference'), kind: 'text' },
        { key: 'debit', label: side === 'AR' ? t('مدين', 'Debit') : t('مدين', 'Debit'), kind: 'amount', minorUnits: minor },
        { key: 'credit', label: t('دائن', 'Credit'), kind: 'amount', minorUnits: minor },
        { key: 'balance', label: t('الرصيد', 'Balance'), kind: 'amount', minorUnits: minor },
      ];
      let balance = new Money(0);
      const rows: ReportRow[] = [];
      const before = movements.filter((m) => m.doc_date < q.from);
      balance = before.reduce((acc, m) => acc.plus(m.amount), balance);
      rows.push({ cells: { kind: t('الرصيد الافتتاحي', 'Opening balance'), balance: balance.toFixed(minor) }, style: 'subtotal' });
      for (const m of movements.filter((x) => x.doc_date >= q.from)) {
        const amount = toMoney(m.amount);
        balance = balance.plus(amount);
        // AR: increases are debits; AP: increases (what we owe) are credits.
        const increase = amount.isPositive();
        const debitSide = side === 'AR' ? increase : !increase;
        rows.push({
          cells: {
            date: m.doc_date,
            doc_no: m.doc_no,
            kind: names[m.kind] ?? null,
            reference: m.reference,
            debit: debitSide ? amount.abs().toFixed(minor) : null,
            credit: debitSide ? null : amount.abs().toFixed(minor),
            balance: balance.toFixed(minor),
          },
          drill: m.id ? { kind: 'entry', id: m.id } : undefined,
        });
      }
      rows.push({ cells: { kind: t('الرصيد الختامي', 'Closing balance'), balance: balance.toFixed(minor) }, style: 'grandTotal' });
      const doc = this.reports.document(side === 'AR' ? 'customer-statement' : 'supplier-statement', t('كشف حساب', 'Statement of account'), company, columns, rows, [
        t(`${party.code} — ${party.name_ar}`, `${party.code} — ${party.name_en}`),
        t(`من ${q.from} إلى ${q.to}`, `From ${q.from} to ${q.to}`),
      ], [t(`المبالغ بعملة ${party.currency_code}`, `Amounts in ${party.currency_code}`)]);
      return { ...doc, currency: party.currency_code, minorUnits: minor, notes: doc.notes.slice(0, 1) };
    });
  }

  /** Printable invoice / note with the amount in words in both languages. */
  printDocument(ctx: CompanyContext, side: LedgerSide, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await this.reports.company(tx, ctx.companyId);
      const doc = await tx.maybeOne<{ doc_type: string; doc_no: string | null; doc_date: string; due_date: string; reference: string | null; description: string | null; total: string; subtotal: string; tax_total: string; status: string; currency_code: string; party_code: string; party_name_ar: string; party_name_en: string; tax_no: string | null; address: string | null }>(
        `SELECT d.doc_type, d.doc_no, d.doc_date, d.due_date, d.reference, d.description, d.total, d.subtotal, d.tax_total, d.status, d.currency_code,
                p.code AS party_code, p.name_ar AS party_name_ar, p.name_en AS party_name_en, p.tax_no, p.address
         FROM sl.documents d JOIN sl.parties p ON p.id = d.party_id WHERE d.company_id = $1 AND d.side = $2 AND d.id = $3`,
        [ctx.companyId, side, id],
      );
      if (!doc) throw notFound('document');
      const currency = await tx.one<WordsCurrency>('SELECT minor_units, name_ar, name_en, minor_name_ar, minor_name_en FROM core.currencies WHERE code = $1', [doc.currency_code]);
      const minor = currency.minor_units;
      const lines = await tx.query<{ description: string; quantity: string; unit_price: string; amount: string; tax_rate: string; tax_amount: string }>(
        'SELECT description, quantity, unit_price, amount, tax_rate, tax_amount FROM sl.document_lines WHERE document_id = $1 ORDER BY line_no',
        [id],
      );
      const columns: ReportColumn[] = [
        { key: 'no', label: t('#', '#'), kind: 'text' },
        { key: 'description', label: t('البيان', 'Description'), kind: 'text', width: 46 },
        { key: 'quantity', label: t('الكمية', 'Qty'), kind: 'rate' },
        { key: 'price', label: t('السعر', 'Unit price'), kind: 'amount', minorUnits: minor },
        { key: 'amount', label: t('المبلغ', 'Amount'), kind: 'amount', minorUnits: minor },
      ];
      const taxed = !toMoney(doc.tax_total).isZero();
      if (taxed) {
        columns.push({ key: 'taxRate', label: t('الضريبة %', 'Tax %'), kind: 'rate' }, { key: 'tax', label: t('الضريبة', 'Tax'), kind: 'amount', minorUnits: minor });
      }
      const rows: ReportRow[] = lines.map((l, i) => ({
        cells: {
          no: String(i + 1),
          description: l.description,
          quantity: String(Number(l.quantity)),
          price: toMoney(l.unit_price).toFixed(minor),
          amount: toMoney(l.amount).toFixed(minor),
          ...(taxed ? { taxRate: toMoney(l.tax_rate).isZero() ? '' : String(Number(l.tax_rate)), tax: toMoney(l.tax_amount).toFixed(minor) } : {}),
        },
      }));
      if (taxed) {
        rows.push({ cells: { description: 'المجموع قبل الضريبة / Subtotal', amount: toMoney(doc.subtotal).toFixed(minor) }, style: 'subtotal' });
        rows.push({ cells: { description: 'الضريبة / Tax', amount: toMoney(doc.tax_total).toFixed(minor) }, style: 'subtotal' });
      }
      rows.push({ cells: { description: `الإجمالي / Total (${doc.currency_code})`, amount: toMoney(doc.total).toFixed(minor) }, style: 'grandTotal' });
      const titles: Record<string, BilingualText> = {
        'AR:INVOICE': t('فاتورة', 'Invoice'),
        'AR:CREDIT_NOTE': t('إشعار دائن', 'Credit note'),
        'AP:INVOICE': t('فاتورة مشتريات', 'Purchase invoice'),
        'AP:DEBIT_NOTE': t('إشعار مدين', 'Debit note'),
      };
      const draft = doc.status === 'DRAFT' ? [t('مسودة — غير مرحلة', 'DRAFT — not posted')] : [];
      const result = this.reports.document(`${side.toLowerCase()}-document`, titles[`${side}:${doc.doc_type}`] ?? t('مستند', 'Document'), company, columns, rows, [
        t(`رقم: ${doc.doc_no ?? '—'}    التاريخ: ${doc.doc_date}    الاستحقاق: ${doc.due_date}`, `No.: ${doc.doc_no ?? '—'}    Date: ${doc.doc_date}    Due: ${doc.due_date}`),
        t(`${SIDES[side].label.ar}: ${doc.party_code} — ${doc.party_name_ar}`, `${side === 'AR' ? 'Customer' : 'Supplier'}: ${doc.party_code} — ${doc.party_name_en}`),
        ...(doc.tax_no ? [t(`الرقم الضريبي: ${doc.tax_no}`, `Tax no.: ${doc.tax_no}`)] : []),
        ...(doc.reference ? [t(`المرجع: ${doc.reference}`, `Reference: ${doc.reference}`)] : []),
        ...draft,
      ], [t(amountInWords(doc.total, currency, 'ar'), amountInWords(doc.total, currency, 'en')), ...(doc.description ? [t(doc.description, doc.description)] : [])]);
      return { ...result, currency: doc.currency_code, minorUnits: minor, notes: result.notes.slice(0, -1) };
    });
  }
}
