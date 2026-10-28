import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@erp/shared';
import type { Request } from 'express';
import { DbService } from '../db/db.service';
import { AppError } from './app-error';
import { COMPANY_KEY, IS_PUBLIC, PERMISSIONS_KEY } from './decorators';
import type { RequestContext } from './request-context';
import { TokenService } from './token.service';

export const AUTH_COOKIE = 'erp_token';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authenticates the caller, resolves tenant membership and permissions, validates the
 * selected company, then enforces @RequirePermissions. Runs for every route.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<Request & { ctx?: RequestContext }>();
    const token = extractToken(request);
    if (!token) throw new AppError('UNAUTHENTICATED');
    const claims = this.tokens.verify(token);

    const companyHeader = request.header('x-company-id');
    const companyId = companyHeader && UUID.test(companyHeader) ? companyHeader : null;

    const membership = await this.db.withTenant({ tenantId: claims.tid, userId: claims.sub }, async (tx) => {
      const row = await tx.maybeOne<{ permissions: Permission[]; cost_center_scope: string[] | null }>(
        `SELECT r.permissions, tu.cost_center_scope
         FROM core.tenant_users tu
         JOIN core.roles r ON r.tenant_id = tu.tenant_id AND r.id = tu.role_id
         JOIN core.tenants t ON t.id = tu.tenant_id
         JOIN core.users u ON u.id = tu.user_id
         WHERE tu.tenant_id = $1 AND tu.user_id = $2 AND tu.is_active AND t.is_active AND u.is_active`,
        [claims.tid, claims.sub],
      );
      if (!row) return null;
      let company: { is_active: boolean } | null = null;
      if (companyId) {
        company = await tx.maybeOne<{ is_active: boolean }>('SELECT is_active FROM core.companies WHERE id = $1', [companyId]);
      }
      return { ...row, company };
    });
    if (!membership) throw new AppError('UNAUTHENTICATED');

    const requiresCompany = this.reflector.getAllAndOverride<boolean>(COMPANY_KEY, targets);
    if (requiresCompany) {
      if (!companyId || !membership.company) throw new AppError('COMPANY_REQUIRED');
      if (!membership.company.is_active) throw new AppError('COMPANY_INACTIVE');
    }

    const ctx: RequestContext = {
      tenantId: claims.tid,
      userId: claims.sub,
      permissions: new Set(membership.permissions),
      companyId: membership.company ? companyId : null,
      costCenterScope: membership.cost_center_scope?.length ? membership.cost_center_scope : null,
      ip: request.ip ?? '',
    };
    request.ctx = ctx;

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    const missing = required.find((p) => !ctx.permissions.has(p));
    if (missing) throw new AppError('FORBIDDEN', { permission: missing });
    return true;
  }
}

const extractToken = (request: Request): string | null => {
  const header = request.header('authorization');
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[AUTH_COOKIE] ?? null;
};
