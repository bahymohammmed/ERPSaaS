import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { mfaCodeSchema, platformCredentialsResetSchema, platformTenantSchema, platformTenantUpdateSchema } from '@erp/shared';
import { PlatformCtx, PlatformRoute } from '../common/decorators';
import type { PlatformContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { PlatformService } from './platform.service';

/** The SaaS operator's console. Accepts platform admin sessions only (see AuthGuard). */
@Controller('platform')
@PlatformRoute()
export class PlatformController {
  constructor(
    private readonly platform: PlatformService,
    private readonly auth: AuthService,
  ) {}

  @Get('me')
  me(@PlatformCtx() ctx: PlatformContext) {
    return this.platform.me(ctx);
  }

  @Get('tenants')
  tenants(@PlatformCtx() ctx: PlatformContext) {
    return this.platform.listTenants(ctx);
  }

  @Post('tenants')
  createTenant(@PlatformCtx() ctx: PlatformContext, @Body() body: unknown) {
    return this.platform.createTenant(ctx, parse(platformTenantSchema, body));
  }

  @Get('tenants/:id')
  tenant(@PlatformCtx() ctx: PlatformContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.platform.tenantDetail(ctx, id);
  }

  @Patch('tenants/:id')
  updateTenant(@PlatformCtx() ctx: PlatformContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.platform.updateTenant(ctx, id, parse(platformTenantUpdateSchema, body));
  }

  @Post('tenants/:id/users/:userId/reset-credentials')
  @HttpCode(200)
  resetCredentials(
    @PlatformCtx() ctx: PlatformContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() body: unknown,
  ) {
    return this.platform.resetCredentials(ctx, id, userId, parse(platformCredentialsResetSchema, body ?? {}));
  }

  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@PlatformCtx() ctx: PlatformContext) {
    return this.auth.setupMfa({ ...ctx, tenantId: null });
  }

  @Post('mfa/enable')
  @HttpCode(200)
  enableMfa(@PlatformCtx() ctx: PlatformContext, @Body() body: unknown) {
    return this.auth.enableMfa({ ...ctx, tenantId: null }, parse(mfaCodeSchema, body).code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  disableMfa(@PlatformCtx() ctx: PlatformContext, @Body() body: unknown) {
    return this.auth.disableMfa({ ...ctx, tenantId: null }, parse(mfaCodeSchema, body).code);
  }
}
