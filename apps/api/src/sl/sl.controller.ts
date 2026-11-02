import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import {
  agingQuerySchema,
  bankAccountSchema,
  bankTransferSchema,
  type DigitStyle,
  documentPrintQuerySchema,
  type LedgerSide,
  ledgerSideSchema,
  partyDocumentSchema,
  partySchema,
  partyStatementQuerySchema,
  type Permission,
  reconciliationItemsSchema,
  reconciliationSchema,
  type ReportDocument,
  type ReportLanguage,
  settlementSchema,
  voidSchema,
} from '@erp/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { CompanyCtx, CompanyScoped, RequirePermissions } from '../common/decorators';
import { assertPermission, type CompanyContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { ExportService } from '../gl/export/export.service';
import { BankService } from './bank.service';
import { SlReportsService } from './sl-reports.service';
import { SubledgerService } from './subledger.service';

type Format = { format: 'json' | 'pdf' | 'xlsx'; lang: ReportLanguage; digits: DigitStyle };

const documentFilter = z.object({
  party_id: z.string().uuid().optional(),
  status: z.enum(['DRAFT', 'POSTED', 'VOID']).optional(),
  doc_type: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']).optional(),
  open: z.enum(['true', 'false']).optional(),
});
const postBody = z.object({ allocations: z.array(z.object({ document_id: z.string().uuid(), amount: z.union([z.string(), z.number()]).transform(String) })).default([]) });

const sendReport = async (exporter: ExportService, res: Response, f: Format, doc: ReportDocument) => {
  if (f.format === 'json') {
    res.json(doc);
    return;
  }
  const body = f.format === 'pdf' ? await exporter.pdf(doc, f.lang, f.digits) : await exporter.xlsx(doc, f.lang, f.digits);
  res.setHeader('Content-Type', f.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${doc.reportKey}-${doc.generatedAt.slice(0, 10)}.${f.format}"`);
  res.send(body);
};

/** Customers (AR) and suppliers (AP) share one API: /sl/AR/... and /sl/AP/... */
@Controller('sl/:side')
@CompanyScoped()
export class SubledgerController {
  constructor(
    private readonly sl: SubledgerService,
    private readonly reports: SlReportsService,
    private readonly exporter: ExportService,
  ) {}

  private side(ctx: CompanyContext, raw: string, action: 'view' | 'manage'): LedgerSide {
    const side = parse(ledgerSideSchema, raw);
    assertPermission(ctx, `${side.toLowerCase()}.${action}` as Permission);
    return side;
  }

  @Get('parties')
  parties(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string) {
    return this.sl.listParties(ctx, this.side(ctx, side, 'view'));
  }

  @Post('parties')
  createParty(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Body() body: unknown) {
    return this.sl.saveParty(ctx, this.side(ctx, side, 'manage'), parse(partySchema, body));
  }

  @Put('parties/:id')
  updateParty(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.sl.saveParty(ctx, this.side(ctx, side, 'manage'), parse(partySchema, body), id);
  }

  @Get('documents')
  documents(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Query() query: unknown) {
    const f = parse(documentFilter, query);
    return this.sl.listDocuments(ctx, this.side(ctx, side, 'view'), { ...f, open: f.open === 'true' });
  }

  @Post('documents')
  createDocument(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Body() body: unknown) {
    return this.sl.createDocument(ctx, this.side(ctx, side, 'manage'), parse(partyDocumentSchema, body));
  }

  @Get('documents/:id')
  document(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sl.getDocument(ctx, this.side(ctx, side, 'view'), id);
  }

  @Get('documents/:id/print')
  async print(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Res() res: Response) {
    const q = parse(documentPrintQuerySchema, query);
    await sendReport(this.exporter, res, q, await this.reports.printDocument(ctx, this.side(ctx, side, 'view'), id));
  }

  @Put('documents/:id')
  updateDocument(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.sl.updateDocument(ctx, this.side(ctx, side, 'manage'), id, parse(partyDocumentSchema, body));
  }

  @Delete('documents/:id')
  deleteDocument(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sl.deleteDocument(ctx, this.side(ctx, side, 'manage'), id);
  }

  @Post('documents/:id/post')
  @HttpCode(200)
  postDocument(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.sl.postDocument(ctx, this.side(ctx, side, 'manage'), id, parse(postBody, body ?? {}).allocations);
  }

  @Post('documents/:id/void')
  @HttpCode(200)
  voidDocument(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.sl.voidDocument(ctx, this.side(ctx, side, 'manage'), id, parse(voidSchema, body ?? {}).void_date);
  }

  @Get('settlements')
  settlements(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Query('party_id') partyId?: string) {
    return this.sl.listSettlements(ctx, this.side(ctx, side, 'view'), { party_id: partyId || undefined });
  }

  @Post('settlements')
  createSettlement(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Body() body: unknown) {
    return this.sl.createSettlement(ctx, this.side(ctx, side, 'manage'), parse(settlementSchema, body));
  }

  @Get('settlements/:id')
  settlement(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sl.getSettlement(ctx, this.side(ctx, side, 'view'), id);
  }

  @Post('settlements/:id/void')
  @HttpCode(200)
  voidSettlement(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.sl.voidSettlement(ctx, this.side(ctx, side, 'manage'), id, parse(voidSchema, body ?? {}).void_date);
  }

  @Get('reports/aging')
  async aging(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Query() query: unknown, @Res() res: Response) {
    const q = parse(agingQuerySchema, query);
    await sendReport(this.exporter, res, q, await this.reports.aging(ctx, this.side(ctx, side, 'view'), q));
  }

  @Get('reports/statement')
  async statement(@CompanyCtx() ctx: CompanyContext, @Param('side') side: string, @Query() query: unknown, @Res() res: Response) {
    const q = parse(partyStatementQuerySchema, query);
    await sendReport(this.exporter, res, q, await this.reports.statement(ctx, this.side(ctx, side, 'view'), q));
  }
}

@Controller('cb')
@CompanyScoped()
@RequirePermissions('cb.view')
export class BankController {
  constructor(private readonly bank: BankService) {}

  @Get('accounts')
  accounts(@CompanyCtx() ctx: CompanyContext) {
    return this.bank.listAccounts(ctx);
  }

  @Post('accounts')
  @RequirePermissions('cb.manage')
  createAccount(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.bank.saveAccount(ctx, parse(bankAccountSchema, body));
  }

  @Put('accounts/:id')
  @RequirePermissions('cb.manage')
  updateAccount(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.bank.saveAccount(ctx, parse(bankAccountSchema, body), id);
  }

  @Get('transfers')
  transfers(@CompanyCtx() ctx: CompanyContext) {
    return this.bank.listTransfers(ctx);
  }

  @Post('transfers')
  @RequirePermissions('cb.manage')
  transfer(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.bank.transfer(ctx, parse(bankTransferSchema, body));
  }

  @Get('accounts/:id/reconciliations')
  reconciliations(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bank.listReconciliations(ctx, id);
  }

  @Post('reconciliations')
  @RequirePermissions('cb.manage')
  startReconciliation(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.bank.startReconciliation(ctx, parse(reconciliationSchema, body));
  }

  @Get('reconciliations/:id')
  reconciliation(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bank.getReconciliation(ctx, id);
  }

  @Put('reconciliations/:id/items')
  @RequirePermissions('cb.manage')
  setItems(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.bank.setItems(ctx, id, parse(reconciliationItemsSchema, body).line_ids);
  }

  @Post('reconciliations/:id/complete')
  @HttpCode(200)
  @RequirePermissions('cb.manage')
  complete(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bank.complete(ctx, id);
  }

  @Delete('reconciliations/:id')
  @RequirePermissions('cb.manage')
  remove(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.bank.deleteReconciliation(ctx, id);
  }
}
