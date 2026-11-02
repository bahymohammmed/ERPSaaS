import { Injectable } from '@nestjs/common';
import {
  type AssetStatus,
  type DepreciationMethod,
  type FaActivateInput,
  type FaAssetInput,
  type FaCategoryInput,
  faImportRowSchema,
  Money,
  type MoneyValue,
  sumAmounts,
  toMoney,
  toStorage,
} from '@erp/shared';
import ExcelJS from 'exceljs';
import type { z } from 'zod';
import type { faDisposeSchema, faTransferSchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { addDays } from '../common/dates';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { FiscalService, type PeriodRow } from '../gl/fiscal.service';
import { ImportService, type ImportResult, type ImportRowResult } from '../gl/import.service';
import { type CompanyInfo, loadCompany, PostingEngine } from '../gl/posting.engine';
import { depreciationFor } from './depreciation';

export type Category = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  asset_account_id: string;
  accum_dep_account_id: string | null;
  dep_expense_account_id: string | null;
  disposal_account_id: string;
  method: DepreciationMethod;
  useful_life_months: number | null;
  declining_rate: string | null;
  residual_percent: string;
  is_active: boolean;
};

export type AssetRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  category_id: string;
  cost_center_id: string;
  acquisition_date: string;
  in_service_date: string;
  cost: string;
  residual_value: string;
  method: DepreciationMethod;
  useful_life_months: number | null;
  declining_rate: string | null;
  opening_accum_dep: string;
  depreciated_to: string | null;
  status: AssetStatus;
  disposal_date: string | null;
  /** Opening + posted depreciation runs (+ the disposal catch-up once disposed). */
  accumulated: string;
};

type AccountInfo = { id: string; code: string; account_type: string; cost_center_rule: 'REQUIRED' | 'OPTIONAL' | 'NOT_ALLOWED'; is_posting: boolean; is_control: boolean; control_module: string | null };
type PostingLine = { account_id: string; cost_center_id: string | null; debit: MoneyValue; credit: MoneyValue; description: string };

export const IMPORT_COLUMNS = [
  'code', 'name_ar', 'name_en', 'category', 'cost_center', 'acquisition_date', 'in_service_date', 'cost', 'residual_value',
  'useful_life_months', 'opening_accum_dep', 'opening_dep_date', 'location', 'custodian', 'serial_no',
];

/** SQL: accumulated depreciation per asset (opening + posted runs + disposal catch-up). */
const ACCUMULATED = `(a.opening_accum_dep
  + COALESCE((SELECT sum(l.amount) FROM fa.depreciation_lines l JOIN fa.depreciation_runs r ON r.id = l.run_id
              WHERE l.asset_id = a.id AND r.status = 'POSTED'), 0)
  + CASE WHEN a.status = 'DISPOSED' THEN COALESCE((SELECT (ev.details->>'catch_up')::numeric FROM fa.asset_events ev
              WHERE ev.asset_id = a.id AND ev.event_type = 'DISPOSE' ORDER BY ev.created_at DESC LIMIT 1), 0) ELSE 0 END)`;

/**
 * Fixed asset register and its postings. Every amount reaches the general ledger through the
 * posting engine as a source-module 'FA' entry, so period locks, numbering and the audit trail
 * apply exactly as for manual journals.
 */
@Injectable()
export class FixedAssetsService {
  constructor(
    private readonly db: DbService,
    private readonly fiscal: FiscalService,
    private readonly engine: PostingEngine,
    private readonly audit: AuditService,
    private readonly importer: ImportService,
  ) {}

  // ================================================================ categories

