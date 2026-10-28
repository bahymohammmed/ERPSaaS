import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import {
  consolidatedPositionQuerySchema,
  consolidatedRangeQuerySchema,
  consolidationAdjustmentSchema,
  consolidationGroupSchema,
  costCenterVersionSchema,
  type DigitStyle,
  intercompanyPartnerSchema,
  intercompanyReconciliationQuerySchema,
  intercompanyTransactionSchema,
  type ReportDocument,
  type ReportLanguage,
} from '@erp/shared';
import type { Response } from 'express';
import { CompanyCtx, CompanyScoped, Ctx, RequirePermissions } from '../common/decorators';
import type { CompanyContext, RequestContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { ConsolidationService } from './consolidation.service';
import { CostCentersService } from './cost-centers.service';
import { ExportService } from './export/export.service';
import { IntercompanyService } from './intercompany.service';

type Format = { format: 'json' | 'pdf' | 'xlsx'; lang: ReportLanguage; digits: DigitStyle };

/** Sends a report as JSON or as a PDF / Excel file. */
const sendReport = async (exporter: ExportService, res: Response, f: Format, doc: ReportDocument): Promise<void> => {
  if (f.format === 'json') {
    res.json(doc);
    return;
  }
  const body = f.format === 'pdf' ? await exporter.pdf(doc, f.lang, f.digits) : await exporter.xlsx(doc, f.lang, f.digits);
  res.setHeader('Content-Type', f.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.reportKey}-${doc.generatedAt.slice(0, 10)}.${f.format}"`);
  res.send(body);
};

@Controller('gl')
@CompanyScoped()
export class Phase3CompanyController {
  constructor(
    private readonly intercompany: IntercompanyService,
    private readonly costCenters: CostCentersService,
    private readonly exporter: ExportService,
  ) {}

  @Get('intercompany/partners')
  @RequirePermissions('gl.master.view')
  partners(@CompanyCtx() ctx: CompanyContext) {
    return this.intercompany.listPartners(ctx);
  }

  @Post('intercompany/partners')
  @RequirePermissions('gl.master.manage')
  savePartner(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.intercompany.savePartner(ctx, parse(intercompanyPartnerSchema, body));
  }

  @Delete('intercompany/partners/:id')
  @RequirePermissions('gl.master.manage')
  removePartner(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.intercompany.removePartner(ctx, id);
  }

  @Post('intercompany/transactions')
  @RequirePermissions('gl.journal.create', 'gl.journal.post')
  createTransaction(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.intercompany.create(ctx, parse(intercompanyTransactionSchema, body));
  }

  @Get('reports/intercompany-reconciliation')
  @RequirePermissions('gl.report.view')
  async reconciliation(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(intercompanyReconciliationQuerySchema, query);
    await sendReport(this.exporter, res, q, await this.intercompany.reconciliation(ctx, q.as_of));
  }

  @Get('cost-center-versions')
  @RequirePermissions('gl.master.view')
  versions(@CompanyCtx() ctx: CompanyContext) {
    return this.costCenters.listVersions(ctx);
  }

  @Post('cost-center-versions')
  @RequirePermissions('gl.master.manage')
  createVersion(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.costCenters.createVersion(ctx, parse(costCenterVersionSchema, body));
  }

  @Delete('cost-center-versions/:id')
  @RequirePermissions('gl.master.manage')
  removeVersion(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.costCenters.removeVersion(ctx, id);
  }
}

/** Consolidation spans companies, so it is tenant-scoped rather than company-scoped. */
@Controller('consolidation')
export class ConsolidationController {
  constructor(
    private readonly consolidation: ConsolidationService,
    private readonly exporter: ExportService,
  ) {}

  @Get('groups')
  @RequirePermissions('gl.report.view')
  groups(@Ctx() ctx: RequestContext) {
    return this.consolidation.listGroups(ctx);
  }

  @Post('groups')
  @RequirePermissions('gl.consolidation.manage')
  createGroup(@Ctx() ctx: RequestContext, @Body() body: unknown) {
    return this.consolidation.saveGroup(ctx, parse(consolidationGroupSchema, body));
  }

  @Post('groups/:id')
  @RequirePermissions('gl.consolidation.manage')
  updateGroup(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.consolidation.saveGroup(ctx, parse(consolidationGroupSchema, body), id);
  }

  @Get('groups/:id/adjustments')
  @RequirePermissions('gl.report.view')
  adjustments(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.consolidation.listAdjustments(ctx, id);
  }

  @Post('groups/:id/adjustments')
  @RequirePermissions('gl.consolidation.manage')
  createAdjustment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.consolidation.saveAdjustment(ctx, id, parse(consolidationAdjustmentSchema, body));
  }

  @Delete('groups/:id/adjustments/:adjustmentId')
  @RequirePermissions('gl.consolidation.manage')
  removeAdjustment(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Param('adjustmentId', ParseUUIDPipe) adjustmentId: string) {
    return this.consolidation.removeAdjustment(ctx, id, adjustmentId);
  }

  @Get('groups/:id/worksheet')
  @RequirePermissions('gl.report.view')
  async worksheet(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const q = parse(consolidatedPositionQuerySchema, query);
    await sendReport(this.exporter, res, q, await this.consolidation.worksheet(ctx, id, q.as_of));
  }

  @Get('groups/:id/balance-sheet')
  @RequirePermissions('gl.report.view')
  async balanceSheet(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const q = parse(consolidatedPositionQuerySchema, query);
    await sendReport(this.exporter, res, q, await this.consolidation.balanceSheet(ctx, id, q.as_of));
  }

  @Get('groups/:id/income-statement')
  @RequirePermissions('gl.report.view')
  async incomeStatement(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const q = parse(consolidatedRangeQuerySchema, query);
    await sendReport(this.exporter, res, q, await this.consolidation.incomeStatement(ctx, id, q.from, q.to));
  }
}
