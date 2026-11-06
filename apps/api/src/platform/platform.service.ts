import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { type PlanInput, type platformCredentialsResetSchema, type PlatformTenantInput, type platformTenantUpdateSchema, withDependencies } from '@erp/shared';
import type { z } from 'zod';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { PlatformContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { AuthService } from './auth.service';
import { ProvisioningService } from './provisioning.service';

/**
 * The SaaS operator's console. Cross-tenant reads go through SECURITY DEFINER functions that
 * re-check the caller; changes to one tenant run inside that tenant's RLS context and are
 * written to that tenant's audit trail, so the customer can see what the operator did.
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly db: DbService,
    private readonly auth: AuthService,
    private readonly provisioning: ProvisioningService,
    private readonly audit: AuditService,
  ) {}

  async me(ctx: PlatformContext) {
    const user = await this.db.withoutTenant(
      (tx) => tx.one('SELECT id, email, full_name, preferred_locale, digit_style, mfa_enabled FROM core.users WHERE id = $1', [ctx.userId]),
      ctx.userId,
    );
    return { user, platform: true };
  }

  listTenants(ctx: PlatformContext) {
    return this.db.withoutTenant(
      (tx) =>
        tx.query(
          `SELECT t.*, p.name_ar AS plan_name_ar, p.name_en AS plan_name_en
           FROM core.platform_tenants() t LEFT JOIN core.plans p ON p.code = t.plan_code`,
        ),
      ctx.userId,
    );
  }

  /**
   * Creates a tenant with its first company. The administrator is a new user (with the given or a
   * generated temporary password) or, when the email is already registered, that existing user.
   */
  async createTenant(ctx: PlatformContext, input: PlatformTenantInput) {
    const existing = await this.db.withoutTenant(
      (tx) => tx.one<{ id: string | null; platform: boolean }>('SELECT core.find_user_id($1) AS id, core.is_platform_admin(core.find_user_id($1)) AS platform', [input.admin.email]),
      ctx.userId,
    );
    if (existing.platform) throw new AppError('PLATFORM_ADMIN_ACCOUNT');

    const temporaryPassword = existing.id ? null : (input.admin.password ?? randomBytes(9).toString('base64url'));
    const passwordHash = temporaryPassword ? await this.auth.hashPassword(temporaryPassword) : null;
    const tenantId = randomUUID();
    const adminUserId = existing.id ?? randomUUID();

    const companyId = await this.db.withTenant({ tenantId, userId: ctx.userId }, async (tx) => {
      if (!existing.id) {
        await tx.query('INSERT INTO core.users (id, email, password_hash, full_name, preferred_locale) VALUES ($1, $2, $3, $4, $5)', [
          adminUserId,
          input.admin.email,
          passwordHash,
          input.admin.full_name,
          input.admin.locale,
        ]);
      }
      const created = await this.provisioning.createTenant(tx, {
        id: tenantId,
        name: input.name,
        plan_code: input.plan_code,
        max_companies: input.max_companies,
        max_users: input.max_users,
        admin_user_id: adminUserId,
        company: {
          ...input.company,
          name_ar: input.company.name_ar || input.name,
          name_en: input.company.name_en || input.name,
        },
      });
      await this.audit.record(tx, { tenantId, userId: ctx.userId, ip: ctx.ip }, {
        action: 'platform_create_tenant',
        entityType: 'tenant',
        entityId: tenantId,
        companyId: created.companyId,
        newData: { name: input.name, plan_code: input.plan_code, admin_email: input.admin.email },
      });
      return created.companyId;
    });

    return {
      tenant_id: tenantId,
      company_id: companyId,
      admin_user_id: adminUserId,
      admin_created: !existing.id,
      // Shown once so the operator can hand it over; only when generated here.
      temporary_password: !existing.id && !input.admin.password ? temporaryPassword : null,
    };
  }

  updateTenant(ctx: PlatformContext, tenantId: string, input: z.infer<typeof platformTenantUpdateSchema>) {
    return this.inTenant(ctx, tenantId, async (tx) => {
      const before = await tx.maybeOne('SELECT name, plan_code, max_companies, max_users, is_active FROM core.tenants WHERE id = $1 FOR UPDATE', [tenantId]);
      if (!before) throw notFound('tenant');
      if (input.plan_code && input.plan_code !== (before as { plan_code: string }).plan_code) {
        const plan = await tx.maybeOne<{ is_active: boolean }>('SELECT is_active FROM core.plans WHERE code = $1', [input.plan_code]);
        if (!plan) throw notFound('plan');
        if (!plan.is_active) throw new AppError('PLAN_INACTIVE');
      }
      const row = await tx.one(
        `UPDATE core.tenants SET name = COALESCE($2, name), plan_code = COALESCE($3, plan_code),
           max_companies = COALESCE($4, max_companies), max_users = COALESCE($5, max_users), is_active = COALESCE($6, is_active)
         WHERE id = $1 RETURNING id, name, plan_code, max_companies, max_users, is_active, created_at`,
        [tenantId, input.name ?? null, input.plan_code ?? null, input.max_companies ?? null, input.max_users ?? null, input.is_active ?? null],
      );
      const action = input.is_active === false ? 'platform_suspend_tenant' : input.is_active === true && !before.is_active ? 'platform_activate_tenant' : 'platform_update_tenant';
      await this.audit.record(tx, { tenantId, userId: ctx.userId, ip: ctx.ip }, { action, entityType: 'tenant', entityId: tenantId, oldData: before, newData: input });
      return row;
    });
  }

  tenantDetail(ctx: PlatformContext, tenantId: string) {
    return this.inTenant(ctx, tenantId, async (tx) => {
      const tenant = await tx.maybeOne('SELECT id, name, plan_code, max_companies, max_users, is_active, created_at FROM core.tenants WHERE id = $1', [tenantId]);
      if (!tenant) throw notFound('tenant');
      const companies = await tx.query('SELECT id, code, name_ar, name_en, base_currency, is_active, created_at FROM core.companies ORDER BY code');
      const members = await tx.query(
        `SELECT u.id AS user_id, u.email, u.full_name, u.last_login_at, u.mfa_enabled, tu.is_active, r.code AS role_code, r.name_ar AS role_name_ar, r.name_en AS role_name_en
         FROM core.tenant_users tu JOIN core.users u ON u.id = tu.user_id JOIN core.roles r ON r.id = tu.role_id
         ORDER BY u.full_name`,
      );
      return { tenant, companies, members };
    });
  }

  /** Support action for a locked-out customer: new password (given or generated) and optionally 2FA cleared. */
  async resetCredentials(ctx: PlatformContext, tenantId: string, userId: string, input: z.infer<typeof platformCredentialsResetSchema>) {
    const password = input.password ?? randomBytes(9).toString('base64url');
    const passwordHash = await this.auth.hashPassword(password);
    return this.inTenant(ctx, tenantId, async (tx) => {
      const row = await tx.one<{ ok: boolean }>('SELECT core.platform_reset_credentials($1, $2, $3, $4) AS ok', [tenantId, userId, passwordHash, input.reset_mfa]);
      if (!row.ok) throw notFound('user');
      await this.audit.record(tx, { tenantId, userId: ctx.userId, ip: ctx.ip }, {
        action: 'platform_reset_credentials',
        entityType: 'user',
        entityId: userId,
        newData: { reset_mfa: input.reset_mfa },
      });
      return { temporary_password: input.password ? null : password };
    });
  }

  // ---------------------------------------------------------------- subscription plans

  listPlans(ctx: PlatformContext) {
    return this.db.withoutTenant(
      (tx) =>
        tx.query(
          `SELECT p.*, COALESCE(u.tenant_count, 0) AS tenant_count
           FROM core.plans p LEFT JOIN core.platform_plan_usage() u ON u.plan_code = p.code
           ORDER BY p.sort_order, p.code`,
        ),
      ctx.userId,
    );
  }

  /** Creates or updates a plan. Modules are stored with everything they require. */
  savePlan(ctx: PlatformContext, input: PlanInput, code?: string) {
    return this.db.withoutTenant(async (tx) => {
      const features = withDependencies(input.features);
      const values = [
        input.name_ar || input.name_en,
        input.name_en || input.name_ar,
        input.description_ar,
        input.description_en,
        features,
        input.max_companies,
        input.max_users,
        input.price_monthly ?? null,
        input.price_currency,
        input.is_active,
        input.is_default,
        input.sort_order,
      ];
      if (input.is_default && !input.is_active) throw new AppError('PLAN_DEFAULT');
      if (code) {
        const before = await tx.maybeOne<{ is_default: boolean }>('SELECT is_default FROM core.plans WHERE code = $1 FOR UPDATE', [code]);
        if (!before) throw notFound('plan');
        // There must always be a default plan for self-service sign-up.
        if (before.is_default && !input.is_default) throw new AppError('PLAN_DEFAULT');
      } else {
        const exists = await tx.maybeOne('SELECT 1 FROM core.plans WHERE code = $1', [input.code]);
        if (exists) throw new AppError('DUPLICATE_CODE', { code: input.code });
      }
      if (input.is_default) await tx.query('UPDATE core.plans SET is_default = false WHERE is_default AND code <> $1', [code ?? input.code]);
      const row = code
        ? await tx.one(
            `UPDATE core.plans SET code = $1, name_ar = $3, name_en = $4, description_ar = $5, description_en = $6, features = $7, max_companies = $8,
               max_users = $9, price_monthly = $10, price_currency = $11, is_active = $12, is_default = $13, sort_order = $14, updated_at = now()
             WHERE code = $2 RETURNING *`,
            [input.code, code, ...values],
          )
        : await tx.one(
            `INSERT INTO core.plans (code, name_ar, name_en, description_ar, description_en, features, max_companies, max_users, price_monthly,
               price_currency, is_active, is_default, sort_order)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [input.code, ...values],
          );
      return row;
    }, ctx.userId);
  }

  deletePlan(ctx: PlatformContext, code: string) {
    return this.db.withoutTenant(async (tx) => {
      const plan = await tx.maybeOne<{ is_default: boolean }>('SELECT is_default FROM core.plans WHERE code = $1 FOR UPDATE', [code]);
      if (!plan) throw notFound('plan');
      if (plan.is_default) throw new AppError('PLAN_DEFAULT');
      const usage = await tx.maybeOne<{ tenant_count: number }>('SELECT tenant_count FROM core.platform_plan_usage() WHERE plan_code = $1', [code]);
      if (usage && usage.tenant_count > 0) throw new AppError('PLAN_IN_USE', { count: usage.tenant_count });
      await tx.query('DELETE FROM core.plans WHERE code = $1', [code]);
      return { deleted: true };
    }, ctx.userId);
  }

  private inTenant<T>(ctx: PlatformContext, tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.withTenant({ tenantId, userId: ctx.userId }, fn);
  }
}
