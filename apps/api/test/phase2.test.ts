import type { INestApplication } from '@nestjs/common';
import { PERMISSIONS, toMoney } from '@erp/shared';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompanyContext } from '../src/common/request-context';
import { RecurringScheduler, RecurringService } from '../src/gl/recurring.service';
import { createApp, type Fixture, line, postEntry, signupTenant } from './helpers';

type Row = { cells: Record<string, string | { ar: string; en: string } | null>; style?: string };

let app: INestApplication;
let f: Fixture;
const period = (code: string) => f.periods.find((p) => p.code === code)!.id;
const byName = (rows: Row[], en: string) => rows.find((r) => typeof r.cells.name === 'object' && r.cells.name?.en === en);
const byCode = (rows: Row[], code: string) => rows.find((r) => r.cells.code === code);
const ctx = (): CompanyContext => ({ tenantId: f.tenantId, userId: f.userId, companyId: f.companyId, permissions: new Set(PERMISSIONS), costCenterScope: null, ip: 'test' });

const xlsx = async (rows: (string | number)[][]): Promise<Buffer> => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('data');
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
};

beforeAll(async () => {
  app = await createApp();
  f = await signupTenant(app);
  await postEntry(f, {
    entry_date: '2026-01-02',
    lines: [line(f.accounts['110103']!, '20000.000', '0'), line(f.accounts['3101']!, '0', '20000.000')],
  });
});

afterAll(async () => {
  await app.close();
});

describe('accruals and approval threshold', () => {
  it('auto-reverses an accrual on the given date', async () => {
    const posted = await postEntry(f, {
      entry_date: '2026-01-31',
      auto_reverse_date: '2026-02-01',
      description: 'Accrued utilities',
      lines: [line(f.accounts['5302']!, '120.000', '0', { cost_center_id: f.costCenters['101'] }), line(f.accounts['210102']!, '0', '120.000')],
    });
    expect(posted.status).toBe('REVERSED');
    const reversal = await f.api.get(`/gl/journals/${posted.reversed_by_id}`);
    expect(reversal.body.entry_date).toBe('2026-02-01');
    expect(reversal.body.status).toBe('POSTED');
    expect(reversal.body.lines[0].credit).toBe('120.0000');
  });

  it('rejects an auto-reversal date that is not after the entry date', async () => {
    const res = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-31',
      auto_reverse_date: '2026-01-31',
      lines: [line(f.accounts['110101']!, '1.000', '0'), line(f.accounts['3101']!, '0', '1.000')],
    });
    expect(res.body.error.code).toBe('AUTO_REVERSE_DATE');
  });

  it('lets entries below the approval threshold post without approval', async () => {
    const companies = await f.api.get('/admin/companies');
    const company = companies.body[0];
    await f.api.put(`/admin/companies/${f.companyId}`, { ...company, require_approval: true, approval_threshold: '1000' });
    const small = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-10',
      lines: [line(f.accounts['110101']!, '500.000', '0'), line(f.accounts['3101']!, '0', '500.000')],
    });
    expect((await f.api.post(`/gl/journals/${small.body.id}/post`)).body.status).toBe('POSTED');
    const large = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-01-10',
      lines: [line(f.accounts['110101']!, '1500.000', '0'), line(f.accounts['3101']!, '0', '1500.000')],
    });
    expect((await f.api.post(`/gl/journals/${large.body.id}/post`)).body.error.code).toBe('JOURNAL_APPROVAL_REQUIRED');
    await f.api.delete(`/gl/journals/${large.body.id}`);
    await f.api.put(`/admin/companies/${f.companyId}`, { ...company, require_approval: false, approval_threshold: null });
  });

  it('prints a voucher with the amount in words', async () => {
    const posted = await postEntry(f, {
      entry_date: '2026-01-12',
      lines: [line(f.accounts['110101']!, '1500.250', '0'), line(f.accounts['3101']!, '0', '1500.250')],
    });
    const res = await f.api.get(`/gl/reports/voucher/${posted.id}`);
    expect(res.status).toBe(200);
    expect(res.body.notes[0].ar).toBe('فقط ألف وخمسمائة دينار كويتي ومائتان وخمسون فلس لا غير');
    expect(res.body.notes[0].en).toBe('Only one thousand five hundred Kuwaiti Dinar and two hundred and fifty fils');
  });
});

