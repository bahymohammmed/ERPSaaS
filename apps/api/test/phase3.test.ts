import type { INestApplication } from '@nestjs/common';
import { toMoney } from '@erp/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totp } from '../src/common/totp';
import { client, createApp, type Fixture, line, postEntry, signupTenant } from './helpers';

type Row = { cells: Record<string, string | { ar: string; en: string } | null>; style?: string };

let app: INestApplication;
let f: Fixture;
const byName = (rows: Row[], en: string) => rows.find((r) => typeof r.cells.name === 'object' && r.cells.name?.en === en);
const byCode = (rows: Row[], code: string) => rows.find((r) => r.cells.code === code);
const period = (fx: Fixture, code: string) => fx.periods.find((p) => p.code === code)!.id;

/** A second (or third) company in the same tenant, with lookups like the signup fixture. */
const addCompany = async (code: string, currency = 'KWD'): Promise<Fixture> => {
  const created = await f.api.post('/admin/companies', {
    code,
    name_en: `Company ${code}`,
    name_ar: `شركة ${code}`,
    base_currency: currency,
    first_fiscal_year: 2026,
    seed_chart_of_accounts: true,
  });
  if (created.status !== 201) throw new Error(JSON.stringify(created.body));
  const api = f.api.withCompany(created.body.id);
  const [accounts, ccs, jts, periods] = await Promise.all([api.get('/gl/accounts'), api.get('/gl/cost-centers'), api.get('/gl/journal-types'), api.get('/gl/periods')]);
  const byCodeMap = (rows: { code: string; id: string }[]) => Object.fromEntries(rows.map((r) => [r.code, r.id]));
  return { ...f, api, companyId: created.body.id, accounts: byCodeMap(accounts.body), costCenters: byCodeMap(ccs.body), journalTypes: byCodeMap(jts.body), periods: periods.body };
};

let b: Fixture;

beforeAll(async () => {
  app = await createApp();
  f = await signupTenant(app);
  b = await addCompany('KW02');
});

afterAll(async () => {
  await app.close();
});

describe('cash flow statement', () => {
  it('reconciles profit to the movement in cash (indirect method)', async () => {
    const a = f.accounts;
    await postEntry(f, { entry_date: '2026-01-02', lines: [line(a['110103']!, '10000.000', '0'), line(a['3101']!, '0', '10000.000')] });
    await postEntry(f, { entry_date: '2026-01-10', lines: [line(a['110103']!, '3000.000', '0'), line(a['4101']!, '0', '3000.000')] });
    await postEntry(f, { entry_date: '2026-01-20', lines: [line(a['5201']!, '1200.000', '0', { cost_center_id: f.costCenters['101'] }), line(a['110103']!, '0', '1200.000')] });
    await postEntry(f, { entry_date: '2026-01-21', lines: [line(a['120104']!, '2000.000', '0'), line(a['110103']!, '0', '2000.000')] });
    await postEntry(f, { entry_date: '2026-01-31', lines: [line(a['5501']!, '100.000', '0', { cost_center_id: f.costCenters['101'] }), line(a['120203']!, '0', '100.000')] });

    const res = await f.api.get(`/gl/reports/cash-flow?from_period_id=${period(f, '2026-01')}&to_period_id=${period(f, '2026-01')}`);
    expect(res.status).toBe(200);
    const rows: Row[] = res.body.rows;
    expect(byName(rows, 'Profit for the period')!.cells.amount).toBe('1700.000');
    expect(byName(rows, 'Net cash from operating activities')!.cells.amount).toBe('1800.000');
    expect(byName(rows, 'Net cash from investing activities')!.cells.amount).toBe('-2000.000');
    expect(byName(rows, 'Net cash from financing activities')!.cells.amount).toBe('10000.000');
    expect(byName(rows, 'Cash and cash equivalents at the end of the period')!.cells.amount).toBe('9800.000');
    expect(res.body.notes[0].en).toBe('Agrees with the movement in cash accounts');
  });
});

