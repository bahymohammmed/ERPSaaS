import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { config } from '../config';
import { DbService } from '../db/db.service';

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
]);

export type UploadedFile = { originalname: string; mimetype: string; size: number; buffer: Buffer };

/** Supporting documents for journal entries, stored under a tenant/company prefix. */
@Injectable()
export class AttachmentsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  upload(ctx: CompanyContext, entryId: string, file: UploadedFile | undefined) {
    if (!file) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'file', message: 'File is required' }]);
    if (file.size > MAX_BYTES) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'file', message: 'Maximum size is 10 MB' }]);
    if (!ALLOWED_TYPES.has(file.mimetype)) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'file', message: 'Unsupported file type' }]);
    return this.db.withTenant(ctx, async (tx) => {
      const entry = await tx.maybeOne('SELECT 1 FROM gl.journal_entries WHERE company_id = $1 AND id = $2', [ctx.companyId, entryId]);
      if (!entry) throw notFound('journal entry');
      const storageKey = join(ctx.tenantId, ctx.companyId, `${randomUUID()}`);
      const path = resolve(config.storageDir, storageKey);
      await mkdir(resolve(path, '..'), { recursive: true });
      await writeFile(path, file.buffer);
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.attachments (tenant_id, company_id, entry_id, file_name, content_type, size_bytes, storage_key, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, file_name, content_type, size_bytes, uploaded_at`,
        [ctx.tenantId, ctx.companyId, entryId, file.originalname.slice(0, 255), file.mimetype, file.size, storageKey, ctx.userId],
      );
      await this.audit.record(tx, ctx, { action: 'attach', entityType: 'journal_entry', entityId: entryId, companyId: ctx.companyId, newData: { file: file.originalname } });
      return row;
    });
  }

  async open(ctx: CompanyContext, id: string) {
    const row = await this.db.withTenant(ctx, (tx) =>
      tx.maybeOne<{ file_name: string; content_type: string; storage_key: string }>(
        'SELECT file_name, content_type, storage_key FROM gl.attachments WHERE company_id = $1 AND id = $2',
        [ctx.companyId, id],
      ),
    );
    if (!row) throw notFound('attachment');
    return { ...row, stream: createReadStream(resolve(config.storageDir, row.storage_key)) };
  }

  remove(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const row = await tx.maybeOne<{ storage_key: string; entry_id: string; status: string; file_name: string }>(
        `SELECT a.storage_key, a.entry_id, e.status, a.file_name FROM gl.attachments a JOIN gl.journal_entries e ON e.id = a.entry_id
         WHERE a.company_id = $1 AND a.id = $2`,
        [ctx.companyId, id],
      );
      if (!row) throw notFound('attachment');
      if (row.status !== 'DRAFT') throw new AppError('POSTED_IMMUTABLE');
      await tx.query('DELETE FROM gl.attachments WHERE id = $1', [id]);
      await this.audit.record(tx, ctx, { action: 'detach', entityType: 'journal_entry', entityId: row.entry_id, companyId: ctx.companyId, oldData: { file: row.file_name } });
      await unlink(resolve(config.storageDir, row.storage_key)).catch(() => undefined);
      return { deleted: true };
    });
  }
}
