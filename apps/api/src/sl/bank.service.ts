import { Injectable } from '@nestjs/common';
import { Money, roundToMinor, sumAmounts, toMoney, toStorage } from '@erp/shared';
import type { z } from 'zod';
import type { bankAccountSchema, bankTransferSchema } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';
import { findRate } from '../gl/masters.service';
import { loadCompany } from '../gl/posting.engine';
import { type SlLine, SubledgerService } from './subledger.service';

type BankAccount = { id: string; code: string; account_id: string; currency_code: string; is_active: boolean };

/** Bank and cash accounts: balances, transfers between them, and statement reconciliation. */
@Injectable()
export class BankService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly subledger: SubledgerService,
  ) {}

  listAccounts(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT b.*, a.code AS account_code, a.name_ar AS account_name_ar, a.name_en AS account_name_en,
                COALESCE(sum(CASE WHEN l.currency_code = b.currency_code THEN l.debit - l.credit END), 0) AS balance,
                COALESCE(sum(l.debit_base - l.credit_base), 0) AS balance_base,
                (SELECT max(r.statement_date) FROM sl.reconciliations r WHERE r.bank_account_id = b.id AND r.status = 'COMPLETED') AS reconciled_to
         FROM sl.bank_accounts b JOIN gl.accounts a ON a.id = b.account_id
         LEFT JOIN gl.journal_lines l ON l.account_id = b.account_id AND EXISTS (SELECT 1 FROM gl.journal_entries e WHERE e.id = l.entry_id AND e.status IN ('POSTED', 'REVERSED'))
         WHERE b.company_id = $1
         GROUP BY b.tenant_id, b.id, a.code, a.name_ar, a.name_en ORDER BY b.code`,
        [ctx.companyId],
      ),
    );
  }

  saveAccount(ctx: CompanyContext, input: z.infer<typeof bankAccountSchema>, id?: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const account = await tx.maybeOne<{ account_type: string; is_posting: boolean; is_control: boolean }>(
        'SELECT account_type, is_posting, is_control FROM gl.accounts WHERE company_id = $1 AND id = $2',
        [ctx.companyId, input.account_id],
      );
      if (!account?.is_posting || account.account_type !== 'ASSET' || account.is_control) {
        throw new AppError('VALIDATION_FAILED', {}, [{ path: 'account_id', message: 'Choose a posting asset account that is not a control account' }]);
      }
      const values = [input.code, input.name_ar || input.name_en, input.name_en || input.name_ar, input.kind, input.account_id, input.currency_code, input.bank_name ?? null, input.account_number ?? null, input.iban ?? null, input.is_active];
      const row = id
        ? await tx.maybeOne(
            `UPDATE sl.bank_accounts SET code = $2, name_ar = $3, name_en = $4, kind = $5, account_id = $6, currency_code = $7, bank_name = $8,
               account_number = $9, iban = $10, is_active = $11 WHERE company_id = $1 AND id = $12 RETURNING *`,
            [ctx.companyId, ...values, id],
          )
        : await tx.one(
            `INSERT INTO sl.bank_accounts (tenant_id, company_id, code, name_ar, name_en, kind, account_id, currency_code, bank_name, account_number, iban, is_active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
            [ctx.tenantId, ctx.companyId, ...values],
          );
      if (!row) throw notFound('bank account');
      await this.audit.record(tx, ctx, { action: id ? 'update' : 'create', entityType: 'bank_account', entityId: (row as { id: string }).id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  // ---------------------------------------------------------------- transfers

  listTransfers(ctx: CompanyContext) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT t.*, f.code AS from_code, f.currency_code AS from_currency, d.code AS to_code, d.currency_code AS to_currency, e.entry_no
         FROM sl.bank_transfers t JOIN sl.bank_accounts f ON f.id = t.from_account_id JOIN sl.bank_accounts d ON d.id = t.to_account_id
         LEFT JOIN gl.journal_entries e ON e.id = t.entry_id
         WHERE t.company_id = $1 ORDER BY t.transfer_date DESC, t.created_at DESC LIMIT 500`,
        [ctx.companyId],
      ),
    );
  }

  /** Moves money between two bank / cash accounts; across currencies the received amount is entered too. */
  transfer(ctx: CompanyContext, input: z.infer<typeof bankTransferSchema>) {
    return this.db.withTenant(ctx, async (tx) => {
      const company = await loadCompany(tx, ctx.companyId);
      const from = await this.account(tx, ctx, input.from_account_id);
      const to = await this.account(tx, ctx, input.to_account_id);
      const amount = toMoney(input.amount);
      const toAmount = from.currency_code === to.currency_code ? amount : toMoney(input.to_amount ?? '0');
      if (toAmount.lte(0)) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'to_amount', message: 'Enter the amount received' }]);
      const rateOf = async (currency: string) => (currency === company.base_currency ? '1' : findRate(tx, ctx.companyId, currency, input.transfer_date));
      const fromRate = await rateOf(from.currency_code);
      // Valued at the paying account's rate; the receiving side carries the same base amount.
      const base =
        from.currency_code === company.base_currency
          ? amount
          : to.currency_code === company.base_currency
            ? toAmount
            : roundToMinor(amount.times(fromRate), company.base_minor_units);
      const toRate = toAmount.isZero() ? '1' : base.div(toAmount).toFixed(8);
      const row = await tx.one<{ id: string }>(
        `INSERT INTO sl.bank_transfers (tenant_id, company_id, transfer_date, from_account_id, to_account_id, amount, to_amount, reference, description, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [ctx.tenantId, ctx.companyId, input.transfer_date, from.id, to.id, toStorage(amount), toStorage(toAmount), input.reference ?? null, input.description ?? null, ctx.userId],
      );
      const zero = new Money(0);
      const description = input.description || `تحويل ${from.code} ← ${to.code} / Transfer ${from.code} → ${to.code}`;
      const lines: SlLine[] = [
        { account_id: to.account_id, cost_center_id: null, description, currency_code: to.currency_code, exchange_rate: to.currency_code === company.base_currency ? '1' : toRate, debit: toAmount, credit: zero, debit_base: base, credit_base: zero },
        { account_id: from.account_id, cost_center_id: null, description, currency_code: from.currency_code, exchange_rate: fromRate, debit: zero, credit: amount, debit_base: zero, credit_base: base },
      ];
      const entryId = await this.subledger.postEntry(tx, ctx, company, 'GL', input.transfer_date, 'BANK_TRANSFER', row.id, description, lines, 'BNK');
      await tx.query('UPDATE sl.bank_transfers SET entry_id = $2 WHERE id = $1', [row.id, entryId]);
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'bank_transfer', entityId: row.id, companyId: ctx.companyId, newData: input });
      return { id: row.id, entry_id: entryId };
    });
  }

  // ---------------------------------------------------------------- reconciliation

  listReconciliations(ctx: CompanyContext, bankAccountId: string) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query(
        `SELECT r.id, r.statement_date, r.statement_balance, r.status, r.completed_at, u.full_name AS completed_by_name,
                (SELECT count(*)::int FROM sl.reconciliation_items i WHERE i.reconciliation_id = r.id) AS item_count
         FROM sl.reconciliations r LEFT JOIN core.users u ON u.id = r.completed_by
         WHERE r.company_id = $1 AND r.bank_account_id = $2 ORDER BY r.statement_date DESC, r.created_at DESC`,
        [ctx.companyId, bankAccountId],
      ),
    );
  }

  startReconciliation(ctx: CompanyContext, input: { bank_account_id: string; statement_date: string; statement_balance: string }) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.account(tx, ctx, input.bank_account_id);
      const open = await tx.maybeOne("SELECT 1 FROM sl.reconciliations WHERE bank_account_id = $1 AND status = 'DRAFT'", [input.bank_account_id]);
      if (open) throw new AppError('SL_RECONCILIATION_OPEN');
      const row = await tx.one<{ id: string }>(
        'INSERT INTO sl.reconciliations (tenant_id, company_id, bank_account_id, statement_date, statement_balance, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [ctx.tenantId, ctx.companyId, input.bank_account_id, input.statement_date, input.statement_balance, ctx.userId],
      );
      return row;
    });
  }

  /**
   * The reconciliation screen: ledger lines on the bank account up to the statement date that no
   * completed reconciliation has cleared, with this reconciliation's selection and the difference.
   */
  getReconciliation(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, (tx) => this.reconciliationState(tx, ctx, id));
  }

  setItems(ctx: CompanyContext, id: string, lineIds: string[]) {
    return this.db.withTenant(ctx, async (tx) => {
      const state = await this.reconciliationState(tx, ctx, id);
      if (state.status !== 'DRAFT') throw new AppError('VALIDATION_FAILED', {}, [{ path: 'status', message: 'The reconciliation is completed' }]);
      const allowed = new Set(state.lines.map((l) => l.id));
      await tx.query('DELETE FROM sl.reconciliation_items WHERE reconciliation_id = $1', [id]);
      for (const lineId of new Set(lineIds)) {
        if (!allowed.has(lineId)) continue;
        await tx.query('INSERT INTO sl.reconciliation_items (tenant_id, company_id, reconciliation_id, line_id) VALUES ($1, $2, $3, $4)', [ctx.tenantId, ctx.companyId, id, lineId]);
      }
      return this.reconciliationState(tx, ctx, id);
    });
  }

  complete(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const state = await this.reconciliationState(tx, ctx, id);
      if (state.status !== 'DRAFT') throw new AppError('VALIDATION_FAILED', {}, [{ path: 'status', message: 'The reconciliation is completed' }]);
      if (!toMoney(state.difference).isZero()) throw new AppError('SL_RECONCILIATION_DIFFERENCE', { difference: state.difference });
      await tx.query("UPDATE sl.reconciliations SET status = 'COMPLETED', completed_by = $2, completed_at = now() WHERE id = $1", [id, ctx.userId]);
      await this.audit.record(tx, ctx, { action: 'reconcile', entityType: 'bank_account', entityId: state.bank_account_id, companyId: ctx.companyId, newData: { statement_date: state.statement_date, statement_balance: state.statement_balance } });
      return { completed: true };
    });
  }

  deleteReconciliation(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const row = await tx.maybeOne<{ status: string }>('SELECT status FROM sl.reconciliations WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
      if (!row) throw notFound('reconciliation');
      if (row.status !== 'DRAFT') throw new AppError('VALIDATION_FAILED', {}, [{ path: 'status', message: 'The reconciliation is completed' }]);
      await tx.query('DELETE FROM sl.reconciliations WHERE id = $1', [id]);
      return { deleted: true };
    });
  }

  private async reconciliationState(tx: Tx, ctx: CompanyContext, id: string) {
    const rec = await tx.maybeOne<{ id: string; bank_account_id: string; statement_date: string; statement_balance: string; status: string }>(
      'SELECT id, bank_account_id, statement_date, statement_balance, status FROM sl.reconciliations WHERE company_id = $1 AND id = $2',
      [ctx.companyId, id],
    );
    if (!rec) throw notFound('reconciliation');
    const bank = await tx.one<BankAccount & { name_ar: string; name_en: string }>('SELECT * FROM sl.bank_accounts WHERE id = $1', [rec.bank_account_id]);
    // Cleared by earlier completed reconciliations of this account.
    const cleared = await tx.one<{ total: string }>(
      `SELECT COALESCE(sum(l.debit - l.credit), 0) AS total FROM gl.journal_lines l
       WHERE l.id IN (SELECT i.line_id FROM sl.reconciliation_items i JOIN sl.reconciliations r ON r.id = i.reconciliation_id
                      WHERE r.bank_account_id = $1 AND r.status = 'COMPLETED' AND r.id <> $2)`,
      [rec.bank_account_id, id],
    );
    const lines = await tx.query<{ id: string; entry_date: string; entry_no: string; entry_id: string; description: string | null; reference: string | null; amount: string; selected: boolean }>(
      `SELECT l.id, e.entry_date, e.entry_no, e.id AS entry_id, COALESCE(l.description, e.description) AS description, e.reference,
              (l.debit - l.credit) AS amount,
              EXISTS (SELECT 1 FROM sl.reconciliation_items i WHERE i.reconciliation_id = $2 AND i.line_id = l.id) AS selected
       FROM gl.journal_lines l JOIN gl.journal_entries e ON e.id = l.entry_id
       WHERE l.company_id = $1 AND l.account_id = $3 AND e.status IN ('POSTED', 'REVERSED') AND e.entry_date <= $4 AND l.currency_code = $5
         AND NOT EXISTS (SELECT 1 FROM sl.reconciliation_items i JOIN sl.reconciliations r ON r.id = i.reconciliation_id
                         WHERE i.line_id = l.id AND r.status = 'COMPLETED' AND r.id <> $2)
       ORDER BY e.entry_date, e.entry_no`,
      [ctx.companyId, id, bank.account_id, rec.statement_date, bank.currency_code],
    );
    const selected = sumAmounts(lines.filter((l) => l.selected).map((l) => l.amount));
    const reconciled = toMoney(cleared.total).plus(selected);
    return {
      ...rec,
      bank_account: bank,
      opening_cleared: toStorage(toMoney(cleared.total)),
      selected_total: toStorage(selected),
      reconciled_balance: toStorage(reconciled),
      difference: toStorage(toMoney(rec.statement_balance).minus(reconciled)),
      lines,
    };
  }

  private async account(tx: Tx, ctx: CompanyContext, id: string): Promise<BankAccount> {
    const row = await tx.maybeOne<BankAccount>('SELECT id, code, account_id, currency_code, is_active FROM sl.bank_accounts WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
    if (!row?.is_active) throw notFound('bank account');
    return row;
  }
}