describe('budget control', () => {
  it('blocks or warns when year-to-date spending exceeds the budget', async () => {
    const years = await f.api.get('/gl/fiscal-years');
    const budget = await f.api.post('/gl/budgets', { code: 'CTRL', name_en: 'Control', fiscal_year_id: years.body[0].id });
    await f.api.put(`/gl/budgets/${budget.body.id}/lines`, {
      lines: [{ account_id: f.accounts['5301'], cost_center_id: f.costCenters['101'], period_id: period(f, '2026-02'), amount: '1000' }],
    });
    await f.api.patch(`/gl/budgets/${budget.body.id}/status`, { status: 'APPROVED' });
    const companies = await f.api.get('/admin/companies');
    const company = companies.body.find((c: { id: string }) => c.id === f.companyId);
    await f.api.put(`/admin/companies/${f.companyId}`, { ...company, budget_control: 'BLOCK', control_budget_id: budget.body.id });

    const rent = (amount: string) => ({
      entry_date: '2026-02-15',
      lines: [line(f.accounts['5301']!, amount, '0', { cost_center_id: f.costCenters['101'] }), line(f.accounts['110103']!, '0', amount)],
    });
    await postEntry(f, rent('800.000'));
    const draft = await f.api.post('/gl/journals', { journal_type_id: f.journalTypes.JV, ...rent('300.000') });
    const blocked = await f.api.post(`/gl/journals/${draft.body.id}/post`);
    expect(blocked.body.error.code).toBe('BUDGET_EXCEEDED');
    expect(blocked.body.error.params).toMatchObject({ account: '5301', costCenter: ' / 101', actual: '1100.000', budget: '1000.000' });

    await f.api.put(`/admin/companies/${f.companyId}`, { ...company, budget_control: 'WARN', control_budget_id: budget.body.id });
    const warned = await f.api.post(`/gl/journals/${draft.body.id}/post`);
    expect(warned.body.status).toBe('POSTED');
    expect(warned.body.warnings).toHaveLength(1);

    await f.api.put(`/admin/companies/${f.companyId}`, { ...company, budget_control: 'NONE', control_budget_id: null });
  });
});

describe('intercompany', () => {
  it('books both sides, reconciles, and reverses together', async () => {
    const missing = await f.api.post('/gl/intercompany/transactions', {
      target_company_id: b.companyId,
      entry_date: '2026-03-05',
      source_lines: [{ account_id: f.accounts['110103'], credit: '500' }],
      target_lines: [{ account_id: b.accounts['5301'], cost_center_id: b.costCenters['101'], debit: '500' }],
    });
    expect(missing.body.error.code).toBe('IC_PARTNER_MISSING');

    await f.api.post('/gl/intercompany/partners', { partner_company_id: b.companyId, due_from_account_id: f.accounts['110401'], due_to_account_id: f.accounts['210501'] });
    await b.api.post('/gl/intercompany/partners', { partner_company_id: f.companyId, due_from_account_id: b.accounts['110401'], due_to_account_id: b.accounts['210501'] });

    const unbalanced = await f.api.post('/gl/intercompany/transactions', {
      target_company_id: b.companyId,
      entry_date: '2026-03-05',
      source_lines: [{ account_id: f.accounts['110103'], credit: '500' }],
      target_lines: [{ account_id: b.accounts['5301'], cost_center_id: b.costCenters['101'], debit: '400' }],
    });
    expect(unbalanced.body.error.code).toBe('IC_UNBALANCED');

    const paid = await f.api.post('/gl/intercompany/transactions', {
      target_company_id: b.companyId,
      entry_date: '2026-03-05',
      description: 'Rent paid on behalf of KW02',
      source_lines: [{ account_id: f.accounts['110103'], credit: '500' }],
      target_lines: [{ account_id: b.accounts['5301'], cost_center_id: b.costCenters['101'], debit: '500' }],
    });
    expect(paid.status).toBe(201);
    const source = await f.api.get(`/gl/journals/${paid.body.source_entry_id}`);
    const target = await b.api.get(`/gl/journals/${paid.body.target_entry_id}`);
    expect(source.body.lines.find((l: { account_code: string }) => l.account_code === '110401').debit_base).toBe('500.0000');
    expect(target.body.lines.find((l: { account_code: string }) => l.account_code === '210501').credit_base).toBe('500.0000');

    const recon = await f.api.get('/gl/reports/intercompany-reconciliation?as_of=2026-03-31');
    const row = byCode(recon.body.rows, 'KW02')!;
    expect(row.cells).toMatchObject({ ours: '500.000', theirs: '-500.000', difference: '0.000' });

    const reversed = await f.api.post(`/gl/journals/${paid.body.source_entry_id}/reverse`, {});
    expect(reversed.status).toBe(201);
    expect((await b.api.get(`/gl/journals/${paid.body.target_entry_id}`)).body.status).toBe('REVERSED');
    const after = await f.api.get('/gl/reports/intercompany-reconciliation?as_of=2026-03-31');
    expect(byCode(after.body.rows, 'KW02')!.cells.ours).toBe('0.000');
  });
});

