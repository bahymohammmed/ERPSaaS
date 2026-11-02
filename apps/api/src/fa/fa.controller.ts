import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  type DigitStyle,
  faActivateSchema,
  faAssetSchema,
  faCategorySchema,
  faDisposeSchema,
  faForecastQuerySchema,
  faMovementQuerySchema,
  faRegisterQuerySchema,
  faRunSchema,
  faTransferSchema,
  type ReportDocument,
  type ReportLanguage,
} from '@erp/shared';
import type { Response } from 'express';
import { z } from 'zod';
import { AppError } from '../common/app-error';
import { CompanyCtx, CompanyScoped, RequirePermissions } from '../common/decorators';
import type { CompanyContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { ExportService } from '../gl/export/export.service';
import { FaReportsService } from './fa-reports.service';
import { FixedAssetsService } from './fixed-assets.service';

const assetFilterSchema = z.object({
  status: z.enum(['DRAFT', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED']).optional(),
  category_id: z.string().uuid().optional(),
  search: z.string().max(100).optional(),
});

type Format = { format: 'json' | 'pdf' | 'xlsx'; lang: ReportLanguage; digits: DigitStyle };

@Controller('fa')
@CompanyScoped()
@RequirePermissions('fa.view')
export class FixedAssetsController {
  constructor(
    private readonly assets: FixedAssetsService,
    private readonly reports: FaReportsService,
    private readonly exporter: ExportService,
  ) {}

  // ---------------------------------------------------------------- categories

  @Get('categories')
  categories(@CompanyCtx() ctx: CompanyContext) {
    return this.assets.listCategories(ctx);
  }

  @Post('categories')
  @RequirePermissions('fa.manage')
  createCategory(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.assets.saveCategory(ctx, parse(faCategorySchema, body));
  }

  @Put('categories/:id')
  @RequirePermissions('fa.manage')
  updateCategory(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.assets.saveCategory(ctx, parse(faCategorySchema, body), id);
  }

  @Delete('categories/:id')
  @RequirePermissions('fa.manage')
  removeCategory(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.removeCategory(ctx, id);
  }

  // ---------------------------------------------------------------- register

  @Get('assets')
  list(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown) {
    return this.assets.listAssets(ctx, parse(assetFilterSchema, query));
  }

  @Post('assets')
  @RequirePermissions('fa.manage')
  create(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.assets.createAsset(ctx, parse(faAssetSchema, body));
  }

  @Get('assets/:id')
  get(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.getAsset(ctx, id);
  }

  @Put('assets/:id')
  @RequirePermissions('fa.manage')
  update(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.assets.updateAsset(ctx, id, parse(faAssetSchema, body));
  }

  @Delete('assets/:id')
  @RequirePermissions('fa.manage')
  remove(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.removeAsset(ctx, id);
  }

  @Post('assets/:id/activate')
  @HttpCode(200)
  @RequirePermissions('fa.manage')
  activate(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.assets.activate(ctx, id, parse(faActivateSchema, body));
  }

  @Post('assets/:id/transfer')
  @HttpCode(200)
  @RequirePermissions('fa.manage')
  transfer(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.assets.transfer(ctx, id, parse(faTransferSchema, body));
  }

  @Post('assets/:id/dispose')
  @HttpCode(200)
  @RequirePermissions('fa.manage')
  dispose(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.assets.dispose(ctx, id, parse(faDisposeSchema, body));
  }

  @Post('assets/:id/reverse-disposal')
  @HttpCode(200)
  @RequirePermissions('fa.manage')
  reverseDisposal(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.reverseDisposal(ctx, id);
  }

  // ---------------------------------------------------------------- depreciation

  @Get('depreciation/runs')
  runs(@CompanyCtx() ctx: CompanyContext) {
    return this.assets.listRuns(ctx);
  }

  @Post('depreciation/preview')
  @HttpCode(200)
  @RequirePermissions('fa.manage')
  preview(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.assets.previewRun(ctx, parse(faRunSchema, body).period_id);
  }

  @Post('depreciation/run')
  @RequirePermissions('fa.manage')
  run(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.assets.postRun(ctx, parse(faRunSchema, body).period_id);
  }

  @Post('depreciation/runs/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('fa.manage')
  reverseRun(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.assets.reverseRun(ctx, id);
  }

  // ---------------------------------------------------------------- import

  @Get('import/template')
  async template(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="fixed-assets-template.xlsx"');
    res.send(await this.assets.importTemplate());
  }

  @Post('import')
  @RequirePermissions('fa.manage')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  import(@CompanyCtx() ctx: CompanyContext, @UploadedFile() file: { buffer: Buffer } | undefined, @Query('commit') commit?: string) {
    if (!file) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'file', message: 'File is required' }]);
    return this.assets.importAssets(ctx, file.buffer, commit === 'true');
  }

  // ---------------------------------------------------------------- reports

  @Get('reports/register')
  async register(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(faRegisterQuerySchema, query);
    await this.send(res, q, await this.reports.register(ctx, q));
  }

  @Get('reports/movement')
  async movement(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(faMovementQuerySchema, query);
    await this.send(res, q, await this.reports.movement(ctx, q));
  }

  @Get('reports/forecast')
  async forecast(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown, @Res() res: Response) {
    const q = parse(faForecastQuerySchema, query);
    await this.send(res, q, await this.reports.forecast(ctx, q));
  }

  private async send(res: Response, f: Format, doc: ReportDocument): Promise<void> {
    if (f.format === 'json') {
      res.json(doc);
      return;
    }
    const body = f.format === 'pdf' ? await this.exporter.pdf(doc, f.lang, f.digits) : await this.exporter.xlsx(doc, f.lang, f.digits);
    res.setHeader('Content-Type', f.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.reportKey}-${doc.generatedAt.slice(0, 10)}.${f.format}"`);
    res.send(body);
  }
}
