import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { LoginInput, SignupInput } from '@erp/shared';
import type { z } from 'zod';
import type { userPreferencesSchema } from '@erp/shared';
import { AppError } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { RequestContext } from '../common/request-context';
import { TokenService } from '../common/token.service';
import { decryptSecret, encryptSecret, generateSecret, otpauthUrl, verifyTotp } from '../common/totp';
import { DbService } from '../db/db.service';
import { ProvisioningService } from './provisioning.service';

type TenantSummary = { tenant_id: string; tenant_name: string };
export type Session = { token: string; tenantId: string; tenants: TenantSummary[] };

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so response timing does not reveal registered emails. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: DbService,
    private readonly tokens: TokenService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
  ) {}

  hashPassword(password: string): Promise<string> {
    return hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  /** Creates a tenant, its first company (with Kuwait template), system roles and the admin user. */
  async signup(input: SignupInput, ip: string): Promise<Session> {
    const existing = await this.db.withoutTenant((tx) => tx.maybeOne<{ id: string }>('SELECT core.find_user_id($1) AS id', [input.email]));
    if (existing?.id) throw new AppError('EMAIL_TAKEN');

    const passwordHash = await this.hashPassword(input.password);
    const tenantId = randomUUID();
    const userId = randomUUID();

    await this.db.withTenant({ tenantId, userId }, async (tx) => {
      await tx.query('INSERT INTO core.users (id, email, password_hash, full_name, preferred_locale) VALUES ($1, $2, $3, $4, $5)', [
        userId,
        input.email,
        passwordHash,
        input.fullName,
        input.locale,
      ]);
      await tx.query('INSERT INTO core.tenants (id, name) VALUES ($1, $2)', [tenantId, input.tenantName]);
      const roles = await this.provisioning.createSystemRoles(tx, tenantId);
      await tx.query('INSERT INTO core.tenant_users (tenant_id, user_id, role_id) VALUES ($1, $2, $3)', [tenantId, userId, roles.ADMIN]);
      const company = await this.provisioning.createCompany(tx, tenantId, {
        code: input.companyCode,
        name_ar: input.companyNameAr || input.tenantName,
        name_en: input.companyNameEn || input.tenantName,
        base_currency: input.baseCurrency,
        fiscal_year_start_month: input.fiscalYearStartMonth,
        first_fiscal_year: input.firstFiscalYear,
        seed_chart_of_accounts: input.seedChartOfAccounts,
      });
      await this.audit.record(tx, { tenantId, userId, ip }, { action: 'signup', entityType: 'tenant', entityId: tenantId, companyId: company.id });
    });

    return { token: this.tokens.sign({ sub: userId, tid: tenantId }), tenantId, tenants: [{ tenant_id: tenantId, tenant_name: input.tenantName }] };
  }

  async login(input: LoginInput, ip: string): Promise<Session> {
    const user = await this.db.withoutTenant((tx) =>
      tx.maybeOne<{ user_id: string; password_hash: string; is_active: boolean; mfa_enabled: boolean; mfa_secret: string | null }>(
        'SELECT * FROM core.auth_lookup($1)',
        [input.email],
      ),
    );
    this.dummyHash ??= this.hashPassword(randomUUID());
    const valid = await verify(user?.password_hash ?? (await this.dummyHash), input.password).catch(() => false);
    if (!user || !valid || !user.is_active) throw new AppError('INVALID_CREDENTIALS');
    if (user.mfa_enabled && user.mfa_secret) {
      if (!input.otp) throw new AppError('MFA_REQUIRED');
      if (!verifyTotp(decryptSecret(user.mfa_secret), input.otp)) throw new AppError('MFA_INVALID');
    }

    const tenants = await this.tenantsOf(user.user_id);
    const tenant = input.tenantId ? tenants.find((t) => t.tenant_id === input.tenantId) : tenants[0];
    if (!tenant) throw new AppError('INVALID_CREDENTIALS');

    await this.db.withTenant({ tenantId: tenant.tenant_id, userId: user.user_id }, async (tx) => {
      await tx.query('UPDATE core.users SET last_login_at = now() WHERE id = $1', [user.user_id]);
      await this.audit.record(tx, { tenantId: tenant.tenant_id, userId: user.user_id, ip }, { action: 'login', entityType: 'user', entityId: user.user_id });
    });
    return { token: this.tokens.sign({ sub: user.user_id, tid: tenant.tenant_id }), tenantId: tenant.tenant_id, tenants };
  }

  async switchTenant(userId: string, tenantId: string): Promise<Session> {
    const tenants = await this.tenantsOf(userId);
    if (!tenants.some((t) => t.tenant_id === tenantId)) throw new AppError('FORBIDDEN');
    return { token: this.tokens.sign({ sub: userId, tid: tenantId }), tenantId, tenants };
  }

  async me(ctx: RequestContext) {
    const tenants = await this.tenantsOf(ctx.userId);
    return this.db.withTenant(ctx, async (tx) => {
      const user = await tx.one('SELECT id, email, full_name, preferred_locale, digit_style, mfa_enabled FROM core.users WHERE id = $1', [ctx.userId]);
      const tenant = await tx.one('SELECT id, name, plan_code FROM core.tenants WHERE id = $1', [ctx.tenantId]);
      const companies = await tx.query(
        `SELECT c.id, c.code, c.name_ar, c.name_en, c.base_currency, cur.minor_units AS base_minor_units, c.require_approval, c.is_active
         FROM core.companies c JOIN core.currencies cur ON cur.code = c.base_currency
         WHERE c.is_active ORDER BY c.code`,
      );
      return {
        user,
        tenant,
        tenants,
        companies,
        permissions: [...ctx.permissions],
        cost_center_scope: ctx.costCenterScope,
      };
    });
  }

  updatePreferences(ctx: RequestContext, input: z.infer<typeof userPreferencesSchema>) {
    return this.db.withTenant(ctx, (tx) =>
      tx.one(
        `UPDATE core.users SET preferred_locale = COALESCE($2, preferred_locale), digit_style = COALESCE($3, digit_style),
           full_name = COALESCE($4, full_name)
         WHERE id = $1 RETURNING id, email, full_name, preferred_locale, digit_style`,
        [ctx.userId, input.preferred_locale ?? null, input.digit_style ?? null, input.full_name ?? null],
      ),
    );
  }

  /** Starts enrolment: stores a new (not yet active) secret and returns it for the authenticator app. */
  setupMfa(ctx: RequestContext) {
    return this.db.withTenant(ctx, async (tx) => {
      const user = await tx.one<{ email: string; mfa_enabled: boolean }>('SELECT email, mfa_enabled FROM core.users WHERE id = $1', [ctx.userId]);
      if (user.mfa_enabled) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'mfa', message: 'Two-factor authentication is already enabled' }]);
      const secret = generateSecret();
      await tx.query('UPDATE core.users SET mfa_secret = $2 WHERE id = $1', [ctx.userId, encryptSecret(secret)]);
      return { secret, otpauth_url: otpauthUrl(secret, user.email) };
    });
  }

  enableMfa(ctx: RequestContext, code: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const user = await tx.one<{ mfa_secret: string | null }>('SELECT mfa_secret FROM core.users WHERE id = $1', [ctx.userId]);
      if (!user.mfa_secret || !verifyTotp(decryptSecret(user.mfa_secret), code)) throw new AppError('MFA_INVALID');
      await tx.query('UPDATE core.users SET mfa_enabled = true WHERE id = $1', [ctx.userId]);
      await this.audit.record(tx, ctx, { action: 'mfa_enable', entityType: 'user', entityId: ctx.userId });
      return { mfa_enabled: true };
    });
  }

  disableMfa(ctx: RequestContext, code: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const user = await tx.one<{ mfa_secret: string | null; mfa_enabled: boolean }>('SELECT mfa_secret, mfa_enabled FROM core.users WHERE id = $1', [ctx.userId]);
      if (!user.mfa_enabled || !user.mfa_secret || !verifyTotp(decryptSecret(user.mfa_secret), code)) throw new AppError('MFA_INVALID');
      await tx.query('UPDATE core.users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1', [ctx.userId]);
      await this.audit.record(tx, ctx, { action: 'mfa_disable', entityType: 'user', entityId: ctx.userId });
      return { mfa_enabled: false };
    });
  }

  private tenantsOf(userId: string): Promise<TenantSummary[]> {
    return this.db.withoutTenant((tx) => tx.query<TenantSummary>('SELECT * FROM core.user_tenants($1)', [userId]));
  }
}
