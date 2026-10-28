import { Injectable } from '@nestjs/common';
import { accountSchema, type AccountInput, DEFAULT_NORMAL_BALANCE, journalEntrySchema, translateError } from '@erp/shared';
import ExcelJS from 'exceljs';
import { ZodError } from 'zod';
import { AppError } from '../common/app-error';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { AccountsService } from './accounts.service';
import { FiscalService } from './fiscal.service';
import { loadCompany, PostingEngine } from './posting.engine';

export type ImportRowResult = { row: number; key: string; action: 'create' | 'update' | 'post' | 'draft'; status: 'ok' | 'error'; message?: string };
export type ImportResult = { committed: boolean; total: number; errors: number; rows: ImportRowResult[] };

type SheetRow = { row: number; values: Record<string, string> };

const ACCOUNT_COLUMNS = ['code', 'name_ar', 'name_en', 'parent_code', 'type', 'posting', 'cost_center_rule', 'cash_flow_category', 'control_module', 'revalue', 'active'];
const JOURNAL_COLUMNS = ['entry', 'date', 'journal_type', 'description', 'reference', 'account', 'cost_center', 'line_description', 'currency', 'rate', 'debit', 'credit'];

const truthy = (v: string | undefined, fallback: boolean): boolean => {
  if (!v) return fallback;
  return ['y', 'yes', '1', 'true', 'نعم'].includes(v.trim().toLowerCase());
};

const describeError = (error: unknown): string => {
  if (error instanceof AppError) {
    const base = translateError(error.code, 'en', error.params);
    return error.issues?.length ? `${base}: ${error.issues.map((i) => `${i.path} ${i.message}`).join('; ')}` : base;
  }
  if (error instanceof ZodError) return error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');
  return error instanceof Error ? error.message : String(error);
};

