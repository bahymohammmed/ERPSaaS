import { Injectable } from '@nestjs/common';
import {
  type LedgerSide,
  Money,
  type MoneyValue,
  type PartyDocumentInput,
  type PartyInput,
  roundToMinor,
  type SettlementInput,
  sumAmounts,
  toMoney,
  toStorage,
} from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { addDays, yearOf } from '../common/dates';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { FiscalService } from '../gl/fiscal.service';
import { findRate } from '../gl/masters.service';
import { type CompanyInfo, loadCompany, PostingEngine } from '../gl/posting.engine';

/** One posting line in transaction currency with its base-currency equivalent. */
export type SlLine = {
  account_id: string;
  cost_center_id: string | null;
  description: string;
  currency_code: string;
  exchange_rate: string;
  debit: MoneyValue;
  credit: MoneyValue;
  debit_base: MoneyValue;
  credit_base: MoneyValue;
};

type Party = {
  id: string;
  side: LedgerSide;
  code: string;
  name_ar: string;
  name_en: string;
  currency_code: string;
  control_account_id: string;
  payment_terms_days: number;
  is_active: boolean;
};

type DocumentRow = {
  id: string;
  side: LedgerSide;
  doc_type: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
  doc_no: string | null;
  party_id: string;
  doc_date: string;
  due_date: string;
  currency_code: string;
  exchange_rate: string;
  total: string;
  status: 'DRAFT' | 'POSTED' | 'VOID';
  entry_id: string | null;
};

type Allocation = { document_id: string; amount: string };

/** Per side: which way documents hit the control account, numbering prefixes, module. */
export const SIDES = {
  AR: { module: 'AR', note: 'CREDIT_NOTE', invoicePrefix: 'SI', notePrefix: 'CN', settlementPrefix: 'RC', template: '110201', label: { ar: 'العميل', en: 'customer' } },
  AP: { module: 'AP', note: 'DEBIT_NOTE', invoicePrefix: 'PI', notePrefix: 'DN', settlementPrefix: 'PY', template: '210101', label: { ar: 'المورد', en: 'supplier' } },
} as const;

/** SQL: open balance of an invoice (total less active allocations against it). */
export const INVOICE_OPEN = `(d.total - COALESCE((SELECT sum(al.amount) FROM sl.allocations al WHERE al.target_document_id = d.id AND al.is_active), 0))`;
/** SQL: unapplied part of a credit / debit note. */
export const NOTE_OPEN = `(d.total - COALESCE((SELECT sum(al.amount) FROM sl.allocations al WHERE al.source_document_id = d.id AND al.is_active), 0))`;

/**
 * Customer and supplier sub-ledgers. Invoices, credit / debit notes and receipts / payments
 * post to the general ledger as AR or AP entries on the party's control account, so the
 * sub-ledger and the ledger always agree. Settlements are allocated to open invoices in the
 * document currency; the difference between the invoice rate and the settlement rate is
 * posted as a realised exchange gain or loss.
 */
@Injectable()
export class SubledgerService {
  constructor(
    private readonly db: DbService,
    private readonly fiscal: FiscalService,
    private readonly engine: PostingEngine,
    private readonly audit: AuditService,
  ) {}

  // ================================================================ parties

