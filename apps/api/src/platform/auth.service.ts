import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { BRAND, type LoginInput, type SignupInput } from '@erp/shared';
import type { z } from 'zod';
import type { userPreferencesSchema } from '@erp/shared';
import { AppError } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { MailService } from '../common/mail.service';
import type { RequestContext } from '../common/request-context';
import { TokenService } from '../common/token.service';
import { decryptSecret, encryptSecret, generateSecret, otpauthUrl, verifyTotp } from '../common/totp';
import { config } from '../config';
import { DbService, type Tx } from '../db/db.service';
import { ProvisioningService } from './provisioning.service';

type TenantSummary = { tenant_id: string; tenant_name: string };
/** platform: a platform console session (no tenant). */
export type Session = { token: string; tenantId: string | null; tenants: TenantSummary[]; platform?: boolean; password_change_required?: boolean };
/** Whoever manages their own 2FA: a tenant member, or a platform admin (tenantId null). */
type MfaActor = { userId: string; tenantId: string | null; ip: string };

@Injectable()
export class AuthService {
  /** Verified against when the email is unknown, so response timing does not reveal registered emails. */
  private dummyHash: Promise<string> | null = null;

  constructor(
    private readonly db: DbService,
    private readonly tokens: TokenService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
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
      const { companyId } = await this.provisioning.createTenant(tx, {
        id: tenantId,
        name: input.tenantName,
        admin_user_id: userId,
        company: {
          code: input.companyCode,
          name_ar: input.companyNameAr || input.tenantName,
          name_en: input.companyNameEn || input.tenantName,
          base_currency: input.baseCurrency,
          fiscal_year_start_month: input.fiscalYearStartMonth,
          first_fiscal_year: input.firstFiscalYear,
          seed_chart_of_accounts: input.seedChartOfAccounts,
        },
      });
      await this.audit.record(tx, { tenantId, userId, ip }, { action: 'signup', entityType: 'tenant', entityId: tenantId, companyId });
    });

    return { token: this.tokens.sign({ sub: userId, tid: tenantId }), tenantId, tenants: [{ tenant_id: tenantId, tenant_name: input.tenantName }] };
  }

  async login(input: LoginInput, ip: string): Promise<Session> {
    const user = await this.db.withoutTenant((tx) =>
      tx.maybeOne<{ user_id: string; password_hash: string; is_active: boolean; mfa_enabled: boolean; mfa_secret: string | null; must_change_password: boolean }>(
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

    const platform = await this.db.withoutTenant((tx) => tx.one<{ ok: boolean }>('SELECT core.is_platform_admin($1) AS ok', [user.user_id]));
    if (platform.ok) {
      await this.db.withoutTenant((tx) => tx.query('UPDATE core.users SET last_login_at = now() WHERE id = $1', [user.user_id]), user.user_id);
      return { token: this.tokens.signPlatform(user.user_id), tenantId: null, tenants: [], platform: true };
    }

    const tenants = await this.tenantsOf(user.user_id);
    const tenant = input.tenantId ? tenants.find((t) => t.tenant_id === input.tenantId) : tenants[0];
    if (!tenant) throw new AppError('INVALID_CREDENTIALS');

    await this.db.withTenant({ tenantId: tenant.tenant_id, userId: user.user_id }, async (tx) => {
      await tx.query('UPDATE core.users SET last_login_at = now() WHERE id = $1', [user.user_id]);
      await this.audit.record(tx, { tenantId: tenant.tenant_id, userId: user.user_id, ip }, { action: 'login', entityType: 'user', entityId: user.user_id });
    });
    return { token: this.tokens.sign({ sub: user.user_id, tid: tenant.tenant_id }), tenantId: tenant.tenant_id, tenants, password_change_required: user.must_change_password };
  }

  // ---------------------------------------------------------------- passwords

  /** A signed-in user (tenant member or platform admin) replaces their own password. */
  async changePassword(userId: string, tenantId: string | null, currentPassword: string, newPassword: string, ip: string): Promise<void> {
    const me = await this.db.withoutTenant((tx) => tx.one<{ email: string }>('SELECT email FROM core.users WHERE id = $1', [userId]), userId);
    const user = await this.db.withoutTenant((tx) => tx.maybeOne<{ password_hash: string }>('SELECT password_hash FROM core.auth_lookup($1)', [me.email]));
    const valid = user ? await verify(user.password_hash, currentPassword).catch(() => false) : false;
    if (!valid) throw new AppError('CURRENT_PASSWORD_INVALID');
    const passwordHash = await this.hashPassword(newPassword);
    const write = async (tx: Tx) => {
      await tx.query('UPDATE core.users SET password_hash = $2, password_changed_at = now(), must_change_password = false WHERE id = $1', [userId, passwordHash]);
      if (tenantId) await this.audit.record(tx, { tenantId, userId, ip }, { action: 'password_change', entityType: 'user', entityId: userId });
    };
    if (tenantId) await this.db.withTenant({ tenantId, userId }, write);
    else await this.db.withoutTenant(write, userId);
  }

  get passwordResetAvailable(): boolean {
    return this.mail.enabled;
  }

  /**
   * Starts a reset: e-mails a one-time link if the address belongs to an active user. The answer
   * is the same either way, and the mail is sent in the background, so the response reveals
   * nothing about which addresses are registered.
   */
  async requestPasswordReset(email: string, locale: 'ar' | 'en' | undefined, ip: string): Promise<{ ok: true }> {
    if (!this.mail.enabled) throw new AppError('PASSWORD_RESET_UNAVAILABLE');
    const token = randomBytes(32).toString('base64url');
    const user = await this.db.withoutTenant((tx) =>
      tx.maybeOne<{ user_id: string; email: string; full_name: string; preferred_locale: 'ar' | 'en' }>(
        'SELECT * FROM core.password_reset_request($1, $2, $3, $4)',
        [email, tokenHash(token), config.passwordResetMinutes, ip],
      ),
    );
    if (user) {
      void this.mail.send(resetMail(user.email, user.full_name, locale ?? user.preferred_locale, `${config.appUrl}/reset-password?token=${token}`)).catch(() => undefined);
    }
    return { ok: true };
  }

  async checkPasswordReset(token: string): Promise<{ valid: boolean }> {
    const row = await this.db.withoutTenant((tx) => tx.one<{ valid: boolean }>('SELECT core.password_reset_check($1) AS valid', [tokenHash(token)]));
    return { valid: row.valid };
  }

  /** Sets the new password with a valid link; every existing session of the user ends. */
  async completePasswordReset(token: string, newPassword: string, ip: string): Promise<{ ok: true }> {
    const passwordHash = await this.hashPassword(newPassword);
    const row = await this.db.withoutTenant((tx) => tx.one<{ user_id: string | null }>('SELECT core.password_reset_complete($1, $2) AS user_id', [tokenHash(token), passwordHash]));
    if (!row.user_id) throw new AppError('PASSWORD_RESET_INVALID');
    const userId = row.user_id;
    for (const tenant of await this.tenantsOf(userId)) {
      await this.db.withTenant({ tenantId: tenant.tenant_id, userId }, (tx) =>
        this.audit.record(tx, { tenantId: tenant.tenant_id, userId, ip }, { action: 'password_reset', entityType: 'user', entityId: userId }),
      );
    }
    return { ok: true };
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
      const tenant = await tx.one(
        `SELECT t.id, t.name, t.plan_code, p.name_ar AS plan_name_ar, p.name_en AS plan_name_en
         FROM core.tenants t LEFT JOIN core.plans p ON p.code = t.plan_code WHERE t.id = $1`,
        [ctx.tenantId],
      );
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
        features: [...ctx.features],
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
  setupMfa(ctx: MfaActor) {
    return this.asActor(ctx, async (tx) => {
      const user = await tx.one<{ email: string; mfa_enabled: boolean }>('SELECT email, mfa_enabled FROM core.users WHERE id = $1', [ctx.userId]);
      if (user.mfa_enabled) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'mfa', message: 'Two-factor authentication is already enabled' }]);
      const secret = generateSecret();
      await tx.query('UPDATE core.users SET mfa_secret = $2 WHERE id = $1', [ctx.userId, encryptSecret(secret)]);
      return { secret, otpauth_url: otpauthUrl(secret, user.email) };
    });
  }

  enableMfa(ctx: MfaActor, code: string) {
    return this.asActor(ctx, async (tx) => {
      const user = await tx.one<{ mfa_secret: string | null }>('SELECT mfa_secret FROM core.users WHERE id = $1', [ctx.userId]);
      if (!user.mfa_secret || !verifyTotp(decryptSecret(user.mfa_secret), code)) throw new AppError('MFA_INVALID');
      await tx.query('UPDATE core.users SET mfa_enabled = true WHERE id = $1', [ctx.userId]);
      await this.auditActor(tx, ctx, 'mfa_enable');
      return { mfa_enabled: true };
    });
  }

  disableMfa(ctx: MfaActor, code: string) {
    return this.asActor(ctx, async (tx) => {
      const user = await tx.one<{ mfa_secret: string | null; mfa_enabled: boolean }>('SELECT mfa_secret, mfa_enabled FROM core.users WHERE id = $1', [ctx.userId]);
      if (!user.mfa_enabled || !user.mfa_secret || !verifyTotp(decryptSecret(user.mfa_secret), code)) throw new AppError('MFA_INVALID');
      await tx.query('UPDATE core.users SET mfa_enabled = false, mfa_secret = NULL WHERE id = $1', [ctx.userId]);
      await this.auditActor(tx, ctx, 'mfa_disable');
      return { mfa_enabled: false };
    });
  }

  private asActor<T>(ctx: MfaActor, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return ctx.tenantId ? this.db.withTenant({ tenantId: ctx.tenantId, userId: ctx.userId }, fn) : this.db.withoutTenant(fn, ctx.userId);
  }

  /** The audit trail is per tenant; platform admins' own security changes are not recorded there. */
  private async auditActor(tx: Tx, ctx: MfaActor, action: string): Promise<void> {
    if (ctx.tenantId) await this.audit.record(tx, { ...ctx, tenantId: ctx.tenantId }, { action, entityType: 'user', entityId: ctx.userId });
  }

  private tenantsOf(userId: string): Promise<TenantSummary[]> {
    return this.db.withoutTenant((tx) => tx.query<TenantSummary>('SELECT * FROM core.user_tenants($1)', [userId]));
  }
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

