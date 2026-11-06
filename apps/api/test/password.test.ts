import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MailService } from '../src/common/mail.service';
import { config } from '../src/config';
import { client, createApp, type Fixture, signupTenant } from './helpers';

let app: INestApplication;
let mail: MailService;
const PASSWORD = 'correct-horse-battery';

const http = () => request(app.getHttpServer());
const login = (email: string, password: string) => http().post('/api/auth/login').send({ email, password });
const emailOf = async (f: Fixture) => (await f.api.get('/auth/me')).body.user.email as string;
const linkToken = (text: string) => /reset-password\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
/** JWTs carry whole-second issue times: wait for the next second so a new token is distinguishable. */
const nextSecond = () => new Promise((r) => setTimeout(r, 1100));

beforeAll(async () => {
  app = await createApp();
  mail = app.get(MailService);
});

afterAll(async () => {
  config.smtpUrl = 'json';
  await app.close();
});

describe('forgotten password', () => {
  it('answers the same for unknown addresses and sends nothing', async () => {
    const before = mail.outbox.length;
    const res = await http().post('/api/auth/password/forgot').send({ email: `nobody-${randomUUID()}@example.com` });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mail.outbox.length).toBe(before);
    expect((await http().get('/api/auth/config')).body.password_reset).toBe(true);
  });

  it('e-mails a one-time link that sets a new password and ends old sessions', async () => {
    const f = await signupTenant(app);
    const email = await emailOf(f);
    await nextSecond();
    expect((await http().post('/api/auth/password/forgot').send({ email: email.toUpperCase(), locale: 'en' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    const message = mail.outbox.at(-1)!;
    expect(message.to).toBe(email);
    expect(message.subject).toContain('Reset your');
    expect(message.html).toContain('dir="rtl"');
    const token = linkToken(message.text);
    expect(token.length).toBeGreaterThan(30);

    // A second request within a minute sends nothing new.
    const count = mail.outbox.length;
    await http().post('/api/auth/password/forgot').send({ email });
    await new Promise((r) => setTimeout(r, 50));
    expect(mail.outbox.length).toBe(count);

    expect((await http().post('/api/auth/password/check').send({ token })).body.valid).toBe(true);
    expect((await http().post('/api/auth/password/reset').send({ token: 'x'.repeat(43), new_password: 'brand-new-password-1' })).body.error.code).toBe('PASSWORD_RESET_INVALID');
    expect((await http().post('/api/auth/password/reset').send({ token, new_password: 'short' })).status).toBe(400);
    expect((await http().post('/api/auth/password/reset').send({ token, new_password: 'brand-new-password-1' })).status).toBe(200);
    expect((await http().post('/api/auth/password/reset').send({ token, new_password: 'another-password-22' })).body.error.code).toBe('PASSWORD_RESET_INVALID');
    expect((await http().post('/api/auth/password/check').send({ token })).body.valid).toBe(false);

    expect((await f.api.get('/auth/me')).status).toBe(401);
    expect((await login(email, PASSWORD)).status).toBe(401);
    const fresh = await login(email, 'brand-new-password-1');
    expect(fresh.status).toBe(200);
    expect((await client(app, fresh.body.token).get('/auth/me')).status).toBe(200);
  });

  it('reports the feature unavailable without SMTP', async () => {
    config.smtpUrl = undefined;
    try {
      expect((await http().get('/api/auth/config')).body.password_reset).toBe(false);
      const res = await http().post('/api/auth/password/forgot').send({ email: 'someone@example.com' });
      expect(res.status).toBe(503);
      expect(res.body.error.code).toBe('PASSWORD_RESET_UNAVAILABLE');
    } finally {
      config.smtpUrl = 'json';
    }
  });
});

describe('changing your password', () => {
  it('checks the current password and keeps only the new session', async () => {
    const f = await signupTenant(app);
    const email = await emailOf(f);
    expect((await f.api.post('/auth/password', { current_password: 'wrong-password', new_password: 'changed-password-1' })).body.error.code).toBe('CURRENT_PASSWORD_INVALID');
    expect((await f.api.post('/auth/password', { current_password: PASSWORD, new_password: PASSWORD })).status).toBe(400);
    await nextSecond();
    const res = await f.api.post('/auth/password', { current_password: PASSWORD, new_password: 'changed-password-1' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await f.api.get('/auth/me')).status).toBe(401);
    expect((await client(app, res.body.token).get('/auth/me')).status).toBe(200);
    expect((await login(email, 'changed-password-1')).status).toBe(200);
  });
});

describe('administrator reset', () => {
  it('sets a temporary password that must be changed at the next sign-in', async () => {
    const owner = await signupTenant(app);
    const roles = (await owner.api.get('/admin/roles')).body as { id: string; code: string }[];
    const email = `member-${randomUUID()}@example.com`;
    const invited = await owner.api.post('/admin/users', { email, full_name: 'Member', role_id: roles.find((r) => r.code === 'ACCOUNTANT')!.id, password: 'member-password-1' });
    expect(invited.status).toBe(201);
    const memberSession = await login(email, 'member-password-1');
    expect(memberSession.body.password_change_required).toBe(false);
    await nextSecond();

    const me = (await owner.api.get('/auth/me')).body.user.id as string;
    expect((await owner.api.post(`/admin/users/${me}/reset-password`)).status).toBe(400);
    const reset = await owner.api.post(`/admin/users/${invited.body.user_id}/reset-password`);
    expect(reset.status, JSON.stringify(reset.body)).toBe(200);
    const temporary = reset.body.temporary_password as string;
    expect(temporary.length).toBeGreaterThanOrEqual(10);

    expect((await client(app, memberSession.body.token).get('/auth/me')).status).toBe(401);
    const signedIn = await login(email, temporary);
    expect(signedIn.body.password_change_required).toBe(true);
    const member = client(app, signedIn.body.token, owner.companyId);
    expect((await member.get('/gl/accounts')).body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await member.get('/auth/me')).status).toBe(200);
    await nextSecond();
    const changed = await member.post('/auth/password', { current_password: temporary, new_password: 'member-password-2' });
    expect(changed.status).toBe(200);
    expect((await client(app, changed.body.token, owner.companyId).get('/gl/accounts')).status).toBe(200);
  });

  it('refuses users who also belong to another organisation', async () => {
    const a = await signupTenant(app);
    const b = await signupTenant(app);
    const email = await emailOf(b);
    const roles = (await a.api.get('/admin/roles')).body as { id: string; code: string }[];
    const invited = await a.api.post('/admin/users', { email, full_name: 'Shared', role_id: roles.find((r) => r.code === 'VIEWER')!.id });
    expect(invited.status).toBe(201);
    const res = await a.api.post(`/admin/users/${invited.body.user_id}/reset-password`);
    expect(res.body.error.code).toBe('USER_IN_OTHER_TENANTS');
  });
});
