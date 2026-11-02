import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Fixture, signupTenant } from './helpers';

type Row = { cells: Record<string, string | { ar: string; en: string } | null>; style?: string };

let app: INestApplication;
let f: Fixture;
let banks: Record<string, string>;

const balance = async (code: string, to = '2026-12-31') => {
  const res = await f.api.get(`/gl/reports/ledger?account_id=${f.accounts[code]}&from=2026-01-01&to=${to}`);
  return (res.body.rows as Row[]).at(-1)!.cells.balance;
};
const ok = <T extends { status: number; body: unknown }>(res: T, status = 201) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Record<string, any>;
};
const openOf = async (side: string, id: string) => (await f.api.get(`/sl/${side}/documents/${id}`)).body.open_amount as string;

beforeAll(async () => {
  app = await createApp();
  f = await signupTenant(app);
  banks = Object.fromEntries((await f.api.get('/cb/accounts')).body.map((b: { code: string; id: string }) => [b.code, b.id]));
});

afterAll(async () => {
  await app.close();
});

describe('customers: invoices, receipts and credit notes', () => {
  let customer: string;
  let invoice: string;
  let receipt: string;

  it('registers the default bank and cash accounts with the company', () => {
    expect(Object.keys(banks).sort()).toEqual(['BANK', 'CASH']);
  });

  it('posts a sales invoice to the receivable control account', async () => {
    customer = ok(await f.api.post('/sl/AR/parties', { code: 'C001', name_en: 'Gulf Trading', name_ar: 'الخليج للتجارة', currency_code: 'KWD', payment_terms_days: 30 })).id;
    const draft = ok(
      await f.api.post('/sl/AR/documents', {
        party_id: customer,
        doc_date: '2026-01-10',
        reference: 'PO-77',
        lines: [
          { description: 'Consulting days', account_id: f.accounts['4102'], cost_center_id: f.costCenters['103'], quantity: '2', unit_price: '500' },
          { description: 'Materials', account_id: f.accounts['4101'], cost_center_id: f.costCenters['102'], quantity: '1', unit_price: '250.000' },
        ],
      }),
    );
    invoice = draft.id;
    const detail = (await f.api.get(`/sl/AR/documents/${invoice}`)).body;
    expect(detail).toMatchObject({ status: 'DRAFT', due_date: '2026-02-09', total: '1250.0000' });

    const posted = ok(await f.api.post(`/sl/AR/documents/${invoice}/post`, {}), 200);
    expect(posted.doc_no).toBe('SI-2026-00001');
    expect(await balance('110201')).toBe('1250.000');
    expect(await balance('4102')).toBe('1000.000');
    expect(await openOf('AR', invoice)).toBe('1250.0000');
  });

  it('applies a receipt and a credit note to the invoice', async () => {
    receipt = ok(await f.api.post('/sl/AR/settlements', { party_id: customer, bank_account_id: banks.BANK, settle_date: '2026-02-01', amount: '1000', allocations: [{ document_id: invoice, amount: '1000' }] })).id;
    expect(await openOf('AR', invoice)).toBe('250.0000');
    expect(await balance('110103')).toBe('1000.000');
    expect(await balance('110201')).toBe('250.000');

    const note = ok(await f.api.post('/sl/AR/documents', { doc_type: 'CREDIT_NOTE', party_id: customer, doc_date: '2026-02-05', lines: [{ description: 'Discount', account_id: f.accounts['4101'], cost_center_id: f.costCenters['102'], unit_price: '100' }] })).id;
    expect((await f.api.post(`/sl/AR/documents/${note}/post`, { allocations: [{ document_id: invoice, amount: '300' }] })).body.error.code).toBe('SL_ALLOCATION_EXCEEDS');
    expect(ok(await f.api.post(`/sl/AR/documents/${note}/post`, { allocations: [{ document_id: invoice, amount: '100' }] }), 200).doc_no).toBe('CN-2026-00001');
    expect(await openOf('AR', invoice)).toBe('150.0000');
    expect(await balance('110201')).toBe('150.000');
  });

  it('keeps settled invoices and sub-ledger entries out of manual reversal', async () => {
    expect((await f.api.post(`/sl/AR/documents/${invoice}/void`, {})).body.error.code).toBe('SL_DOCUMENT_SETTLED');
    const detail = (await f.api.get(`/sl/AR/documents/${invoice}`)).body;
    expect((await f.api.post(`/gl/journals/${detail.entry_id}/reverse`, {})).body.error.code).toBe('SL_REVERSE_IN_MODULE');
  });

  it('voids a receipt, reopening the invoice', async () => {
    ok(await f.api.post(`/sl/AR/settlements/${receipt}/void`, {}), 200);
    expect(await openOf('AR', invoice)).toBe('1150.0000');
    expect(await balance('110103')).toBe('0.000');
    expect(await balance('110201')).toBe('1150.000');
  });

  it('ages receivables and agrees them with the ledger', async () => {
    const res = await f.api.get('/sl/AR/reports/aging?as_of=2026-03-31');
    expect(res.status).toBe(200);
    const total = (res.body.rows as Row[]).at(-1)!.cells;
    // Due 9 Feb, 50 days late at 31 March.
    expect(total).toMatchObject({ d60: '1150.000', total: '1150.000' });
    expect(res.body.notes[0].en).toBe('Agrees with the control account in the general ledger');
  });

  it('prints a statement of account with a running balance', async () => {
    const res = await f.api.get(`/sl/AR/reports/statement?party_id=${customer}&from=2026-01-01&to=2026-12-31`);
    const rows = res.body.rows as Row[];
    expect(rows.map((r) => r.cells.balance)).toEqual(['0.000', '1250.000', '1150.000', '1150.000']);
    const pdf = await f.api.get(`/sl/AR/documents/${invoice}/print?format=json`);
    expect(pdf.body.notes[0].en).toContain('one thousand two hundred and fifty Kuwaiti Dinar');
  });
});