describe('consolidation', () => {
  it('aggregates members, eliminates intercompany balances and applies adjustments', async () => {
    await postEntry(b, { entry_date: '2026-03-01', lines: [line(b.accounts['110103']!, '4000.000', '0'), line(b.accounts['3101']!, '0', '4000.000')] });
    await postEntry(b, { entry_date: '2026-03-02', lines: [line(b.accounts['110103']!, '600.000', '0'), line(b.accounts['4101']!, '0', '600.000')] });
    const ic = await f.api.post('/gl/intercompany/transactions', {
      target_company_id: b.companyId,
      entry_date: '2026-03-10',
      source_lines: [{ account_id: f.accounts['110103'], credit: '250' }],
      target_lines: [{ account_id: b.accounts['110103'], debit: '250' }],
    });
    expect(ic.status).toBe(201);

    const group = await f.api.post('/consolidation/groups', {
      code: 'GRP',
      name_en: 'Group',
      parent_company_id: f.companyId,
      presentation_currency: 'KWD',
      member_company_ids: [b.companyId],
    });
    expect(group.status).toBe(201);

    const worksheet = await f.api.get(`/consolidation/groups/${group.body.id}/worksheet?as_of=2026-03-31`);
    const ws: Row[] = worksheet.body.rows;
    expect(byCode(ws, '110401')!.cells.total).toBe('0.000');
    expect(byCode(ws, '210501')!.cells.total).toBe('0.000');
    const totals = ws.find((r) => r.style === 'grandTotal')!.cells;
    for (const [key, value] of Object.entries(totals)) if (key !== 'name') expect(value).toBe('0.000');

    const bs = await f.api.get(`/consolidation/groups/${group.body.id}/balance-sheet?as_of=2026-03-31`);
    expect(bs.body.notes[0].en).toBe('The statement balances');
    const kw01 = await f.api.get(`/gl/reports/balance-sheet?period_id=${period(f, '2026-03')}`);
    const kw02 = await b.api.get(`/gl/reports/balance-sheet?period_id=${period(b, '2026-03')}`);
    const assets = (rows: Row[]) => toMoney(byName(rows, 'Total assets')!.cells.current as string);
    expect(assets(bs.body.rows).toFixed(3)).toBe(assets(kw01.body.rows).plus(assets(kw02.body.rows)).minus(250).toFixed(3));

    const income = async () =>
      toMoney(byName((await f.api.get(`/consolidation/groups/${group.body.id}/income-statement?from=2026-01-01&to=2026-03-31`)).body.rows, 'Consolidated net profit')!.cells.current as string);
    const before = await income();
    const adj = await f.api.post(`/consolidation/groups/${group.body.id}/adjustments`, {
      adjustment_date: '2026-03-31',
      description: 'Eliminate intra-group sale',
      lines: [
        { account_code: '4101', debit: '100' },
        { account_code: '5301', credit: '100' },
      ],
    });
    expect(adj.status).toBe(201);
    expect((await income()).toFixed(3)).toBe(before.toFixed(3));
    const revenue = (await f.api.get(`/consolidation/groups/${group.body.id}/income-statement?from=2026-01-01&to=2026-03-31`)).body.rows as Row[];
    expect(byName(revenue, 'Total revenue')!.cells.current).toBe('3500.000');
  });

  it('translates a foreign-currency member at closing and average rates', async () => {
    const us = await addCompany('US01', 'USD');
    await postEntry(us, { entry_date: '2026-01-05', lines: [line(us.accounts['110103']!, '1000.00', '0'), line(us.accounts['3101']!, '0', '1000.00')] });
    await postEntry(us, { entry_date: '2026-01-06', lines: [line(us.accounts['110103']!, '200.00', '0'), line(us.accounts['4101']!, '0', '200.00')] });
    await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-01-31', rate_type: 'CLOSING', rate: '0.31' });
    await f.api.post('/gl/exchange-rates', { currency_code: 'USD', rate_date: '2026-01-31', rate_type: 'AVERAGE', rate: '0.30' });
    const group = await f.api.post('/consolidation/groups', { code: 'GRPUS', name_en: 'With US', parent_company_id: f.companyId, presentation_currency: 'KWD', member_company_ids: [us.companyId] });

    const ws = (await f.api.get(`/consolidation/groups/${group.body.id}/worksheet?as_of=2026-01-31`)).body.rows as Row[];
    expect(byCode(ws, '110103')!.cells[`m_${us.companyId}`]).toBe('372.000');
    const is = (await f.api.get(`/consolidation/groups/${group.body.id}/income-statement?from=2026-01-01&to=2026-01-31`)).body;
    expect(byCode(is.rows, '4101')!.cells.current).toBe('3060.000');
    const bs = (await f.api.get(`/consolidation/groups/${group.body.id}/balance-sheet?as_of=2026-01-31`)).body;
    expect(bs.notes[0].en).toBe('The statement balances');
  });
});

