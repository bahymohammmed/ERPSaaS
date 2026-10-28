import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

export type Api = ReturnType<typeof client>;

export const createApp = async (): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  await app.init();
  return app;
};

/** Thin authenticated client bound to one tenant/company. */
export const client = (app: INestApplication, token: string, companyId?: string) => {
  const http = request(app.getHttpServer());
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${token}`,
    ...(companyId ? { 'X-Company-Id': companyId } : {}),
    ...extra,
  });
  return {
    get: (url: string) => http.get(`/api${url}`).set(headers()),
    post: (url: string, body?: unknown) => http.post(`/api${url}`).set(headers()).send(body as object),
    put: (url: string, body?: unknown) => http.put(`/api${url}`).set(headers()).send(body as object),
    patch: (url: string, body?: unknown) => http.patch(`/api${url}`).set(headers()).send(body as object),
    delete: (url: string) => http.delete(`/api${url}`).set(headers()),
    withCompany: (id: string) => client(app, token, id),
  };
};

export type Fixture = {
  api: Api;
  token: string;
  tenantId: string;
  userId: string;
  companyId: string;
  accounts: Record<string, string>;
  costCenters: Record<string, string>;
  journalTypes: Record<string, string>;
  periods: { id: string; code: string; period_no: number }[];
};

export const signupTenant = async (app: INestApplication, overrides: Record<string, unknown> = {}): Promise<Fixture> => {
  const email = `owner-${randomUUID()}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/api/auth/signup')
    .send({
      tenantName: 'شركة الاختبار',
      companyCode: 'KW01',
      companyNameAr: 'شركة الاختبار للتجارة',
      companyNameEn: 'Test Trading Co.',
      baseCurrency: 'KWD',
      firstFiscalYear: 2026,
      fullName: 'Test Owner',
      email,
      password: 'correct-horse-battery',
      ...overrides,
    });
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  const token: string = res.body.token;
  const me = await client(app, token).get('/auth/me');
  const companyId: string = me.body.companies[0].id;
  const api = client(app, token, companyId);
  const [accounts, ccs, jts, periods] = await Promise.all([
    api.get('/gl/accounts'),
    api.get('/gl/cost-centers'),
    api.get('/gl/journal-types'),
    api.get('/gl/periods'),
  ]);
  const byCode = (rows: { code: string; id: string }[]) => Object.fromEntries(rows.map((r) => [r.code, r.id]));
  return {
    api,
    token,
    tenantId: res.body.tenantId,
    userId: me.body.user.id,
    companyId,
    accounts: byCode(accounts.body),
    costCenters: byCode(ccs.body),
    journalTypes: byCode(jts.body),
    periods: periods.body,
  };
};

export const line = (account: string, debit: string, credit: string, extra: Record<string, unknown> = {}) => ({ account_id: account, debit, credit, ...extra });

/** Creates and posts an entry, asserting success. */
export const postEntry = async (f: Fixture, body: Record<string, unknown>) => {
  const draft = await f.api.post('/gl/journals', { journal_type_id: f.journalTypes.JV, ...body });
  if (draft.status !== 201) throw new Error(`draft failed: ${JSON.stringify(draft.body)}`);
  const posted = await f.api.post(`/gl/journals/${draft.body.id}/post`);
  if (posted.status !== 201) throw new Error(`post failed: ${JSON.stringify(posted.body)}`);
  return posted.body;
};
