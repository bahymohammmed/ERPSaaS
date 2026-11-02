import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Fixture, signupTenant } from './helpers';

type Row = { cells: Record<string, string | { ar: string; en: string } | null>; style?: string };

let app: INestApplication;
let f: Fixture;
let banks: Record<string, string>;

const balance = async (code: string, to = '2026-12-31') => {
  const res = await f.api.get(`/gl/reports/ledger?account_id=${f.accounts[code]}&from=2026-01-01&to=${to}`);
  return (res.body.rows as Row[]).at(-1)!.cells.balance as string;
};
const ok = <T extends { status: number; body: unknown }>(res: T, status = 201) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as Record<string, any>;
};
const openOf = async (side: string, id: string) => (await f.api.get(`/sl/${side}/documents/${id}`)).body.open_amount as string;
const post = async (side: string, body: Record<string, unknown>, allocations: unknown[] = []) => {
  const draft = ok(await f.api.post(`/sl/${side}/documents`, body));
  ok(await f.api.post(`/sl/${side}/documents/${draft.id}/post`, { allocations }), 200);
  return draft.id as string;
};

beforeAll(async () => {
  app = await createApp();
  f = await signupTenant(app);
  banks = Object.fromEntries((await f.api.get('/cb/accounts')).body.map((b: { code: string; id: string }) => [b.code, b.id]));
  await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-01-01', rate: '0.30000000' });
  await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-03-01', rate: '0.31000000' });
});

afterAll(async () => {
  await app.close();
});

describe('tax codes', () => {
  let vat: string;
  let customer: string;

  it('adds tax per line and posts it to the tax accounts', async () => {
    vat = ok(await f.api.post('/tax/codes', { code: 'VAT5', name_en: 'VAT 5%', rate: '5', sales_account_id: f.accounts['210105'], purchase_account_id: f.accounts['110207'] })).id;
    expect((await f.api.post('/tax/codes', { code: 'BAD', name_en: 'No account', rate: '5' })).status).toBe(400);
    customer = ok(await f.api.post('/sl/AR/parties', { code: 'C001', name_en: 'Gulf Trading', currency_code: 'KWD' })).id;
    const draft = ok(
      await f.api.post('/sl/AR/documents', {
        party_id: customer,
        doc_date: '2026-01-10',
        lines: [
          { description: 'Goods', account_id: f.accounts['4101'], cost_center_id: f.costCenters['102'], unit_price: '1000', tax_code_id: vat },
          { description: 'Exempt service', account_id: f.accounts['4102'], cost_center_id: f.costCenters['103'], unit_price: '200' },
        ],
      }),
    );
    expect((await f.api.get(`/sl/AR/documents/${draft.id}`)).body).toMatchObject({ subtotal: '1200.0000', tax_total: '50.0000', total: '1250.0000' });
    ok(await f.api.post(`/sl/AR/documents/${draft.id}/post`, {}), 200);
    expect(await balance('110201')).toBe('1250.000');
    expect(await balance('210105')).toBe('50.000');
    expect(await openOf('AR', draft.id)).toBe('1250.0000');
  });

  it('reverses tax on credit notes and recovers input tax on purchases', async () => {
    await post('AR', { doc_type: 'CREDIT_NOTE', party_id: customer, doc_date: '2026-01-20', lines: [{ description: 'Return', account_id: f.accounts['4101'], cost_center_id: f.costCenters['102'], unit_price: '100', tax_code_id: vat }] });
    expect(await balance('210105')).toBe('45.000');
    const supplier = ok(await f.api.post('/sl/AP/parties', { code: 'S001', name_en: 'Office Supplies Co.', currency_code: 'KWD' })).id;
    await post('AP', { party_id: supplier, doc_date: '2026-01-15', lines: [{ description: 'Advice', account_id: f.accounts['5305'], cost_center_id: f.costCenters['101'], unit_price: '200', tax_code_id: vat }] });
    expect(await balance('110207')).toBe('10.000');
    expect(await balance('210101')).toBe('210.000');

    // A code with only a sales account cannot be used on a purchase.
    const salesOnly = ok(await f.api.post('/tax/codes', { code: 'ST10', name_en: 'Sales only', rate: '10', sales_account_id: f.accounts['210105'] })).id;
    const draft = ok(await f.api.post('/sl/AP/documents', { party_id: supplier, doc_date: '2026-01-16', lines: [{ description: 'X', account_id: f.accounts['5305'], cost_center_id: f.costCenters['101'], unit_price: '10', tax_code_id: salesOnly }] }));
    expect((await f.api.post(`/sl/AP/documents/${draft.id}/post`, {})).body.error.code).toBe('SL_TAX_ACCOUNT_MISSING');
    ok(await f.api.delete(`/sl/AP/documents/${draft.id}`), 200);
    ok(await f.api.delete(`/tax/codes/${salesOnly}`), 200);
    expect((await f.api.delete(`/tax/codes/${vat}`)).status).toBe(400);
  });

  it('summarises output and input tax in the tax report', async () => {
    const res = await f.api.get('/tax/report?from=2026-01-01&to=2026-01-31');
    expect(res.status).toBe(200);
    const rows = res.body.rows as Row[];
    expect(rows[0]!.cells).toMatchObject({ code: 'VAT5', sales: '900.000', output: '45.000', purchases: '200.000', input: '10.000' });
    expect(rows[1]!.cells).toMatchObject({ code: '—', sales: '200.000' });
    expect(rows.at(-1)!.cells).toMatchObject({ input: '35.000' });
    expect((rows.at(-1)!.cells.name as { en: string }).en).toBe('Net tax payable');
  });
});

