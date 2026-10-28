import type { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Fixture, line, postEntry, signupTenant } from './helpers';

type Row = { cells: Record<string, string | { ar: string; en: string } | null>; style?: string };

let app: INestApplication;
let f: Fixture;

const byName = (rows: Row[], en: string) => rows.find((r) => typeof r.cells.name === 'object' && r.cells.name?.en === en);
const byCode = (rows: Row[], code: string) => rows.find((r) => r.cells.code === code);

beforeAll(async () => {
  app = await createApp();
  f = await signupTenant(app);
  const cc = f.costCenters;
  const acc = f.accounts;
  // Prior year: 2025 with a profit of 1,000.000 that is never formally closed.
  await f.api.post('/gl/fiscal-years', { code: '2025', start_date: '2025-01-01' });
  await postEntry(f, { entry_date: '2025-06-30', lines: [line(acc['110103']!, '1000.000', '0'), line(acc['4102']!, '0', '1000.000', { cost_center_id: cc['102'] })] });
  // 2026 activity.
  await postEntry(f, { entry_date: '2026-01-02', lines: [line(acc['110103']!, '10000.000', '0'), line(acc['3101']!, '0', '10000.000')] });
  await postEntry(f, { entry_date: '2026-01-15', lines: [line(acc['110103']!, '3000.000', '0'), line(acc['4101']!, '0', '3000.000', { cost_center_id: cc['102'] })] });
  await postEntry(f, { entry_date: '2026-01-20', lines: [line(acc['5201']!, '800.000', '0', { cost_center_id: cc['101'] }), line(acc['5201']!, '400.000', '0', { cost_center_id: cc['103'] }), line(acc['110103']!, '0', '1200.000')] });
  await postEntry(f, { entry_date: '2026-02-10', lines: [line(acc['5301']!, '250.500', '0', { cost_center_id: cc['102'] }), line(acc['210102']!, '0', '250.500')] });
});

afterAll(async () => {
  await app.close();
});

const period = (code: string) => {
  const p = f.periods.find((x) => x.code === code);
  if (!p) throw new Error(`no period ${code}`);
  return p.id;
};