describe('suppliers in a foreign currency', () => {
  it('posts a realised exchange loss when paying at a higher rate', async () => {
    await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-01-01', rate: '0.30000000' });
    await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-03-01', rate: '0.31000000' });
    const usdBank = ok(await f.api.post('/cb/accounts', { code: 'USD', name_en: 'USD account', kind: 'BANK', account_id: f.accounts['110104'], currency_code: 'USD' })).id;
    const supplier = ok(await f.api.post('/sl/AP/parties', { code: 'S001', name_en: 'Global Software Inc.', currency_code: 'USD', payment_terms_days: 15 })).id;

    expect((await f.api.post('/sl/AP/settlements', { party_id: supplier, bank_account_id: banks.BANK, settle_date: '2026-03-05', amount: '10' })).body.error.code).toBe('SL_CURRENCY_MISMATCH');

    const bill = ok(await f.api.post('/sl/AP/documents', { party_id: supplier, doc_date: '2026-02-01', lines: [{ description: 'Licences', account_id: f.accounts['5305'], cost_center_id: f.costCenters['101'], unit_price: '1000' }] })).id;
    expect(ok(await f.api.post(`/sl/AP/documents/${bill}/post`, {}), 200).doc_no).toBe('PI-2026-00001');
    expect(await balance('210101')).toBe('300.000');

    // Fund the USD account first so its balance stays positive.
    ok(await f.api.post('/cb/transfers', { transfer_date: '2026-03-01', from_account_id: banks.BANK, to_account_id: usdBank, amount: '620', to_amount: '2000' }));

    const payment = ok(await f.api.post('/sl/AP/settlements', { party_id: supplier, bank_account_id: usdBank, settle_date: '2026-03-05', amount: '1000', allocations: [{ document_id: bill, amount: '1000' }] }));
    expect(payment.doc_no).toBe('PY-2026-00001');
    expect(await balance('210101')).toBe('0.000');
    expect(await balance('5701')).toBe('10.000');
    const detail = (await f.api.get(`/sl/AP/settlements/${payment.id}`)).body;
    expect(detail.allocations[0].fx_difference).toBe('-10.0000');

    const accounts = (await f.api.get('/cb/accounts')).body as { code: string; balance: string; balance_base: string }[];
    expect(accounts.find((a) => a.code === 'USD')).toMatchObject({ balance: '1000.0000', balance_base: '310.0000' });
  });
});

describe('bank reconciliation', () => {
  it('reconciles cleared lines against the statement balance', async () => {
    const start = ok(await f.api.post('/cb/reconciliations', { bank_account_id: banks.BANK, statement_date: '2026-03-31', statement_balance: '-620.000' }));
    expect((await f.api.post('/cb/reconciliations', { bank_account_id: banks.BANK, statement_date: '2026-03-31', statement_balance: '0' })).body.error.code).toBe('SL_RECONCILIATION_OPEN');
    const state = (await f.api.get(`/cb/reconciliations/${start.id}`)).body as { lines: { id: string; amount: string }[]; difference: string };
    // Receipt 1,000, its void −1,000 and the transfer −620.
    expect(state.lines.map((l) => l.amount).sort()).toEqual(['-1000.0000', '-620.0000', '1000.0000']);
    expect((await f.api.post(`/cb/reconciliations/${start.id}/complete`)).body.error.code).toBe('SL_RECONCILIATION_DIFFERENCE');

    const transfer = state.lines.find((l) => l.amount === '-620.0000')!;
    const partial = ok(await f.api.put(`/cb/reconciliations/${start.id}/items`, { line_ids: [transfer.id] }), 200);
    expect(partial.difference).toBe('0.0000');
    ok(await f.api.post(`/cb/reconciliations/${start.id}/complete`), 200);

    // Cleared lines no longer appear in the next reconciliation.
    const next = ok(await f.api.post('/cb/reconciliations', { bank_account_id: banks.BANK, statement_date: '2026-04-30', statement_balance: '-620.000' }));
    const nextState = (await f.api.get(`/cb/reconciliations/${next.id}`)).body;
    expect(nextState.lines).toHaveLength(2);
    expect(nextState.opening_cleared).toBe('-620.0000');
    expect(nextState.difference).toBe('0.0000');
  });
});