describe('foreign currency customers', () => {
  let customer: string;
  let usdBank: string;

  it('receives a USD invoice into a KWD account at the amount the bank credited', async () => {
    customer = ok(await f.api.post('/sl/AR/parties', { code: 'C-USD', name_en: 'Atlantic Corp', currency_code: 'USD' })).id;
    const invoice = await post('AR', { party_id: customer, doc_date: '2026-02-01', lines: [{ description: 'Licence', account_id: f.accounts['4102'], cost_center_id: f.costCenters['103'], unit_price: '1000' }] });
    const body = { party_id: customer, bank_account_id: banks.BANK, settle_date: '2026-03-05', amount: '1000', allocations: [{ document_id: invoice, amount: '1000' }] };
    expect((await f.api.post('/sl/AR/settlements', body)).body.error.code).toBe('SL_BANK_AMOUNT_REQUIRED');
    const receipt = ok(await f.api.post('/sl/AR/settlements', { ...body, bank_amount: '312' }));
    expect(await openOf('AR', invoice)).toBe('0.0000');
    expect(await balance('110103')).toBe('312.000');
    // Booked at 300 (0.30); 312 received: a gain of 12.
    expect(await balance('4202')).toBe('12.000');
    const detail = (await f.api.get(`/sl/AR/settlements/${receipt.id}`)).body;
    expect(detail).toMatchObject({ bank_amount: '312.0000', exchange_rate: '0.31200000' });
  });

  it('applies a receipt after posting and realises the exchange difference then', async () => {
    usdBank = ok(await f.api.post('/cb/accounts', { code: 'USD', name_en: 'USD account', kind: 'BANK', account_id: f.accounts['110104'], currency_code: 'USD' })).id;
    const invoice = await post('AR', { party_id: customer, doc_date: '2026-02-10', lines: [{ description: 'Support', account_id: f.accounts['4102'], cost_center_id: f.costCenters['103'], unit_price: '500' }] });
    const receipt = ok(await f.api.post('/sl/AR/settlements', { party_id: customer, bank_account_id: usdBank, settle_date: '2026-03-10', amount: '500' })).id as string;
    const control = await balance('110201');
    expect(await openOf('AR', invoice)).toBe('500.0000');

    expect((await f.api.post('/sl/AR/allocations', { source_type: 'SETTLEMENT', source_id: receipt, date: '2026-03-01', allocations: [{ document_id: invoice, amount: '500' }] })).status).toBe(400);
    expect((await f.api.post('/sl/AR/allocations', { source_type: 'SETTLEMENT', source_id: receipt, allocations: [{ document_id: invoice, amount: '600' }] })).body.error.code).toBe('SL_ALLOCATION_EXCEEDS');
    const applied = ok(await f.api.post('/sl/AR/allocations', { source_type: 'SETTLEMENT', source_id: receipt, date: '2026-03-20', allocations: [{ document_id: invoice, amount: '500' }] }), 200);
    // Invoice at 150 (0.30), receipt at 155 (0.31).
    expect(applied.fx_difference).toBe('5.0000');
    expect(await openOf('AR', invoice)).toBe('0.0000');
    expect(await balance('4202')).toBe('17.000');
    expect(Number(await balance('110201'))).toBeCloseTo(Number(control) + 5, 3);

    // As at 15 March the receipt was not yet applied; at month end it was.
    const aging = async (asOf: string) => ((await f.api.get(`/sl/AR/reports/aging?as_of=${asOf}`)).body.rows as Row[]).find((r) => r.cells.code === 'C-USD')?.cells;
    expect(await aging('2026-03-15')).toMatchObject({ unapplied: '-155.000' });
    expect(await aging('2026-03-31')).toBeUndefined();

    const allocation = (await f.api.get(`/sl/AR/settlements/${receipt}`)).body.allocations[0];
    ok(await f.api.post(`/sl/AR/allocations/${allocation.id}/remove`, { date: '2026-03-25' }), 200);
    expect(await openOf('AR', invoice)).toBe('500.0000');
    expect(await balance('4202')).toBe('12.000');
    // Removed on the 25th: still applied as at the 22nd.
    expect(await aging('2026-03-22')).toBeUndefined();
    expect(await aging('2026-03-31')).toMatchObject({ unapplied: '-155.000' });

    // Applied again, then the receipt is voided: every difference it realised is undone.
    ok(await f.api.post('/sl/AR/allocations', { source_type: 'SETTLEMENT', source_id: receipt, date: '2026-03-26', allocations: [{ document_id: invoice, amount: '500' }] }), 200);
    expect(await balance('4202')).toBe('17.000');
    ok(await f.api.post(`/sl/AR/settlements/${receipt}/void`, { void_date: '2026-03-31' }), 200);
    expect(await openOf('AR', invoice)).toBe('500.0000');
    expect(await balance('4202')).toBe('12.000');
    expect(await balance('110104')).toBe('0.000');
  });

  it('voids a settlement whose allocation made at posting was later removed', async () => {
    const invoice = await post('AR', { party_id: customer, doc_date: '2026-02-15', lines: [{ description: 'Support', account_id: f.accounts['4102'], cost_center_id: f.costCenters['103'], unit_price: '100' }] });
    const receipt = ok(await f.api.post('/sl/AR/settlements', { party_id: customer, bank_account_id: usdBank, settle_date: '2026-03-12', amount: '100', allocations: [{ document_id: invoice, amount: '100' }] })).id;
    expect(await balance('4202')).toBe('13.000');
    const allocation = (await f.api.get(`/sl/AR/settlements/${receipt}`)).body.allocations[0];
    ok(await f.api.post(`/sl/AR/allocations/${allocation.id}/remove`, { date: '2026-03-13' }), 200);
    expect(await balance('4202')).toBe('12.000');
    ok(await f.api.post(`/sl/AR/settlements/${receipt}/void`, {}), 200);
    expect(await balance('4202')).toBe('12.000');
    expect(await openOf('AR', invoice)).toBe('100.0000');
    const aging = (await f.api.get('/sl/AR/reports/aging?as_of=2026-12-31')).body;
    expect(aging.notes[0].en).toBe('Agrees with the control account in the general ledger');
  });
});

