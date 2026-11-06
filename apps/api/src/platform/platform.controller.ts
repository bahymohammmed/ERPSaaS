import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Res } from '@nestjs/common';
import { changePasswordSchema, mfaCodeSchema, planSchema, platformCredentialsResetSchema, platformTenantSchema, platformTenantUpdateSchema } from '@erp/shared';
import type { Response } from 'express';
import { AUTH_COOKIE } from '../common/auth.guard';
import { PlatformCtx, PlatformRoute } from '../common/decorators';
import { TokenService } from '../common/token.service';
import { config } from '../config';
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
    private readonly tokens: TokenService,
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

  @Get('plans')
  plans(@PlatformCtx() ctx: PlatformContext) {
    return this.platform.listPlans(ctx);
  }

  @Post('plans')
  createPlan(@PlatformCtx() ctx: PlatformContext, @Body() body: unknown) {
    return this.platform.savePlan(ctx, parse(planSchema, body));
  }

  @Put('plans/:code')
  updatePlan(@PlatformCtx() ctx: PlatformContext, @Param('code') code: string, @Body() body: unknown) {
    return this.platform.savePlan(ctx, parse(planSchema, body), code);
  }

  @Delete('plans/:code')
  deletePlan(@PlatformCtx() ctx: PlatformContext, @Param('code') code: string) {
    return this.platform.deletePlan(ctx, code);
  }

  @Post('password')
  @HttpCode(200)
  async changePassword(@PlatformCtx() ctx: PlatformContext, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const input = parse(changePasswordSchema, body);
    await this.auth.changePassword(ctx.userId, null, input.current_password, input.new_password, ctx.ip);
    const token = this.tokens.signPlatform(ctx.userId);
    res.cookie(AUTH_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, maxAge: config.jwtTtlSeconds * 1000, path: '/' });
    return { token, platform: true };
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
