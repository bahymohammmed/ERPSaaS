import { Controller, Get, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import {
  balanceSheetQuerySchema,
  budgetVsActualQuerySchema,
  cashFlowQuerySchema,
  costCenterReportQuerySchema,
  costCenterSummaryQuerySchema,
  type DigitStyle,
  incomeStatementQuerySchema,
  journalRegisterQuerySchema,
  ledgerQuerySchema,
  type ReportDocument,
  type ReportLanguage,
  statementQuerySchema,
  trialBalanceQuerySchema,
  voucherQuerySchema,
} from '@erp/shared';
import type { Response } from 'express';
import { CompanyCtx, CompanyScoped, RequirePermissions } from '../common/decorators';
import type { CompanyContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { AnalysisReportsService } from './analysis-reports.service';
import { ExportService } from './export/export.service';
import { ReportsService } from './reports.service';

type Format = { format: 'json' | 'pdf' | 'xlsx'; lang: ReportLanguage; digits: DigitStyle };

@Controller('gl/reports')
@CompanyScoped()
@RequirePermissions('gl.report.view')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly exporter: ExportService,
    private readonly analysis: AnalysisReportsService,
  ) {}

  @Get('budget-vs-actual')
  async budgetVsActual(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(budgetVsActualQuerySchema, query);
    await this.send(res, q, await this.analysis.budgetVsActual(ctx, q));
  }

  @Get('cash-flow')
  async cashFlow(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(cashFlowQuerySchema, query);
    await this.send(res, q, await this.analysis.cashFlow(ctx, q));
  }

  @Get('statement')
  async statement(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(statementQuerySchema, query);
    await this.send(res, q, await this.analysis.statement(ctx, q));
  }

  @Get('voucher/:id')
  @RequirePermissions('gl.journal.view')
  async voucher(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const q = parse(voucherQuerySchema, query);
    await this.send(res, q, await this.analysis.voucher(ctx, id));
  }

  @Get('trial-balance')
  async trialBalance(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(trialBalanceQuerySchema, query);
    await this.send(res, q, await this.reports.trialBalance(ctx, q));
  }

  @Get('ledger')
  async ledger(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(ledgerQuerySchema, query);
    await this.send(res, q, await this.reports.ledger(ctx, q));
  }

  @Get('journal-register')
  async register(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(journalRegisterQuerySchema, query);
    await this.send(res, q, await this.reports.journalRegister(ctx, q));
  }

  @Get('cost-center-matrix')
  async costCenterMatrix(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(costCenterReportQuerySchema, query);
    await this.send(res, q, await this.reports.costCenterMatrix(ctx, q));
  }

  @Get('cost-center-summary')
  async costCenterSummary(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(costCenterSummaryQuerySchema, query);
    await this.send(res, q, await this.reports.costCenterSummary(ctx, q));
  }

  @Get('income-statement')
  async incomeStatement(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(incomeStatementQuerySchema, query);
    await this.send(res, q, await this.reports.incomeStatement(ctx, q));
  }

  @Get('balance-sheet')
  async balanceSheet(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(balanceSheetQuerySchema, query);
    await this.send(res, q, await this.reports.balanceSheet(ctx, q));
  }

  private async send(res: Response, f: Format, doc: ReportDocument): Promise<void> {
    if (f.format === 'json') {
      res.json(doc);
      return;
    }
    const fileName = `${doc.reportKey}-${doc.generatedAt.slice(0, 10)}.${f.format}`;
    const body = f.format === 'pdf' ? await this.exporter.pdf(doc, f.lang, f.digits) : await this.exporter.xlsx(doc, f.lang, f.digits);
    res.setHeader('Content-Type', f.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(body);
  }
}
