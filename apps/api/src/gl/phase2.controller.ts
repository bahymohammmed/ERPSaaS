import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  allocationRuleSchema,
  appropriationRuleSchema,
  budgetGenerateSchema,
  budgetLinesSchema,
  budgetSchema,
  driverSchema,
  driverValuesSchema,
  fxRevaluationSchema,
  periodRefSchema,
  recurringSchema,
  statementSchema,
  yearEndSchema,
} from '@erp/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { CompanyCtx, CompanyScoped, RequirePermissions } from '../common/decorators';
import type { CompanyContext } from '../common/request-context';
import { assertPermission } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { AllocationService } from './allocation.service';
import { AnalysisReportsService } from './analysis-reports.service';
import { BudgetsService } from './budgets.service';
import { FxRevaluationService } from './fx-revaluation.service';
import { ImportService } from './import.service';
import { RecurringService } from './recurring.service';
import { YearEndService } from './year-end.service';

const uuidQuery = z.string().uuid();

@Controller('gl')
@CompanyScoped()
export class Phase2Controller {
  constructor(
    private readonly recurring: RecurringService,
    private readonly fx: FxRevaluationService,
    private readonly allocation: AllocationService,
    private readonly budgets: BudgetsService,
    private readonly yearEnd: YearEndService,
    private readonly analysis: AnalysisReportsService,
    private readonly imports: ImportService,
  ) {}

  // ---------------------------------------------------------------- recurring entries
  @Get('recurring')
  @RequirePermissions('gl.journal.view')
  listRecurring(@CompanyCtx() ctx: CompanyContext) {
    return this.recurring.list(ctx);
  }

  @Post('recurring')
  @RequirePermissions('gl.journal.create')
  createRecurring(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.recurring.create(ctx, parse(recurringSchema, body));
  }

  @Put('recurring/:id')
  @RequirePermissions('gl.journal.create')
  updateRecurring(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.recurring.update(ctx, id, parse(recurringSchema, body));
  }

  @Delete('recurring/:id')
  @RequirePermissions('gl.journal.create')
  deleteRecurring(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.remove(ctx, id);
  }

  @Post('recurring/:id/run')
  @RequirePermissions('gl.journal.create')
  runRecurring(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.recurring.runNow(ctx, id);
  }

  // ---------------------------------------------------------------- FX revaluation
  @Post('fx-revaluation/preview')
  @RequirePermissions('gl.close.manage')
  previewFx(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.fx.preview(ctx, parse(fxRevaluationSchema, body));
  }

  @Post('fx-revaluation')
  @RequirePermissions('gl.close.manage')
  postFx(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.fx.post(ctx, parse(fxRevaluationSchema, body));
  }

  // ---------------------------------------------------------------- cost allocation
  @Get('allocation/drivers')
  @RequirePermissions('gl.master.view')
  drivers(@CompanyCtx() ctx: CompanyContext) {
    return this.allocation.listDrivers(ctx);
  }

  @Post('allocation/drivers')
  @RequirePermissions('gl.master.manage')
  createDriver(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.allocation.saveDriver(ctx, parse(driverSchema, body));
  }

  @Put('allocation/drivers/:id')
  @RequirePermissions('gl.master.manage')
  updateDriver(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.allocation.saveDriver(ctx, parse(driverSchema, body), id);
  }

  @Get('allocation/drivers/:id/values')
  @RequirePermissions('gl.master.view')
  driverValues(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Query('period_id') periodId: string) {
    return this.allocation.driverValues(ctx, id, parse(uuidQuery, periodId));
  }

  @Put('allocation/drivers/:id/values')
  @RequirePermissions('gl.master.manage')
  setDriverValues(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.allocation.setDriverValues(ctx, id, parse(driverValuesSchema, body));
  }

  @Get('allocation/rules')
  @RequirePermissions('gl.master.view')
  rules(@CompanyCtx() ctx: CompanyContext) {
    return this.allocation.listRules(ctx);
  }

  @Post('allocation/rules')
  @RequirePermissions('gl.master.manage')
  createRule(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.allocation.saveRule(ctx, parse(allocationRuleSchema, body));
  }

  @Put('allocation/rules/:id')
  @RequirePermissions('gl.master.manage')
  updateRule(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.allocation.saveRule(ctx, parse(allocationRuleSchema, body), id);
  }

  @Delete('allocation/rules/:id')
  @RequirePermissions('gl.master.manage')
  deleteRule(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.allocation.removeRule(ctx, id);
  }

  @Get('allocation/runs')
  @RequirePermissions('gl.journal.view')
  runs(@CompanyCtx() ctx: CompanyContext) {
    return this.allocation.listRuns(ctx);
  }

  @Post('allocation/preview')
  @RequirePermissions('gl.close.manage')
  previewAllocation(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.allocation.preview(ctx, parse(periodRefSchema, body).period_id);
  }

  @Post('allocation/runs')
  @RequirePermissions('gl.close.manage')
  runAllocation(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.allocation.run(ctx, parse(periodRefSchema, body).period_id);
  }

  @Post('allocation/runs/:id/reverse')
  @RequirePermissions('gl.close.manage')
  reverseAllocation(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.allocation.reverseRun(ctx, id);
  }