/**
 * Excel imports. Every row runs through the same validation as the UI inside one transaction,
 * each under a savepoint so all errors are reported at once; a preview always rolls back, and a
 * commit rolls back entirely when any row fails.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly db: DbService,
    private readonly accounts: AccountsService,
    private readonly fiscal: FiscalService,
    private readonly engine: PostingEngine,
  ) {}

  async template(kind: 'accounts' | 'journals'): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(kind);
    if (kind === 'accounts') {
      sheet.addRow(ACCOUNT_COLUMNS);
      sheet.addRow(['6', 'حسابات إضافية', 'Additional accounts', '', 'EXPENSE', 'N', '', '', '', 'N', 'Y']);
      sheet.addRow(['6001', 'مصروف تجريبي', 'Sample expense', '6', 'EXPENSE', 'Y', 'REQUIRED', 'OPERATING', '', 'N', 'Y']);
    } else {
      sheet.addRow(JOURNAL_COLUMNS);
      sheet.addRow(['1', '2026-01-31', 'JV', 'Opening cash', 'OB-1', '110101', '', '', 'KWD', '', '1000.000', '']);
      sheet.addRow(['1', '2026-01-31', 'JV', 'Opening cash', 'OB-1', '3101', '', '', 'KWD', '', '', '1000.000']);
    }
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => (c.width = 18));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  importAccounts(ctx: CompanyContext, file: Buffer, commit: boolean): Promise<ImportResult> {
    return this.run(ctx, commit, async (tx) => {
      const rows = await this.readSheet(file, ACCOUNT_COLUMNS);
      const existing = new Map(
        (await tx.query<{ id: string; code: string }>('SELECT id, code FROM gl.accounts WHERE company_id = $1', [ctx.companyId])).map((a) => [a.code, a.id]),
      );
      // Parents first: a row is processed once its parent exists in the ledger or earlier in the file.
      const pending = [...rows];
      const ordered: SheetRow[] = [];
      while (pending.length) {
        const index = pending.findIndex((r) => {
          const parent = r.values.parent_code;
          return !parent || existing.has(parent) || ordered.some((o) => o.values.code === parent) || !pending.some((p) => p.values.code === parent);
        });
        ordered.push(...pending.splice(index === -1 ? 0 : index, 1));
      }
      const results: ImportRowResult[] = [];
      for (const r of ordered) {
        const v = r.values;
        const id = existing.get(v.code ?? '');
        results.push(
          await this.savepoint(tx, { row: r.row, key: v.code ?? '', action: id ? 'update' : 'create' }, async () => {
            const parentId = v.parent_code ? existing.get(v.parent_code) : null;
            if (v.parent_code && !parentId) throw new AppError('NOT_FOUND', { entity: `parent ${v.parent_code}` });
            const current = id ? await this.accounts.get(ctx, id).catch(() => null) : null;
            const type = (v.type?.toUpperCase() || current?.account_type || 'ASSET') as AccountInput['account_type'];
            const input = accountSchema.parse({
              code: v.code,
              name_ar: v.name_ar || current?.name_ar || '',
              name_en: v.name_en || current?.name_en || '',
              parent_id: v.parent_code !== undefined && v.parent_code !== '' ? parentId : (current?.parent_id ?? null),
              is_posting: truthy(v.posting, current?.is_posting ?? true),
              account_type: type,
              normal_balance: current?.account_type === type ? current.normal_balance : DEFAULT_NORMAL_BALANCE[type],
              cost_center_rule: v.cost_center_rule?.toUpperCase() || current?.cost_center_rule || 'OPTIONAL',
              default_cost_center_id: current?.default_cost_center_id ?? null,
              allowed_cost_center_ids: current?.allowed_cost_center_ids ?? [],
              is_control: v.control_module ? true : (current?.is_control ?? false),
              control_module: v.control_module?.toUpperCase() || current?.control_module || null,
              allowed_currencies: current?.allowed_currencies ?? null,
              cash_flow_category: v.cash_flow_category?.toUpperCase() || current?.cash_flow_category || null,
              is_reconcilable: current?.is_reconcilable ?? false,
              revalue: truthy(v.revalue, current?.revalue ?? false),
              is_active: truthy(v.active, current?.is_active ?? true),
              dimension_rules: current?.dimension_rules ?? [],
            });
            const saved = id ? await this.accounts.updateTx(tx, ctx, id, input) : await this.accounts.createTx(tx, ctx, input);
            existing.set(saved.code, saved.id);
          }),
        );
      }
      return results;
    });
  }

  importJournals(ctx: CompanyContext, file: Buffer, commit: boolean, post: boolean): Promise<ImportResult> {
    return this.run(ctx, commit, async (tx) => {
      const rows = await this.readSheet(file, JOURNAL_COLUMNS);
      const company = await loadCompany(tx, ctx.companyId);
      const lookup = async (sql: string) => new Map((await tx.query<{ code: string; id: string }>(sql, [ctx.companyId])).map((r) => [r.code, r.id]));
      const accounts = await lookup('SELECT code, id FROM gl.accounts WHERE company_id = $1');
      const costCenters = await lookup('SELECT code, id FROM gl.cost_centers WHERE company_id = $1');
      const types = new Map(
        (await tx.query<{ code: string; id: string; is_system: boolean }>('SELECT code, id, is_system FROM gl.journal_types WHERE company_id = $1', [ctx.companyId])).map((r) => [r.code, r]),
      );

      const groups = new Map<string, SheetRow[]>();
      for (const r of rows) {
        const key = r.values.entry || `row-${r.row}`;
        groups.set(key, [...(groups.get(key) ?? []), r]);
      }
      const results: ImportRowResult[] = [];
      for (const [key, lines] of groups) {
        const first = lines[0] as SheetRow;
        results.push(
          await this.savepoint(tx, { row: first.row, key, action: post ? 'post' : 'draft' }, async () => {
            const h = first.values;
            const type = types.get(h.journal_type || 'JV');
            if (!type || type.is_system) throw new AppError('NOT_FOUND', { entity: `journal type ${h.journal_type}` });
            const resolve = (map: Map<string, string>, code: string | undefined, entity: string, row: number) => {
              if (!code) return null;
              const id = map.get(code);
              if (!id) throw new AppError('NOT_FOUND', { entity: `${entity} ${code} (row ${row})` });
              return id;
            };
            const input = journalEntrySchema.parse({
              journal_type_id: type.id,
              entry_date: h.date,
              description: h.description || null,
              reference: h.reference || null,
              lines: lines.map((l) => ({
                account_id: resolve(accounts, l.values.account, 'account', l.row),
                cost_center_id: resolve(costCenters, l.values.cost_center, 'cost center', l.row),
                description: l.values.line_description || null,
                currency_code: l.values.currency || company.base_currency,
                exchange_rate: l.values.rate || null,
                debit: l.values.debit || '0',
                credit: l.values.credit || '0',
              })),
            });
            const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, input.entry_date, input.adjustment_period);
            const entry = await tx.one<{ id: string }>(
              `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date, description,
                 reference, source_module, source_doc_type, source_doc_id, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'GL', 'IMPORT', $9, $10) RETURNING id`,
              [ctx.tenantId, ctx.companyId, type.id, period.fiscal_year_id, period.id, input.entry_date, input.description ?? null, input.reference ?? null, key, ctx.userId],
            );
            const totals = await this.engine.insertLines(tx, ctx, company, entry.id, input.entry_date, input.lines);
            await tx.query('UPDATE gl.journal_entries SET total_debit = $2, total_credit = $3 WHERE id = $1', [entry.id, totals.debit.toFixed(4), totals.credit.toFixed(4)]);
            const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
            if (post) await this.engine.post(tx, ctx, company, locked);
            else await this.engine.validate(tx, ctx, company, locked);
          }),
        );
      }
      return results;
    });
  }

  private async run(ctx: CompanyContext, commit: boolean, process: (tx: Tx) => Promise<ImportRowResult[]>): Promise<ImportResult> {
    const execute = async (tx: Tx) => {
      const rows = await process(tx);
      const errors = rows.filter((r) => r.status === 'error').length;
      if (commit && errors > 0) throw Object.assign(new AppError('IMPORT_HAS_ERRORS', { count: errors }), { rows });
      return { committed: commit, total: rows.length, errors, rows };
    };
    if (!commit) return this.db.previewWithTenant(ctx, execute);
    try {
      return await this.db.withTenant(ctx, execute);
    } catch (error) {
      // Report row-level errors instead of a bare failure.
      const rows = (error as { rows?: ImportRowResult[] }).rows;
      if (rows) return { committed: false, total: rows.length, errors: rows.filter((r) => r.status === 'error').length, rows };
      throw error;
    }
  }

  private async savepoint(tx: Tx, base: Omit<ImportRowResult, 'status'>, fn: () => Promise<void>): Promise<ImportRowResult> {
    await tx.query('SAVEPOINT import_row');
    try {
      await fn();
      await tx.query('RELEASE SAVEPOINT import_row');
      return { ...base, status: 'ok' };
    } catch (error) {
      await tx.query('ROLLBACK TO SAVEPOINT import_row');
      return { ...base, status: 'error', message: describeError(error) };
    }
  }

  private async readSheet(file: Buffer, columns: string[]): Promise<SheetRow[]> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file as unknown as ArrayBuffer);
    } catch (error) {
      throw new AppError('IMPORT_FILE_INVALID', { reason: (error as Error).message });
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new AppError('IMPORT_FILE_INVALID', { reason: 'no worksheet' });
    const header = (sheet.getRow(1).values as unknown[]).map((v) => String(v ?? '').trim().toLowerCase());
    const missing = columns.filter((c) => ['code', 'account', 'date'].includes(c) && !header.includes(c));
    if (missing.length) throw new AppError('IMPORT_FILE_INVALID', { reason: `missing columns: ${missing.join(', ')}` });
    const rows: SheetRow[] = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values: Record<string, string> = {};
      header.forEach((key, index) => {
        if (!key) return;
        const cell = row.getCell(index);
        const value = cell.value instanceof Date ? cell.value.toISOString().slice(0, 10) : cell.text;
        values[key] = String(value ?? '').trim();
      });
      if (Object.values(values).some((v) => v !== '')) rows.push({ row: rowNumber, values });
    });
    if (rows.length > 5000) throw new AppError('IMPORT_FILE_INVALID', { reason: 'more than 5000 rows' });
    return rows;
  }
}