describe('bank statement import', () => {
  it('imports a statement, matches it to the ledger and books what is missing', async () => {
    const rec = ok(await f.api.post('/cb/reconciliations', { bank_account_id: banks.BANK, statement_date: '2026-03-31', statement_balance: '309.500' })).id;
    const csv = ['Kuwait Bank — statement', '', 'Date,Description,Reference,Debit,Credit', '06/03/2026,"Transfer from Atlantic, Inc.",TT-1,,312.000', '15/03/2026,Service charge,,2.500,'].join('\r\n');
    const res = await f.api.post(`/cb/reconciliations/${rec}/statement`).attach('file', Buffer.from(csv), { filename: 'statement.csv', contentType: 'text/csv' });
    const state = ok(res, 200);
    expect(state.statement_lines).toHaveLength(2);
    const [receipt, charge] = state.statement_lines as { id: string; amount: string; description: string; matched_line_id: string | null }[];
    expect(receipt).toMatchObject({ amount: '312.0000', description: 'Transfer from Atlantic, Inc.' });
    expect(receipt!.matched_line_id).toBeTruthy();
    expect(charge).toMatchObject({ amount: '-2.5000', matched_line_id: null });
    expect(state.difference).toBe('-2.5000');

    const booked = ok(await f.api.post(`/cb/reconciliations/${rec}/statement/${charge!.id}/post`, { account_id: f.accounts['5310'] }), 200);
    expect(booked.difference).toBe('0.0000');
    expect(await balance('5310')).toBe('2.500');
    expect((await f.api.post(`/cb/reconciliations/${rec}/statement/${charge!.id}/post`, { account_id: f.accounts['5310'] })).body.error.code).toBe('SL_STATEMENT_LINE_MATCHED');
    ok(await f.api.post(`/cb/reconciliations/${rec}/complete`), 200);
  });

  it('rejects a file without the columns it needs', async () => {
    const rec = ok(await f.api.post('/cb/reconciliations', { bank_account_id: banks.CASH, statement_date: '2026-03-31', statement_balance: '0' })).id;
    const res = await f.api.post(`/cb/reconciliations/${rec}/statement`).attach('file', Buffer.from('a,b\n1,2'), { filename: 'x.csv', contentType: 'text/csv' });
    expect(res.body.error.code).toBe('IMPORT_FILE_INVALID');
  });
});