  listParties(ctx: CompanyContext, side: LedgerSide) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT p.*, a.code AS control_account_code,
                COALESCE((SELECT sum(${INVOICE_OPEN}) FROM sl.documents d WHERE d.party_id = p.id AND d.doc_type = 'INVOICE' AND d.status = 'POSTED'), 0)
                - COALESCE((SELECT sum(${NOTE_OPEN}) FROM sl.documents d WHERE d.party_id = p.id AND d.doc_type <> 'INVOICE' AND d.status = 'POSTED'), 0)
                - COALESCE((SELECT sum(s.amount - COALESCE((SELECT sum(al.amount) FROM sl.allocations al WHERE al.settlement_id = s.id AND al.is_active), 0))
                            FROM sl.settlements s WHERE s.party_id = p.id AND s.status = 'POSTED'), 0) AS balance
         FROM sl.parties p JOIN gl.accounts a ON a.id = p.control_account_id
         WHERE p.company_id = $1 AND p.side = $2 ORDER BY p.code`,
        [ctx.companyId, side],
      ),
    );
  }

  saveParty(ctx: CompanyContext, side: LedgerSide, input: PartyInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const control = input.control_account_id
        ? await tx.maybeOne<{ id: string; is_control: boolean; control_module: string | null }>('SELECT id, is_control, control_module FROM gl.accounts WHERE company_id = $1 AND id = $2', [ctx.companyId, input.control_account_id])
        : await tx.maybeOne<{ id: string; is_control: boolean; control_module: string | null }>('SELECT id, is_control, control_module FROM gl.accounts WHERE company_id = $1 AND code = $2', [ctx.companyId, SIDES[side].template]);
      if (!control?.is_control || control.control_module !== side) throw new AppError('SL_CONTROL_ACCOUNT', { module: side });
      const values = [
        input.code,
        input.name_ar || input.name_en,
        input.name_en || input.name_ar,
        input.currency_code,
        control.id,
        input.default_account_id ?? null,
        input.payment_terms_days,
        input.credit_limit ?? null,
        input.contact_name ?? null,
        input.email ?? null,
        input.phone ?? null,
        input.address ?? null,
        input.tax_no ?? null,
        input.commercial_reg_no ?? null,
        input.notes ?? null,
        input.is_active,
      ];
      if (id) {
        const existing = await tx.maybeOne<{ currency_code: string }>('SELECT currency_code FROM sl.parties WHERE company_id = $1 AND id = $2 AND side = $3', [ctx.companyId, id, side]);
        if (!existing) throw notFound('party');
        if (existing.currency_code !== input.currency_code) {
          const used = await tx.maybeOne("SELECT 1 FROM sl.documents WHERE party_id = $1 AND status <> 'DRAFT' UNION ALL SELECT 1 FROM sl.settlements WHERE party_id = $1 LIMIT 1", [id]);
          if (used) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'currency_code', message: 'The currency cannot change once documents exist' }]);
        }
      }
      const row = id
        ? await tx.one(
            `UPDATE sl.parties SET code = $2, name_ar = $3, name_en = $4, currency_code = $5, control_account_id = $6, default_account_id = $7,
               payment_terms_days = $8, credit_limit = $9, contact_name = $10, email = $11, phone = $12, address = $13, tax_no = $14,
               commercial_reg_no = $15, notes = $16, is_active = $17
             WHERE id = $1 RETURNING *`,
            [id, ...values],
          )
        : await tx.one(
            `INSERT INTO sl.parties (tenant_id, company_id, side, code, name_ar, name_en, currency_code, control_account_id, default_account_id,
               payment_terms_days, credit_limit, contact_name, email, phone, address, tax_no, commercial_reg_no, notes, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
            [ctx.tenantId, ctx.companyId, side, ...values],
          );
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: side === 'AR' ? 'customer' : 'supplier', entityId: (row as { id: string }).id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  // ================================================================ documents