describe('cost center hierarchy versions', () => {
  it('reports on the structure saved in a version', async () => {
    await postEntry(f, {
      entry_date: '2026-02-20',
      lines: [line(f.accounts['5302']!, '75.000', '0', { cost_center_id: f.costCenters['103'] }), line(f.accounts['110103']!, '0', '75.000')],
    });
    const version = await f.api.post('/gl/cost-center-versions', { code: 'V2026', name_en: 'Original', effective_date: '2026-01-01' });
    expect(version.status).toBe(201);
    const header = await f.api.post('/gl/cost-centers', { code: '2', name_en: 'Field operations', is_posting: false });
    const ops = (await f.api.get('/gl/cost-centers')).body.find((c: { code: string }) => c.code === '103');
    await f.api.put(`/gl/cost-centers/${ops.id}`, { ...ops, parent_id: header.body.id });

    const q = `from_period_id=${period(f, '2026-01')}&to_period_id=${period(f, '2026-02')}`;
    const current = (await f.api.get(`/gl/reports/cost-center-summary?${q}`)).body.rows as Row[];
    const old = (await f.api.get(`/gl/reports/cost-center-summary?${q}&hierarchy_version_id=${version.body.id}`)).body.rows as Row[];
    const expense = (rows: Row[], code: string) => toMoney(byCode(rows, code)!.cells.expense as string);
    expect(expense(old, '1').minus(expense(current, '1')).toFixed(3)).toBe('75.000');
    expect(expense(current, '2').toFixed(3)).toBe('75.000');
    expect(byCode(old, '2')).toBeUndefined();
  });
});

describe('security', () => {
  it('requires a TOTP code once two-factor authentication is enabled', async () => {
    const me = await f.api.get('/auth/me');
    const email: string = me.body.user.email;
    const setup = await f.api.post('/auth/mfa/setup');
    expect(setup.body.otpauth_url).toContain('otpauth://totp/');
    expect((await f.api.post('/auth/mfa/enable', { code: '000000' })).body.error.code).toBe('MFA_INVALID');
    expect((await f.api.post('/auth/mfa/enable', { code: totp(setup.body.secret) })).body.mfa_enabled).toBe(true);

    const login = (body: Record<string, string>) => request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'correct-horse-battery', ...body });
    expect((await login({})).body.error.code).toBe('MFA_REQUIRED');
    expect((await login({ otp: '123456' })).status).toBe(401);
    const ok = await login({ otp: totp(setup.body.secret) });
    expect(ok.status).toBe(200);

    expect((await client(app, ok.body.token).get('/admin/users')).body.find((u: { email: string }) => u.email === email).mfa_enabled).toBe(true);
    await f.api.post(`/admin/users/${me.body.user.id}/mfa-reset`);
    expect((await login({})).status).toBe(200);
  });

  it('exports the tenant without secrets', async () => {
    const res = await f.api.get('/admin/export');
    expect(res.status).toBe(200);
    expect(res.body.data['gl.journal_entries'].length).toBeGreaterThan(5);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('password_hash');
    expect(text).not.toContain('mfa_secret');
  });
});
