import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { client, createApp, type Fixture, signupTenant } from './helpers';

let app: INestApplication;
let platform: ReturnType<typeof client>;
let tenantFixture: Fixture;
const adminEmail = `platform-${randomUUID()}@example.com`;
const adminPassword = 'platform-password-123';

const login = (email: string, password: string) => request(app.getHttpServer()).post('/api/auth/login').send({ email, password });

/** Platform admins are granted with the owner connection, as the CLI does. */
const grantPlatformAdmin = async (email: string, password: string) => {
  const owner = new Client({ connectionString: config.migrationDatabaseUrl });
  await owner.connect();
  try {
    const id = randomUUID();
    await owner.query('INSERT INTO core.users (id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)', [id, email, await hash(password), 'Operator']);
    await owner.query('INSERT INTO core.platform_admins (user_id) VALUES ($1)', [id]);
  } finally {
    await owner.end();
  }
};

const newTenant = (overrides: Record<string, unknown> = {}) => ({
  name: 'Gulf Contracting',
  plan_code: 'standard',
  max_companies: 2,
  max_users: 3,
  company: { code: 'GC01', name_en: 'Gulf Contracting Co.', name_ar: 'شركة الخليج للمقاولات', first_fiscal_year: 2026 },
  admin: { email: `owner-${randomUUID()}@example.com`, full_name: 'Gulf Owner' },
  ...overrides,
});

beforeAll(async () => {
  app = await createApp();
  await grantPlatformAdmin(adminEmail, adminPassword);
  const res = await login(adminEmail, adminPassword);
  expect(res.status).toBe(200);
  expect(res.body.platform).toBe(true);
  platform = client(app, res.body.token);
  tenantFixture = await signupTenant(app);
});

afterAll(async () => {
  config.publicSignup = true;
  await app.close();
});

describe('platform console', () => {
  it('keeps platform and tenant sessions apart', async () => {
    expect((await platform.get('/auth/me')).status).toBe(401);
    expect((await platform.get('/admin/companies')).status).toBe(401);
    expect((await tenantFixture.api.get('/platform/tenants')).status).toBe(401);
    expect((await platform.get('/platform/me')).body.user.email).toBe(adminEmail);
  });

  it('creates a tenant whose administrator can sign in with the temporary password', async () => {
    const input = newTenant();
    const created = await platform.post('/platform/tenants', input);
    expect(created.status).toBe(201);
    expect(created.body.temporary_password).toMatch(/.{10,}/);

    const session = await login(input.admin.email, created.body.temporary_password);
    expect(session.status).toBe(200);
    expect(session.body.tenantId).toBe(created.body.tenant_id);
    const me = await client(app, session.body.token).get('/auth/me');
    expect(me.body.tenant.name).toBe('Gulf Contracting');
    expect(me.body.companies.map((c: { code: string }) => c.code)).toEqual(['GC01']);
    expect(me.body.permissions).toContain('admin.tenant');

    const list = await platform.get('/platform/tenants');
    const row = list.body.find((t: { id: string }) => t.id === created.body.tenant_id);
    expect(row).toMatchObject({ name: 'Gulf Contracting', max_users: 3, company_count: 1, user_count: 1, is_active: true });

    const audit = await client(app, session.body.token).get('/admin/audit?entity_type=tenant');
    expect(audit.body.some((a: { action: string }) => a.action === 'platform_create_tenant')).toBe(true);
  });

  it('adds an existing user as administrator of a further tenant without changing their password', async () => {
    const me = await tenantFixture.api.get('/auth/me');
    const created = await platform.post('/platform/tenants', newTenant({ name: 'Second Org', admin: { email: me.body.user.email, full_name: 'ignored' } }));
    expect(created.status).toBe(201);
    expect(created.body.admin_created).toBe(false);
    expect(created.body.temporary_password).toBeNull();
    const session = await login(me.body.user.email, 'correct-horse-battery');
    expect(session.body.tenants.map((t: { tenant_id: string }) => t.tenant_id)).toContain(created.body.tenant_id);
  });

  it('refuses to make a platform administrator a tenant member', async () => {
    expect((await platform.post('/platform/tenants', newTenant({ admin: { email: adminEmail, full_name: 'Someone' } }))).body.error.code).toBe('PLATFORM_ADMIN_ACCOUNT');
    const roles = await tenantFixture.api.get('/admin/roles');
    const invite = await tenantFixture.api.post('/admin/users', { email: adminEmail, full_name: 'Someone', role_id: roles.body[0].id });
    expect(invite.body.error.code).toBe('PLATFORM_ADMIN_ACCOUNT');
  });

  it('suspends a tenant, which blocks sign-in and existing sessions, and reactivates it', async () => {
    const input = newTenant({ admin: { email: `s-${randomUUID()}@example.com`, full_name: 'Suspended Owner', password: 'tenant-password-1' } });
    const created = await platform.post('/platform/tenants', input);
    const session = await login(input.admin.email, 'tenant-password-1');
    const tenantApi = client(app, session.body.token);
    expect((await tenantApi.get('/auth/me')).status).toBe(200);

    expect((await platform.patch(`/platform/tenants/${created.body.tenant_id}`, { is_active: false })).status).toBe(200);
    expect((await tenantApi.get('/auth/me')).status).toBe(401);
    expect((await login(input.admin.email, 'tenant-password-1')).status).toBe(401);

    await platform.patch(`/platform/tenants/${created.body.tenant_id}`, { is_active: true, max_companies: 1 });
    const again = client(app, (await login(input.admin.email, 'tenant-password-1')).body.token);
    const extra = await again.post('/admin/companies', { code: 'GC02', name_en: 'Second', name_ar: 'ثانية', base_currency: 'KWD', first_fiscal_year: 2026 });
    expect(extra.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('resets a member password and 2FA for support', async () => {
    const input = newTenant({ admin: { email: `r-${randomUUID()}@example.com`, full_name: 'Locked Out', password: 'forgotten-password' } });
    const created = await platform.post('/platform/tenants', input);
    const detail = await platform.get(`/platform/tenants/${created.body.tenant_id}`);
    expect(detail.body.members).toHaveLength(1);
    expect(detail.body.companies[0].code).toBe('GC01');

    const reset = await platform.post(`/platform/tenants/${created.body.tenant_id}/users/${created.body.admin_user_id}/reset-credentials`, { reset_mfa: true });
    expect(reset.status).toBe(200);
    expect((await login(input.admin.email, 'forgotten-password')).status).toBe(401);
    expect((await login(input.admin.email, reset.body.temporary_password)).status).toBe(200);

    // The user must belong to the tenant named in the URL.
    const other = await platform.post(`/platform/tenants/${tenantFixture.tenantId}/users/${created.body.admin_user_id}/reset-credentials`, {});
    expect(other.status).toBe(404);
  });

  it('closes public sign-up when configured', async () => {
    config.publicSignup = false;
    const cfg = await request(app.getHttpServer()).get('/api/auth/config');
    expect(cfg.body).toEqual({ signup: false });
    await expect(signupTenant(app)).rejects.toThrow(/SIGNUP_DISABLED/);
    config.publicSignup = true;
  });

  it('denies the application role direct access to the platform admin list', async () => {
    const appRole = new Client({ connectionString: config.databaseUrl });
    await appRole.connect();
    try {
      await expect(appRole.query('SELECT * FROM core.platform_admins')).rejects.toThrow(/permission denied/);
      await expect(appRole.query('SELECT * FROM core.platform_tenants()')).rejects.toThrow(/FORBIDDEN/);
    } finally {
      await appRole.end();
    }
  });
});
