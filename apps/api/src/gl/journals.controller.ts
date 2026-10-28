import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { journalEntrySchema, journalListQuerySchema, postingRequestSchema, rejectSchema, reverseSchema } from '@erp/shared';
import type { Response } from 'express';
import { CompanyCtx, CompanyScoped, RequirePermissions } from '../common/decorators';
import type { CompanyContext } from '../common/request-context';
import { parse } from '../common/zod.pipe';
import { AttachmentsService, type UploadedFile as Upload } from './attachments.service';
import { JournalsService } from './journals.service';

@Controller('gl')
@CompanyScoped()
export class JournalsController {
  constructor(
    private readonly journals: JournalsService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get('journals')
  @RequirePermissions('gl.journal.view')
  list(@CompanyCtx() ctx: CompanyContext, @Query() query: unknown) {
    return this.journals.list(ctx, parse(journalListQuerySchema, query));
  }

  @Get('journals/:id')
  @RequirePermissions('gl.journal.view')
  get(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.get(ctx, id);
  }

  @Get('journals/:id/audit')
  @RequirePermissions('gl.journal.view')
  audit(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.auditTrail(ctx, id);
  }

  @Post('journals')
  @RequirePermissions('gl.journal.create')
  create(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.journals.createDraft(ctx, parse(journalEntrySchema, body));
  }

  @Put('journals/:id')
  @RequirePermissions('gl.journal.create')
  update(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.journals.updateDraft(ctx, id, parse(journalEntrySchema, body));
  }

  @Delete('journals/:id')
  @RequirePermissions('gl.journal.create')
  remove(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.deleteDraft(ctx, id);
  }

  @Post('journals/:id/submit')
  @RequirePermissions('gl.journal.create')
  submit(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.submit(ctx, id);
  }

  @Post('journals/:id/approve')
  @RequirePermissions('gl.journal.approve')
  approve(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.approve(ctx, id);
  }

  @Post('journals/:id/reject')
  @RequirePermissions('gl.journal.approve')
  reject(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.journals.reject(ctx, id, parse(rejectSchema, body).reason);
  }

  @Post('journals/:id/post')
  @RequirePermissions('gl.journal.post')
  post(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.journals.post(ctx, id);
  }

  @Post('journals/:id/reverse')
  @RequirePermissions('gl.journal.reverse')
  reverse(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.journals.reverse(ctx, id, parse(reverseSchema, body ?? {}));
  }

  /** Integration endpoint for sub-ledgers: validates and posts in one call, idempotent per key. */
  @Post('postings')
  @RequirePermissions('gl.journal.post')
  postExternal(@CompanyCtx() ctx: CompanyContext, @Body() body: unknown) {
    return this.journals.postExternal(ctx, parse(postingRequestSchema, body));
  }

  @Post('journals/:id/attachments')
  @RequirePermissions('gl.journal.create')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Upload) {
    return this.attachments.upload(ctx, id, file);
  }

  @Get('attachments/:id')
  @RequirePermissions('gl.journal.view')
  async download(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const file = await this.attachments.open(ctx, id);
    res.setHeader('Content-Type', file.content_type);
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.file_name)}`);
    file.stream.pipe(res);
  }

  @Delete('attachments/:id')
  @RequirePermissions('gl.journal.create')
  removeAttachment(@CompanyCtx() ctx: CompanyContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.attachments.remove(ctx, id);
  }
}