describe('recurring entries', () => {
  it('generates monthly occurrences on the last valid day, catching up missed runs', async () => {
    const source = await postEntry(f, {
      entry_date: '2026-01-01',
      description: 'Monthly software subscription',
      lines: [line(f.accounts['5303']!, '45.000', '0', { cost_center_id: f.costCenters['101'] }), line(f.accounts['110103']!, '0', '45.000')],
    });
    const created = await f.api.post('/gl/recurring', {
      code: 'SUBS',
      name_en: 'Software subscription',
      frequency: 'MONTHLY',
      day_of_month: 31,
      start_date: '2026-01-01',
      auto_post: true,
      from_entry_id: source.id,
    });
    expect(created.status).toBe(201);
    const service = app.get(RecurringService);
    const result = await service.runNow(ctx(), created.body.id, '2026-04-15');
    expect(result.generated.map((g) => g.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(result.generated.every((g) => g.status === 'POSTED')).toBe(true);

    const scheduled = await app.get(RecurringScheduler).tick('2026-05-31');
    expect(scheduled).toBe(2);
    const list = await f.api.get('/gl/recurring');
    expect(list.body[0].next_run_date).toBe('2026-06-30');
    expect(list.body[0].last_error).toBeNull();
  });
});

describe('FX revaluation', () => {
  it('revalues foreign balances at the closing rate and books the gain', async () => {
    await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-01-01', rate: '0.30000000' });
    await postEntry(f, {
      entry_date: '2026-01-05',
      lines: [line(f.accounts['110104']!, '1000.00', '0', { currency_code: 'USD' }), line(f.accounts['3101']!, '0', '300.000')],
    });
    await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-01-31', rate_type: 'CLOSING', rate: '0.31000000' });
    const preview = await f.api.post('/gl/fx-revaluation/preview', { revaluation_date: '2026-01-31' });
    expect(preview.status).toBe(201);
    expect(preview.body.lines).toHaveLength(1);
    expect(preview.body.lines[0].difference).toBe('10.000');

    const posted = await f.api.post('/gl/fx-revaluation', { revaluation_date: '2026-01-31' });
    expect(posted.status).toBe(201);
    const entry = await f.api.get(`/gl/journals/${posted.body.entry_id}`);
    expect(entry.body.status).toBe('REVERSED');
    const gain = entry.body.lines.find((l: { account_code: string }) => l.account_code === '4202');
    expect(gain.credit_base).toBe('10.0000');
    const bankLine = entry.body.lines.find((l: { account_code: string }) => l.account_code === '110104');
    expect(bankLine.debit).toBe('0.0000');
    expect(bankLine.debit_base).toBe('10.0000');

    const again = await f.api.post('/gl/fx-revaluation/preview', { revaluation_date: '2026-01-31' });
    expect(again.body.lines).toHaveLength(0);
  });
});

describe('cost allocation', () => {
  it('allocates by driver then step-down, previews without posting, and reverses', async () => {
    await postEntry(f, {
      entry_date: '2026-03-10',
      lines: [line(f.accounts['5301']!, '1000.000', '0', { cost_center_id: f.costCenters['101'] }), line(f.accounts['110103']!, '0', '1000.000')],
    });
    const driver = await f.api.post('/gl/allocation/drivers', { code: 'HC', name_en: 'Headcount', unit: 'staff' });
    await f.api.put(`/gl/allocation/drivers/${driver.body.id}/values`, {
      period_id: period('2026-03'),
      values: [
        { cost_center_id: f.costCenters['102'], value: '3' },
        { cost_center_id: f.costCenters['103'], value: '1' },
      ],
    });
    const rule1 = await f.api.post('/gl/allocation/rules', {
      code: 'ADMIN',
      name_en: 'Admin rent by headcount',
      step_no: 1,
      method: 'DRIVER',
      driver_id: driver.body.id,
      source_account_ids: [f.accounts['53']],
      source_cost_center_ids: [f.costCenters['101']],
      targets: [{ cost_center_id: f.costCenters['102'] }, { cost_center_id: f.costCenters['103'] }],
    });
    expect(rule1.status).toBe(201);
    await f.api.post('/gl/allocation/rules', {
      code: 'SALES',
      name_en: 'Sales to operations',
      step_no: 2,
      method: 'FIXED',
      source_account_ids: [f.accounts['5301']],
      source_cost_center_ids: [f.costCenters['102']],
      targets: [{ cost_center_id: f.costCenters['103'], percent: '100' }],
    });
    const bad = await f.api.post('/gl/allocation/rules', {
      code: 'BAD',
      name_en: 'Bad',
      method: 'FIXED',
      source_account_ids: [f.accounts['5301']],
      source_cost_center_ids: [f.costCenters['1']],
      targets: [{ cost_center_id: f.costCenters['103'], percent: '100' }],
    });
    expect(bad.body.error.code).toBe('ALLOCATION_TARGET_IS_SOURCE');

    // Rule 1 takes all of group 53 on cost center 101: the rent plus March's 45.000 subscription.
    const preview = await f.api.post('/gl/allocation/preview', { period_id: period('2026-03') });
    expect(preview.body.rules.map((r: { allocated: string }) => r.allocated)).toEqual(['1045.000', '750.000']);
    expect((await f.api.get('/gl/allocation/runs')).body).toHaveLength(0);

    const run = await f.api.post('/gl/allocation/runs', { period_id: period('2026-03') });
    expect(run.status).toBe(201);
    const matrix = async () =>
      (await f.api.get(`/gl/reports/cost-center-matrix?from_period_id=${period('2026-03')}&to_period_id=${period('2026-03')}&parent_cost_center_id=${f.costCenters['1']}&account_scope=EXPENSE`)).body.rows as Row[];
    const rent = byCode(await matrix(), '5301')!;
    expect(rent.cells[`cc_${f.costCenters['101']}`]).toBeNull();
    expect(rent.cells[`cc_${f.costCenters['102']}`]).toBeNull();
    expect(rent.cells[`cc_${f.costCenters['103']}`]).toBe('1000.000');

    expect((await f.api.post('/gl/allocation/runs', { period_id: period('2026-03') })).body.error.code).toBe('ALLOCATION_ALREADY_RUN');
    const reversed = await f.api.post(`/gl/allocation/runs/${run.body.run_id}/reverse`);
    expect(reversed.body.reversed).toBe(2);
    expect(byCode(await matrix(), '5301')!.cells[`cc_${f.costCenters['101']}`]).toBe('1000.000');
  });
});

describe('budgets', () => {
  it('compares budget with actuals and generates from actuals', async () => {
    const years = await f.api.get('/gl/fiscal-years');
    const budget = await f.api.post('/gl/budgets', { code: 'B2026', name_en: 'Budget 2026', fiscal_year_id: years.body[0].id });
    expect(budget.status).toBe(201);
    await f.api.put(`/gl/budgets/${budget.body.id}/lines`, {
      lines: [{ account_id: f.accounts['5301'], period_id: period('2026-03'), amount: '900' }],
    });
    const report = await f.api.get(`/gl/reports/budget-vs-actual?budget_id=${budget.body.id}&from_period_id=${period('2026-03')}&to_period_id=${period('2026-03')}`);
    const rent = byCode(report.body.rows, '5301')!;
    expect(rent.cells.budget).toBe('900.000');
    expect(rent.cells.actual).toBe('1000.000');
    expect(rent.cells.variance).toBe('-100.000');

    await f.api.patch(`/gl/budgets/${budget.body.id}/status`, { status: 'APPROVED' });
    const locked = await f.api.put(`/gl/budgets/${budget.body.id}/lines`, { lines: [{ account_id: f.accounts['5301'], period_id: period('2026-03'), amount: '1' }] });
    expect(locked.body.error.code).toBe('BUDGET_APPROVED');

    const generated = await f.api.post('/gl/budgets', { code: 'B2026G', name_en: 'Generated', fiscal_year_id: years.body[0].id });
    const result = await f.api.post(`/gl/budgets/${generated.body.id}/generate`, { source_fiscal_year_id: years.body[0].id, adjust_percent: 10 });
    expect(result.body.lines).toBeGreaterThan(0);
    const lines = await f.api.get(`/gl/budgets/${generated.body.id}/lines?cost_center_id=${f.costCenters['101']}`);
    const march = lines.body.find((l: { account_id: string; period_id: string }) => l.account_id === f.accounts['5301'] && l.period_id === period('2026-03'));
    expect(march.amount).toBe('1100.0000');
  });
});

describe('statement designer', () => {
  it('renders the seeded IFRS statements consistently with the standard reports', async () => {
    const list = await f.api.get('/gl/statements');
    const is = list.body.find((s: { code: string }) => s.code === 'IS-IFRS');
    const bs = list.body.find((s: { code: string }) => s.code === 'BS-IFRS');
    const q = `from_period_id=${period('2026-01')}&to_period_id=${period('2026-03')}`;
    const designed = await f.api.get(`/gl/reports/statement?statement_id=${is.id}&${q}`);
    const standard = await f.api.get(`/gl/reports/income-statement?${q}`);
    expect(byName(designed.body.rows, 'Profit for the year')!.cells.current).toBe(byName(standard.body.rows, 'Net profit (loss) for the period')!.cells.current);
    expect(designed.body.notes.filter((n: { en: string }) => n.en.startsWith('Accounts with balances not mapped'))).toHaveLength(0);

    const position = await f.api.get(`/gl/reports/statement?statement_id=${bs.id}&period_id=${period('2026-03')}`);
    expect(byName(position.body.rows, 'Total assets')!.cells.current).toBe(byName(position.body.rows, 'Total equity and liabilities')!.cells.current);

    const broken = await f.api.put(`/gl/statements/${is.id}`, { code: 'IS-IFRS', name_en: 'x', basis: 'PERIOD', rows: [{ row_key: 'A', row_type: 'FORMULA', formula: 'A+MISSING' }] });
    expect(broken.body.error.code).toBe('STATEMENT_FORMULA');
  });
});

describe('Excel import', () => {
  it('previews errors without saving and commits valid accounts', async () => {
    const file = await xlsx([
      ['code', 'name_ar', 'name_en', 'parent_code', 'type', 'posting', 'cost_center_rule'],
      ['59', 'مصروفات مستوردة', 'Imported expenses', '5', 'EXPENSE', 'N', ''],
      ['5901', 'مصروف أ', 'Expense A', '59', 'EXPENSE', 'Y', 'REQUIRED'],
      ['5902', 'مصروف ب', 'Expense B', '5999', 'EXPENSE', 'Y', ''],
    ]);
    const preview = await f.api.post('/gl/import/accounts').attach('file', file, 'accounts.xlsx');
    expect(preview.status).toBe(201);
    expect(preview.body.errors).toBe(1);
    expect(preview.body.rows.find((r: { key: string }) => r.key === '5902').status).toBe('error');
    expect((await f.api.get('/gl/accounts?search=5901')).body).toHaveLength(0);

    const failed = await f.api.post('/gl/import/accounts?commit=true').attach('file', file, 'accounts.xlsx');
    expect(failed.body.committed).toBe(false);
    expect((await f.api.get('/gl/accounts?search=5901')).body).toHaveLength(0);

    const good = await xlsx([
      ['code', 'name_ar', 'name_en', 'parent_code', 'type', 'posting', 'cost_center_rule'],
      ['5901', 'مصروف أ', 'Expense A', '59', 'EXPENSE', 'Y', 'REQUIRED'],
      ['59', 'مصروفات مستوردة', 'Imported expenses', '5', 'EXPENSE', 'N', ''],
    ]);
    const committed = await f.api.post('/gl/import/accounts?commit=true').attach('file', good, 'accounts.xlsx');
    expect(committed.body).toMatchObject({ committed: true, errors: 0, total: 2 });
    expect((await f.api.get('/gl/accounts?search=5901')).body[0].cost_center_rule).toBe('REQUIRED');
  });

  it('imports and posts journals grouped by entry', async () => {
    const file = await xlsx([
      ['entry', 'date', 'journal_type', 'description', 'account', 'cost_center', 'debit', 'credit'],
      ['A', '2026-04-05', 'JV', 'Imported A', '5901', '102', '80.500', ''],
      ['A', '2026-04-05', 'JV', 'Imported A', '110101', '', '', '80.500'],
      ['B', '2026-04-06', 'JV', 'Imported B', '5901', '', '10', ''],
      ['B', '2026-04-06', 'JV', 'Imported B', '110101', '', '', '10'],
    ]);
    const preview = await f.api.post('/gl/import/journals?post=true').attach('file', file, 'journals.xlsx');
    expect(preview.body.errors).toBe(1);
    expect(preview.body.rows.find((r: { key: string }) => r.key === 'B').message).toContain('requires a cost center');

    const okFile = await xlsx([
      ['entry', 'date', 'journal_type', 'description', 'account', 'cost_center', 'debit', 'credit'],
      ['A', '2026-04-05', 'JV', 'Imported A', '5901', '102', '80.500', ''],
      ['A', '2026-04-05', 'JV', 'Imported A', '110101', '', '', '80.500'],
    ]);
    const committed = await f.api.post('/gl/import/journals?commit=true&post=true').attach('file', okFile, 'journals.xlsx');
    expect(committed.body).toMatchObject({ committed: true, errors: 0 });
    const list = await f.api.get('/gl/journals?search=Imported A');
    expect(list.body.rows[0].status).toBe('POSTED');
  });
});

describe('year-end close', () => {
  it('posts statutory contributions, closes P&L into retained earnings, and reopens', async () => {
    await postEntry(f, {
      entry_date: '2026-06-15',
      lines: [line(f.accounts['110103']!, '50000.000', '0'), line(f.accounts['4101']!, '0', '50000.000', { cost_center_id: f.costCenters['102'] })],
    });
    const drafts = await f.api.get('/gl/journals?status=DRAFT');
    for (const d of drafts.body.rows) await f.api.delete(`/gl/journals/${d.id}`);

    const years = await f.api.get('/gl/fiscal-years');
    const fy = years.body[0];
    const preview = await f.api.get(`/gl/year-end/${fy.id}/preview`);
    expect(preview.status).toBe(200);
    const profit = toMoney(preview.body.profit_before_contributions);
    const reserve = preview.body.rules.find((r: { code: string }) => r.code === 'STAT_RES');
    const kfas = preview.body.rules.find((r: { code: string }) => r.code === 'KFAS');
    expect(reserve.amount).toBe(profit.times(0.1).toFixed(3));
    expect(kfas.amount).toBe(profit.minus(reserve.amount).times(0.01).toFixed(3));

    const incomeBefore = await f.api.get(`/gl/reports/income-statement?from_period_id=${period('2026-01')}&to_period_id=${period('2026-13')}`);
    const closed = await f.api.post('/gl/year-end/close', { fiscal_year_id: fy.id });
    expect(closed.status).toBe(201);
    expect(closed.body.entries.map((e: { kind: string }) => e.kind)).toEqual(['contributions', 'closing', 'reserves']);

    // P&L reports still show the year's activity; the closing entry is excluded.
    const incomeAfter = await f.api.get(`/gl/reports/income-statement?from_period_id=${period('2026-01')}&to_period_id=${period('2026-13')}`);
    const netAfter = toMoney(byName(incomeAfter.body.rows, 'Net profit (loss) for the period')!.cells.current as string);
    const netBefore = toMoney(byName(incomeBefore.body.rows, 'Net profit (loss) for the period')!.cells.current as string);
    expect(netAfter.toFixed(3)).toBe(netBefore.minus(kfas.amount).toFixed(3));

    // Balance sheet: everything sits in equity accounts now.
    const bs = await f.api.get(`/gl/reports/balance-sheet?period_id=${period('2026-13')}`);
    expect(byName(bs.body.rows, 'Current year profit (loss)')!.cells.current).toBe('0.000');
    expect(byCode(bs.body.rows, '3201')!.cells.current).toBe(toMoney(reserve.amount).toFixed(3));
    expect(bs.body.notes[0].en).toBe('The statement balances');

    const blocked = await f.api.post('/gl/journals', {
      journal_type_id: f.journalTypes.JV,
      entry_date: '2026-07-01',
      lines: [line(f.accounts['110101']!, '1.000', '0'), line(f.accounts['3101']!, '0', '1.000')],
    });
    expect((await f.api.post(`/gl/journals/${blocked.body.id}/post`)).body.error.code).toBe('PERIOD_NOT_OPEN');
    await f.api.delete(`/gl/journals/${blocked.body.id}`);
    expect((await f.api.post('/gl/year-end/close', { fiscal_year_id: fy.id })).body.error.code).toBe('YEAR_ALREADY_CLOSED');

    const reopened = await f.api.post('/gl/year-end/reopen', { fiscal_year_id: fy.id });
    expect(reopened.body).toMatchObject({ reopened: true, reversed: 3 });
    const bsAfter = await f.api.get(`/gl/reports/balance-sheet?period_id=${period('2026-13')}`);
    expect(byCode(bsAfter.body.rows, '3201')).toBeUndefined();
    expect(byName(bsAfter.body.rows, 'Current year profit (loss)')!.cells.current).toBe(netBefore.toFixed(3));
  });
});
