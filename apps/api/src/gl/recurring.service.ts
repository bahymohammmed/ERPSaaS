import { Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type JournalLineInput, PERMISSIONS, type RecurrenceFrequency, type RecurringInput } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { addMonths, today } from '../common/dates';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { FiscalService } from './fiscal.service';
import { loadCompany, PostingEngine } from './posting.engine';

type Template = { description: string | null; reference: string | null; lines: JournalLineInput[] };

type RecurringRow = {
  id: string;
  code: string;
  journal_type_id: string;
  frequency: RecurrenceFrequency;
  day_of_month: number;
  start_date: string;
  end_date: string | null;
  next_run_date: string;
  auto_post: boolean;
  is_active: boolean;
  template: Template;
  created_by: string;
};

const MONTHS: Record<RecurrenceFrequency, number> = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, YEARLY: 12 };

/** The run date in the month of `date`, clamped to the month's length (day 31 → 30 Apr, 28/29 Feb). */
export const onDay = (date: string, day: number): string => {
  const [y, m] = date.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${date.slice(0, 7)}-${String(Math.min(day, last)).padStart(2, '0')}`;
};

export const firstRunDate = (start: string, day: number): string => {
  const candidate = onDay(start, day);
  return candidate >= start ? candidate : onDay(addMonths(`${start.slice(0, 7)}-01`, 1), day);
};

export const nextRunDate = (current: string, frequency: RecurrenceFrequency, day: number): string =>
  onDay(addMonths(`${current.slice(0, 7)}-01`, MONTHS[frequency]), day);

/** Recurring journal templates (rent, depreciation, subscriptions) generated on a schedule. */
@Injectable()
export class RecurringService {
  constructor(
    private readonly db: DbService,
    private readonly engine: PostingEngine,
    private readonly fiscal: FiscalService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT r.id, r.code, r.name_ar, r.name_en, r.journal_type_id, jt.code AS journal_type_code, r.frequency, r.day_of_month,
                r.start_date, r.end_date, r.next_run_date, r.last_run_date, r.last_entry_id, r.last_error, r.auto_post, r.is_active,
                r.template, e.entry_no AS last_entry_no
         FROM gl.recurring_entries r
         JOIN gl.journal_types jt ON jt.id = r.journal_type_id
         LEFT JOIN gl.journal_entries e ON e.id = r.last_entry_id
         WHERE r.company_id = $1 ORDER BY r.code`,
        [ctx.companyId],
      ),
    );
  }

  /** Creates a schedule from an existing entry's header and lines. */
  create(ctx: CompanyContext, input: RecurringInput) {
    return this.db.withTenant(ctx, async (tx) => {
      if (!input.from_entry_id) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'from_entry_id', message: 'Source entry is required' }]);
      const source = await tx.maybeOne<{ journal_type_id: string; is_system: boolean; description: string | null; reference: string | null }>(
        `SELECT e.journal_type_id, jt.is_system, e.description, e.reference FROM gl.journal_entries e
         JOIN gl.journal_types jt ON jt.id = e.journal_type_id WHERE e.company_id = $1 AND e.id = $2`,
        [ctx.companyId, input.from_entry_id],
      );
      if (!source) throw notFound('journal entry');
      if (source.is_system) throw new AppError('JOURNAL_SYSTEM_TYPE', { code: '' });
      const lines = await tx.query<JournalLineInput & { distribution: JournalLineInput['distribution'] }>(
        `SELECT l.account_id, l.cost_center_id, l.description, l.currency_code, l.debit, l.credit, l.distribution_template_id, l.distribution,
                COALESCE(json_agg(json_build_object('dimension_type_id', d.dimension_type_id, 'dimension_value_id', d.dimension_value_id))
                         FILTER (WHERE d.line_id IS NOT NULL), '[]') AS dimensions
         FROM gl.journal_lines l LEFT JOIN gl.journal_line_dimensions d ON d.line_id = l.id
         WHERE l.entry_id = $1 AND NOT l.is_rounding
         GROUP BY l.tenant_id, l.id ORDER BY l.line_no`,
        [input.from_entry_id],
      );
      // Rates are looked up on each run date, so the template keeps amounts but not rates.
      const template: Template = { description: source.description, reference: source.reference, lines };
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.recurring_entries (tenant_id, company_id, code, name_ar, name_en, journal_type_id, frequency, day_of_month,
           start_date, end_date, next_run_date, auto_post, is_active, template, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [
          ctx.tenantId,
          ctx.companyId,
          input.code,
          input.name_ar || input.name_en,
          input.name_en || input.name_ar,
          source.journal_type_id,
          input.frequency,
          input.day_of_month,
          input.start_date,
          input.end_date ?? null,
          firstRunDate(input.start_date, input.day_of_month),
          input.auto_post,
          input.is_active,
          JSON.stringify(template),
          ctx.userId,
        ],
      );
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'recurring_entry', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  /** Updates the schedule; the line template stays as captured. */
  update(ctx: CompanyContext, id: string, input: RecurringInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.find(tx, ctx.companyId, id);
      const scheduleChanged =
        existing.start_date !== input.start_date || existing.day_of_month !== input.day_of_month || existing.frequency !== input.frequency;
      const next = scheduleChanged ? firstRunDate(input.start_date > today() ? input.start_date : existing.next_run_date, input.day_of_month) : existing.next_run_date;
      const row = await tx.one(
        `UPDATE gl.recurring_entries SET code = $3, name_ar = $4, name_en = $5, frequency = $6, day_of_month = $7, start_date = $8,
           end_date = $9, next_run_date = $10, auto_post = $11, is_active = $12
         WHERE company_id = $1 AND id = $2 RETURNING *`,
        [
          ctx.companyId,
          id,
          input.code,
          input.name_ar || input.name_en,
          input.name_en || input.name_ar,
          input.frequency,
          input.day_of_month,
          input.start_date,
          input.end_date ?? null,
          next,
          input.auto_post,
          input.is_active,
        ],
      );
      await this.audit.record(tx, ctx, { action: 'update', entityType: 'recurring_entry', entityId: id, companyId: ctx.companyId, oldData: existing, newData: input });
      return row;
    });
  }

  remove(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.find(tx, ctx.companyId, id);
      await tx.query('DELETE FROM gl.recurring_entries WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'recurring_entry', entityId: id, companyId: ctx.companyId, oldData: existing });
      return { deleted: true };
    });
  }

  /** Generates every due occurrence (catching up missed runs) for one schedule. */
  async runNow(ctx: CompanyContext, id: string, asOf: string = today()): Promise<{ generated: { entry_id: string; date: string; status: string }[] }> {
    const generated: { entry_id: string; date: string; status: string }[] = [];
    for (let guard = 0; guard < 120; guard++) {
      const result = await this.runOnce(ctx, id, asOf);
      if (!result) break;
      generated.push(result);
    }
    return { generated };
  }

  /**
   * Generates the next occurrence if it is due. Each occurrence is its own transaction; on failure
   * the error is recorded on the schedule and the schedule does not advance.
   */
  private async runOnce(ctx: CompanyContext, id: string, asOf: string): Promise<{ entry_id: string; date: string; status: string } | null> {
    try {
      return await this.db.withTenant(ctx, async (tx) => {
        const rec = await this.find(tx, ctx.companyId, id, true);
        if (!rec.is_active || rec.next_run_date > asOf || (rec.end_date && rec.next_run_date > rec.end_date)) return null;
        const company = await loadCompany(tx, ctx.companyId);
        const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, rec.next_run_date);
        const entry = await tx.one<{ id: string }>(
          `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date,
             description, reference, source_module, source_doc_type, source_doc_id, idempotency_key, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GL', 'RECURRING', $9, $10, $11) RETURNING id`,
          [
            ctx.tenantId,
            ctx.companyId,
            rec.journal_type_id,
            period.fiscal_year_id,
            period.id,
            rec.next_run_date,
            rec.template.description,
            rec.template.reference,
            rec.id,
            `recurring:${rec.id}:${rec.next_run_date}`,
            rec.created_by,
          ],
        );
        const lines = rec.template.lines.map((l) => ({ ...l, exchange_rate: null, dimensions: l.dimensions ?? [] }));
        const totals = await this.engine.insertLines(tx, ctx, company, entry.id, rec.next_run_date, lines);
        await tx.query('UPDATE gl.journal_entries SET total_debit = $2, total_credit = $3 WHERE id = $1', [entry.id, totals.debit.toFixed(4), totals.credit.toFixed(4)]);

        let status = 'DRAFT';
        if (rec.auto_post) {
          const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
          const approvalNeeded = company.require_approval && !(company.approval_threshold !== null && totals.debit.lessThan(company.approval_threshold));
          if (approvalNeeded) {
            await this.engine.validate(tx, ctx, company, locked);
            await tx.query("UPDATE gl.journal_entries SET status = 'SUBMITTED', submitted_by = $2, submitted_at = now() WHERE id = $1", [entry.id, rec.created_by]);
            status = 'SUBMITTED';
          } else {
            await this.engine.post(tx, ctx, company, locked);
            status = 'POSTED';
          }
        }
        await tx.query(
          `UPDATE gl.recurring_entries SET last_run_date = next_run_date, next_run_date = $3, last_entry_id = $4, last_error = NULL
           WHERE company_id = $1 AND id = $2`,
          [ctx.companyId, rec.id, nextRunDate(rec.next_run_date, rec.frequency, rec.day_of_month), entry.id],
        );
        return { entry_id: entry.id, date: rec.next_run_date, status };
      });
    } catch (error) {
      const message = error instanceof AppError ? `${error.code} ${JSON.stringify(error.params)}` : String(error);
      await this.db.withTenant(ctx, (tx) => tx.query('UPDATE gl.recurring_entries SET last_error = $2 WHERE id = $1', [id, message.slice(0, 500)]));
      throw error;
    }
  }

  private async find(tx: Tx, companyId: string, id: string, lock = false): Promise<RecurringRow> {
    const row = await tx.maybeOne<RecurringRow>(`SELECT * FROM gl.recurring_entries WHERE company_id = $1 AND id = $2 ${lock ? 'FOR UPDATE' : ''}`, [companyId, id]);
    if (!row) throw notFound('recurring entry');
    return row;
  }
}

