import type { INestApplication } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, type Fixture, line, postEntry, signupTenant } from './helpers';

type Row = { cells: Record<string, string | { ar: string; en: string } | null>; style?: string };

let app: INestApplication;
let f: Fixture;
let categories: Record<string, { id: string; asset_account_id: string; accum_dep_account_id: string }>;
const period = (code: string) => f.periods.find((p) => p.code === code)!.id;

const balance = async (code: string, to = '2026-12-31') => {
  const res = await f.api.get(`/gl/reports/ledger?account_id=${f.accounts[code]}&from=2026-01-01&to=${to}`);
  const closing = (res.body.rows as Row[]).at(-1)!.cells;
  return { debit: closing.debit, credit: closing.credit, balance: closing.balance };
};

const newAsset = async (body: Record<string, unknown>) => {
  const res = await f.api.post('/fa/assets', {
    cost_center_id: f.costCenters['102'],
    acquisition_date: '2026-01-16',
    ...body,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
};

beforeAll(async () => {
  app = await createApp();
  f = await signupTenant(app);
  const res = await f.api.get('/fa/categories');
  categories = Object.fromEntries(res.body.map((c: { code: string }) => [c.code, c]));
});

afterAll(async () => {
  await app.close();
});

describe('fixed assets', () => {
  let vehicle: string;

  it('seeds the default categories with the chart of accounts', () => {
    expect(Object.keys(categories).sort()).toEqual(['BLD', 'CMP', 'FUR', 'LND', 'MCH', 'VEH']);
  });

  it('posts the purchase when an asset is put into service', async () => {
    vehicle = await newAsset({ code: 'VEH-1', name_en: 'Delivery van', name_ar: 'شاحنة توصيل', category_id: categories.VEH!.id, cost: '12000' });
    const draft = await f.api.get(`/fa/assets/${vehicle}`);
    expect(draft.body).toMatchObject({ status: 'DRAFT', method: 'STRAIGHT_LINE', useful_life_months: 60, in_service_date: '2026-01-16' });

    const res = await f.api.post(`/fa/assets/${vehicle}/activate`, { mode: 'POST', offset_account_id: f.accounts['110103'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.entry_id).toBeTruthy();
    expect((await balance('120104')).balance).toBe('12000.000');
  });

  it('depreciates pro rata, refuses duplicates, and catches up skipped months', async () => {
    const jan = await f.api.post('/fa/depreciation/run', { period_id: period('2026-01') });
    expect(jan.status, JSON.stringify(jan.body)).toBe(201);
    expect(jan.body.total).toBe('103.226');

    expect((await f.api.post('/fa/depreciation/run', { period_id: period('2026-01') })).body.error.code).toBe('FA_RUN_EXISTS');
    const feb = await f.api.post('/fa/depreciation/run', { period_id: period('2026-02') });
    expect(feb.body.total).toBe('200.000');

    // Skip March: April's run charges both months.
    const preview = await f.api.post('/fa/depreciation/preview', { period_id: period('2026-04') });
    expect(preview.body.total).toBe('400.000');
    expect((await f.api.get('/fa/depreciation/runs')).body).toHaveLength(2);
    const apr = await f.api.post('/fa/depreciation/run', { period_id: period('2026-04') });
    expect(apr.body.lines[0]).toMatchObject({ from_date: '2026-03-01', to_date: '2026-04-30', amount: '400.000' });
    expect((await f.api.post('/fa/depreciation/run', { period_id: period('2026-03') })).body.error.code).toBe('FA_LATER_RUN_EXISTS');

    expect((await balance('120203')).balance).toBe('-703.226');
    const expense = await f.api.get(`/gl/reports/ledger?account_id=${f.accounts['5501']}&from=2026-01-01&to=2026-12-31&cost_center_id=${f.costCenters['102']}`);
    expect((expense.body.rows as Row[]).at(-1)!.cells.balance).toBe('703.226');
  });

  it('reverses only the latest run and restores the asset', async () => {
    const runs = (await f.api.get('/fa/depreciation/runs')).body as { id: string; period_code: string; status: string }[];
    const feb = runs.find((r) => r.period_code === '2026-02')!;
    const apr = runs.find((r) => r.period_code === '2026-04')!;
    expect((await f.api.post(`/fa/depreciation/runs/${feb.id}/reverse`)).body.error.code).toBe('FA_NOT_LATEST_RUN');
    expect((await f.api.post(`/fa/depreciation/runs/${apr.id}/reverse`)).status).toBe(200);
    expect((await f.api.get(`/fa/assets/${vehicle}`)).body.depreciated_to).toBe('2026-02-28');
    expect((await balance('120203')).balance).toBe('-303.226');
    const again = await f.api.post('/fa/depreciation/run', { period_id: period('2026-04') });
    expect(again.body.total).toBe('400.000');
  });

  it('keeps fixed asset entries out of the journal reversal screen', async () => {
    const asset = await f.api.get(`/fa/assets/${vehicle}`);
    const res = await f.api.post(`/gl/journals/${asset.body.acquisition_entry_id}/reverse`, {});
    expect(res.body.error.code).toBe('FA_REVERSE_IN_MODULE');
  });

  it('disposes with depreciation to the disposal date and a loss, and can be reversed', async () => {
    expect((await f.api.post(`/fa/assets/${vehicle}/dispose`, { disposal_date: '2026-04-15', proceeds: '0' })).body.error.code).toBe('FA_DEPRECIATED_BEYOND');
    expect((await f.api.post(`/fa/assets/${vehicle}/dispose`, { disposal_date: '2026-05-10', proceeds: '11000' })).body.error.code).toBe('FA_PROCEEDS_ACCOUNT_REQUIRED');

    const res = await f.api.post(`/fa/assets/${vehicle}/dispose`, { disposal_date: '2026-05-10', proceeds: '11000', proceeds_account_id: f.accounts['110103'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // 10 days of May: 200 × 10/31; accumulated 703.226 + 64.516 = 767.742; book value 11,232.258.
    expect(res.body).toMatchObject({ catch_up: '64.5160', net_book_value: '11232.2580', gain: '-232.2580' });
    expect((await balance('120104')).balance).toBe('0.000');
    expect((await balance('120203')).balance).toBe('0.000');
    // A loss is a debit on the gain/loss account (shown against its credit-normal balance).
    expect((await balance('4203')).balance).toBe('-232.258');
    const disposed = await f.api.get(`/fa/assets/${vehicle}`);
    expect(disposed.body).toMatchObject({ status: 'DISPOSED', accumulated: '767.7420' });

    expect((await f.api.post(`/fa/assets/${vehicle}/reverse-disposal`)).status).toBe(200);
    const restored = await f.api.get(`/fa/assets/${vehicle}`);
    expect(restored.body).toMatchObject({ status: 'ACTIVE', depreciated_to: '2026-04-30', accumulated: '703.2260' });
    expect((await balance('120104')).balance).toBe('12000.000');
  });

  it('transfers between cost centers, and later depreciation follows the asset', async () => {
    expect((await f.api.post(`/fa/assets/${vehicle}/transfer`, { cost_center_id: f.costCenters['103'], transfer_date: '2026-05-01' })).status).toBe(200);
    const may = await f.api.post('/fa/depreciation/run', { period_id: period('2026-05') });
    expect(may.body.total).toBe('200.000');
    const expense = await f.api.get(`/gl/reports/ledger?account_id=${f.accounts['5501']}&from=2026-05-01&to=2026-05-31&cost_center_id=${f.costCenters['103']}`);
    expect((expense.body.rows as Row[]).at(-1)!.cells.balance).toBe('200.000');
    const detail = await f.api.get(`/fa/assets/${vehicle}`);
    expect(detail.body.events.map((e: { event_type: string }) => e.event_type)).toEqual(['TRANSFER', 'DISPOSAL_REVERSED', 'DISPOSE', 'ACQUIRE']);
  });

  it('supports declining balance and existing balances without posting', async () => {
    const dbCategory = await f.api.post('/fa/categories', {
      code: 'IT-DB',
      name_en: 'IT (declining)',
      asset_account_id: f.accounts['120106'],
      accum_dep_account_id: f.accounts['120205'],
      dep_expense_account_id: f.accounts['5501'],
      disposal_account_id: f.accounts['4203'],
      method: 'DECLINING_BALANCE',
      declining_rate: '20',
    });
    expect(dbCategory.status, JSON.stringify(dbCategory.body)).toBe(201);
    const server = await newAsset({ code: 'IT-1', name_en: 'Server', category_id: dbCategory.body.id, cost: '10000', acquisition_date: '2026-06-01' });
    expect((await f.api.post(`/fa/assets/${server}/activate`, { mode: 'EXISTING' })).status).toBe(200);
    const jun = await f.api.post('/fa/depreciation/run', { period_id: period('2026-06') });
    // Van 200 + server 10,000 × 20% / 12.
    expect(jun.body.total).toBe('366.667');
  });

  it('reports the IAS 16 movement and checks it against the ledger', async () => {
    const res = await f.api.get('/fa/reports/movement?from=2026-01-01&to=2026-06-30');
    expect(res.status).toBe(200);
    const total = (res.body.rows as Row[]).at(-1)!.cells;
    // Van: 103.226 + 200 + 400 (Mar–Apr) + 200 + 200; server: 166.667.
    expect(total).toMatchObject({ additions: '22000.000', cost_close: '22000.000', charge: '1269.893', acc_close: '1269.893', nbv: '20730.107' });
    // The server's cost was never posted (EXISTING), so the ledger shows 10,000 less.
    expect(res.body.notes[0].en).toContain('cost -10000.000');

    const register = await f.api.get('/fa/reports/register?as_of=2026-06-30');
    expect((register.body.rows as Row[]).at(-1)!.cells).toMatchObject({ cost: '22000.000', accumulated: '1269.893', nbv: '20730.107' });
    const forecast = await f.api.get(`/fa/reports/forecast?from_period_id=${period('2026-07')}&months=6`);
    expect((forecast.body.rows as Row[]).find((r) => typeof r.cells.name === 'object' && r.cells.name?.en === 'Vehicles')!.cells.m0).toBe('200.000');
  });

  it('locks the asset accounts to the module when asked', async () => {
    const veh = categories.VEH!;
    const res = await f.api.put(`/fa/categories/${veh.id}`, {
      code: 'VEH',
      name_en: 'Vehicles',
      asset_account_id: veh.asset_account_id,
      accum_dep_account_id: veh.accum_dep_account_id,
      dep_expense_account_id: f.accounts['5501'],
      disposal_account_id: f.accounts['4203'],
      method: 'STRAIGHT_LINE',
      useful_life_months: 60,
      lock_accounts: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const draft = await f.api.post('/gl/journals', { journal_type_id: f.journalTypes.JV, entry_date: '2026-07-01', lines: [line(f.accounts['120104']!, '100.000', '0'), line(f.accounts['110103']!, '0', '100.000')] });
    const posted = await f.api.post(`/gl/journals/${draft.body.id}/post`);
    expect(posted.body.error.code).toBe('LINE_CONTROL_ACCOUNT');
    // The module itself still posts there.
    const car = await newAsset({ code: 'VEH-2', name_en: 'Car', category_id: veh.id, cost: '6000', acquisition_date: '2026-07-01' });
    expect((await f.api.post(`/fa/assets/${car}/activate`, { mode: 'POST', offset_account_id: f.accounts['110103'] })).status).toBe(200);
  });

  it('imports an opening register from Excel', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('assets');
    sheet.addRow(['code', 'name_en', 'category', 'cost_center', 'acquisition_date', 'cost', 'opening_accum_dep', 'opening_dep_date']);
    sheet.addRow(['FUR-OLD', 'Old desks', 'FUR', '101', '2020-01-01', '3000', '3000', '2024-12-31']);
    sheet.addRow(['FUR-NEW', 'New desks', 'FUR', '101', '2025-07-01', '6000', '600', '2025-12-31']);
    sheet.addRow(['BAD', 'Unknown', 'XXX', '101', '2025-07-01', '100', '', '']);
    const file = Buffer.from(await workbook.xlsx.writeBuffer());

    const preview = await f.api.post('/fa/import').attach('file', file, 'assets.xlsx');
    expect(preview.body).toMatchObject({ committed: false, total: 3, errors: 1 });
    expect((await f.api.get('/fa/assets?search=FUR-')).body).toHaveLength(0);

    sheet.spliceRows(4, 1);
    const good = Buffer.from(await workbook.xlsx.writeBuffer());
    const commit = await f.api.post('/fa/import?commit=true').attach('file', good, 'assets.xlsx');
    expect(commit.body).toMatchObject({ committed: true, errors: 0 });
    const imported = (await f.api.get('/fa/assets?search=FUR-')).body as { code: string; status: string; net_book_value: string }[];
    expect(imported.map((a) => [a.code, a.status, a.net_book_value])).toEqual([
      ['FUR-NEW', 'ACTIVE', '5400.0000'],
      ['FUR-OLD', 'FULLY_DEPRECIATED', '0.0000'],
    ]);
  });
});
