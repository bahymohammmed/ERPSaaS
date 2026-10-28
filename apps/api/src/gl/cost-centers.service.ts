import { Injectable } from '@nestjs/common';
import type { CostCenterInput } from '@erp/shared';
import { AppError, notFound } from '../common/app-error';
import { AuditService } from '../common/audit.service';
import { descendantIds, wouldCreateCycle } from '../common/hierarchy';
import type { CompanyContext, RequestContext } from '../common/request-context';
import { DbService, type Tx } from '../db/db.service';

export type CostCenterRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  is_posting: boolean;
  cc_type: string;
  manager_user_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
};

const COLUMNS = 'id, code, name_ar, name_en, parent_id, is_posting, cc_type, manager_user_id, valid_from, valid_to, is_active';

@Injectable()
export class CostCentersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: CompanyContext, query: { search?: string; posting_only?: boolean; active_only?: boolean }) {
    return this.db.withTenant(ctx, async (tx) => {
      const scope = await scopedCostCenterIds(tx, ctx);
      return tx.query<CostCenterRow & { has_transactions: boolean }>(
        `SELECT ${COLUMNS},
                EXISTS (SELECT 1 FROM gl.journal_lines l WHERE l.company_id = c.company_id AND l.cost_center_id = c.id) AS has_transactions
         FROM gl.cost_centers c
         WHERE company_id = $1
           AND ($2::text IS NULL OR search_text LIKE '%' || lower(core.ar_normalize($2)) || '%')
           AND (NOT $3 OR is_posting)
           AND (NOT $4 OR is_active)
           AND ($5::uuid[] IS NULL OR id = ANY($5))
         ORDER BY code`,
        [ctx.companyId, query.search || null, query.posting_only ?? false, query.active_only ?? false, scope],
      );
    });
  }

  create(ctx: CompanyContext, input: CostCenterInput) {
    return this.db.withTenant(ctx, async (tx) => {
      await this.validateParent(tx, ctx.companyId, input.parent_id ?? null, null);
      const row = await tx.one<CostCenterRow>(
        `INSERT INTO gl.cost_centers (tenant_id, company_id, code, name_ar, name_en, parent_id, is_posting, cc_type,
           manager_user_id, valid_from, valid_to, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING ${COLUMNS}`,
        [ctx.tenantId, ctx.companyId, ...values(input)],
      );
      await this.audit.record(tx, ctx, { action: 'create', entityType: 'cost_center', entityId: row.id, companyId: ctx.companyId, newData: input });
      return row;
    });
  }

  update(ctx: CompanyContext, id: string, input: CostCenterInput) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await tx.maybeOne<CostCenterRow>(`SELECT ${COLUMNS} FROM gl.cost_centers WHERE company_id = $1 AND id = $2 FOR UPDATE`, [ctx.companyId, id]);
      if (!existing) throw notFound('cost center');
      await this.validateParent(tx, ctx.companyId, input.parent_id ?? null, id);
      if (existing.is_posting && !input.is_posting && (await this.hasTransactions(tx, ctx.companyId, id))) {
        throw new AppError('COST_CENTER_HAS_TRANSACTIONS', { code: existing.code });
      }
      if (!existing.is_posting && input.is_posting) {
        const child = await tx.maybeOne('SELECT 1 FROM gl.cost_centers WHERE company_id = $1 AND parent_id = $2 LIMIT 1', [ctx.companyId, id]);
        if (child) throw new AppError('COST_CENTER_HAS_CHILDREN', { code: existing.code });
      }
      const row = await tx.one<CostCenterRow>(
        `UPDATE gl.cost_centers SET code = $3, name_ar = $4, name_en = $5, parent_id = $6, is_posting = $7, cc_type = $8,
           manager_user_id = $9, valid_from = $10, valid_to = $11, is_active = $12
         WHERE company_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
        [ctx.companyId, id, ...values(input)],
      );
      await this.audit.record(tx, ctx, { action: 'update', entityType: 'cost_center', entityId: id, companyId: ctx.companyId, oldData: existing, newData: input });
      return row;
    });
  }

  remove(ctx: CompanyContext, id: string) {
    return this.db.withTenant(ctx, async (tx) => {
      const existing = await tx.maybeOne<CostCenterRow>(`SELECT ${COLUMNS} FROM gl.cost_centers WHERE company_id = $1 AND id = $2`, [ctx.companyId, id]);
      if (!existing) throw notFound('cost center');
      if (await this.hasTransactions(tx, ctx.companyId, id)) throw new AppError('COST_CENTER_HAS_TRANSACTIONS', { code: existing.code });
      const child = await tx.maybeOne('SELECT 1 FROM gl.cost_centers WHERE company_id = $1 AND parent_id = $2 LIMIT 1', [ctx.companyId, id]);
      if (child) throw new AppError('COST_CENTER_HAS_CHILDREN', { code: existing.code });
      await tx.query('DELETE FROM gl.cost_centers WHERE company_id = $1 AND id = $2', [ctx.companyId, id]);
      await this.audit.record(tx, ctx, { action: 'delete', entityType: 'cost_center', entityId: id, companyId: ctx.companyId, oldData: existing });
      return { deleted: true };
    });
  }

  private async hasTransactions(tx: Tx, companyId: string, id: string): Promise<boolean> {
    return !!(await tx.maybeOne('SELECT 1 FROM gl.journal_lines WHERE company_id = $1 AND cost_center_id = $2 LIMIT 1', [companyId, id]));
  }

  private async validateParent(tx: Tx, companyId: string, parentId: string | null, selfId: string | null): Promise<void> {
    if (!parentId) return;
    const parent = await tx.maybeOne<{ is_posting: boolean }>('SELECT is_posting FROM gl.cost_centers WHERE company_id = $1 AND id = $2', [companyId, parentId]);
    if (!parent) throw notFound('parent cost center');
    if (parent.is_posting) throw new AppError('COST_CENTER_PARENT_NOT_HEADER');
    if (selfId && (await wouldCreateCycle(tx, 'gl.cost_centers', companyId, selfId, parentId))) throw new AppError('HIERARCHY_CYCLE');
  }
}

const values = (input: CostCenterInput): unknown[] => [
  input.code,
  input.name_ar || input.name_en,
  input.name_en || input.name_ar,
  input.parent_id ?? null,
  input.is_posting,
  input.cc_type,
  input.manager_user_id ?? null,
  input.valid_from ?? null,
  input.valid_to ?? null,
  input.is_active,
];

/** Cost center ids visible to the user (scope roots + subtrees), or null when unrestricted. */
export const scopedCostCenterIds = async (tx: Tx, ctx: RequestContext & { companyId: string }): Promise<string[] | null> => {
  if (!ctx.costCenterScope) return null;
  return descendantIds(tx, 'gl.cost_centers', ctx.companyId, ctx.costCenterScope);
};
