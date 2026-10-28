import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res } from '@nestjs/common';
import { loginSchema, type LoginInput, mfaCodeSchema, signupSchema, type SignupInput, switchTenantSchema, userPreferencesSchema } from '@erp/shared';
import type { Request, Response } from 'express';
import type { z } from 'zod';
import { AUTH_COOKIE } from '../common/auth.guard';
import { Ctx, Public } from '../common/decorators';
import type { RequestContext } from '../common/request-context';
import { ZodPipe } from '../common/zod.pipe';
import { config } from '../config';
import { AuthService, type Session } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  async signup(@Body(new ZodPipe(signupSchema)) body: SignupInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.signup(body, req.ip ?? ''));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginSchema)) body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(body, req.ip ?? ''));
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Post('switch-tenant')
  @HttpCode(200)
  async switchTenant(@Ctx() ctx: RequestContext, @Body(new ZodPipe(switchTenantSchema)) body: z.infer<typeof switchTenantSchema>, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.switchTenant(ctx.userId, body.tenantId));
  }

  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.auth.me(ctx);
  }

  @Patch('preferences')
  preferences(@Ctx() ctx: RequestContext, @Body(new ZodPipe(userPreferencesSchema)) body: z.infer<typeof userPreferencesSchema>) {
    return this.auth.updatePreferences(ctx, body);
  }

  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@Ctx() ctx: RequestContext) {
    return this.auth.setupMfa(ctx);
  }

  @Post('mfa/enable')
  @HttpCode(200)
  enableMfa(@Ctx() ctx: RequestContext, @Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    return this.auth.enableMfa(ctx, body.code);
  }

  @Post('mfa/disable')
  @HttpCode(200)
  disableMfa(@Ctx() ctx: RequestContext, @Body(new ZodPipe(mfaCodeSchema)) body: z.infer<typeof mfaCodeSchema>) {
    return this.auth.disableMfa(ctx, body.code);
  }

  /** Browser clients use the httpOnly cookie; API clients use the returned bearer token. */
  private respond(res: Response, session: Session) {
    res.cookie(AUTH_COOKIE, session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.secureCookies,
      maxAge: config.jwtTtlSeconds * 1000,
      path: '/',
    });
    return session;
  }
}