/** Generates due recurring entries across all tenants every hour (disable with RECURRING_SCHEDULER=off). */
@Injectable()
export class RecurringScheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RecurringScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly db: DbService,
    private readonly recurring: RecurringService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.RECURRING_SCHEDULER === 'off') return;
    this.timer = setInterval(() => void this.tick(), 60 * 60 * 1000);
    setTimeout(() => void this.tick(), 10_000);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(asOf: string = today()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let count = 0;
    try {
      const due = await this.db.withoutTenant((tx) =>
        tx.query<{ tenant_id: string; company_id: string; id: string }>('SELECT * FROM gl.due_recurring_entries($1)', [asOf]),
      );
      for (const item of due) {
        const owner = await this.db.withTenant({ tenantId: item.tenant_id, userId: null }, (tx) =>
          tx.one<{ created_by: string }>('SELECT created_by FROM gl.recurring_entries WHERE id = $1', [item.id]),
        );
        const ctx: CompanyContext = {
          tenantId: item.tenant_id,
          userId: owner.created_by,
          companyId: item.company_id,
          permissions: new Set(PERMISSIONS),
          costCenterScope: null,
          ip: 'scheduler',
        };
        try {
          count += (await this.recurring.runNow(ctx, item.id, asOf)).generated.length;
        } catch (error) {
          this.logger.warn(`Recurring entry ${item.id} failed: ${error instanceof AppError ? error.code : String(error)}`);
        }
      }
    } finally {
      this.running = false;
    }
    return count;
  }
}