const escapeHtml = (v: string) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);

/** Bilingual reset e-mail; the recipient's language comes first. */
const resetMail = (to: string, name: string, locale: 'ar' | 'en', link: string) => {
  const minutes = config.passwordResetMinutes;
  const en = {
    title: `Reset your ${BRAND.name_en} password`,
    hello: `Hello ${name},`,
    body: `We received a request to reset the password for ${to}. The link below works once and expires in ${minutes} minutes.`,
    button: 'Choose a new password',
    ignore: 'If you did not ask for this, ignore this e-mail; your password stays the same.',
  };
  const ar = {
    title: `إعادة تعيين كلمة المرور في ${BRAND.name_ar}`,
    hello: `مرحباً ${name}،`,
    body: `تلقينا طلباً لإعادة تعيين كلمة المرور للحساب ${to}. الرابط أدناه يعمل مرة واحدة وتنتهي صلاحيته خلال ${minutes} دقيقة.`,
    button: 'اختر كلمة مرور جديدة',
    ignore: 'إذا لم تطلب ذلك فتجاهل هذه الرسالة؛ تبقى كلمة المرور كما هي.',
  };
  const parts = locale === 'ar' ? [{ t: ar, dir: 'rtl' }, { t: en, dir: 'ltr' }] : [{ t: en, dir: 'ltr' }, { t: ar, dir: 'rtl' }];
  const block = ({ t, dir }: { t: typeof en; dir: string }) => `
    <div dir="${dir}" style="text-align:${dir === 'rtl' ? 'right' : 'left'};margin:0 0 28px">
      <h2 style="margin:0 0 12px;font-size:18px">${escapeHtml(t.title)}</h2>
      <p>${escapeHtml(t.hello)}</p><p>${escapeHtml(t.body)}</p>
      <p><a href="${link}" style="display:inline-block;background:#0b7a69;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">${escapeHtml(t.button)}</a></p>
      <p style="color:#666;font-size:13px">${escapeHtml(t.ignore)}</p>
    </div>`;
  return {
    to,
    subject: `${parts[0]!.t.title} / ${parts[1]!.t.title}`,
    text: parts.map(({ t }) => [t.title, '', t.hello, t.body, '', link, '', t.ignore].join('\n')).join('\n\n----\n\n'),
    html: `<div style="font-family:Segoe UI,Tahoma,Arial,sans-serif;font-size:15px;line-height:1.6;max-width:560px;margin:auto;color:#1a1a1a">${parts.map(block).join('<hr style="border:0;border-top:1px solid #eee;margin:24px 0">')}</div>`,
  };
};