  // ---------------------------------------------------------------- budgets
  @Get('budgets')
  @RequirePermissions('gl.report.view')
  listBudgets(@CompanyCtx() ctx: CompanyContext) {
    return this.budgets.list(ctx);
  }

  @Post('budgets')
  @RequirePermissions('gl.budget.manage')
  createBudget(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.budgets.save(ctx, parse(budgetSchema, body));
  }

  @Put('budgets/:id')
  @RequirePermissions('gl.budget.manage')
  updateBudget(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.budgets.save(ctx, parse(budgetSchema, body), id);
  }

  @Delete('budgets/:id')
  @RequirePermissions('gl.budget.manage')
  deleteBudget(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.budgets.remove(ctx, id);
  }

  @Patch('budgets/:id/status')
  @RequirePermissions('gl.budget.manage')
  budgetStatus(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.budgets.setStatus(ctx, id, parse(z.object({ status: z.enum(['DRAFT', 'APPROVED']) }), body).status);
  }

  @Get('budgets/:id/lines')
  @RequirePermissions('gl.report.view')
  budgetLines(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Query('cost_center_id') costCenterId?: string) {
    return this.budgets.lines(ctx, id, costCenterId ? parse(uuidQuery, costCenterId) : null);
  }

  @Put('budgets/:id/lines')
  @RequirePermissions('gl.budget.manage')
  saveBudgetLines(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.budgets.saveLines(ctx, id, parse(budgetLinesSchema, body));
  }

  @Post('budgets/:id/generate')
  @RequirePermissions('gl.budget.manage')
  generateBudget(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.budgets.generateFromActuals(ctx, id, parse(budgetGenerateSchema, body));
  }

  // ---------------------------------------------------------------- year end
  @Get('year-end/rules')
  @RequirePermissions('gl.master.view')
  appropriationRules(@CompanyCtx() ctx: CompanyContext) {
    return this.yearEnd.listRules(ctx);
  }

  @Post('year-end/rules')
  @RequirePermissions('gl.close.manage')
  createAppropriationRule(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.yearEnd.saveRule(ctx, parse(appropriationRuleSchema, body));
  }

  @Put('year-end/rules/:id')
  @RequirePermissions('gl.close.manage')
  updateAppropriationRule(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.yearEnd.saveRule(ctx, parse(appropriationRuleSchema, body), id);
  }

  @Get('year-end/:fiscalYearId/preview')
  @RequirePermissions('gl.close.manage')
  previewYearEnd(@CompanyCtx() ctx: CompanyContext, @Param('fiscalYearId', ParseUUIDPipe) id: string) {
    return this.yearEnd.preview(ctx, id);
  }

  @Post('year-end/close')
  @RequirePermissions('gl.close.manage')
  closeYear(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    const input = parse(yearEndSchema, body);
    return this.yearEnd.close(ctx, input.fiscal_year_id, input.apply_appropriations);
  }

  @Post('year-end/reopen')
  @RequirePermissions('gl.close.manage', 'gl.period.unlock')
  reopenYear(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.yearEnd.reopen(ctx, parse(yearEndSchema, body).fiscal_year_id);
  }

  // ---------------------------------------------------------------- statement designer
  @Get('statements')
  @RequirePermissions('gl.report.view')
  statements(@CompanyCtx() ctx: CompanyContext) {
    return this.analysis.listStatements(ctx);
  }

  @Post('statements')
  @RequirePermissions('gl.master.manage')
  createStatement(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.analysis.saveStatement(ctx, parse(statementSchema, body));
  }

  @Put('statements/:id')
  @RequirePermissions('gl.master.manage')
  updateStatement(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.analysis.saveStatement(ctx, parse(statementSchema, body), id);
  }

  @Delete('statements/:id')
  @RequirePermissions('gl.master.manage')
  deleteStatement(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.analysis.removeStatement(ctx, id);
  }

  // ---------------------------------------------------------------- Excel import
  @Get('import/templates/:kind')
  @RequirePermissions('gl.master.view')
  async importTemplate(@Param('kind') kind: string, @Res() res: Response) {
    if (kind !== 'accounts' && kind !== 'journals') throw new AppError('NOT_FOUND', { entity: 'template' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${kind}-template.xlsx"`);
    res.send(await this.imports.template(kind));
  }

  @Post('import/accounts')
  @RequirePermissions('gl.master.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importAccounts(@CompanyCtx() ctx: CompanyContext, @UploadedFile() file: { buffer: Buffer } | undefined, @Query('commit') commit?: string) {
    if (!file) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'file', message: 'File is required' }]);
    return this.imports.importAccounts(ctx, file.buffer, commit === 'true');
  }

  @Post('import/journals')
  @RequirePermissions('gl.journal.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  importJournals(@CompanyCtx() ctx: CompanyContext, @UploadedFile() file: { buffer: Buffer } | undefined, @Query('commit') commit?: string, @Query('post') post?: string) {
    if (!file) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'file', message: 'File is required' }]);
    if (post === 'true') assertPermission(ctx, 'gl.journal.post');
    return this.imports.importJournals(ctx, file.buffer, commit === 'true', post === 'true');
  }
}