describe('financial reports', () => {
  it('trial balance balances and carries prior-year results', async () => {
    const res = await f.api.get(`/gl/reports/trial-balance?from_period_id=${period('2026-01')}&to_period_id=${period('2026-02')}`);
    expect(res.status).toBe(200);
    const rows: Row[] = res.body.rows;
    const total = rows.find((r) => r.style === 'grandTotal')!;
    expect(total.cells.cd).toBe(total.cells.cc);
    expect(total.cells.md).toBe('14450.500');
    expect(byCode(rows, '110103')!.cells.od).toBe('1000.000');
    expect(byCode(rows, '110103')!.cells.cd).toBe('12800.000');
    expect(byName(rows, "Prior years' unclosed result")!.cells.oc).toBe('1000.000');
    expect(byCode(rows, '4102')).toBeUndefined();
  });

  it('income statement nets revenue and expenses for the range', async () => {
    const res = await f.api.get(`/gl/reports/income-statement?from_period_id=${period('2026-01')}&to_period_id=${period('2026-02')}`);
    const rows: Row[] = res.body.rows;
    expect(byName(rows, 'Total revenue')!.cells.current).toBe('3000.000');
    expect(byName(rows, 'Total expenses')!.cells.current).toBe('1450.500');
    expect(byName(rows, 'Net profit (loss) for the period')!.cells.current).toBe('1549.500');
  });

  it('income statement filtered by a cost center subtree', async () => {
    const res = await f.api.get(`/gl/reports/income-statement?from_period_id=${period('2026-01')}&to_period_id=${period('2026-02')}&cost_center_id=${f.costCenters['102']}`);
    const rows: Row[] = res.body.rows;
    expect(byName(rows, 'Net profit (loss) for the period')!.cells.current).toBe('2749.500');
  });

  it('balance sheet balances with current and prior results in equity', async () => {
    const res = await f.api.get(`/gl/reports/balance-sheet?period_id=${period('2026-02')}`);
    const rows: Row[] = res.body.rows;
    expect(byName(rows, 'Total assets')!.cells.current).toBe('12800.000');
    expect(byName(rows, 'Total liabilities')!.cells.current).toBe('250.500');
    expect(byName(rows, "Prior years' unclosed result")!.cells.current).toBe('1000.000');
    expect(byName(rows, 'Current year profit (loss)')!.cells.current).toBe('1549.500');
    expect(byName(rows, 'Total liabilities and equity')!.cells.current).toBe('12800.000');
    expect(res.body.notes[0].en).toBe('The statement balances');
  });

  it('balance sheet compares against the same period last year', async () => {
    const res = await f.api.get(`/gl/reports/balance-sheet?period_id=${period('2026-02')}&compare=prior_year`);
    const rows: Row[] = res.body.rows;
    expect(byName(rows, 'Total assets')!.cells.prior).toBe('0.000');
  });

  it('account statement shows opening, running balance and totals', async () => {
    const res = await f.api.get(`/gl/reports/ledger?account_id=${f.accounts['110103']}&from=2026-01-10&to=2026-02-28`);
    const rows: Row[] = res.body.rows;
    expect(rows[0]!.cells.balance).toBe('11000.000');
    expect(rows.at(-1)!.cells.balance).toBe('12800.000');
    expect(rows.at(-1)!.cells.debit).toBe('3000.000');
    expect(rows.at(-1)!.cells.credit).toBe('1200.000');
  });

  it('cost center matrix and summary roll up the hierarchy', async () => {
    const matrix = await f.api.get(`/gl/reports/cost-center-matrix?from_period_id=${period('2026-01')}&to_period_id=${period('2026-02')}&parent_cost_center_id=${f.costCenters['1']}`);
    const salaries = byCode(matrix.body.rows, '5201')!;
    expect(salaries.cells[`cc_${f.costCenters['101']}`]).toBe('800.000');
    expect(salaries.cells[`cc_${f.costCenters['103']}`]).toBe('400.000');
    expect(salaries.cells.total).toBe('1200.000');

    const summary = await f.api.get(`/gl/reports/cost-center-summary?from_period_id=${period('2026-01')}&to_period_id=${period('2026-02')}`);
    const root = byCode(summary.body.rows, '1')!;
    expect(root.cells.revenue).toBe('3000.000');
    expect(root.cells.expense).toBe('1450.500');
    expect(byCode(summary.body.rows, '102')!.cells.net).toBe('2749.500');
  });

  it('journal register lists posted entries with totals', async () => {
    const res = await f.api.get('/gl/reports/journal-register?from=2026-01-01&to=2026-01-31');
    const total = (res.body.rows as Row[]).find((r) => r.style === 'grandTotal')!;
    expect(total.cells.debit).toBe('14200.000');
    expect(total.cells.credit).toBe('14200.000');
  });

  it('exports PDF (bilingual) and Excel', async () => {
    const pdf = await f.api
      .get(`/gl/reports/trial-balance?from_period_id=${period('2026-01')}&to_period_id=${period('2026-02')}&format=pdf&lang=both`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.status).toBe(200);
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

    const xlsx = await f.api
      .get(`/gl/reports/income-statement?from_period_id=${period('2026-01')}&to_period_id=${period('2026-02')}&format=xlsx&lang=ar`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(xlsx.status).toBe(200);
    expect((xlsx.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  }, 60000);

  it('balance summary always equals a rebuild from posted lines', async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id', $1, true)", [f.tenantId]);
      const snapshot = `SELECT period_id, account_id, cost_center_id, currency_code, debit, credit, debit_base, credit_base
                        FROM gl.account_balances WHERE company_id = $1 ORDER BY 1, 2, 3, 4`;
      const before = await db.query(snapshot, [f.companyId]);
      await db.query('SELECT gl.rebuild_balances($1)', [f.companyId]);
      const after = await db.query(snapshot, [f.companyId]);
      expect(after.rows).toEqual(before.rows);
      expect(after.rows.length).toBeGreaterThan(0);
    } finally {
      await db.query('ROLLBACK');
      await db.end();
    }
  });
});
