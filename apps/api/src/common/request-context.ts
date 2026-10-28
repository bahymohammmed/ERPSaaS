import type { Permission } from '@erp/shared';
import { AppError } from './app-error';

export type RequestContext = {
  tenantId: string;
  userId: string;
  permissions: ReadonlySet<Permission>;
  /** Company selected through the X-Company-Id header, validated against the tenant. */
  companyId: string | null;
  /** Root cost centers the user may see; null means unrestricted. */
  costCenterScope: string[] | null;
  ip: string;
};

export type CompanyContext = RequestContext & { companyId: string };

export const requireCompany = (ctx: RequestContext): CompanyContext => {
  if (!ctx.companyId) throw new AppError('COMPANY_REQUIRED');
  return ctx as CompanyContext;
};

export const assertPermission = (ctx: RequestContext, permission: Permission): void => {
  if (!ctx.permissions.has(permission)) throw new AppError('FORBIDDEN', { permission });
};
