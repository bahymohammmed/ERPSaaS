import { randomBytes, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CompanyInput } from '@erp/shared';
import type { z } from 'zod';
import type { inviteUserSchema, roleSchema, updateMembershipSchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { RequestContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { AuthService } from './auth.service';
import { ProvisioningService } from './provisioning.service';

/** Tenant administration: companies, members, roles and the audit log. */
@Injectable()
export class AdminService {
  constructor(
    private readonly db: DbService,
    private readonly provisioning: ProvisioningService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- companies

  listCompanies(ctx: RequestContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT c.*, cur.minor_units AS base_minor_units FROM core.companies c
         JOIN core.currencies cur ON cur.code = c.base_currency ORDER BY c.code`,
      ),
    );
  }

  createCompany(ctx: RequestContext, input: CompanyInput & { first_fiscal_year: number; seed_chart_of_accounts: boolean }) {
    return this.db.withTenant(ctx, async (tx) => {
      const limits = await tx.one<{ max_companies: number; count: number }>(
        `SELECT t.max_companies, (SELECT count(*)::int FROM core.companies) AS count FROM core.tenants t WHERE t.id = $1`,
        [ctx.tenantId],
      );
      if (limits.count >= limits.max_companies) throw new AppError('PLAN_LIMIT_REACHED', { resource: 'companies' });
      const company = await this.provisioning.createCompany(tx, ctx.tenantId, {
        code: input.code,
        name_ar: input.name_ar,
        name_en: input.name_en,
        base_currency: input.base_currency,
        fiscal_year_start_month: input.fiscal_year_start_month,
        first_fiscal_year: input.first_fiscal_year,
        seed_chart_of_accounts: input.seed_chart_of_accounts,
        require_approval: input.require_approval,
      });
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'company', entityId: company.id, companyId: company.id, newData: input });
      return tx.one('SELECT * FROM core.companies WHERE id = $1', [company.id]);
    });
  }

  updateCompany(ctx: RequestContext, id: string, input: CompanyInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await tx.maybeOne<{ base_currency: string }>('SELECT * FROM core.companies WHERE id = $1 FOR UPDATE', [id]);
      if (!existing) throw notFound('company');
      if (existing.base_currency !== input.base_currency) {
        const used = await tx.maybeOne('SELECT 1 FROM gl.journal_entries WHERE company_id = $1 LIMIT 1', [id]);
        if (used) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'base_currency', message: 'Base currency cannot change after entries exist' }]);
      }
      for (const accountId of [input.rounding_account_id, input.retained_earnings_account_id, input.fx_gain_account_id, input.fx_loss_account_id]) {
        if (!accountId) continue;
        const account = await tx.maybeOne<{ is_posting: boolean; is_active: boolean }>(
          'SELECT is_posting, is_active FROM gl.accounts WHERE company_id = $1 AND id = $2',
          [id, accountId],
        );
        if (!account?.is_posting || !account.is_active) {
          throw new AppError('VALIDATION_FAILED', {}, [{ path: 'rounding_account_id', message: 'Must be an active posting account' }]);
        }
      }
      const row = await tx.one(
        `UPDATE core.companies SET code = $2, name_ar = $3, name_en = $4, base_currency = $5, commercial_reg_no = $6, tax_no = $7,
           fiscal_year_start_month = $8, require_approval = $9, rounding_account_id = $10, retained_earnings_account_id = $11, is_active = $12,
           fx_gain_account_id = $13, fx_loss_account_id = $14, approval_threshold = $15
         WHERE id = $1 RETURNING *`,
        [
          id,
          input.code,
          input.name_ar || input.name_en,
          input.name_en || input.name_ar,
          input.base_currency,
          input.commercial_reg_no ?? null,
          input.tax_no ?? null,
          input.fiscal_year_start_month,
          input.require_approval,
          input.rounding_account_id ?? null,
          input.retained_earnings_account_id ?? null,
          input.is_active,
          input.fx_gain_account_id ?? null,
          input.fx_loss_account_id ?? null,
          input.approval_threshold ?? null,
        ],
      );
      await this.audit.record(tx, ctx, { action: 'update', entityType: 'company', entityId: id, companyId: id, oldData: existing, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- members

  listMembers(ctx: RequestContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT u.id AS user_id, u.email, u.full_name, u.last_login_at, tu.is_active, tu.role_id, tu.cost_center_scope,
                r.code AS role_code, r.name_ar AS role_name_ar, r.name_en AS role_name_en
         FROM core.tenant_users tu JOIN core.users u ON u.id = tu.user_id JOIN core.roles r ON r.id = tu.role_id
         ORDER BY u.full_name`,
      ),
    );
  }

  /** Adds a user to the tenant, creating the global user if the email is new. */
  async inviteUser(ctx: RequestContext, input: z.infer<typeof inviteUserSchema>) {
    const temporaryPassword = input.password ?? randomBytes(9).toString('base64url');
    const passwordHash = await this.auth.hashPassword(temporaryPassword);
    return this.db.withTenant(ctx, async (tx) => {
      const limits = await tx.one<{ max_users: number; count: number }>(
        'SELECT t.max_users, (SELECT count(*)::int FROM core.tenant_users WHERE is_active) AS count FROM core.tenants t WHERE t.id = $1',
        [ctx.tenantId],
      );
      if (limits.count >= limits.max_users) throw new AppError('PLAN_LIMIT_REACHED', { resource: 'users' });
      await this.assertRole(tx, input.role_id);

      const found = await tx.one<{ id: string | null }>('SELECT core.find_user_id($1) AS id', [input.email]);
      let userId = found.id;
      let created = false;
      if (!userId) {
        userId = randomUUID();
        await tx.query('INSERT INTO core.users (id, email, password_hash, full_name) VALUES ($1, $2, $3, $4)', [userId, input.email, passwordHash, input.full_name]);
        created = true;
      }
      const member = await tx.maybeOne('SELECT 1 FROM core.tenant_users WHERE user_id = $1', [userId]);
      if (member) throw new AppError('EMAIL_TAKEN');
      await tx.query('INSERT INTO core.tenant_users (tenant_id, user_id, role_id, cost_center_scope) VALUES ($1, $2, $3, $4)', [
        ctx.tenantId,
        userId,
        input.role_id,
        input.cost_center_scope?.length ? input.cost_center_scope : null,
      ]);
      await this.audit.record(tx, ctx, { action: 'invite', entityType: 'user', entityId: userId, newData: { email: input.email, role_id: input.role_id } });
      // The temporary password is returned once so the admin can hand it over; email delivery is a later integration.
      return { user_id: userId, created, temporary_password: created && !input.password ? temporaryPassword : null };
    });
  }

  updateMember(ctx: RequestContext, userId: string, input: z.infer<typeof updateMembershipSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await tx.maybeOne('SELECT * FROM core.tenant_users WHERE user_id = $1 FOR UPDATE', [userId]);
      if (!existing) throw notFound('user');
      if (input.role_id) await this.assertRole(tx, input.role_id);
      if (userId === ctx.userId && (input.is_active === false || input.role_id)) {
        throw new AppError('VALIDATION_FAILED', {}, [{ path: 'user', message: 'You cannot change your own role or deactivate yourself' }]);
      }
      const row = await tx.one(
        `UPDATE core.tenant_users SET role_id = COALESCE($2, role_id), is_active = COALESCE($3, is_active),
           cost_center_scope = CASE WHEN $4 THEN $5::uuid[] ELSE cost_center_scope END
         WHERE user_id = $1 RETURNING *`,
        [userId, input.role_id ?? null, input.is_active ?? null, input.cost_center_scope !== undefined, input.cost_center_scope?.length ? input.cost_center_scope : null],
      );
      await this.audit.record(tx, ctx, { action: 'update_membership', entityType: 'user', entityId: userId, oldData: existing, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- roles

  listRoles(ctx: RequestContext) {
    return this.db.withTenant(ctx, (tx) => tx.query('SELECT * FROM core.roles ORDER BY is_system DESC, code'));
  }

  saveRole(ctx: RequestContext, input: z.infer<typeof roleSchema>, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      if (id) {
        const role = await tx.maybeOne<{ is_system: boolean; code: string }>('SELECT is_system, code FROM core.roles WHERE id = $1', [id]);
        if (!role) throw notFound('role');
        if (role.is_system && role.code === 'ADMIN') {
          throw new AppError('VALIDATION_FAILED', {}, [{ path: 'permissions', message: 'The administrator role cannot be modified' }]);
        }
      }
      const params = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.permissions];
      const row = id
        ? await tx.one<{ id: string }>(
            'UPDATE core.roles SET code = CASE WHEN is_system THEN code ELSE $2 END, name_ar = $3, name_en = $4, permissions = $5 WHERE id = $1 RETURNING *',
            [id, ...params],
          )
        : await tx.one<{ id: string }>('INSERT INTO core.roles (tenant_id, code, name_ar, name_en, permissions) VALUES ($1, $2, $3, $4, $5) RETURNING *', [
            ctx.tenantId,
            ...params,
          ]);
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'role', entityId: row.id, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- audit

  listAudit(ctx: RequestContext, query: { entity_type?: string; entity_id?: string; user_id?: string; limit?: number }) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT a.id, a.occurred_at, a.action, a.entity_type, a.entity_id, a.company_id, a.ip, a.old_data, a.new_data, u.full_name AS user_name
         FROM core.audit_log a LEFT JOIN core.users u ON u.id = a.user_id
         WHERE ($1::text IS NULL OR a.entity_type = $1) AND ($2::uuid IS NULL OR a.entity_id = $2) AND ($3::uuid IS NULL OR a.user_id = $3)
         ORDER BY a.occurred_at DESC, a.id DESC LIMIT $4`,
        [query.entity_type ?? null, query.entity_id ?? null, query.user_id ?? null, Math.min(query.limit ?? 200, 1000)],
      ),
    );
  }

  private async assertRole(tx: Tx, roleId: string): Promise<void> {
    const role = await tx.maybeOne('SELECT 1 FROM core.roles WHERE id = $1', [roleId]);
    if (!role) throw notFound('role');
  }
}
