import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  accountSchema,
  costCenterSchema,
  dimensionTypeSchema,
  dimensionValueSchema,
  distributionTemplateSchema,
  exchangeRateSchema,
  fiscalYearSchema,
  journalTypeSchema,
  periodStatusSchema,
} from '@erp/shared';
import { z } from 'zod';
import { CompanyCtx, CompanyScoped, RequirePermissions } from '../common/decorators';
import type { CompanyContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { AccountsService } from './accounts.service';
import { CostCentersService } from './cost-centers.service';
import { FiscalService } from './fiscal.service';
import { MastersService } from './masters.service';

const listQuery = z.object({
  search: z.string().max(100).optional(),
  posting_only: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  active_only: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

@Controller('gl')
@CompanyScoped()
export class MasterDataController {
  constructor(
    private readonly accounts: AccountsService,
    private readonly costCenters: CostCentersService,
    private readonly masters: MastersService,
    private readonly fiscal: FiscalService,
  ) {}

  // ---- chart of accounts
  @Get('accounts')
  @RequirePermissions('gl.master.view')
  listAccounts(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown) {
    return this.accounts.list(ctx, parse(listQuery, query));
  }

  @Get('accounts/:id')
  @RequirePermissions('gl.master.view')
  getAccount(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.get(ctx, id);
  }

  @Post('accounts')
  @RequirePermissions('gl.master.manage')
  createAccount(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.accounts.create(ctx, parse(accountSchema, body));
  }

  @Put('accounts/:id')
  @RequirePermissions('gl.master.manage')
  updateAccount(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.accounts.update(ctx, id, parse(accountSchema, body));
  }

  @Delete('accounts/:id')
  @RequirePermissions('gl.master.manage')
  deleteAccount(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.remove(ctx, id);
  }

  // ---- cost centers
  @Get('cost-centers')
  @RequirePermissions('gl.master.view')
  listCostCenters(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown) {
    return this.costCenters.list(ctx, parse(listQuery, query));
  }

  @Post('cost-centers')
  @RequirePermissions('gl.master.manage')
  createCostCenter(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.costCenters.create(ctx, parse(costCenterSchema, body));
  }

  @Put('cost-centers/:id')
  @RequirePermissions('gl.master.manage')
  updateCostCenter(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.costCenters.update(ctx, id, parse(costCenterSchema, body));
  }

  @Delete('cost-centers/:id')
  @RequirePermissions('gl.master.manage')
  deleteCostCenter(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.costCenters.remove(ctx, id);
  }

  // ---- dimensions
  @Get('dimensions')
  @RequirePermissions('gl.master.view')
  listDimensions(@CompanyCtx() ctx: CompanyContext) {
    return this.masters.listDimensionTypes(ctx);
  }

  @Post('dimensions')
  @RequirePermissions('gl.master.manage')
  createDimension(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.masters.saveDimensionType(ctx, parse(dimensionTypeSchema, body));
  }

  @Put('dimensions/:id')
  @RequirePermissions('gl.master.manage')
  updateDimension(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.masters.saveDimensionType(ctx, parse(dimensionTypeSchema, body), id);
  }

  @Post('dimension-values')
  @RequirePermissions('gl.master.manage')
  createDimensionValue(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.masters.saveDimensionValue(ctx, parse(dimensionValueSchema, body));
  }

  @Put('dimension-values/:id')
  @RequirePermissions('gl.master.manage')
  updateDimensionValue(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.masters.saveDimensionValue(ctx, parse(dimensionValueSchema, body), id);
  }

  // ---- journal types
  @Get('journal-types')
  @RequirePermissions('gl.master.view')
  listJournalTypes(@CompanyCtx() ctx: CompanyContext) {
    return this.masters.listJournalTypes(ctx);
  }

  @Post('journal-types')
  @RequirePermissions('gl.master.manage')
  createJournalType(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.masters.saveJournalType(ctx, parse(journalTypeSchema, body));
  }

  @Put('journal-types/:id')
  @RequirePermissions('gl.master.manage')
  updateJournalType(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.masters.saveJournalType(ctx, parse(journalTypeSchema, body), id);
  }

  // ---- distribution templates
  @Get('distribution-templates')
  @RequirePermissions('gl.master.view')
  listTemplates(@CompanyCtx() ctx: CompanyContext) {
    return this.masters.listTemplates(ctx);
  }

  @Post('distribution-templates')
  @RequirePermissions('gl.master.manage')
  createTemplate(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.masters.saveTemplate(ctx, parse(distributionTemplateSchema, body));
  }

  @Put('distribution-templates/:id')
  @RequirePermissions('gl.master.manage')
  updateTemplate(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.masters.saveTemplate(ctx, parse(distributionTemplateSchema, body), id);
  }

  // ---- currencies & rates
  @Get('currencies')
  @RequirePermissions('gl.master.view')
  listCurrencies(@CompanyCtx() ctx: CompanyContext) {
    return this.masters.listCurrencies(ctx);
  }

  @Get('exchange-rates')
  @RequirePermissions('gl.master.view')
  listRates(@CompanyCtx() ctx: CompanyContext, @Query('currency') currency?: string) {
    return this.masters.listRates(ctx, currency && /^[A-Z]{3}$/.test(currency) ? currency : undefined);
  }

  @Post('exchange-rates')
  @RequirePermissions('gl.rates.manage')
  saveRate(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.masters.saveRate(ctx, parse(exchangeRateSchema, body));
  }

  @Delete('exchange-rates/:id')
  @RequirePermissions('gl.rates.manage')
  deleteRate(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.masters.deleteRate(ctx, id);
  }

  // ---- fiscal calendar
  @Get('fiscal-years')
  @RequirePermissions('gl.master.view')
  listYears(@CompanyCtx() ctx: CompanyContext) {
    return this.fiscal.listYears(ctx);
  }

  @Post('fiscal-years')
  @RequirePermissions('gl.period.manage')
  createYear(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.fiscal.createYear(ctx, parse(fiscalYearSchema, body));
  }

  @Get('periods')
  @RequirePermissions('gl.master.view')
  listPeriods(@CompanyCtx() ctx: CompanyContext, @Query('fiscal_year_id') fiscalYearId?: string) {
    return this.fiscal.listPeriods(ctx, fiscalYearId && z.string().uuid().safeParse(fiscalYearId).success ? fiscalYearId : undefined);
  }

  @Patch('periods/:id/status')
  @RequirePermissions('gl.period.manage')
  setPeriodStatus(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = parse(periodStatusSchema, body);
    return this.fiscal.setPeriodStatus(ctx, id, input.module, input.status);
  }
}
