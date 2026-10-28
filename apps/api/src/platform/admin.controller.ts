import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { companySchema, inviteUserSchema, roleSchema, updateMembershipSchema } from '@erp/shared';
import { z } from 'zod';
import { Ctx, RequirePermissions } from '../common/decorators';
import type { RequestContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { AdminService } from './admin.service';

const newCompanySchema = companySchema.and(
  z.object({ first_fiscal_year: z.number().int().min(2000).max(2100), seed_chart_of_accounts: z.boolean().default(true) }),
);
const auditQuerySchema = z.object({
  entity_type: z.string().max(50).optional(),
  entity_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('companies')
  companies(@Ctx() ctx: RequestContext) {
    return this.admin.listCompanies(ctx);
  }

  @Post('companies')
  @RequirePermissions('admin.tenant')
  createCompany(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.admin.createCompany(ctx, parse(newCompanySchema, body));
  }

  @Put('companies/:id')
  @RequirePermissions('admin.tenant')
  updateCompany(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.admin.updateCompany(ctx, id, parse(companySchema, body));
  }

  @Get('users')
  @RequirePermissions('admin.users')
  users(@Ctx() ctx: RequestContext) {
    return this.admin.listMembers(ctx);
  }

  @Post('users')
  @RequirePermissions('admin.users')
  invite(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.admin.inviteUser(ctx, parse(inviteUserSchema, body));
  }

  @Patch('users/:userId')
  @RequirePermissions('admin.users')
  updateUser(@Ctx() ctx: RequestContext, @Param('userId', ParseUUIDPipe) userId: string, @Body() body: unknown) {
    return this.admin.updateMember(ctx, userId, parse(updateMembershipSchema, body));
  }

  @Get('roles')
  roles(@Ctx() ctx: RequestContext) {
    return this.admin.listRoles(ctx);
  }

  @Post('roles')
  @RequirePermissions('admin.users')
  createRole(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.admin.saveRole(ctx, parse(roleSchema, body));
  }

  @Put('roles/:id')
  @RequirePermissions('admin.users')
  updateRole(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.admin.saveRole(ctx, parse(roleSchema, body), id);
  }

  @Get('audit')
  @RequirePermissions('admin.audit')
  audit(@Ctx() ctx: RequestContext, @Query() query: unknown) {
    return this.admin.listAudit(ctx, parse(auditQuerySchema, query));
  }
}
