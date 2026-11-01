import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '@erp/shared';
import { AppError } from './app-error';
import type { CompanyContext, PlatformContext, RequestContext } from './request-context';

export const IS_PUBLIC = 'isPublic';
export const PERMISSIONS_KEY = 'permissions';
export const COMPANY_KEY = 'requiresCompany';
export const PLATFORM_KEY = 'platformRoute';

/** Route needs no authentication. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Route needs every listed permission. */
export const RequirePermissions = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_KEY, permissions);

/** Route (or controller) operates inside the company sent in X-Company-Id. */
export const CompanyScoped = () => SetMetadata(COMPANY_KEY, true);

/** Route (or controller) belongs to the platform console: needs a platform admin session, not a tenant one. */
export const PlatformRoute = () => SetMetadata(PLATFORM_KEY, true);

type WithCtx = { ctx?: RequestContext; platformCtx?: PlatformContext };

export const PlatformCtx = createParamDecorator((_: unknown, host: ExecutionContext): PlatformContext => {
  const ctx = host.switchToHttp().getRequest<WithCtx>().platformCtx;
  if (!ctx) throw new AppError('UNAUTHENTICATED');
  return ctx;
});

export const Ctx = createParamDecorator((_: unknown, host: ExecutionContext): RequestContext => {
  const ctx = host.switchToHttp().getRequest<WithCtx>().ctx;
  if (!ctx) throw new AppError('UNAUTHENTICATED');
  return ctx;
});

export const CompanyCtx = createParamDecorator((_: unknown, host: ExecutionContext): CompanyContext => {
  const ctx = host.switchToHttp().getRequest<WithCtx>().ctx;
  if (!ctx) throw new AppError('UNAUTHENTICATED');
  if (!ctx.companyId) throw new AppError('COMPANY_REQUIRED');
  return ctx as CompanyContext;
});
