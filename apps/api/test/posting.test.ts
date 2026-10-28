import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Fixture, line, postEntry, signupTenant } from './helpers';

let app: INestApplication;
let f: Fixture;

beforeAll(async () => {
  app = await createApp();
  f = await signupTenant(app);
});

afterAll(async () => {
  await app.close();
});

describe('provisioning', () => {
  it('seeds the Kuwait chart of accounts, calendar, journal types and cost centers', () => {
    expect(Object.keys(f.accounts).length).toBeGreaterThan(100);
    expect(f.accounts['110103']).toBeDefined();
    expect(f.journalTypes.JV).toBeDefined();
    expect(f.journalTypes.REV).toBeDefined();
    expect(f.costCenters['101']).toBeDefined();
    expect(f.periods).toHaveLength(13);
    expect(f.periods.at(-1)?.period_no).toBe(13);
  });
});

describe('posting engine', () => {
  it('posts a balanced KWD entry with a gapless number and updates balances', async () => {
    const posted = await postEntry(f, {
      entry_date: '2026-01-05',
      description: 'Capital injection',
      lines: [line(f.accounts['110103']!, '50000.000', '0'), line(f.accounts['3101']!, '0', '50000.000')],
    });
    expect(posted.status).toBe('POSTED');
    expect(posted.entry_no).toBe('JV-2026-000001');
    expect(posted.total_debit).toBe('50000.0000');

    const tb = await f.api.get(`/gl/reports/trial-balance?from_period_id=${f.periods[0]!.id}&to_period_id=${f.periods[0]!.id}`);
    expect(tb.status).toBe(200);
    const bank = tb.body.rows.find((r: { cells: { code: string } }) => r.cells.code === '110103');
    expect(bank.cells.cd).toBe('50000.000');
  });

  it('rejects amounts finer than the currency allows (KWD = 3 decimals)', async () => {
    const res = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-06',
      lines: [line(f.accounts['110101']!, '1.2345', '0'), line(f.accounts['3101']!, '0', '1.2345')],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('JOURNAL_LINE_PRECISION');
  });

  it('rejects an unbalanced entry and does not consume a number', async () => {
    const draft = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-07',
      lines: [line(f.accounts['110101']!, '100.000', '0'), line(f.accounts['3101']!, '0', '99.999')],
    });
    expect(draft.status).toBe(201);
    const res = await f.api.post(`/gl/journals/${draft.body.id}/post`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('JOURNAL_UNBALANCED');

    const next = await postEntry(f, {
      entry_date: '2026-01-07',
      lines: [line(f.accounts['110101']!, '100.000', '0'), line(f.accounts['3101']!, '0', '100.000')],
    });
    expect(next.entry_no).toBe('JV-2026-000002');
  });

  it('enforces cost center rules per account', async () => {
    const missing = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-08',
      lines: [line(f.accounts['5301']!, '500.000', '0'), line(f.accounts['110103']!, '0', '500.000')],
    });
    const res = await f.api.post(`/gl/journals/${missing.body.id}/post`);
    expect(res.body.error.code).toBe('LINE_COST_CENTER_REQUIRED');

    const notAllowed = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-08',
      lines: [
        line(f.accounts['5301']!, '500.000', '0', { cost_center_id: f.costCenters['101'] }),
        line(f.accounts['110103']!, '0', '500.000', { cost_center_id: f.costCenters['101'] }),
      ],
    });
    const res2 = await f.api.post(`/gl/journals/${notAllowed.body.id}/post`);
    expect(res2.body.error.code).toBe('LINE_COST_CENTER_NOT_ALLOWED');

    const header = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-08',
      lines: [
        line(f.accounts['5301']!, '500.000', '0', { cost_center_id: f.costCenters['1'] }),
        line(f.accounts['110103']!, '0', '500.000'),
      ],
    });
    const res3 = await f.api.post(`/gl/journals/${header.body.id}/post`);
    expect(res3.body.error.code).toBe('LINE_COST_CENTER_INVALID');
  });

  it('splits a line across cost centers by template and keeps the exact total', async () => {
    const template = await f.api.post('/gl/distribution-templates', {
      code: 'RENT',
      name_ar: 'توزيع الإيجار',
      name_en: 'Rent split',
      lines: [
        { cost_center_id: f.costCenters['101'], percent: '40' },
        { cost_center_id: f.costCenters['102'], percent: '35' },
        { cost_center_id: f.costCenters['103'], percent: '25' },
      ],
    });
    expect(template.status).toBe(201);
    const posted = await postEntry(f, {
      entry_date: '2026-01-10',
      description: 'January rent',
      lines: [
        line(f.accounts['5301']!, '1000.001', '0', { distribution_template_id: template.body.id }),
        line(f.accounts['110103']!, '0', '1000.001'),
      ],
    });
    const rent = posted.lines.filter((l: { account_id: string }) => l.account_id === f.accounts['5301']);
    expect(rent.map((l: { debit: string }) => l.debit)).toEqual(['400.0000', '350.0000', '250.0010']);
    expect(rent.map((l: { cost_center_code: string }) => l.cost_center_code)).toEqual(['101', '102', '103']);
  });

  it('splits by explicit amounts and rejects amounts that do not add up', async () => {
    const bad = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-11',
      lines: [
        line(f.accounts['5302']!, '90.000', '0', {
          distribution: [
            { cost_center_id: f.costCenters['101'], amount: '30.000' },
            { cost_center_id: f.costCenters['102'], amount: '50.000' },
          ],
        }),
        line(f.accounts['110103']!, '0', '90.000'),
      ],
    });
    const res = await f.api.post(`/gl/journals/${bad.body.id}/post`);
    expect(res.body.error.code).toBe('DISTRIBUTION_AMOUNTS_MISMATCH');
  });

  it('converts foreign currency at the stored rate and books rounding differences', async () => {
    const rate = await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-01-01', rate: '0.307155' });
    expect(rate.status).toBe(201);
    const posted = await postEntry(f, {
      entry_date: '2026-01-15',
      description: 'USD expenses',
      lines: [
        line(f.accounts['5305']!, '33.33', '0', { currency_code: 'USD', cost_center_id: f.costCenters['101'] }),
        line(f.accounts['5305']!, '33.33', '0', { currency_code: 'USD', cost_center_id: f.costCenters['102'] }),
        line(f.accounts['5305']!, '33.33', '0', { currency_code: 'USD', cost_center_id: f.costCenters['103'] }),
        line(f.accounts['110104']!, '0', '99.99', { currency_code: 'USD' }),
      ],
    });
    const fx = posted.lines.filter((l: { currency_code: string }) => l.currency_code === 'USD');
    expect(fx[0].exchange_rate).toBe('0.30715500');
    expect(fx[0].debit_base).toBe('10.2370');
    expect(fx[3].credit_base).toBe('30.7120');
    const rounding = posted.lines.find((l: { is_rounding: boolean }) => l.is_rounding);
    expect(rounding.account_code).toBe('5703');
    expect(rounding.debit_base).toBe('0.0010');
    expect(posted.total_debit).toBe(posted.total_credit);
  });

  it('fails clearly when no exchange rate exists', async () => {
    const res = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-15',
      lines: [line(f.accounts['110104']!, '10.00', '0', { currency_code: 'EUR' }), line(f.accounts['3101']!, '0', '10.00', { currency_code: 'EUR' })],
    });
    expect(res.body.error.code).toBe('RATE_NOT_FOUND');
  });

  it('blocks control accounts from manual entries but accepts them from the owning sub-ledger, idempotently', async () => {
    const manual = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-20',
      lines: [line(f.accounts['110201']!, '200.000', '0'), line(f.accounts['4101']!, '0', '200.000')],
    });
    const res = await f.api.post(`/gl/journals/${manual.body.id}/post`);
    expect(res.body.error.code).toBe('LINE_CONTROL_ACCOUNT');

    const request = {
      journal_type_code: 'AR',
      source_module: 'AR',
      source_doc_type: 'INVOICE',
      source_doc_id: 'INV-0001',
      idempotency_key: 'ar-invoice-INV-0001',
      entry_date: '2026-01-20',
      description: 'Invoice INV-0001',
      lines: [line(f.accounts['110201']!, '200.000', '0'), line(f.accounts['4101']!, '0', '200.000')],
    };
    const first = await f.api.post('/gl/postings', request);
    expect(first.status).toBe(201);
    expect(first.body.entry_no).toBe('AR-2026-000001');
    expect(first.body.idempotent_replay).toBe(false);
    const replay = await f.api.post('/gl/postings', request);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.idempotent_replay).toBe(true);
  });

  it('refuses to post into a closed period until it is reopened', async () => {
    const feb = f.periods[1]!;
    const closed = await f.api.patch(`/gl/periods/${feb.id}/status`, { module: 'GL', status: 'CLOSED' });
    expect(closed.status).toBe(200);
    const draft = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-02-03',
      lines: [line(f.accounts['110101']!, '10.000', '0'), line(f.accounts['3101']!, '0', '10.000')],
    });
    const res = await f.api.post(`/gl/journals/${draft.body.id}/post`);
    expect(res.body.error.code).toBe('PERIOD_NOT_OPEN');
    await f.api.patch(`/gl/periods/${feb.id}/status`, { module: 'GL', status: 'OPEN' });
    const ok = await f.api.post(`/gl/journals/${draft.body.id}/post`);
    expect(ok.status).toBe(201);
  });

  it('posts into the adjustment period only when dated on the year end', async () => {
    const wrong = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.ADJ,
      entry_date: '2026-12-30',
      adjustment_period: true,
      lines: [line(f.accounts['110101']!, '1.000', '0'), line(f.accounts['3101']!, '0', '1.000')],
    });
    expect(wrong.body.error.code).toBe('ADJUSTMENT_PERIOD_DATE');
    const ok = await postEntry(f, {
      journal_type_id: f.journalTypes.ADJ,
      entry_date: '2026-12-31',
      adjustment_period: true,
      lines: [line(f.accounts['110101']!, '1.000', '0'), line(f.accounts['3101']!, '0', '1.000')],
    });
    expect(ok.period_code).toBe('2026-13');
  });
});

