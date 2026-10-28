import { Injectable } from '@nestjs/common';
import { type AccountInput, DEFAULT_NORMAL_BALANCE } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { wouldCreateCycle } from '../common/hierarchy';
import type { CompanyContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';

export type AccountRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  is_posting: boolean;
  account_type: AccountInput['account_type'];
  normal_balance: 'DEBIT' | 'CREDIT';
  cost_center_rule: 'REQUIRED' | 'OPTIONAL' | 'NOT_ALLOWED';
  default_cost_center_id: string | null;
  is_control: boolean;
  control_module: string | null;
  allowed_currencies: string[] | null;
  cash_flow_category: string | null;
  is_reconcilable: boolean;
  is_active: boolean;
};

const ACCOUNT_COLUMNS = `a.id, a.code, a.name_ar, a.name_en, a.parent_id, a.is_posting, a.account_type, a.normal_balance,
  a.cost_center_rule, a.default_cost_center_id, a.is_control, a.control_module, a.allowed_currencies,
  a.cash_flow_category, a.is_reconcilable, a.is_active`;

@Injectable()
export class AccountsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: CompanyContext, query: { search?: string; posting_only?: boolean; active_only?: boolean }) {
    return this.db.withTenant(ctx, (tx) =>
      tx.query<AccountRow & { has_transactions: boolean }>(
        `SELECT ${ACCOUNT_COLUMNS},
                EXISTS (SELECT 1 FROM gl.journal_lines l WHERE l.company_id = a.company_id AND l.account_id = a.id) AS has_transactions
         FROM gl.accounts a
         WHERE a.company_id = $1
           AND ($2::text IS NULL OR a.search_text LIKE '%' || lower(core.ar_normalize($2)) || '%')
           AND (NOT $3 OR a.is_posting)
           AND (NOT $4 OR a.is_active)
         ORDER BY a.code`,
        [ctx.companyId, query.search || null, query.posting_only ?? false, query.active_only ?? false],
      ),
    );
  }

  get(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const account = await this.find(tx, ctx.companyId, id);
      const allowed = await tx.query<{ cost_center_id: string }>(
        'SELECT cost_center_id FROM gl.account_cost_centers WHERE account_id = $1',
        [id],
      );
      const rules = await tx.query<{ dimension_type_id: string; rule: string }>(
        'SELECT dimension_type_id, rule FROM gl.account_dimension_rules WHERE account_id = $1',
        [id],
      );
      return { ...account, allowed_cost_center_ids: allowed.map((r) => r.cost_center_id), dimension_rules: rules };
    });
  }

  create(ctx: CompanyContext, input: AccountInput) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.validateParent(tx, ctx.companyId, input, null);
      const row = await tx.one<AccountRow>(
        `INSERT INTO gl.accounts (tenant_id, company_id, code, name_ar, name_en, parent_id, is_posting, account_type,
           normal_balance, cost_center_rule, default_cost_center_id, is_control, control_module, allowed_currencies,
           cash_flow_category, is_reconcilable, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         RETURNING ${ACCOUNT_COLUMNS.replace(/a\./g, '')}`,
        [ctx.tenantId, ctx.companyId, ...this.values(input)],
      );
      await this.replaceRules(tx, ctx, row.id, input);
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'account', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  update(ctx: CompanyContext, id: string, input: AccountInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.find(tx, ctx.companyId, id, true);
      await this.validateParent(tx, ctx.companyId, input, id);

      const hasTransactions = await this.hasTransactions(tx, ctx.companyId, id);
      if (hasTransactions && (existing.account_type !== input.account_type || !input.is_posting)) {
        throw new AppError('ACCOUNT_HAS_TRANSACTIONS', { code: existing.code });
      }
      if (input.is_posting && !existing.is_posting) {
        const child = await tx.maybeOne('SELECT 1 FROM gl.accounts WHERE company_id = $1 AND parent_id = $2 LIMIT 1', [ctx.companyId, id]);
        if (child) throw new AppError('ACCOUNT_HAS_CHILDREN', { code: existing.code });
      }

      const row = await tx.one<AccountRow>(
        `UPDATE gl.accounts SET code = $3, name_ar = $4, name_en = $5, parent_id = $6, is_posting = $7, account_type = $8,
           normal_balance = $9, cost_center_rule = $10, default_cost_center_id = $11, is_control = $12, control_module = $13,
           allowed_currencies = $14, cash_flow_category = $15, is_reconcilable = $16, is_active = $17
         WHERE company_id = $1 AND id = $2
         RETURNING ${ACCOUNT_COLUMNS.replace(/a\./g, '')}`,
        [ctx.companyId, id, ...this.values(input)],
      );
      await this.replaceRules(tx, ctx, id, input);
      await this.audit.record(tx, ctx, { action: 'update', entityType: 'account', entityId: id, companyId: ctx.companyId, oldData: existing, newData: input });
      return row;
    });
  }

  remove(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await this.find(tx, ctx.companyId, id, true);
      if (await this.hasTransactions(tx, ctx.companyId, id)) throw new AppError('ACCOUNT_HAS_TRANSACTIONS', { code: existing.code });
      const child = await tx.maybeOne('SELECT 1 FROM gl.accounts WHERE company_id = $1 AND parent_id = $2 LIMIT 1', [ctx.companyId, id]);
      if (child) throw new AppError('ACCOUNT_HAS_CHILDREN', { code: existing.code });
      await tx.query('DELETE FROM gl.accounts WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'account', entityId: id, companyId: ctx.companyId, oldData: existing });
      return { deleted: true };
    });
  }

  private values(input: AccountInput): unknown[] {
    return [
      input.code,
      input.name_ar || input.name_en,
      input.name_en || input.name_ar,
      input.parent_id ?? null,
      input.is_posting,
      input.account_type,
      input.normal_balance ?? DEFAULT_NORMAL_BALANCE[input.account_type],
      input.cost_center_rule,
      input.default_cost_center_id ?? null,
      input.is_control,
      input.is_control ? (input.control_module ?? null) : null,
      input.allowed_currencies?.length ? input.allowed_currencies : null,
      input.cash_flow_category ?? null,
      input.is_reconcilable,
      input.is_active,
    ];
  }

  private async find(tx: Tx, companyId: string, id: string, lock = false): Promise<AccountRow> {
    const row = await tx.maybeOne<AccountRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM gl.accounts a WHERE a.company_id = $1 AND a.id = $2 ${lock ? 'FOR UPDATE' : ''}`,
      [companyId, id],
    );
    if (!row) throw notFound('account');
    return row;
  }

  private async hasTransactions(tx: Tx, companyId: string, id: string): Promise<boolean> {
    return !!(await tx.maybeOne('SELECT 1 FROM gl.journal_lines WHERE company_id = $1 AND account_id = $2 LIMIT 1', [companyId, id]));
  }

  private async validateParent(tx: Tx, companyId: string, input: AccountInput, selfId: string | null): Promise<void> {
    if (input.default_cost_center_id) {
      const cc = await tx.maybeOne<{ is_posting: boolean }>('SELECT is_posting FROM gl.cost_centers WHERE company_id = $1 AND id = $2', [companyId, input.default_cost_center_id]);
      if (!cc?.is_posting) throw new AppError('VALIDATION_FAILED', {}, [{ path: 'default_cost_center_id', message: 'Must be a posting cost center' }]);
    }
    if (!input.parent_id) return;
    const parent = await tx.maybeOne<{ is_posting: boolean; account_type: string }>(
      'SELECT is_posting, account_type FROM gl.accounts WHERE company_id = $1 AND id = $2',
      [companyId, input.parent_id],
    );
    if (!parent) throw notFound('parent account');
    if (parent.is_posting) throw new AppError('ACCOUNT_PARENT_NOT_HEADER');
    if (parent.account_type !== input.account_type) throw new AppError('ACCOUNT_PARENT_TYPE_MISMATCH');
    if (selfId && (await wouldCreateCycle(tx, 'gl.accounts', companyId, selfId, input.parent_id))) {
      throw new AppError('HIERARCHY_CYCLE');
    }
  }

  private async replaceRules(tx: Tx, ctx: CompanyContext, accountId: string, input: AccountInput): Promise<void> {
    await tx.query('DELETE FROM gl.account_cost_centers WHERE account_id = $1', [accountId]);
    if (input.allowed_cost_center_ids.length) {
      await tx.query(
        `INSERT INTO gl.account_cost_centers (tenant_id, company_id, account_id, cost_center_id)
         SELECT $1, $2, $3, unnest($4::uuid[])`,
        [ctx.tenantId, ctx.companyId, accountId, input.allowed_cost_center_ids],
      );
    }
    await tx.query('DELETE FROM gl.account_dimension_rules WHERE account_id = $1', [accountId]);
    for (const rule of input.dimension_rules) {
      await tx.query(
        `INSERT INTO gl.account_dimension_rules (tenant_id, company_id, account_id, dimension_type_id, rule) VALUES ($1, $2, $3, $4, $5)`,
        [ctx.tenantId, ctx.companyId, accountId, rule.dimension_type_id, rule.rule],
      );
    }
  }
}
