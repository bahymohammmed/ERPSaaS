import { Injectable } from '@nestjs/common';
import { DEFAULT_NORMAL_BALANCE, SYSTEM_ROLES, type SystemRoleCode } from '@erp/shared';
import type { Tx } from '../db/db.service';
import {
  DEFAULT_JOURNAL_TYPES,
  KUWAIT_IFRS_COA,
  TEMPLATE_FX_GAIN_ACCOUNT,
  TEMPLATE_FX_LOSS_ACCOUNT,
  TEMPLATE_RETAINED_EARNINGS_ACCOUNT,
  TEMPLATE_ROUNDING_ACCOUNT,
} from '../db/seed/coa-kuwait';
import { ensureCompanyDefaults } from '../gl/defaults';
import { FiscalService } from '../gl/fiscal.service';

export type NewCompany = {
  code: string;
  name_ar: string;
  name_en: string;
  base_currency: string;
  fiscal_year_start_month: number;
  first_fiscal_year: number;
  seed_chart_of_accounts: boolean;
  require_approval?: boolean;
};

const DEFAULT_COST_CENTERS = [
  { code: '1', ar: 'المركز الرئيسي', en: 'Head office', parent: null, posting: false, type: 'OTHER' },
  { code: '101', ar: 'الإدارة العامة', en: 'General administration', parent: '1', posting: true, type: 'ADMINISTRATIVE' },
  { code: '102', ar: 'المبيعات', en: 'Sales', parent: '1', posting: true, type: 'SALES' },
  { code: '103', ar: 'العمليات', en: 'Operations', parent: '1', posting: true, type: 'PRODUCTION' },
] as const;

/** Seeds what a new tenant or company needs to start posting on day one. */
@Injectable()
export class ProvisioningService {
  constructor(private readonly fiscal: FiscalService) {}

  async createSystemRoles(tx: Tx, tenantId: string): Promise<Record<SystemRoleCode, string>> {
    const ids = {} as Record<SystemRoleCode, string>;
    for (const [code, role] of Object.entries(SYSTEM_ROLES) as [SystemRoleCode, (typeof SYSTEM_ROLES)[SystemRoleCode]][]) {
      const row = await tx.one<{ id: string }>(
        `INSERT INTO core.roles (tenant_id, code, name_ar, name_en, permissions, is_system) VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
        [tenantId, code, role.name_ar, role.name_en, role.permissions],
      );
      ids[code] = row.id;
    }
    return ids;
  }

  async createCompany(tx: Tx, tenantId: string, input: NewCompany): Promise<{ id: string }> {
    const company = await tx.one<{ id: string }>(
      `INSERT INTO core.companies (tenant_id, code, name_ar, name_en, base_currency, fiscal_year_start_month, require_approval)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        tenantId,
        input.code,
        input.name_ar || input.name_en,
        input.name_en || input.name_ar,
        input.base_currency,
        input.fiscal_year_start_month,
        input.require_approval ?? false,
      ],
    );
    const ctx = { tenantId, companyId: company.id };

    for (const jt of DEFAULT_JOURNAL_TYPES) {
      await tx.query(
        `INSERT INTO gl.journal_types (tenant_id, company_id, code, name_ar, name_en, is_system, source_module)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tenantId, company.id, jt.code, jt.ar, jt.en, jt.system, jt.module],
      );
    }

    if (input.seed_chart_of_accounts) {
      await this.seedCostCenters(tx, tenantId, company.id);
      await this.seedChartOfAccounts(tx, tenantId, company.id);
    }

    const month = String(input.fiscal_year_start_month).padStart(2, '0');
    const year = input.first_fiscal_year;
    await this.fiscal.createYearTx(tx, ctx, {
      code: input.fiscal_year_start_month === 1 ? String(year) : `${year}/${year + 1}`,
      start_date: `${year}-${month}-01`,
      with_adjustment_period: true,
    });
    return company;
  }

  private async seedCostCenters(tx: Tx, tenantId: string, companyId: string): Promise<void> {
    const ids = new Map<string, string>();
    for (const cc of DEFAULT_COST_CENTERS) {
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.cost_centers (tenant_id, company_id, code, name_ar, name_en, parent_id, is_posting, cc_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [tenantId, companyId, cc.code, cc.ar, cc.en, cc.parent ? ids.get(cc.parent) : null, cc.posting, cc.type],
      );
      ids.set(cc.code, row.id);
    }
  }

  private async seedChartOfAccounts(tx: Tx, tenantId: string, companyId: string): Promise<void> {
    const ids = new Map<string, string>();
    for (const a of KUWAIT_IFRS_COA) {
      const row = await tx.one<{ id: string }>(
        `INSERT INTO gl.accounts (tenant_id, company_id, code, name_ar, name_en, parent_id, is_posting, account_type, normal_balance,
           cost_center_rule, is_control, control_module, cash_flow_category, is_reconcilable, revalue)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
        [
          tenantId,
          companyId,
          a.code,
          a.ar,
          a.en,
          a.parent ? ids.get(a.parent) : null,
          a.posting,
          a.type,
          DEFAULT_NORMAL_BALANCE[a.type],
          a.cc ?? 'OPTIONAL',
          !!a.control,
          a.control ?? null,
          a.cashFlow ?? null,
          a.reconcilable ?? false,
          a.revalue ?? false,
        ],
      );
      ids.set(a.code, row.id);
    }
    await tx.query(
      `UPDATE core.companies SET rounding_account_id = $2, retained_earnings_account_id = $3, fx_gain_account_id = $4, fx_loss_account_id = $5
       WHERE id = $1`,
      [companyId, ids.get(TEMPLATE_ROUNDING_ACCOUNT), ids.get(TEMPLATE_RETAINED_EARNINGS_ACCOUNT), ids.get(TEMPLATE_FX_GAIN_ACCOUNT), ids.get(TEMPLATE_FX_LOSS_ACCOUNT)],
    );
    await ensureCompanyDefaults(tx, tenantId, companyId);
  }
}
