import type { AccountType, CostCenterType, DimensionRule, JournalStatus, ModuleCode, PeriodStatus, Permission } from '@erp/shared';

export type Named = { id: string; code: string; name_ar: string; name_en: string };

export type Me = {
  user: { id: string; email: string; full_name: string; preferred_locale: 'ar' | 'en'; digit_style: 'latn' | 'arab' };
  tenant: { id: string; name: string; plan_code: string };
  tenants: { tenant_id: string; tenant_name: string }[];
  companies: (Named & { base_currency: string; base_minor_units: number; require_approval: boolean })[];
  permissions: Permission[];
  cost_center_scope: string[] | null;
};

export type Account = Named & {
  parent_id: string | null;
  is_posting: boolean;
  account_type: AccountType;
  normal_balance: 'DEBIT' | 'CREDIT';
  cost_center_rule: DimensionRule;
  default_cost_center_id: string | null;
  is_control: boolean;
  control_module: ModuleCode | null;
  allowed_currencies: string[] | null;
  cash_flow_category: string | null;
  is_reconcilable: boolean;
  is_active: boolean;
  has_transactions?: boolean;
};

export type CostCenter = Named & {
  parent_id: string | null;
  is_posting: boolean;
  cc_type: CostCenterType;
  manager_user_id: string | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  has_transactions?: boolean;
};

export type JournalType = Named & { is_system: boolean; source_module: ModuleCode; is_active: boolean };
export type DimensionType = Named & { is_active: boolean; values: (Named & { is_active: boolean })[] };
export type Template = Named & { is_active: boolean; lines: { cost_center_id: string; percent: string }[] };
export type Currency = { code: string; name_ar: string; name_en: string; minor_units: number };
export type FiscalYear = { id: string; code: string; start_date: string; end_date: string; status: string };
export type Period = Named & {
  fiscal_year_id: string;
  fiscal_year_code: string;
  period_no: number;
  start_date: string;
  end_date: string;
  is_adjustment: boolean;
  statuses: Partial<Record<ModuleCode, PeriodStatus>>;
};

export type JournalLine = {
  id?: string;
  account_id: string;
  account_code?: string;
  account_name_ar?: string;
  account_name_en?: string;
  cost_center_id: string | null;
  cost_center_code?: string | null;
  description: string | null;
  currency_code: string;
  exchange_rate: string;
  debit: string;
  credit: string;
  debit_base?: string;
  credit_base?: string;
  distribution_template_id: string | null;
  distribution: { cost_center_id: string; percent?: string; amount?: string }[] | null;
  is_rounding?: boolean;
  dimensions: { dimension_type_id: string; dimension_value_id: string }[];
};

export type JournalEntry = {
  id: string;
  entry_no: string | null;
  journal_type_id: string;
  journal_type_code: string;
  journal_type_name_ar: string;
  journal_type_name_en: string;
  entry_date: string;
  period_code: string;
  status: JournalStatus;
  description: string | null;
  reference: string | null;
  source_module: ModuleCode;
  total_debit: string;
  total_credit: string;
  version: number;
  rejection_reason: string | null;
  created_by: string;
  created_by_name: string | null;
  approved_by_name: string | null;
  posted_by_name: string | null;
  posted_at: string | null;
  reversed_by_id: string | null;
  reversed_by_no: string | null;
  reversal_of_id: string | null;
  reversal_of_no: string | null;
  auto_reverse_date: string | null;
  lines: JournalLine[];
  attachments: { id: string; file_name: string; size_bytes: number; uploaded_at: string }[];
};
