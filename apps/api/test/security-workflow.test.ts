import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createApp, type Fixture, line, postEntry, signupTenant } from './helpers';

let app: INestApplication;
let a: Fixture;
let b: Fixture;
let db: Client;

beforeAll(async () => {
  app = await createApp();
  a = await signupTenant(app);
  b = await signupTenant(app, { tenantName: 'Other tenant', companyCode: 'OTHER' });
  db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
});

afterAll(async () => {
  await db.end();
  await app.close();
});

/** Runs SQL as the application role inside a tenant context, like the API does. */
const asTenant = async <T>(tenantId: string, fn: () => Promise<T>): Promise<T> => {
  await db.query('BEGIN');
  await db.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
  try {
    return await fn();
  } finally {
    await db.query('ROLLBACK');
  }
};

describe('tenant isolation', () => {
  it('rejects another tenant’s company id', async () => {
    const res = await b.api.withCompany(a.companyId).get('/gl/accounts');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('COMPANY_REQUIRED');
  });

  it('cannot read another tenant’s rows even with direct SQL', async () => {
    const visible = await asTenant(b.tenantId, () => db.query('SELECT count(*)::int AS n FROM gl.accounts WHERE company_id = $1', [a.companyId]));
    expect(visible.rows[0].n).toBe(0);
    const own = await asTenant(b.tenantId, () => db.query('SELECT count(*)::int AS n FROM gl.accounts'));
    expect(own.rows[0].n).toBeGreaterThan(100);
    const noContext = await db.query('SELECT count(*)::int AS n FROM gl.accounts');
    expect(noContext.rows[0].n).toBe(0);
  });

  it('cannot insert rows for another tenant', async () => {
    await expect(
      asTenant(b.tenantId, () =>
        db.query(`INSERT INTO gl.dimension_types (tenant_id, company_id, code, name_en) VALUES ($1, $2, 'X', 'X')`, [a.tenantId, a.companyId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('cannot reference another tenant’s account from a journal line', async () => {
    const res = await b.api.post('/gl/journals', {
      journal_type_id: b.journalTypes.JV,
      entry_date: '2026-01-05',
      lines: [line(a.accounts['110101']!, '1.000', '0'), line(b.accounts['3101']!, '0', '1.000')],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('database-level immutability', () => {
  it('refuses UPDATE/DELETE of posted lines and headers even with direct SQL', async () => {
    const posted = await postEntry(a, {
      entry_date: '2026-01-05',
      lines: [line(a.accounts['110101']!, '10.000', '0'), line(a.accounts['3101']!, '0', '10.000')],
    });
    await expect(asTenant(a.tenantId, () => db.query('UPDATE gl.journal_lines SET debit = 999 WHERE entry_id = $1', [posted.id]))).rejects.toThrow(/POSTED_IMMUTABLE/);
    await expect(asTenant(a.tenantId, () => db.query('DELETE FROM gl.journal_lines WHERE entry_id = $1', [posted.id]))).rejects.toThrow(/POSTED_IMMUTABLE/);
    await expect(asTenant(a.tenantId, () => db.query("UPDATE gl.journal_entries SET description = 'x' WHERE id = $1", [posted.id]))).rejects.toThrow(/POSTED_IMMUTABLE/);
    await expect(asTenant(a.tenantId, () => db.query('DELETE FROM gl.journal_entries WHERE id = $1', [posted.id]))).rejects.toThrow(/POSTED_IMMUTABLE/);
  });

  it('keeps the audit log append-only for the application role', async () => {
    await expect(asTenant(a.tenantId, () => db.query('DELETE FROM core.audit_log'))).rejects.toThrow(/permission denied/);
    await expect(asTenant(a.tenantId, () => db.query("UPDATE core.audit_log SET action = 'x'"))).rejects.toThrow(/permission denied/);
  });
});

describe('approval workflow', () => {
  it('requires submit → approve (by someone else) → post when the company demands approval', async () => {
    const companies = await a.api.get('/admin/companies');
    const company = companies.body[0];
    const updated = await a.api.put(`/admin/companies/${a.companyId}`, { ...company, require_approval: true });
    expect(updated.status).toBe(200);

    const draft = await a.api.post('/gl/journals', {
      journal_type_id: a.journalTypes.JV,
      entry_date: '2026-01-21',
      lines: [line(a.accounts['110101']!, '20.000', '0'), line(a.accounts['3101']!, '0', '20.000')],
    });
    expect((await a.api.post(`/gl/journals/${draft.body.id}/post`)).body.error.code).toBe('JOURNAL_APPROVAL_REQUIRED');
    expect((await a.api.post(`/gl/journals/${draft.body.id}/submit`)).body.status).toBe('SUBMITTED');
    expect((await a.api.post(`/gl/journals/${draft.body.id}/approve`)).body.error.code).toBe('JOURNAL_SELF_APPROVAL');

    const roles = await a.api.get('/admin/roles');
    const chief = roles.body.find((r: { code: string }) => r.code === 'CHIEF_ACCOUNTANT');
    const invite = await a.api.post('/admin/users', { email: `chief-${Date.now()}@example.com`, full_name: 'Chief', role_id: chief.id, password: 'another-long-password' });
    expect(invite.status).toBe(201);

    const members = await a.api.get('/admin/users');
    const chiefMember = members.body.find((m: { user_id: string }) => m.user_id === invite.body.user_id);
    const session = await request(app.getHttpServer()).post('/api/auth/login').send({ email: chiefMember.email, password: 'another-long-password' });
    expect(session.status).toBe(200);
    const chiefApi = client(app, session.body.token, a.companyId);

    const approved = await chiefApi.post(`/gl/journals/${draft.body.id}/approve`);
    expect(approved.body.status).toBe('APPROVED');
    const posted = await chiefApi.post(`/gl/journals/${draft.body.id}/post`);
    expect(posted.body.status).toBe('POSTED');

    await a.api.put(`/admin/companies/${a.companyId}`, { ...company, require_approval: false });
  });

  it('enforces role permissions', async () => {
    const roles = await a.api.get('/admin/roles');
    const viewer = roles.body.find((r: { code: string }) => r.code === 'VIEWER');
    const email = `viewer-${Date.now()}@example.com`;
    await a.api.post('/admin/users', { email, full_name: 'Viewer', role_id: viewer.id, password: 'viewer-long-password' });
    const session = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'viewer-long-password' });
    const viewerApi = client(app, session.body.token, a.companyId);
    expect((await viewerApi.get('/gl/accounts')).status).toBe(200);
    const denied = await viewerApi.post('/gl/journals', {
      journal_type_id: a.journalTypes.JV,
      entry_date: '2026-01-21',
      lines: [line(a.accounts['110101']!, '1.000', '0'), line(a.accounts['3101']!, '0', '1.000')],
    });
    expect(denied.status).toBe(403);
    expect((await viewerApi.get('/admin/users')).status).toBe(403);
  });
});

describe('cost center scope', () => {
  it('limits a scoped user to their cost center subtree', async () => {
    const roles = await a.api.get('/admin/roles');
    const accountant = roles.body.find((r: { code: string }) => r.code === 'ACCOUNTANT');
    const email = `sales-${Date.now()}@example.com`;
    await a.api.post('/admin/users', { email, full_name: 'Sales accountant', role_id: accountant.id, password: 'sales-long-password', cost_center_scope: [a.costCenters['102']] });
    const session = await request(app.getHttpServer()).post('/api/auth/login').send({ email, password: 'sales-long-password' });
    const scoped = client(app, session.body.token, a.companyId);

    const ccs = await scoped.get('/gl/cost-centers');
    expect(ccs.body.map((c: { code: string }) => c.code)).toEqual(['102']);

    const draft = await scoped.post('/gl/journals', {
      journal_type_id: a.journalTypes.JV,
      entry_date: '2026-01-22',
      lines: [line(a.accounts['5401']!, '15.000', '0', { cost_center_id: a.costCenters['101'] }), line(a.accounts['110101']!, '0', '15.000')],
    });
    const submit = await scoped.post(`/gl/journals/${draft.body.id}/submit`);
    expect(submit.body.error.code).toBe('OUT_OF_SCOPE');

    const bs = await scoped.get(`/gl/reports/balance-sheet?period_id=${a.periods[0]!.id}`);
    expect(bs.status).toBe(403);
  });
});

describe('authentication', () => {
  it('rejects bad credentials and missing tokens', async () => {
    const bad = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'whatever' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('INVALID_CREDENTIALS');
    const anon = await request(app.getHttpServer()).get('/api/gl/accounts');
    expect(anon.status).toBe(401);
  });

  it('rejects a duplicate signup email', async () => {
    const members = await a.api.get('/admin/users');
    const res = await request(app.getHttpServer()).post('/api/auth/signup').send({
      tenantName: 'Dup', companyCode: 'D', firstFiscalYear: 2026, fullName: 'Dup User', email: members.body[0].email, password: 'long-enough-password',
    });
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});