  listCategories(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT c.*, acc.code AS asset_account_code, (acc.is_control AND acc.control_module = 'FA') AS accounts_locked,
                (SELECT count(*)::int FROM fa.assets a WHERE a.category_id = c.id) AS asset_count
         FROM fa.categories c JOIN gl.accounts acc ON acc.id = c.asset_account_id
         WHERE c.company_id = $1 ORDER BY c.code`,
        [ctx.companyId],
      ),
    );
  }

  saveCategory(ctx: CompanyContext, input: FaCategoryInput, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const accounts = await this.accountMap(tx, ctx.companyId);
      const expect = (accountId: string | null | undefined, types: string[], field: string) => {
        if (!accountId) return;
        const account = accounts.get(accountId);
        if (!account || !account.is_posting || !types.includes(account.account_type)) {
          throw new AppError('VALIDATION_FAILED', {}, [{ path: field, message: `Choose a posting ${types.join(' or ').toLowerCase()} account` }]);
        }
      };
      expect(input.asset_account_id, ['ASSET'], 'asset_account_id');
      expect(input.accum_dep_account_id, ['ASSET'], 'accum_dep_account_id');
      expect(input.dep_expense_account_id, ['EXPENSE'], 'dep_expense_account_id');
      expect(input.disposal_account_id, ['REVENUE', 'EXPENSE'], 'disposal_account_id');

      const values = [
        input.code,
        input.name_ar || input.name_en,
        input.name_en || input.name_ar,
        input.asset_account_id,
        input.method === 'NONE' ? null : input.accum_dep_account_id,
        input.method === 'NONE' ? null : input.dep_expense_account_id,
        input.disposal_account_id,
        input.method,
        input.method === 'STRAIGHT_LINE' ? input.useful_life_months : null,
        input.method === 'DECLINING_BALANCE' ? input.declining_rate : null,
        input.residual_percent,
        input.is_active,
      ];
      const row = id
        ? await tx.maybeOne(
            `UPDATE fa.categories SET code = $2, name_ar = $3, name_en = $4, asset_account_id = $5, accum_dep_account_id = $6,
               dep_expense_account_id = $7, disposal_account_id = $8, method = $9, useful_life_months = $10, declining_rate = $11,
               residual_percent = $12, is_active = $13
             WHERE company_id = $1 AND id = $14 RETURNING *`,
            [ctx.companyId, ...values, id],
          )
        : await tx.one(
            `INSERT INTO fa.categories (tenant_id, company_id, code, name_ar, name_en, asset_account_id, accum_dep_account_id,
               dep_expense_account_id, disposal_account_id, method, useful_life_months, declining_rate, residual_percent, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
            [ctx.tenantId, ctx.companyId, ...values],
          );
      if (!row) throw notFound('category');
      if (input.lock_accounts) {
        // Only this module may post to the asset and accumulated depreciation accounts from now on.
        for (const accountId of [input.asset_account_id, input.method === 'NONE' ? null : input.accum_dep_account_id]) {
          if (!accountId) continue;
          const account = accounts.get(accountId);
          if (account?.is_control && account.control_module !== 'FA') {
            throw new AppError('VALIDATION_FAILED', {}, [{ path: 'lock_accounts', message: `Account ${account.code} already belongs to ${account.control_module}` }]);
          }
          await tx.query("UPDATE gl.accounts SET is_control = true, control_module = 'FA' WHERE id = $1", [accountId]);
        }
      }
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'fa_category', entityId: (row as { id: string }).id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  removeCategory(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const used = await tx.maybeOne('SELECT 1 FROM fa.assets WHERE company_id = $1 AND category_id = $2 LIMIT 1', [ctx.companyId, id]);
      if (used) throw new AppError('FA_CATEGORY_IN_USE');
      const row = await tx.maybeOne('DELETE FROM fa.categories WHERE company_id = $1 AND id = $2 RETURNING id', [ctx.companyId, id]);
      if (!row) throw notFound('category');
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'fa_category', entityId: id, companyId: ctx.companyId });
      return { deleted: true };
    });
  }

  // ================================================================ register

  listAssets(ctx: CompanyContext, filter: { status?: string; category_id?: string; search?: string }) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT a.id, a.code, a.name_ar, a.name_en, a.category_id, a.cost_center_id, a.location, a.custodian, a.serial_no,
                a.acquisition_date, a.in_service_date, a.cost, a.residual_value, a.method, a.useful_life_months, a.status,
                a.depreciated_to, a.disposal_date,
                c.code AS category_code, c.name_ar AS category_name_ar, c.name_en AS category_name_en,
                cc.code AS cost_center_code, cc.name_ar AS cost_center_name_ar, cc.name_en AS cost_center_name_en,
                ${ACCUMULATED} AS accumulated,
                CASE WHEN a.status = 'DISPOSED' THEN 0 ELSE a.cost - ${ACCUMULATED} END AS net_book_value
         FROM fa.assets a
         JOIN fa.categories c ON c.id = a.category_id
         JOIN gl.cost_centers cc ON cc.id = a.cost_center_id
         WHERE a.company_id = $1
           AND ($2::text IS NULL OR a.status = $2)
           AND ($3::uuid IS NULL OR a.category_id = $3)
           AND ($4::text IS NULL OR a.code ILIKE '%' || $4 || '%' OR core.ar_normalize(a.name_ar) LIKE '%' || core.ar_normalize($4) || '%'
                OR a.name_en ILIKE '%' || $4 || '%' OR a.serial_no ILIKE '%' || $4 || '%')
         ORDER BY a.code`,
        [ctx.companyId, filter.status ?? null, filter.category_id ?? null, filter.search?.trim() || null],
      ),
    );
  }

  getAsset(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const asset = await tx.maybeOne(
        `SELECT a.*, ${ACCUMULATED} AS accumulated, CASE WHEN a.status = 'DISPOSED' THEN 0 ELSE a.cost - ${ACCUMULATED} END AS net_book_value,
                c.code AS category_code, c.name_ar AS category_name_ar, c.name_en AS category_name_en,
                cc.code AS cost_center_code, cc.name_ar AS cost_center_name_ar, cc.name_en AS cost_center_name_en,
                acq.entry_no AS acquisition_entry_no, dsp.entry_no AS disposal_entry_no
         FROM fa.assets a
         JOIN fa.categories c ON c.id = a.category_id
         JOIN gl.cost_centers cc ON cc.id = a.cost_center_id
         LEFT JOIN gl.journal_entries acq ON acq.id = a.acquisition_entry_id
         LEFT JOIN gl.journal_entries dsp ON dsp.id = a.disposal_entry_id
         WHERE a.company_id = $1 AND a.id = $2`,
        [ctx.companyId, id],
      );
      if (!asset) throw notFound('asset');
      const depreciation = await tx.query(
        `SELECT l.run_id, l.from_date, l.to_date, l.amount, r.status, p.code AS period_code, e.entry_no, r.entry_id
         FROM fa.depreciation_lines l JOIN fa.depreciation_runs r ON r.id = l.run_id
         JOIN gl.fiscal_periods p ON p.id = r.period_id LEFT JOIN gl.journal_entries e ON e.id = r.entry_id
         WHERE l.asset_id = $1 AND l.amount <> 0 ORDER BY l.to_date DESC`,
        [id],
      );
      const events = await tx.query(
        `SELECT ev.id, ev.event_type, ev.event_date, ev.amount, ev.details, ev.created_at, ev.entry_id, e.entry_no, u.full_name AS created_by_name
         FROM fa.asset_events ev LEFT JOIN gl.journal_entries e ON e.id = ev.entry_id LEFT JOIN core.users u ON u.id = ev.created_by
         WHERE ev.asset_id = $1 ORDER BY ev.created_at DESC`,
        [id],
      );
      return { ...asset, depreciation, events };
    });
  }

  createAsset(ctx: CompanyContext, input: FaAssetInput) {
    return this.db.withTenant(ctx, (tx) => this.insertAsset(tx, ctx, input));
  }

  /** Draft assets can change freely; assets in service only their descriptive fields. */
  updateAsset(ctx: CompanyContext, id: string, input: FaAssetInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const asset = await this.lockAsset(tx, ctx, id);
      if (asset.status !== 'DRAFT') {
        const row = await tx.one(
          `UPDATE fa.assets SET name_ar = $2, name_en = $3, location = $4, custodian = $5, serial_no = $6, notes = $7
           WHERE id = $1 RETURNING *`,
          [id, input.name_ar || input.name_en, input.name_en || input.name_ar, input.location ?? null, input.custodian ?? null, input.serial_no ?? null, input.notes ?? null],
        );
        await this.audit.record(tx, ctx, { action: 'update', entityType: 'fa_asset', entityId: id, companyId: ctx.companyId, newData: input });
        return row;
      }
      const values = await this.assetValues(tx, ctx, input);
      const row = await tx.one(
        `UPDATE fa.assets SET code = $2, name_ar = $3, name_en = $4, category_id = $5, cost_center_id = $6, location = $7, custodian = $8,
           serial_no = $9, acquisition_date = $10, in_service_date = $11, cost = $12, residual_value = $13, method = $14,
           useful_life_months = $15, declining_rate = $16, notes = $17
         WHERE id = $1 RETURNING *`,
        [id, ...values],
      );
      await this.audit.record(tx, ctx, { action: 'update', entityType: 'fa_asset', entityId: id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  removeAsset(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const asset = await this.lockAsset(tx, ctx, id);
      if (asset.status !== 'DRAFT') throw new AppError('FA_ASSET_NOT_DRAFT');
      await tx.query('DELETE FROM fa.assets WHERE id = $1', [id]);
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'fa_asset', entityId: id, companyId: ctx.companyId });
      return { deleted: true };
    });
  }

  /** Puts a draft asset into service, posting the purchase or recognising an existing ledger balance. */
  activate(ctx: CompanyContext, id: string, input: FaActivateInput) {
    return this.db.withTenant(ctx, (tx) => this.activateTx(tx, ctx, id, input));
  }

  transfer(ctx: CompanyContext, id: string, input: z.infer<typeof faTransferSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      const asset = await this.lockAsset(tx, ctx, id);
      if (asset.status !== 'ACTIVE' && asset.status !== 'FULLY_DEPRECIATED') throw new AppError('FA_ASSET_NOT_IN_SERVICE');
      const target = await tx.maybeOne<{ is_posting: boolean }>('SELECT is_posting FROM gl.cost_centers WHERE company_id = $1 AND id = $2', [ctx.companyId, input.cost_center_id]);
      if (!target?.is_posting) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'cost_center_id', message: 'Choose a posting cost center' }]);
      await tx.query('UPDATE fa.assets SET cost_center_id = $2 WHERE id = $1', [id, input.cost_center_id]);
      await this.event(tx, ctx, id, 'TRANSFER', input.transfer_date, null, null, { from: asset.cost_center_id, to: input.cost_center_id, notes: input.notes ?? null });
      await this.audit.record(tx, ctx, { action: 'transfer', entityType: 'fa_asset', entityId: id, companyId: ctx.companyId, oldData: { cost_center_id: asset.cost_center_id }, newData: input });
      return { transferred: true };
    });
  }

  /**
   * Retires the asset: depreciation is first brought up to the disposal date, then cost and
   * accumulated depreciation are removed and the difference with the proceeds is a gain or loss.
   */
  dispose(ctx: CompanyContext, id: string, input: z.infer<typeof faDisposeSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const asset = await this.lockAsset(tx, ctx, id);
      if (asset.status !== 'ACTIVE' && asset.status !== 'FULLY_DEPRECIATED') throw new AppError('FA_ASSET_NOT_IN_SERVICE');
      if (input.disposal_date < asset.acquisition_date) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'disposal_date', message: 'Before the acquisition date' }]);
      if (asset.depreciated_to && asset.depreciated_to > input.disposal_date) throw new AppError('FA_DEPRECIATED_BEYOND', { date: asset.depreciated_to });
      const proceeds = toMoney(input.proceeds);
      if (proceeds.gt(0) && !input.proceeds_account_id) throw new AppError('FA_PROCEEDS_ACCOUNT_REQUIRED');
      const category = await this.category(tx, ctx, asset.category_id);

      const accumulated = toMoney(asset.accumulated);
      const catchUpFrom = asset.depreciated_to ? addDays(asset.depreciated_to, 1) : asset.in_service_date;
      const catchUp = depreciationFor({ ...asset, accumulated }, catchUpFrom > asset.in_service_date ? catchUpFrom : asset.in_service_date, input.disposal_date, company.base_minor_units);
      const accumTotal = accumulated.plus(catchUp);
      const nbv = toMoney(asset.cost).minus(accumTotal);
      const gain = proceeds.minus(nbv);
      const label = `${asset.code}`;

      const lines: PostingLine[] = [];
      if (catchUp.gt(0) && category.dep_expense_account_id && category.accum_dep_account_id) {
        lines.push(this.line(category.dep_expense_account_id, asset.cost_center_id, catchUp, 'debit', `${label} depreciation to ${input.disposal_date}`));
        lines.push(this.line(category.accum_dep_account_id, asset.cost_center_id, catchUp, 'credit', `${label} depreciation to ${input.disposal_date}`));
      }
      if (accumTotal.gt(0) && category.accum_dep_account_id) lines.push(this.line(category.accum_dep_account_id, asset.cost_center_id, accumTotal, 'debit', `${label} accumulated depreciation`));
      if (proceeds.gt(0) && input.proceeds_account_id) lines.push(this.line(input.proceeds_account_id, asset.cost_center_id, proceeds, 'debit', `${label} proceeds`));
      lines.push(this.line(category.asset_account_id, asset.cost_center_id, toMoney(asset.cost), 'credit', `${label} cost`));
      if (!gain.isZero()) lines.push(this.line(category.disposal_account_id, asset.cost_center_id, gain.abs(), gain.isPositive() ? 'credit' : 'debit', `${label} ${gain.isPositive() ? 'gain' : 'loss'} on disposal`));

      const entryId = await this.postEntry(tx, ctx, company, input.disposal_date, 'FA_DISPOSAL', id,
        input.description || `استبعاد الأصل ${asset.code} / Disposal of asset ${asset.code}`, lines);
      await tx.query(
        `UPDATE fa.assets SET status = 'DISPOSED', disposal_date = $2, disposal_proceeds = $3, disposal_entry_id = $4, depreciated_to = $2 WHERE id = $1`,
        [id, input.disposal_date, toStorage(proceeds), entryId],
      );
      await this.event(tx, ctx, id, 'DISPOSE', input.disposal_date, toStorage(proceeds), entryId, {
        catch_up: toStorage(catchUp),
        accumulated: toStorage(accumTotal),
        net_book_value: toStorage(nbv),
        gain: toStorage(gain),
        prev_depreciated_to: asset.depreciated_to,
        prev_status: asset.status,
      });
      await this.audit.record(tx, ctx, { action: 'dispose', entityType: 'fa_asset', entityId: id, companyId: ctx.companyId, newData: input });
      return { entry_id: entryId, catch_up: toStorage(catchUp), net_book_value: toStorage(nbv), gain: toStorage(gain) };
    });
  }

  reverseDisposal(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const asset = await this.lockAsset(tx, ctx, id);
      const disposal = await tx.maybeOne<{ entry_id: string; details: { prev_depreciated_to: string | null; prev_status: AssetStatus } }>(
        "SELECT entry_id, details FROM fa.asset_events WHERE asset_id = $1 AND event_type = 'DISPOSE' ORDER BY created_at DESC LIMIT 1",
        [id],
      );
      if (asset.status !== 'DISPOSED' || !disposal) throw new AppError('FA_ASSET_NOT_IN_SERVICE');
      const reversalId = await this.engine.reverse(tx, ctx, company, disposal.entry_id, { description: `عكس استبعاد ${asset.code} / Disposal of ${asset.code} reversed` });
      await tx.query(
        `UPDATE fa.assets SET status = $2, depreciated_to = $3, disposal_date = NULL, disposal_proceeds = NULL, disposal_entry_id = NULL WHERE id = $1`,
        [id, disposal.details.prev_status, disposal.details.prev_depreciated_to],
      );
      await this.event(tx, ctx, id, 'DISPOSAL_REVERSED', asset.disposal_date ?? asset.acquisition_date, null, reversalId, {});
      await this.audit.record(tx, ctx, { action: 'reverse_disposal', entityType: 'fa_asset', entityId: id, companyId: ctx.companyId });
      return { reversal_entry_id: reversalId };
    });
  }

  // ================================================================ depreciation runs

  listRuns(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT r.id, r.period_id, p.code AS period_code, p.name_ar AS period_name_ar, p.name_en AS period_name_en, r.status, r.total,
                r.created_at, e.entry_no, r.entry_id, u.full_name AS created_by_name,
                (SELECT count(*)::int FROM fa.depreciation_lines l WHERE l.run_id = r.id AND l.amount <> 0) AS asset_count
         FROM fa.depreciation_runs r JOIN gl.fiscal_periods p ON p.id = r.period_id
         LEFT JOIN gl.journal_entries e ON e.id = r.entry_id LEFT JOIN core.users u ON u.id = r.created_by
         WHERE r.company_id = $1 ORDER BY p.start_date DESC, r.created_at DESC`,
        [ctx.companyId],
      ),
    );
  }

  /** Executes the run and rolls back: the user sees exactly what would be posted. */
  previewRun(ctx: CompanyContext, periodId: string) {
    return this.db.previewWithTenant(ctx, (tx) => this.executeRun(tx, ctx, periodId));
  }

  postRun(ctx: CompanyContext, periodId: string) {
    return this.db.withTenant(ctx, (tx) => this.executeRun(tx, ctx, periodId));
  }

  /** Only the latest run can be reversed, so assets step back one period at a time. */
  reverseRun(ctx: CompanyContext, runId: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const run = await tx.maybeOne<{ id: string; entry_id: string | null; status: string; start_date: string; end_date: string }>(
        `SELECT r.id, r.entry_id, r.status, p.start_date, p.end_date FROM fa.depreciation_runs r JOIN gl.fiscal_periods p ON p.id = r.period_id
         WHERE r.company_id = $1 AND r.id = $2 FOR UPDATE OF r`,
        [ctx.companyId, runId],
      );
      if (!run || run.status !== 'POSTED') throw notFound('depreciation run');
      const later = await tx.maybeOne(
        `SELECT 1 FROM fa.depreciation_runs r JOIN gl.fiscal_periods p ON p.id = r.period_id
         WHERE r.company_id = $1 AND r.status = 'POSTED' AND p.start_date > $2`,
        [ctx.companyId, run.start_date],
      );
      if (later) throw new AppError('FA_NOT_LATEST_RUN');
      const lines = await tx.query<{ asset_id: string; prev_depreciated_to: string | null; prev_status: AssetStatus; status: AssetStatus }>(
        'SELECT l.asset_id, l.prev_depreciated_to, l.prev_status, a.status FROM fa.depreciation_lines l JOIN fa.assets a ON a.id = l.asset_id WHERE l.run_id = $1 FOR UPDATE OF a',
        [runId],
      );
      if (lines.some((l) => l.status === 'DISPOSED')) throw new AppError('FA_ASSET_NOT_IN_SERVICE');
      if (run.entry_id) await this.engine.reverse(tx, ctx, company, run.entry_id, { date: run.end_date });
      for (const l of lines) await tx.query('UPDATE fa.assets SET depreciated_to = $2, status = $3 WHERE id = $1', [l.asset_id, l.prev_depreciated_to, l.prev_status]);
      await tx.query("UPDATE fa.depreciation_runs SET status = 'REVERSED' WHERE id = $1", [runId]);
      await this.audit.record(tx, ctx, { action: 'reverse', entityType: 'fa_depreciation_run', entityId: runId, companyId: ctx.companyId });
      return { reversed: true };
    });
  }

  private async executeRun(tx: Tx, ctx: CompanyContext, periodId: string) {
    const company = await loadCompany(tx, ctx.companyId);
    const period = await tx.maybeOne<PeriodRow>('SELECT * FROM gl.fiscal_periods WHERE company_id = $1 AND id = $2', [ctx.companyId, periodId]);
    if (!period || period.is_adjustment) throw notFound('period');
    const existing = await tx.maybeOne(`SELECT 1 FROM fa.depreciation_runs WHERE company_id = $1 AND period_id = $2 AND status = 'POSTED'`, [ctx.companyId, periodId]);
    if (existing) throw new AppError('FA_RUN_EXISTS', { period: period.code });
    const later = await tx.maybeOne<{ code: string }>(
      `SELECT p.code FROM fa.depreciation_runs r JOIN gl.fiscal_periods p ON p.id = r.period_id
       WHERE r.company_id = $1 AND r.status = 'POSTED' AND p.start_date > $2 ORDER BY p.start_date DESC LIMIT 1`,
      [ctx.companyId, period.start_date],
    );
    if (later) throw new AppError('FA_LATER_RUN_EXISTS', { period: later.code });

    const assets = await this.assetsForUpdate(
      tx,
      ctx,
      `a.status = 'ACTIVE' AND a.method <> 'NONE' AND a.in_service_date <= $2 AND (a.depreciated_to IS NULL OR a.depreciated_to < $2)`,
      [period.end_date],
    );
    const categories = new Map((await tx.query<Category>('SELECT * FROM fa.categories WHERE company_id = $1', [ctx.companyId])).map((c) => [c.id, c]));
    const run = await tx.one<{ id: string }>('INSERT INTO fa.depreciation_runs (tenant_id, company_id, period_id, created_by) VALUES ($1, $2, $3, $4) RETURNING id', [
      ctx.tenantId,
      ctx.companyId,
      periodId,
      ctx.userId,
    ]);

    const charges: { asset: AssetRow; from: string; amount: MoneyValue; category: Category }[] = [];
    for (const asset of assets) {
      const from = asset.depreciated_to && addDays(asset.depreciated_to, 1) > asset.in_service_date ? addDays(asset.depreciated_to, 1) : asset.in_service_date;
      const accumulated = toMoney(asset.accumulated);
      const amount = depreciationFor({ ...asset, accumulated }, from, period.end_date, company.base_minor_units);
      const category = categories.get(asset.category_id);
      if (!category) continue;
      const remaining = toMoney(asset.cost).minus(asset.residual_value).minus(accumulated).minus(amount);
      await tx.query(
        `INSERT INTO fa.depreciation_lines (tenant_id, company_id, run_id, asset_id, from_date, to_date, amount, prev_depreciated_to, prev_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ctx.tenantId, ctx.companyId, run.id, asset.id, from, period.end_date, toStorage(amount), asset.depreciated_to, asset.status],
      );
      await tx.query('UPDATE fa.assets SET depreciated_to = $2, status = $3 WHERE id = $1', [asset.id, period.end_date, remaining.lte(0) ? 'FULLY_DEPRECIATED' : 'ACTIVE']);
      if (amount.gt(0)) charges.push({ asset, from, amount, category });
    }
    const total = sumAmounts(charges.map((c) => c.amount));
    if (total.isZero()) throw new AppError('NOTHING_TO_PROCESS');

    // One entry for the period: expense per account and cost center, accumulated depreciation per account.
    const grouped = new Map<string, PostingLine>();
    const add = (accountId: string, costCenterId: string | null, amount: MoneyValue, side: 'debit' | 'credit', description: string) => {
      const key = `${accountId}|${costCenterId ?? ''}|${side}`;
      const line = grouped.get(key) ?? this.line(accountId, costCenterId, new Money(0), side, description);
      line[side] = line[side].plus(amount);
      grouped.set(key, line);
    };
    for (const c of charges) {
      if (!c.category.dep_expense_account_id || !c.category.accum_dep_account_id) continue;
      add(c.category.dep_expense_account_id, c.asset.cost_center_id, c.amount, 'debit', `${c.category.code} ${period.code}`);
      add(c.category.accum_dep_account_id, c.asset.cost_center_id, c.amount, 'credit', `${c.category.code} ${period.code}`);
    }
    const entryId = await this.postEntry(tx, ctx, company, period.end_date, 'FA_DEPRECIATION', run.id,
      `استهلاك الأصول الثابتة ${period.code} / Depreciation of fixed assets ${period.code}`, [...grouped.values()]);
    await tx.query('UPDATE fa.depreciation_runs SET entry_id = $2, total = $3 WHERE id = $1', [run.id, entryId, toStorage(total)]);
    await this.audit.record(tx, ctx, { action: 'run', entityType: 'fa_depreciation_run', entityId: run.id, companyId: ctx.companyId, newData: { period: period.code, total: toStorage(total) } });

    return {
      run_id: run.id,
      entry_id: entryId,
      period_code: period.code,
      total: total.toFixed(company.base_minor_units),
      lines: charges.map((c) => ({
        asset_id: c.asset.id,
        code: c.asset.code,
        name_ar: c.asset.name_ar,
        name_en: c.asset.name_en,
        category_code: c.category.code,
        from_date: c.from,
        to_date: period.end_date,
        amount: c.amount.toFixed(company.base_minor_units),
      })),
    };
  }

  // ================================================================ import

  async importTemplate(): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('fixed-assets');
    sheet.addRow(IMPORT_COLUMNS);
    sheet.addRow(['VEH-001', 'سيارة تويوتا لاندكروزر', 'Toyota Land Cruiser', 'VEH', '102', '2024-03-10', '2024-03-15', '18000.000', '0', '60', '7500.000', '2025-12-31', 'Kuwait City', 'Sales manager', 'JTM123456']);
    sheet.addRow(['FUR-001', 'أثاث المكتب الرئيسي', 'Head office furniture', 'FUR', '101', '2025-01-01', '', '7500.000', '', '', '1500.000', '2025-12-31', 'Head office', '', '']);
    sheet.getRow(1).font = { bold: true };
    sheet.columns.forEach((c) => (c.width = 18));
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  /** Opening register from Excel: each row becomes an asset in service with its accumulated depreciation to date. */
  importAssets(ctx: CompanyContext, file: Buffer, commit: boolean): Promise<ImportResult> {
    return this.importer.run(ctx, commit, async (tx) => {
      const rows = await this.importer.readSheet(file, IMPORT_COLUMNS);
      const categories = new Map((await tx.query<{ id: string; code: string }>('SELECT id, code FROM fa.categories WHERE company_id = $1', [ctx.companyId])).map((c) => [c.code, c.id]));
      const costCenters = new Map((await tx.query<{ id: string; code: string }>('SELECT id, code FROM gl.cost_centers WHERE company_id = $1', [ctx.companyId])).map((c) => [c.code, c.id]));
      const results: ImportRowResult[] = [];
      for (const r of rows) {
        const v = r.values;
        results.push(
          await this.importer.savepoint(tx, { row: r.row, key: v.code ?? '', action: 'create' }, async () => {
            const categoryId = categories.get(v.category ?? '');
            if (!categoryId) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'category', message: `Unknown category ${v.category ?? ''}` }]);
            const costCenterId = costCenters.get(v.cost_center ?? '');
            if (!costCenterId) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'cost_center', message: `Unknown cost center ${v.cost_center ?? ''}` }]);
            const input = faImportRowSchema.parse({
              code: v.code,
              name_ar: v.name_ar,
              name_en: v.name_en,
              category_id: categoryId,
              cost_center_id: costCenterId,
              acquisition_date: v.acquisition_date,
              in_service_date: v.in_service_date || null,
              cost: v.cost,
              residual_value: v.residual_value || null,
              useful_life_months: v.useful_life_months ? Number(v.useful_life_months) : null,
              location: v.location || null,
              custodian: v.custodian || null,
              serial_no: v.serial_no || null,
              opening_accum_dep: v.opening_accum_dep || '0',
              opening_dep_date: v.opening_dep_date || null,
            });
            const asset = await this.insertAsset(tx, ctx, input);
            await this.activateTx(tx, ctx, asset.id, { mode: 'EXISTING', opening_accum_dep: input.opening_accum_dep, opening_dep_date: input.opening_dep_date ?? null });
          }),
        );
      }
      return results;
    });
  }

  // ================================================================ helpers

  private async activateTx(tx: Tx, ctx: CompanyContext, id: string, input: FaActivateInput) {
    const company = await loadCompany(tx, ctx.companyId);
    const asset = await this.lockAsset(tx, ctx, id);
    if (asset.status !== 'DRAFT') throw new AppError('FA_ASSET_NOT_DRAFT');
    const category = await this.category(tx, ctx, asset.category_id);
    const depreciable = toMoney(asset.cost).minus(asset.residual_value);
    let entryId: string | null = null;
    let opening = new Money(0);
    let depreciatedTo = addDays(asset.in_service_date, -1);

    if (input.mode === 'POST') {
      const cost = toMoney(asset.cost);
      entryId = await this.postEntry(tx, ctx, company, asset.acquisition_date, 'FA_ACQUISITION', id, input.description || `اقتناء الأصل ${asset.code} / Acquisition of asset ${asset.code}`, [
        this.line(category.asset_account_id, asset.cost_center_id, cost, 'debit', `${asset.code} cost`),
        this.line(input.offset_account_id, asset.cost_center_id, cost, 'credit', `${asset.code} cost`),
      ]);
    } else {
      opening = toMoney(input.opening_accum_dep);
      if (opening.gt(depreciable)) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'opening_accum_dep', message: 'More than cost less residual value' }]);
      if (opening.gt(0)) {
        if (!input.opening_dep_date) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'opening_dep_date', message: 'Date of the accumulated depreciation is required' }]);
        depreciatedTo = input.opening_dep_date;
      }
    }
    const status: AssetStatus = asset.method !== 'NONE' && opening.gte(depreciable) ? 'FULLY_DEPRECIATED' : 'ACTIVE';
    await tx.query('UPDATE fa.assets SET status = $2, opening_accum_dep = $3, depreciated_to = $4, acquisition_entry_id = $5 WHERE id = $1', [
      id,
      status,
      toStorage(opening),
      depreciatedTo,
      entryId,
    ]);
    await this.event(tx, ctx, id, 'ACQUIRE', asset.acquisition_date, asset.cost, entryId, { mode: input.mode, opening_accum_dep: toStorage(opening) });
    await this.audit.record(tx, ctx, { action: 'activate', entityType: 'fa_asset', entityId: id, companyId: ctx.companyId, newData: input });
    return { status, entry_id: entryId };
  }

  private async insertAsset(tx: Tx, ctx: CompanyContext, input: FaAssetInput): Promise<{ id: string }> {
    const values = await this.assetValues(tx, ctx, input);
    const row = await tx.one<{ id: string }>(
      `INSERT INTO fa.assets (tenant_id, company_id, code, name_ar, name_en, category_id, cost_center_id, location, custodian, serial_no,
         acquisition_date, in_service_date, cost, residual_value, method, useful_life_months, declining_rate, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [ctx.tenantId, ctx.companyId, ...values, ctx.userId],
    );
    await this.audit.record(tx, ctx, { action: 'create', entityType: 'fa_asset', entityId: row.id, companyId: ctx.companyId, newData: input });
    return row;
  }

  /** Column values for insert/update, with the category's depreciation defaults applied. */
  private async assetValues(tx: Tx, ctx: CompanyContext, input: FaAssetInput) {
    const category = await this.category(tx, ctx, input.category_id);
    const costCenter = await tx.maybeOne<{ is_posting: boolean }>('SELECT is_posting FROM gl.cost_centers WHERE company_id = $1 AND id = $2', [ctx.companyId, input.cost_center_id]);
    if (!costCenter?.is_posting) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'cost_center_id', message: 'Choose a posting cost center' }]);
    const method = input.method ?? category.method;
    const life = method === 'STRAIGHT_LINE' ? (input.useful_life_months ?? category.useful_life_months) : null;
    const rate = method === 'DECLINING_BALANCE' ? (input.declining_rate ?? category.declining_rate) : null;
    if (method === 'STRAIGHT_LINE' && !life) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'useful_life_months', message: 'Useful life is required' }]);
    if (method === 'DECLINING_BALANCE' && !rate) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'declining_rate', message: 'Rate is required' }]);
    if (method !== 'NONE' && (!category.accum_dep_account_id || !category.dep_expense_account_id)) {
      throw new AppError('VALIDATION_FAILED', {}, [{ path: 'method', message: 'The category has no depreciation accounts' }]);
    }
    const cost = toMoney(input.cost);
    const residual = input.residual_value ? toMoney(input.residual_value) : cost.times(category.residual_percent).div(100).toDecimalPlaces(3);
    if (residual.gte(cost)) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'residual_value', message: 'Must be less than cost' }]);
    const inService = input.in_service_date ?? input.acquisition_date;
    if (inService < input.acquisition_date) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'in_service_date', message: 'Before the acquisition date' }]);
    return [
      input.code,
      input.name_ar || input.name_en,
      input.name_en || input.name_ar,
      input.category_id,
      input.cost_center_id,
      input.location ?? null,
      input.custodian ?? null,
      input.serial_no ?? null,
      input.acquisition_date,
      inService,
      toStorage(cost),
      toStorage(residual),
      method,
      life,
      rate,
      input.notes ?? null,
    ];
  }

  private async category(tx: Tx, ctx: CompanyContext, id: string): Promise<Category> {
    const category = await tx.maybeOne<Category>('SELECT * FROM fa.categories WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
    if (!category) throw notFound('category');
    return category;
  }

  private async lockAsset(tx: Tx, ctx: CompanyContext, id: string): Promise<AssetRow & { disposal_date: string | null }> {
    const [asset] = await this.assetsForUpdate(tx, ctx, 'a.id = $2', [id]);
    if (!asset) throw notFound('asset');
    return asset;
  }

  private assetsForUpdate(tx: Tx, ctx: CompanyContext, where: string, params: unknown[]): Promise<AssetRow[]> {
    return tx.query<AssetRow>(
      `SELECT a.id, a.code, a.name_ar, a.name_en, a.category_id, a.cost_center_id, a.acquisition_date, a.in_service_date, a.cost,
              a.residual_value, a.method, a.useful_life_months, a.declining_rate, a.opening_accum_dep, a.depreciated_to, a.status,
              a.disposal_date, ${ACCUMULATED} AS accumulated
       FROM fa.assets a WHERE a.company_id = $1 AND ${where} ORDER BY a.code FOR UPDATE OF a`,
      [ctx.companyId, ...params],
    );
  }

  private line(accountId: string, costCenterId: string | null, amount: MoneyValue, side: 'debit' | 'credit', description: string): PostingLine {
    return { account_id: accountId, cost_center_id: costCenterId, debit: side === 'debit' ? amount : new Money(0), credit: side === 'credit' ? amount : new Money(0), description };
  }

  private async accountMap(tx: Tx, companyId: string): Promise<Map<string, AccountInfo>> {
    const rows = await tx.query<AccountInfo>(
      'SELECT id, code, account_type, cost_center_rule, is_posting, is_control, control_module FROM gl.accounts WHERE company_id = $1',
      [companyId],
    );
    return new Map(rows.map((a) => [a.id, a]));
  }

  /**
   * Creates and posts a base-currency FA entry. Cost centers follow each account's rule:
   * kept where required (or, for profit and loss accounts, allowed), dropped where not allowed.
   */
  private async postEntry(tx: Tx, ctx: CompanyContext, company: CompanyInfo, date: string, docType: string, docId: string, description: string, lines: PostingLine[]): Promise<string> {
    const period = await this.fiscal.resolvePeriod(tx, ctx.companyId, date);
    const type = await tx.one<{ id: string }>("SELECT id FROM gl.journal_types WHERE company_id = $1 AND code = 'FA'", [ctx.companyId]);
    const accounts = await this.accountMap(tx, ctx.companyId);
    const entry = await tx.one<{ id: string }>(
      `INSERT INTO gl.journal_entries (tenant_id, company_id, journal_type_id, fiscal_year_id, period_id, entry_date, description,
         source_module, source_doc_type, source_doc_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'FA', $8, $9, $10) RETURNING id`,
      [ctx.tenantId, ctx.companyId, type.id, period.fiscal_year_id, period.id, date, description, docType, docId, ctx.userId],
    );
    let lineNo = 0;
    for (const l of lines) {
      if (l.debit.isZero() && l.credit.isZero()) continue;
      const account = accounts.get(l.account_id);
      const profitAndLoss = account?.account_type === 'REVENUE' || account?.account_type === 'EXPENSE';
      const keepCostCenter = account?.cost_center_rule === 'REQUIRED' || (account?.cost_center_rule === 'OPTIONAL' && profitAndLoss);
      lineNo++;
      await tx.query(
        `INSERT INTO gl.journal_lines (tenant_id, company_id, entry_id, line_no, account_id, cost_center_id, description, currency_code,
           exchange_rate, debit, credit, debit_base, credit_base)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $9, $10)`,
        [ctx.tenantId, ctx.companyId, entry.id, lineNo, l.account_id, keepCostCenter ? l.cost_center_id : null, l.description, company.base_currency, toStorage(l.debit), toStorage(l.credit)],
      );
    }
    const locked = await this.engine.lockEntry(tx, ctx.companyId, entry.id);
    await this.engine.post(tx, ctx, company, locked, { systemEntry: true });
    return entry.id;
  }

  private event(tx: Tx, ctx: CompanyContext, assetId: string, type: string, date: string, amount: string | null, entryId: string | null, details: Record<string, unknown>) {
    return tx.query(
      `INSERT INTO fa.asset_events (tenant_id, company_id, asset_id, event_type, event_date, amount, entry_id, details, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [ctx.tenantId, ctx.companyId, assetId, type, date, amount, entryId, JSON.stringify(details), ctx.userId],
    );
  }
}