describe('reversal and immutability', () => {
  it('reverses a posted entry with a mirror entry and blocks a second reversal', async () => {
    const posted = await postEntry(f, {
      entry_date: '2026-03-01',
      lines: [line(f.accounts['110101']!, '75.500', '0'), line(f.accounts['3101']!, '0', '75.500')],
    });
    const reversal = await f.api.post(`/gl/journals/${posted.id}/reverse`, {});
    expect(reversal.status).toBe(201);
    expect(reversal.body.entry_no).toMatch(/^REV-2026-/);
    expect(reversal.body.lines[0].credit).toBe('75.5000');
    const original = await f.api.get(`/gl/journals/${posted.id}`);
    expect(original.body.status).toBe('REVERSED');
    expect(original.body.reversed_by_no).toBe(reversal.body.entry_no);
    const again = await f.api.post(`/gl/journals/${posted.id}/reverse`, {});
    expect(again.body.error.code).toBe('JOURNAL_ALREADY_REVERSED');
  });

  it('does not allow editing or deleting posted entries through the API', async () => {
    const posted = await postEntry(f, {
      entry_date: '2026-03-02',
      lines: [line(f.accounts['110101']!, '5.000', '0'), line(f.accounts['3101']!, '0', '5.000')],
    });
    const edit = await f.api.put(`/gl/journals/${posted.id}`, {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-03-02',
      lines: [line(f.accounts['110101']!, '6.000', '0'), line(f.accounts['3101']!, '0', '6.000')],
    });
    expect(edit.body.error.code).toBe('JOURNAL_NOT_EDITABLE');
    const del = await f.api.delete(`/gl/journals/${posted.id}`);
    expect(del.body.error.code).toBe('JOURNAL_NOT_EDITABLE');
  });
});
