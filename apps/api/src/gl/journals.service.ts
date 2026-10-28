import { Injectable } from '@nestjs/common';
import { type JournalEntryInput, type PostingRequest, toMoney } from '@erp/shared';
import type { z } from 'zod';
import type { journalListQuerySchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { scopedCostCenterIds } from './cost-centers.service';
import { FiscalService } from './fiscal.service';
import { type CompanyInfo, type EntryRow, loadCompany, PostingEngine } from './posting.engine';

type ListQuery = z.infer<typeof journalListQuerySchema>;

@Injectable()
export class JournalsService {
  constructor(
    private readonly db: DbService,
    private readonly fiscal: FiscalService,
    private readonly engine: PostingEngine,
    private readonly audit: AuditService,
  ) {}

  list(ctx: CompanyContext, query: ListQuery) {
    return this.db.withTenant(ctx, async (tx) => {
      const scope = await scopedCostCenterIds(tx, ctx);
      const params = [
        ctx.companyId,
        query.status ?? null,
        query.journal_type_id ?? null,
        query.from ?? null,
        query.to ?? null,
        query.search ? `%${query.search}%` : null,
        scope,
        ctx.userId,
      ];
      const where = `e.company_id = $1
        AND ($2::text IS NULL OR e.status = $2)
        AND ($3::uuid IS NULL OR e.journal_type_id = $3)
        AND ($4::date IS NULL OR e.entry_date >= $4)
        AND ($5::date IS NULL OR e.entry_date <= $5)
        AND ($6::text IS NULL OR e.entry_no ILIKE $6 OR e.description ILIKE $6 OR e.reference ILIKE $6)
        AND ($7::uuid[] IS NULL OR e.created_by = $8 OR EXISTS (
              SELECT 1 FROM gl.journal_lines l WHERE l.entry_id = e.id AND l.cost_center_id = ANY($7)))`;
      const [count] = await tx.query<{ total: number }>(`SELECT count(*)::int AS total FROM gl.journal_entries e WHERE ${where}`, params);
      const rows = await tx.query(
        `SELECT e.id, e.entry_no, e.entry_date, e.status, e.description, e.reference, e.total_debit, e.total_credit,
                e.source_module, e.created_at, e.posted_at, jt.code AS journal_type_code, jt.name_ar AS journal_type_name_ar,
                jt.name_en AS journal_type_name_en, p.code AS period_code, u.full_name AS created_by_name
         FROM gl.journal_entries e
         JOIN gl.journal_types jt ON jt.id = e.journal_type_id
         JOIN gl.fiscal_periods p ON p.id = e.period_id
         LEFT JOIN core.users u ON u.id = e.created_by
         WHERE ${where}
         ORDER BY e.entry_date DESC, e.created_at DESC
         LIMIT ${query.page_size} OFFSET ${(query.page - 1) * query.page_size}`,
        params,
      );
      return { total: count?.total ?? 0, page: query.page, page_size: query.page_size, rows };
    });
  }

  get(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, (tx) => this.load(tx, ctx, id));
  }

  createDraft(ctx: CompanyContext, input: JournalEntryInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const type = await this.journalType(tx, ctx.companyId, input.journal_type_id);
      if (type.is_system) throw new AppError('JOURNAL_SYSTEM_TYPE', { code: type.code });
      const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, input.entry_date, input.adjustment_period);
      assertAutoReverse(input);
      const entry = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date,
           description, reference, source_module, created_by, auto_reverse_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GL', $9, $10) RETURNING id`,
        [
          ctx.tenantId,
          ctx.companyId,
          type.id,
          period.fiscal_year_id,
          period.id,
          input.entry_date,
          input.description ?? null,
          input.reference ?? null,
          ctx.userId,
          input.auto_reverse_date ?? null,
        ],
      );
      await this.writeLines(tx, ctx, company, entry.id, input);
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'journal_entry', entityId: entry.id, companyId: ctx.companyId, newData: input });
      return this.load(tx, ctx, entry.id);
    });
  }

  updateDraft(ctx: CompanyContext, id: string, input: JournalEntryInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const entry = await this.engine.lockEntry(tx, ctx.companyId, id);
      if (entry.status !== 'DRAFT') throw new AppError('JOURNAL_NOT_EDITABLE');
      if (input.version !== undefined && input.version !== entry.version) throw new AppError('CONCURRENT_MODIFICATION');
      const type = await this.journalType(tx, ctx.companyId, input.journal_type_id);
      if (type.is_system) throw new AppError('JOURNAL_SYSTEM_TYPE', { code: type.code });
      const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, input.entry_date, input.adjustment_period);
      const before = await this.load(tx, ctx, id);
      assertAutoReverse(input);
      await tx.query(
        `UPDATE gl.journal_entries SET journal_type_id = $3, fiscal_year_id = $4, period_id = $5, entry_date = $6,
           description = $7, reference = $8, updated_by = $9, version = version + 1, rejection_reason = NULL,
           auto_reverse_date = $10
         WHERE company_id = $1 AND id = $2`,
        [
          ctx.companyId,
          id,
          type.id,
          period.fiscal_year_id,
          period.id,
          input.entry_date,
          input.description ?? null,
          input.reference ?? null,
          ctx.userId,
          input.auto_reverse_date ?? null,
        ],
      );
      await tx.query('DELETE FROM gl.journal_lines WHERE company_id = $1 AND entry_id = $2', [ctx.companyId, id]);
      await this.writeLines(tx, ctx, company, id, input);
      await this.audit.record(tx, ctx, { action: 'update', entityType: 'journal_entry', entityId: id, companyId: ctx.companyId, oldData: before, newData: input });
      return this.load(tx, ctx, id);
    });
  }

  deleteDraft(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const entry = await this.engine.lockEntry(tx, ctx.companyId, id);
      if (entry.status !== 'DRAFT') throw new AppError('JOURNAL_NOT_EDITABLE');
      const before = await this.load(tx, ctx, id);
      await tx.query('DELETE FROM gl.journal_entries WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'journal_entry', entityId: id, companyId: ctx.companyId, oldData: before });
      return { deleted: true };
    });
  }

  submit(ctx: CompanyContext, id: string) {
    return this.transition(ctx, id, 'submit', ['DRAFT'], async (tx, entry, company) => {
      await this.engine.validate(tx, ctx, company, entry);
      await tx.query(
        `UPDATE gl.journal_entries SET status = 'SUBMITTED', submitted_by = $3, submitted_at = now(), updated_by = $3,
           rejection_reason = NULL, version = version + 1 WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, id, ctx.userId],
      );
    });
  }

  approve(ctx: CompanyContext, id: string) {
    return this.transition(ctx, id, 'approve', ['SUBMITTED'], async (tx, entry, company) => {
      if (entry.created_by === ctx.userId) throw new AppError('JOURNAL_SELF_APPROVAL');
      await this.engine.validate(tx, ctx, company, entry);
      await tx.query(
        `UPDATE gl.journal_entries SET status = 'APPROVED', approved_by = $3, approved_at = now(), updated_by = $3,
           version = version + 1 WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, id, ctx.userId],
      );
    });
  }

  reject(ctx: CompanyContext, id: string, reason: string) {
    return this.transition(ctx, id, 'reject', ['SUBMITTED', 'APPROVED'], async (tx) => {
      await tx.query(
        `UPDATE gl.journal_entries SET status = 'DRAFT', rejection_reason = $3, submitted_by = NULL, submitted_at = NULL,
           approved_by = NULL, approved_at = NULL, updated_by = $4, version = version + 1 WHERE company_id = $1 AND id = $2`,
        [ctx.companyId, id, reason, ctx.userId],
      );
    });
  }

  post(ctx: CompanyContext, id: string) {
    return this.transition(ctx, id, 'post', ['DRAFT', 'SUBMITTED', 'APPROVED'], async (tx, entry, company) => {
      if (company.require_approval && entry.status !== 'APPROVED' && !(await this.belowThreshold(tx, company, id))) {
        throw new AppError('JOURNAL_APPROVAL_REQUIRED');
      }
      await this.engine.post(tx, ctx, company, entry);
    });
  }

  /** Creates and posts a mirror entry (debits ⇄ credits, same rates and base amounts). */
  reverse(ctx: CompanyContext, id: string, input: { reversal_date?: string; description?: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const reversalId = await this.engine.reverse(tx, ctx, company, id, { date: input.reversal_date, description: input.description });
      return this.load(tx, ctx, reversalId);
    });
  }

  /**
   * Programmatic posting for sub-ledgers and integrations. Idempotent on idempotency_key:
   * a retry returns the entry created by the first call.
   */
  postExternal(ctx: CompanyContext, request: PostingRequest) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await tx.maybeOne<{ id: string }>(
        'SELECT id FROM gl.journal_entries WHERE company_id = $1 AND idempotency_key = $2',
        [ctx.companyId, request.idempotency_key],
      );
      if (existing) return { ...(await this.load(tx, ctx, existing.id)), idempotent_replay: true };

      const company = await loadCompany(tx, ctx.companyId);
      assertAutoReverse(request);
      const type = await tx.maybeOne<{ id: string; source_module: string; is_active: boolean }>(
        'SELECT id, source_module, is_active FROM gl.journal_types WHERE company_id = $1 AND code = $2',
        [ctx.companyId, request.journal_type_code],
      );
      if (!type || !type.is_active) throw notFound('journal type');
      const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, request.entry_date, request.adjustment_period);
      const entry = await tx.one<{ id: string }>(
        `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date,
           description, reference, source_module, source_doc_type, source_doc_id, idempotency_key, created_by, auto_reverse_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [
          ctx.tenantId,
          ctx.companyId,
          type.id,
          period.fiscal_year_id,
          period.id,
          request.entry_date,
          request.description ?? null,
          request.reference ?? null,
          request.source_module,
          request.source_doc_type,
          request.source_doc_id,
          request.idempotency_key,
          ctx.userId,
          request.auto_reverse_date ?? null,
        ],
      );
      await this.writeLines(tx, ctx, company, entry.id, request);
      const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
      await this.engine.post(tx, ctx, company, locked);
      return { ...(await this.load(tx, ctx, entry.id)), idempotent_replay: false };
    });
  }

  auditTrail(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT a.id, a.occurred_at, a.action, a.old_data, a.new_data, u.full_name AS user_name
         FROM core.audit_log a LEFT JOIN core.users u ON u.id = a.user_id
         WHERE a.entity_type = 'journal_entry' AND a.entity_id = $1 ORDER BY a.occurred_at`,
        [id],
      ),
    );
  }

  // ---------------------------------------------------------------- helpers

  private async transition(
    ctx: CompanyContext,
    id: string,
    action: 'submit' | 'approve' | 'reject' | 'post',
    allowed: string[],
    apply: (tx: Tx, entry: EntryRow, company: CompanyInfo) => Promise<void>,
  ) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const entry = await this.engine.lockEntry(tx, ctx.companyId, id);
      if (!allowed.includes(entry.status)) throw new AppError('JOURNAL_INVALID_TRANSITION', { action, status: entry.status });
      if (entry.source_module !== 'GL' && action !== 'post') throw new AppError('JOURNAL_INVALID_TRANSITION', { action, status: entry.status });
      await apply(tx, entry, company);
      if (action !== 'post') {
        await this.audit.record(tx, ctx, { action, entityType: 'journal_entry', entityId: id, companyId: ctx.companyId, oldData: { status: entry.status } });
      }
      return this.load(tx, ctx, id);
    });
  }

  private async writeLines(tx: Tx, ctx: CompanyContext, company: CompanyInfo, entryId: string, input: JournalEntryInput | PostingRequest): Promise<void> {
    const totals = await this.engine.insertLines(tx, ctx, company, entryId, input.entry_date, input.lines);
    await tx.query('UPDATE gl.journal_entries SET total_debit = $3, total_credit = $4 WHERE company_id = $1 AND id = $2', [
      ctx.companyId,
      entryId,
      totals.debit.toFixed(4),
      totals.credit.toFixed(4),
    ]);
  }

  /** Entries below the company's approval threshold may be posted without approval. */
  private async belowThreshold(tx: Tx, company: CompanyInfo, entryId: string): Promise<boolean> {
    if (company.approval_threshold === null) return false;
    const row = await tx.one<{ total_debit: string }>('SELECT total_debit FROM gl.journal_entries WHERE id = $1', [entryId]);
    return toMoney(row.total_debit).lessThan(company.approval_threshold);
  }

  private async journalType(tx: Tx, companyId: string, id: string) {
    const type = await tx.maybeOne<{ id: string; code: string; is_system: boolean; is_active: boolean }>(
      'SELECT id, code, is_system, is_active FROM gl.journal_types WHERE company_id = $1 AND id = $2',
      [companyId, id],
    );
    if (!type || !type.is_active) throw notFound('journal type');
    return type;
  }

  private async load(tx: Tx, ctx: CompanyContext, id: string) {
    const header = await tx.maybeOne(
      `SELECT e.*, jt.code AS journal_type_code, jt.name_ar AS journal_type_name_ar, jt.name_en AS journal_type_name_en,
              p.code AS period_code, p.name_ar AS period_name_ar, p.name_en AS period_name_en,
              cu.full_name AS created_by_name, su.full_name AS submitted_by_name, au.full_name AS approved_by_name,
              pu.full_name AS posted_by_name, rev.entry_no AS reversed_by_no, orig.entry_no AS reversal_of_no
       FROM gl.journal_entries e
       JOIN gl.journal_types jt ON jt.id = e.journal_type_id
       JOIN gl.fiscal_periods p ON p.id = e.period_id
       LEFT JOIN core.users cu ON cu.id = e.created_by
       LEFT JOIN core.users su ON su.id = e.submitted_by
       LEFT JOIN core.users au ON au.id = e.approved_by
       LEFT JOIN core.users pu ON pu.id = e.posted_by
       LEFT JOIN gl.journal_entries rev ON rev.id = e.reversed_by_id
       LEFT JOIN gl.journal_entries orig ON orig.id = e.reversal_of_id
       WHERE e.company_id = $1 AND e.id = $2`,
      [ctx.companyId, id],
    );
    if (!header) throw notFound('journal entry');
    const lines = await tx.query(
      `SELECT l.id, l.line_no, l.account_id, a.code AS account_code, a.name_ar AS account_name_ar, a.name_en AS account_name_en,
              l.cost_center_id, c.code AS cost_center_code, c.name_ar AS cost_center_name_ar, c.name_en AS cost_center_name_en,
              l.description, l.currency_code, l.exchange_rate, l.debit, l.credit, l.debit_base, l.credit_base,
              l.distribution_template_id, l.distribution, l.is_rounding,
              COALESCE(json_agg(json_build_object('dimension_type_id', d.dimension_type_id, 'dimension_value_id', d.dimension_value_id))
                       FILTER (WHERE d.line_id IS NOT NULL), '[]') AS dimensions
       FROM gl.journal_lines l
       JOIN gl.accounts a ON a.id = l.account_id
       LEFT JOIN gl.cost_centers c ON c.id = l.cost_center_id
       LEFT JOIN gl.journal_line_dimensions d ON d.line_id = l.id
       WHERE l.company_id = $1 AND l.entry_id = $2
       GROUP BY l.tenant_id, l.id, a.code, a.name_ar, a.name_en, c.code, c.name_ar, c.name_en
       ORDER BY l.line_no`,
      [ctx.companyId, id],
    );
    const attachments = await tx.query(
      'SELECT id, file_name, content_type, size_bytes, uploaded_at FROM gl.attachments WHERE entry_id = $1 ORDER BY uploaded_at',
      [id],
    );
    return { ...header, lines, attachments };
  }
}

const assertAutoReverse = (input: { entry_date: string; auto_reverse_date?: string | null }): void => {
  if (input.auto_reverse_date && input.auto_reverse_date <= input.entry_date) throw new AppError('AUTO_REVERSE_DATE');
};