  listDocuments(ctx: CompanyContext, side: LedgerSide, f: { party_id?: string; status?: string; doc_type?: string; open?: boolean }) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT d.id, d.doc_type, d.doc_no, d.party_id, p.code AS party_code, p.name_ar AS party_name_ar, p.name_en AS party_name_en,
                d.doc_date, d.due_date, d.currency_code, d.exchange_rate, d.reference, d.description, d.total, d.total_base, d.status,
                CASE WHEN d.status <> 'POSTED' THEN 0 WHEN d.doc_type = 'INVOICE' THEN ${INVOICE_OPEN} ELSE ${NOTE_OPEN} END AS open_amount
         FROM sl.documents d JOIN sl.parties p ON p.id = d.party_id
         WHERE d.company_id = $1 AND d.side = $2
           AND ($3::uuid IS NULL OR d.party_id = $3) AND ($4::text IS NULL OR d.status = $4) AND ($5::text IS NULL OR d.doc_type = $5)
           AND (NOT $6 OR (d.status = 'POSTED' AND d.doc_type = 'INVOICE' AND ${INVOICE_OPEN} > 0))
         ORDER BY d.doc_date DESC, d.created_at DESC LIMIT 1000`,
        [ctx.companyId, side, f.party_id ?? null, f.status ?? null, f.doc_type ?? null, f.open ?? false],
      ),
    );
  }

  getDocument(ctx: CompanyContext, side: LedgerSide, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await tx.maybeOne(
        `SELECT d.*, p.code AS party_code, p.name_ar AS party_name_ar, p.name_en AS party_name_en, e.entry_no, ve.entry_no AS void_entry_no,
                CASE WHEN d.status <> 'POSTED' THEN 0 WHEN d.doc_type = 'INVOICE' THEN ${INVOICE_OPEN} ELSE ${NOTE_OPEN} END AS open_amount
         FROM sl.documents d JOIN sl.parties p ON p.id = d.party_id
         LEFT JOIN gl.journal_entries e ON e.id = d.entry_id LEFT JOIN gl.journal_entries ve ON ve.id = d.void_entry_id
         WHERE d.company_id = $1 AND d.side = $2 AND d.id = $3`,
        [ctx.companyId, side, id],
      );
      if (!doc) throw notFound('document');
      const lines = await tx.query('SELECT line_no, description, account_id, cost_center_id, quantity, unit_price, amount FROM sl.document_lines WHERE document_id = $1 ORDER BY line_no', [id]);
      // Settlements and notes applied to this document, or invoices this note was applied to.
      const applied = await tx.query(
        `SELECT al.id, al.amount, al.fx_difference, al.is_active,
                COALESCE(s.doc_no, src.doc_no) AS source_no, COALESCE(s.settle_date, src.doc_date) AS source_date,
                al.settlement_id, al.source_document_id, tgt.id AS target_id, tgt.doc_no AS target_no
         FROM sl.allocations al
         LEFT JOIN sl.settlements s ON s.id = al.settlement_id
         LEFT JOIN sl.documents src ON src.id = al.source_document_id
         JOIN sl.documents tgt ON tgt.id = al.target_document_id
         WHERE al.target_document_id = $1 OR al.source_document_id = $1
         ORDER BY source_date`,
        [id],
      );
      return { ...doc, lines, applied };
    });
  }

  createDocument(ctx: CompanyContext, side: LedgerSide, input: PartyDocumentInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const id = await this.writeDraft(tx, ctx, side, input);
      await this.audit.record(tx, ctx, { action: 'create', entityType: `${side.toLowerCase()}_document`, entityId: id, companyId: ctx.companyId, newData: input });
      return { id };
    });
  }

  updateDocument(ctx: CompanyContext, side: LedgerSide, id: string, input: PartyDocumentInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.lockDocument(tx, ctx, side, id);
      if (doc.status !== 'DRAFT') throw new AppError('SL_DOCUMENT_NOT_DRAFT');
      await this.writeDraft(tx, ctx, side, input, id);
      await this.audit.record(tx, ctx, { action: 'update', entityType: `${side.toLowerCase()}_document`, entityId: id, companyId: ctx.companyId, newData: input });
      return { id };
    });
  }

  deleteDocument(ctx: CompanyContext, side: LedgerSide, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const doc = await this.lockDocument(tx, ctx, side, id);
      if (doc.status !== 'DRAFT') throw new AppError('SL_DOCUMENT_NOT_DRAFT');
      await tx.query('DELETE FROM sl.documents WHERE id = $1', [id]);
      await this.audit.record(tx, ctx, { action: 'delete', entityType: `${side.toLowerCase()}_document`, entityId: id, companyId: ctx.companyId });
      return { deleted: true };
    });
  }

  /** Numbers and posts a draft: control account against the line accounts; notes also settle invoices. */
  postDocument(ctx: CompanyContext, side: LedgerSide, id: string, allocations: Allocation[] = []) {
    return this.db.withTenant(ctx, (tx) => this.postDocumentTx(tx, ctx, side, id, allocations));
  }

  async postDocumentTx(tx: Tx, ctx: CompanyContext, side: LedgerSide, id: string, allocations: Allocation[] = []) {
    const company = await loadCompany(tx, ctx.companyId);
    const doc = await this.lockDocument(tx, ctx, side, id);
    if (doc.status !== 'DRAFT') throw new AppError('SL_DOCUMENT_NOT_DRAFT');
    const party = await this.party(tx, ctx, side, doc.party_id);
    const lines = await tx.query<{ description: string; account_id: string; cost_center_id: string | null; amount: string }>(
      'SELECT description, account_id, cost_center_id, amount FROM sl.document_lines WHERE document_id = $1 ORDER BY line_no',
      [id],
    );
    const total = sumAmounts(lines.map((l) => l.amount));
    if (total.lte(0)) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'lines', message: 'The total must be positive' }]);
    const rate = doc.currency_code === company.base_currency ? '1' : doc.exchange_rate;
    const isNote = doc.doc_type !== 'INVOICE';
    if (!isNote && allocations.length) throw new AppError('SL_ALLOCATION_INVALID');

    // AR invoice and AP note debit the control account; AR note and AP invoice credit it.
    const controlDebit = (side === 'AR') === !isNote;
    const lineBases = lines.map((l) => roundToMinor(toMoney(l.amount).times(rate), company.base_minor_units));
    const postingLines: SlLine[] = lines.map((l, i) =>
      this.slLine(l.account_id, l.cost_center_id, l.description, doc.currency_code, rate, toMoney(l.amount), lineBases[i] ?? new Money(0), !controlDebit),
    );
    const applied = isNote ? await this.checkAllocations(tx, ctx, side, party, doc.currency_code, allocations, total) : [];
    const control = this.controlBase(applied, total, rate, side, company);
    postingLines.push(this.slLine(party.control_account_id, null, `${party.code}`, doc.currency_code, rate, total, control.base, controlDebit));
    this.addFxLine(postingLines, company);

    const docNo = await this.nextNumber(tx, ctx, isNote ? SIDES[side].notePrefix : SIDES[side].invoicePrefix, doc.doc_date);
    const entryId = await this.postEntry(tx, ctx, company, SIDES[side].module, doc.doc_date, `SL_${doc.doc_type}`, id, `${docNo} ${party.code} — ${party.name_en || party.name_ar}`, postingLines);
    await tx.query(
      `UPDATE sl.documents SET status = 'POSTED', doc_no = $2, exchange_rate = $3, total = $4, total_base = $5, entry_id = $6, posted_by = $7, posted_at = now() WHERE id = $1`,
      [id, docNo, rate, toStorage(total), toStorage(sumAmounts(lineBases)), entryId, ctx.userId],
    );
    for (const a of control.allocations) {
      await tx.query(
        'INSERT INTO sl.allocations (tenant_id, company_id, source_document_id, target_document_id, amount, fx_difference) VALUES ($1, $2, $3, $4, $5, $6)',
        [ctx.tenantId, ctx.companyId, id, a.document_id, toStorage(a.amount), toStorage(a.fx)],
      );
    }
    await this.audit.record(tx, ctx, { action: 'post', entityType: `${side.toLowerCase()}_document`, entityId: id, companyId: ctx.companyId, newData: { doc_no: docNo, total: toStorage(total) } });
    return { id, doc_no: docNo, entry_id: entryId };
  }

  /** Voids a posted document by reversing its entry; an invoice must have nothing applied to it. */
  voidDocument(ctx: CompanyContext, side: LedgerSide, id: string, voidDate?: string | null) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const doc = await this.lockDocument(tx, ctx, side, id);
      if (doc.status !== 'POSTED' || !doc.entry_id) throw new AppError('SL_DOCUMENT_NOT_DRAFT');
      const applied = await tx.maybeOne('SELECT 1 FROM sl.allocations WHERE target_document_id = $1 AND is_active', [id]);
      if (applied) throw new AppError('SL_DOCUMENT_SETTLED');
      const reversal = await this.engine.reverse(tx, ctx, company, doc.entry_id, { date: voidDate ?? doc.doc_date, description: `إلغاء ${doc.doc_no} / Void ${doc.doc_no}` });
      await tx.query('UPDATE sl.allocations SET is_active = false WHERE source_document_id = $1', [id]);
      await tx.query("UPDATE sl.documents SET status = 'VOID', void_entry_id = $2 WHERE id = $1", [id, reversal]);
      await this.audit.record(tx, ctx, { action: 'void', entityType: `${side.toLowerCase()}_document`, entityId: id, companyId: ctx.companyId });
      return { void_entry_id: reversal };
    });
  }

  // ================================================================ receipts / payments

  listSettlements(ctx: CompanyContext, side: LedgerSide, f: { party_id?: string }) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT s.id, s.doc_no, s.party_id, p.code AS party_code, p.name_ar AS party_name_ar, p.name_en AS party_name_en, s.bank_account_id,
                b.code AS bank_code, b.name_ar AS bank_name_ar, b.name_en AS bank_name_en, s.settle_date, s.currency_code, s.exchange_rate,
                s.amount, s.reference, s.description, s.status,
                s.amount - COALESCE((SELECT sum(al.amount) FROM sl.allocations al WHERE al.settlement_id = s.id AND al.is_active), 0) AS unallocated
         FROM sl.settlements s JOIN sl.parties p ON p.id = s.party_id JOIN sl.bank_accounts b ON b.id = s.bank_account_id
         WHERE s.company_id = $1 AND s.side = $2 AND ($3::uuid IS NULL OR s.party_id = $3)
         ORDER BY s.settle_date DESC, s.created_at DESC LIMIT 1000`,
        [ctx.companyId, side, f.party_id ?? null],
      ),
    );
  }

  getSettlement(ctx: CompanyContext, side: LedgerSide, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const row = await tx.maybeOne(
        `SELECT s.*, p.code AS party_code, p.name_ar AS party_name_ar, p.name_en AS party_name_en, b.code AS bank_code,
                b.name_ar AS bank_name_ar, b.name_en AS bank_name_en, e.entry_no, ve.entry_no AS void_entry_no
         FROM sl.settlements s JOIN sl.parties p ON p.id = s.party_id JOIN sl.bank_accounts b ON b.id = s.bank_account_id
         LEFT JOIN gl.journal_entries e ON e.id = s.entry_id LEFT JOIN gl.journal_entries ve ON ve.id = s.void_entry_id
         WHERE s.company_id = $1 AND s.side = $2 AND s.id = $3`,
        [ctx.companyId, side, id],
      );
      if (!row) throw notFound('settlement');
      const allocations = await tx.query(
        `SELECT al.id, al.amount, al.fx_difference, al.is_active, d.id AS document_id, d.doc_no, d.doc_date, d.total
         FROM sl.allocations al JOIN sl.documents d ON d.id = al.target_document_id WHERE al.settlement_id = $1 ORDER BY d.doc_date`,
        [id],
      );
      return { ...row, allocations };
    });
  }

  /** Records and posts a receipt (AR) or payment (AP), applying it to open invoices. */
  createSettlement(ctx: CompanyContext, side: LedgerSide, input: SettlementInput) {
    return this.db.withTenant(ctx, (tx) => this.createSettlementTx(tx, ctx, side, input));
  }

  async createSettlementTx(tx: Tx, ctx: CompanyContext, side: LedgerSide, input: SettlementInput) {
    const company = await loadCompany(tx, ctx.companyId);
    const party = await this.party(tx, ctx, side, input.party_id);
    const bank = await tx.maybeOne<{ id: string; account_id: string; currency_code: string; is_active: boolean }>(
      'SELECT id, account_id, currency_code, is_active FROM sl.bank_accounts WHERE company_id = $1 AND id = $2',
      [ctx.companyId, input.bank_account_id],
    );
    if (!bank?.is_active) throw notFound('bank account');
    if (bank.currency_code !== party.currency_code) {
      throw new AppError('SL_CURRENCY_MISMATCH', { bank: bank.currency_code, currency: party.currency_code, party: SIDES[side].label.en });
    }
    const currency = party.currency_code;
    const rate = currency === company.base_currency ? '1' : (input.exchange_rate ?? (await findRate(tx, ctx.companyId, currency, input.settle_date)));
    const amount = toMoney(input.amount);
    const applied = await this.checkAllocations(tx, ctx, side, party, currency, input.allocations, amount);
    const control = this.controlBase(applied, amount, rate, side, company);
    const bankBase = roundToMinor(amount.times(rate), company.base_minor_units);
    // A receipt debits the bank and credits the receivable; a payment the reverse.
    const receipt = side === 'AR';
    const docNo = await this.nextNumber(tx, ctx, SIDES[side].settlementPrefix, input.settle_date);
    const lines: SlLine[] = [
      this.slLine(bank.account_id, null, `${docNo} ${party.code}`, currency, rate, amount, bankBase, receipt),
      this.slLine(party.control_account_id, null, `${docNo} ${party.code}`, currency, rate, amount, control.base, !receipt),
    ];
    this.addFxLine(lines, company);

    const row = await tx.one<{ id: string }>(
      `INSERT INTO sl.settlements (tenant_id, company_id, side, doc_no, party_id, bank_account_id, settle_date, currency_code, exchange_rate, amount,
         reference, description, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [ctx.tenantId, ctx.companyId, side, docNo, party.id, bank.id, input.settle_date, currency, rate, toStorage(amount), input.reference ?? null, input.description ?? null, ctx.userId],
    );
    const entryId = await this.postEntry(tx, ctx, company, SIDES[side].module, input.settle_date, receipt ? 'SL_RECEIPT' : 'SL_PAYMENT', row.id,
      input.description || `${docNo} ${party.code} — ${party.name_en || party.name_ar}`, lines);
    await tx.query('UPDATE sl.settlements SET entry_id = $2 WHERE id = $1', [row.id, entryId]);
    for (const a of control.allocations) {
      await tx.query(
        'INSERT INTO sl.allocations (tenant_id, company_id, settlement_id, target_document_id, amount, fx_difference) VALUES ($1, $2, $3, $4, $5, $6)',
        [ctx.tenantId, ctx.companyId, row.id, a.document_id, toStorage(a.amount), toStorage(a.fx)],
      );
    }
    await this.audit.record(tx, ctx, { action: 'create', entityType: receipt ? 'receipt' : 'payment', entityId: row.id, companyId: ctx.companyId, newData: input });
    return { id: row.id, doc_no: docNo, entry_id: entryId };
  }

  voidSettlement(ctx: CompanyContext, side: LedgerSide, id: string, voidDate?: string | null) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const row = await tx.maybeOne<{ id: string; status: string; entry_id: string | null; settle_date: string; doc_no: string }>(
        'SELECT id, status, entry_id, settle_date, doc_no FROM sl.settlements WHERE company_id = $1 AND side = $2 AND id = $3 FOR UPDATE',
        [ctx.companyId, side, id],
      );
      if (!row || row.status !== 'POSTED' || !row.entry_id) throw notFound('settlement');
      const reversal = await this.engine.reverse(tx, ctx, company, row.entry_id, { date: voidDate ?? row.settle_date, description: `إلغاء ${row.doc_no} / Void ${row.doc_no}` });
      await tx.query('UPDATE sl.allocations SET is_active = false WHERE settlement_id = $1', [id]);
      await tx.query("UPDATE sl.settlements SET status = 'VOID', void_entry_id = $2 WHERE id = $1", [id, reversal]);
      await this.audit.record(tx, ctx, { action: 'void', entityType: side === 'AR' ? 'receipt' : 'payment', entityId: id, companyId: ctx.companyId });
      return { void_entry_id: reversal };
    });
  }

  // ================================================================ helpers

  private async writeDraft(tx: Tx, ctx: CompanyContext, side: LedgerSide, input: PartyDocumentInput, id?: string): Promise<string> {
    const company = await loadCompany(tx, ctx.companyId);
    const party = await this.party(tx, ctx, side, input.party_id);
    const expected = input.doc_type === 'INVOICE' ? 'INVOICE' : SIDES[side].note;
    if (input.doc_type !== expected) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'doc_type', message: `Use INVOICE or ${SIDES[side].note}` }]);
    const rate = party.currency_code === company.base_currency ? '1' : (input.exchange_rate ?? (await findRate(tx, ctx.companyId, party.currency_code, input.doc_date)));
    const dueDate = input.due_date ?? addDays(input.doc_date, input.doc_type === 'INVOICE' ? party.payment_terms_days : 0);
    const amounts = input.lines.map((l) => roundToMinor(toMoney(l.quantity).times(l.unit_price), 4));
    const total = sumAmounts(amounts);
    const values = [party.id, input.doc_date, dueDate, party.currency_code, rate, input.reference ?? null, input.description ?? null, toStorage(total)];
    let docId = id;
    if (docId) {
      await tx.query(
        'UPDATE sl.documents SET doc_type = $2, party_id = $3, doc_date = $4, due_date = $5, currency_code = $6, exchange_rate = $7, reference = $8, description = $9, total = $10 WHERE id = $1',
        [docId, input.doc_type, ...values],
      );
      await tx.query('DELETE FROM sl.document_lines WHERE document_id = $1', [docId]);
    } else {
      docId = (
        await tx.one<{ id: string }>(
          `INSERT INTO sl.documents (tenant_id, company_id, side, doc_type, party_id, doc_date, due_date, currency_code, exchange_rate, reference, description, total, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
          [ctx.tenantId, ctx.companyId, side, input.doc_type, ...values, ctx.userId],
        )
      ).id;
    }
    for (const [i, l] of input.lines.entries()) {
      await tx.query(
        `INSERT INTO sl.document_lines (tenant_id, company_id, document_id, line_no, description, account_id, cost_center_id, quantity, unit_price, amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [ctx.tenantId, ctx.companyId, docId, i + 1, l.description, l.account_id, l.cost_center_id ?? null, l.quantity, l.unit_price, toStorage(amounts[i] ?? '0')],
      );
    }
    return docId;
  }

  /** Validates allocations against open invoices of the same party and currency. */
  private async checkAllocations(tx: Tx, ctx: CompanyContext, side: LedgerSide, party: Party, currency: string, allocations: Allocation[], limit: MoneyValue) {
    const applied: { document_id: string; amount: MoneyValue; rate: string }[] = [];
    for (const a of allocations) {
      const target = await tx.maybeOne<{ id: string; doc_no: string; exchange_rate: string; open: string; party_id: string; currency_code: string }>(
        `SELECT d.id, d.doc_no, d.exchange_rate, d.party_id, d.currency_code, ${INVOICE_OPEN} AS open
         FROM sl.documents d WHERE d.company_id = $1 AND d.side = $2 AND d.id = $3 AND d.doc_type = 'INVOICE' AND d.status = 'POSTED' FOR UPDATE`,
        [ctx.companyId, side, a.document_id],
      );
      if (!target || target.party_id !== party.id || target.currency_code !== currency) throw new AppError('SL_ALLOCATION_INVALID');
      const already = applied.filter((x) => x.document_id === target.id).reduce((acc, x) => acc.plus(x.amount), new Money(0));
      if (toMoney(a.amount).plus(already).gt(target.open)) throw new AppError('SL_ALLOCATION_EXCEEDS', { doc: target.doc_no, open: toMoney(target.open).toFixed(2) });
      applied.push({ document_id: target.id, amount: toMoney(a.amount), rate: target.exchange_rate });
    }
    const totalApplied = sumAmounts(applied.map((x) => x.amount));
    if (totalApplied.gt(limit)) throw new AppError('SL_ALLOCATION_TOTAL', { total: limit.toString() });
    return applied;
  }

  /**
   * Base amount for the control account line: allocated amounts clear the invoices at the rate
   * they were booked at; anything unapplied stays at this document's rate. Realised difference
   * per allocation: AR gains when more base currency is received, AP when less is paid.
   */
  private controlBase(applied: { document_id: string; amount: MoneyValue; rate: string }[], total: MoneyValue, rate: string, side: LedgerSide, company: CompanyInfo) {
    const round = (v: MoneyValue) => roundToMinor(v, company.base_minor_units);
    let base = new Money(0);
    const allocations = applied.map((a) => {
      const atInvoice = round(a.amount.times(a.rate));
      const atThis = round(a.amount.times(rate));
      base = base.plus(atInvoice);
      return { document_id: a.document_id, amount: a.amount, fx: side === 'AR' ? atThis.minus(atInvoice) : atInvoice.minus(atThis) };
    });
    const unapplied = total.minus(sumAmounts(applied.map((a) => a.amount)));
    base = base.plus(round(unapplied.times(rate)));
    return { base, allocations };
  }

  private slLine(accountId: string, costCenterId: string | null, description: string, currency: string, rate: string, amount: MoneyValue, base: MoneyValue, debit: boolean): SlLine {
    const zero = new Money(0);
    return {
      account_id: accountId,
      cost_center_id: costCenterId,
      description,
      currency_code: currency,
      exchange_rate: rate,
      debit: debit ? amount : zero,
      credit: debit ? zero : amount,
      debit_base: debit ? base : zero,
      credit_base: debit ? zero : base,
    };
  }

  /** Any base-currency difference left between the lines is a realised exchange gain or loss. */
  private addFxLine(lines: SlLine[], company: CompanyInfo) {
    const diff = sumAmounts(lines.map((l) => l.debit_base)).minus(sumAmounts(lines.map((l) => l.credit_base)));
    if (diff.isZero()) return;
    if (!company.fx_gain_account_id || !company.fx_loss_account_id) throw new AppError('FX_ACCOUNTS_MISSING');
    // Debits exceed credits: the balancing credit is a gain; otherwise a loss.
    const gain = diff.isPositive();
    lines.push(
      this.slLine(gain ? company.fx_gain_account_id : company.fx_loss_account_id, null, gain ? 'Realised FX gain / أرباح فروقات عملة محققة' : 'Realised FX loss / خسائر فروقات عملة محققة',
        company.base_currency, '1', diff.abs(), diff.abs(), !gain),
    );
  }

  async postEntry(tx: Tx, ctx: CompanyContext, company: CompanyInfo, module: 'AR' | 'AP' | 'GL', date: string, docType: string, docId: string, description: string, lines: SlLine[], journalType?: string): Promise<string> {
    const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, date);
    const type = await tx.one<{ id: string }>('SELECT id FROM gl.journal_types WHERE company_id = $1 AND code = $2', [ctx.companyId, journalType ?? module]);
    const entry = await tx.one<{ id: string }>(
      `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date, description,
         source_module, source_doc_type, source_doc_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [ctx.tenantId, ctx.companyId, type.id, period.fiscal_year_id, period.id, date, description.slice(0, 500), module, docType, docId, ctx.userId],
    );
    let lineNo = 0;
    for (const l of lines) {
      if (l.debit.isZero() && l.credit.isZero() && l.debit_base.isZero() && l.credit_base.isZero()) continue;
      lineNo++;
      await tx.query(
        `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description, currency_code,
           exchange_rate, debit, credit, debit_base, credit_base)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [ctx.tenantId, ctx.companyId, entry.id, lineNo, l.account_id, l.cost_center_id, l.description.slice(0, 500), l.currency_code, l.exchange_rate,
          toStorage(l.debit), toStorage(l.credit), toStorage(l.debit_base), toStorage(l.credit_base)],
      );
    }
    const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
    // Not a system entry: cost center rules, user scope and budget control apply to document lines.
    await this.engine.post(tx, ctx, company, locked, { preserveBase: true });
    return entry.id;
  }

  async nextNumber(tx: Tx, ctx: CompanyContext, prefix: string, date: string): Promise<string> {
    const year = yearOf(date);
    const row = await tx.one<{ last_no: number }>(
      `INSERT INTO sl.number_sequences (tenant_id, company_id, prefix, year, last_no) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (tenant_id, company_id, prefix, year) DO UPDATE SET last_no = sl.number_sequences.last_no + 1 RETURNING last_no`,
      [ctx.tenantId, ctx.companyId, prefix, year],
    );
    return `${prefix}-${year}-${String(row.last_no).padStart(5, '0')}`;
  }

  private async party(tx: Tx, ctx: CompanyContext, side: LedgerSide, id: string): Promise<Party> {
    const party = await tx.maybeOne<Party>('SELECT * FROM sl.parties WHERE company_id = $1 AND side = $2 AND id = $3', [ctx.companyId, side, id]);
    if (!party) throw notFound(side === 'AR' ? 'customer' : 'supplier');
    if (!party.is_active) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'party_id', message: 'Inactive' }]);
    return party;
  }

  private async lockDocument(tx: Tx, ctx: CompanyContext, side: LedgerSide, id: string): Promise<DocumentRow> {
    const doc = await tx.maybeOne<DocumentRow>('SELECT * FROM sl.documents WHERE company_id = $1 AND side = $2 AND id = $3 FOR UPDATE', [ctx.companyId, side, id]);
    if (!doc) throw notFound('document');
    return doc;
  }
}
