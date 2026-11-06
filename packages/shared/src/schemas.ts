import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  CASH_FLOW_CATEGORIES,
  COST_CENTER_TYPES,
  DEPRECIATION_METHODS,
  DIGIT_STYLES,
  LEDGER_SIDES,
  DIMENSION_RULES,
  LOCALES,
  MODULES,
  NORMAL_BALANCES,
  PERIOD_STATUSES,
  RATE_TYPES,
  REPORT_LANGUAGES,
} from './enums';
import { PERMISSIONS } from './permissions';

const DECIMAL_PATTERN = /^\d{1,15}(\.\d{1,8})?$/;

/** Non-negative decimal amount transported as a string. */
export const amountSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((v) => DECIMAL_PATTERN.test(v), { message: 'Invalid amount' });

export const rateSchema = amountSchema.refine((v) => Number(v) > 0, { message: 'Rate must be positive' });

export const uuidSchema = z.string().uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
export const currencyCodeSchema = z.string().regex(/^[A-Z]{3}$/);
const codeSchema = z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9._-]+$/, 'Letters, digits, . _ - only');

/** Bilingual names: at least one is required; the other falls back to it. */
const bilingualNames = {
  name_ar: z.string().trim().max(200).optional().default(''),
  name_en: z.string().trim().max(200).optional().default(''),
};
const requireOneName = <T extends { name_ar: string; name_en: string }>(v: T) => v.name_ar !== '' || v.name_en !== '';
const nameIssue = { message: 'Arabic or English name is required', path: ['name_ar'] };

// ---------- Platform ----------

export const signupSchema = z.object({
  tenantName: z.string().trim().min(2).max(200),
  companyCode: codeSchema,
  companyNameAr: z.string().trim().max(200).default(''),
  companyNameEn: z.string().trim().max(200).default(''),
  baseCurrency: currencyCodeSchema.default('KWD'),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(1),
  firstFiscalYear: z.number().int().min(2000).max(2100),
  seedChartOfAccounts: z.boolean().default(true),
  fullName: z.string().trim().min(2).max(200),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(10).max(200),
  locale: z.enum(LOCALES).default('ar'),
});
export type SignupInput = z.infer<typeof signupSchema>;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  tenantId: uuidSchema.optional(),
  otp: z.string().trim().regex(/^\d{6}$/).optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

const newPasswordSchema = z.string().min(10).max(200);

export const changePasswordSchema = z
  .object({ current_password: z.string().min(1).max(200), new_password: newPasswordSchema })
  .refine((v) => v.current_password !== v.new_password, { message: 'Choose a password different from the current one', path: ['new_password'] });

export const forgotPasswordSchema = z.object({ email: z.string().trim().toLowerCase().email().max(254), locale: z.enum(['ar', 'en']).optional() });

export const resetPasswordSchema = z.object({ token: z.string().trim().min(20).max(200), new_password: newPasswordSchema });

/** Platform console: a new tenant with its first company and administrator. */
export const platformTenantSchema = z.object({
  name: z.string().trim().min(2).max(200),
  plan_code: z.string().trim().min(1).max(30).nullish(),
  max_companies: z.number().int().min(1).max(1000).nullish(),
  max_users: z.number().int().min(1).max(10000).nullish(),
  company: z.object({
    code: codeSchema,
    name_ar: z.string().trim().max(200).default(''),
    name_en: z.string().trim().max(200).default(''),
    base_currency: currencyCodeSchema.default('KWD'),
    fiscal_year_start_month: z.number().int().min(1).max(12).default(1),
    first_fiscal_year: z.number().int().min(2000).max(2100),
    seed_chart_of_accounts: z.boolean().default(true),
  }),
  admin: z.object({
    email: z.string().trim().toLowerCase().email(),
    full_name: z.string().trim().min(2).max(200),
    /** Omitted: a temporary password is generated and returned once. Ignored for existing users. */
    password: z.string().min(10).max(200).optional(),
    locale: z.enum(LOCALES).default('ar'),
  }),
});
export type PlatformTenantInput = z.infer<typeof platformTenantSchema>;

export const platformTenantUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  plan_code: z.string().trim().min(1).max(30).optional(),
  max_companies: z.number().int().min(1).max(1000).optional(),
  max_users: z.number().int().min(1).max(10000).optional(),
  is_active: z.boolean().optional(),
});

/** A subscription plan; features are module keys from features.ts (dependencies are added on save). */
export const planSchema = z
  .object({
    code: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{0,29}$/, 'Lowercase letters, digits, - and _'),
    ...bilingualNames,
    description_ar: z.string().trim().max(500).default(''),
    description_en: z.string().trim().max(500).default(''),
    features: z.array(z.string()).max(50),
    max_companies: z.number().int().min(1).max(1000),
    max_users: z.number().int().min(1).max(10000),
    price_monthly: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,9}(\.\d{1,3})?$/.test(v), { message: 'Invalid amount' }).nullish(),
    price_currency: z.string().trim().length(3).default('KWD'),
    is_active: z.boolean().default(true),
    is_default: z.boolean().default(false),
    sort_order: z.number().int().min(0).max(10000).default(0),
  })
  .refine(requireOneName, nameIssue);
export type PlanInput = z.infer<typeof planSchema>;

export const platformCredentialsResetSchema = z.object({
  password: z.string().min(10).max(200).optional(),
  reset_mfa: z.boolean().default(false),
});

// ---------- Fixed assets ----------

const depreciationFields = {
  method: z.enum(DEPRECIATION_METHODS),
  useful_life_months: z.number().int().min(1).max(1200).nullish(),
  declining_rate: amountSchema.refine((v) => Number(v) > 0 && Number(v) <= 100, { message: 'Rate must be between 0 and 100' }).nullish(),
};
const depreciationIssues = (v: { method: string; useful_life_months?: number | null; declining_rate?: string | null }, ctx: z.RefinementCtx) => {
  if (v.method === 'STRAIGHT_LINE' && !v.useful_life_months) ctx.addIssue({ code: 'custom', path: ['useful_life_months'], message: 'Useful life is required' });
  if (v.method === 'DECLINING_BALANCE' && !v.declining_rate) ctx.addIssue({ code: 'custom', path: ['declining_rate'], message: 'Rate is required' });
};

export const faCategorySchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    asset_account_id: uuidSchema,
    accum_dep_account_id: uuidSchema.nullish(),
    dep_expense_account_id: uuidSchema.nullish(),
    disposal_account_id: uuidSchema,
    ...depreciationFields,
    residual_percent: amountSchema.refine((v) => Number(v) < 100, { message: 'Must be below 100' }).default('0'),
    is_active: z.boolean().default(true),
    /** Make the asset and accumulated depreciation accounts accept postings from this module only. */
    lock_accounts: z.boolean().default(false),
  })
  .refine(requireOneName, nameIssue)
  .superRefine((v, ctx) => {
    depreciationIssues(v, ctx);
    if (v.method !== 'NONE' && (!v.accum_dep_account_id || !v.dep_expense_account_id)) {
      ctx.addIssue({ code: 'custom', path: ['accum_dep_account_id'], message: 'Depreciation accounts are required' });
    }
  });
export type FaCategoryInput = z.infer<typeof faCategorySchema>;

/** Optional fields fall back to the category defaults. */
export const faAssetSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    category_id: uuidSchema,
    cost_center_id: uuidSchema,
    location: z.string().trim().max(200).nullish(),
    custodian: z.string().trim().max(200).nullish(),
    serial_no: z.string().trim().max(100).nullish(),
    acquisition_date: dateSchema,
    in_service_date: dateSchema.nullish(),
    cost: amountSchema.refine((v) => Number(v) > 0, { message: 'Cost must be positive' }),
    residual_value: amountSchema.nullish(),
    method: z.enum(DEPRECIATION_METHODS).nullish(),
    useful_life_months: z.number().int().min(1).max(1200).nullish(),
    declining_rate: amountSchema.nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .refine(requireOneName, nameIssue);
export type FaAssetInput = z.infer<typeof faAssetSchema>;

/**
 * POST: the module posts the purchase (debit the asset account, credit offset_account_id).
 * EXISTING: the cost is already in the ledger (or the asset is taken over from a previous system,
 * with accumulated depreciation up to opening_dep_date); nothing is posted.
 */
export const faActivateSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('POST'), offset_account_id: uuidSchema, description: z.string().trim().max(500).nullish() }),
  z.object({ mode: z.literal('EXISTING'), opening_accum_dep: amountSchema.default('0'), opening_dep_date: dateSchema.nullish() }),
]);
export type FaActivateInput = z.infer<typeof faActivateSchema>;

export const faTransferSchema = z.object({ cost_center_id: uuidSchema, transfer_date: dateSchema, notes: z.string().trim().max(500).nullish() });

export const faDisposeSchema = z.object({
  disposal_date: dateSchema,
  proceeds: amountSchema.default('0'),
  proceeds_account_id: uuidSchema.nullish(),
  description: z.string().trim().max(500).nullish(),
});

export const faRunSchema = z.object({ period_id: uuidSchema });

export const faImportRowSchema = faAssetSchema.and(
  z.object({ opening_accum_dep: amountSchema.default('0'), opening_dep_date: dateSchema.nullish() }),
);

export const switchTenantSchema = z.object({ tenantId: uuidSchema });

export const userPreferencesSchema = z.object({
  preferred_locale: z.enum(LOCALES).optional(),
  digit_style: z.enum(DIGIT_STYLES).optional(),
  full_name: z.string().trim().min(2).max(200).optional(),
});

export const companySchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    base_currency: currencyCodeSchema,
    commercial_reg_no: z.string().trim().max(50).nullish(),
    tax_no: z.string().trim().max(50).nullish(),
    fiscal_year_start_month: z.number().int().min(1).max(12).default(1),
    require_approval: z.boolean().default(false),
    rounding_account_id: uuidSchema.nullish(),
    retained_earnings_account_id: uuidSchema.nullish(),
    fx_gain_account_id: uuidSchema.nullish(),
    fx_loss_account_id: uuidSchema.nullish(),
    approval_threshold: amountSchema.nullish(),
    budget_control: z.enum(['NONE', 'WARN', 'BLOCK']).default('NONE'),
    control_budget_id: uuidSchema.nullish(),
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue);
export type CompanyInput = z.infer<typeof companySchema>;

export const inviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  full_name: z.string().trim().min(2).max(200),
  password: z.string().min(10).max(200).optional(),
  role_id: uuidSchema,
  cost_center_scope: z.array(uuidSchema).nullish(),
});

export const updateMembershipSchema = z.object({
  role_id: uuidSchema.optional(),
  is_active: z.boolean().optional(),
  cost_center_scope: z.array(uuidSchema).nullish(),
});

export const roleSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    permissions: z.array(z.enum(PERMISSIONS)),
  })
  .refine(requireOneName, nameIssue);

// ---------- GL master data ----------

export const accountSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    parent_id: uuidSchema.nullish(),
    is_posting: z.boolean(),
    account_type: z.enum(ACCOUNT_TYPES),
    normal_balance: z.enum(NORMAL_BALANCES).optional(),
    cost_center_rule: z.enum(DIMENSION_RULES).default('OPTIONAL'),
    default_cost_center_id: uuidSchema.nullish(),
    allowed_cost_center_ids: z.array(uuidSchema).default([]),
    is_control: z.boolean().default(false),
    control_module: z.enum(MODULES).nullish(),
    allowed_currencies: z.array(currencyCodeSchema).nullish(),
    cash_flow_category: z.enum(CASH_FLOW_CATEGORIES).nullish(),
    is_reconcilable: z.boolean().default(false),
    revalue: z.boolean().default(false),
    is_active: z.boolean().default(true),
    dimension_rules: z
      .array(z.object({ dimension_type_id: uuidSchema, rule: z.enum(DIMENSION_RULES) }))
      .default([]),
  })
  .refine(requireOneName, nameIssue)
  .refine((v) => !v.is_control || !!v.control_module, {
    message: 'Control accounts need a module',
    path: ['control_module'],
  });
export type AccountInput = z.infer<typeof accountSchema>;

export const costCenterSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    parent_id: uuidSchema.nullish(),
    is_posting: z.boolean(),
    cc_type: z.enum(COST_CENTER_TYPES).default('OTHER'),
    manager_user_id: uuidSchema.nullish(),
    valid_from: dateSchema.nullish(),
    valid_to: dateSchema.nullish(),
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue)
  .refine((v) => !v.valid_from || !v.valid_to || v.valid_from <= v.valid_to, {
    message: 'valid_to must be after valid_from',
    path: ['valid_to'],
  });
export type CostCenterInput = z.infer<typeof costCenterSchema>;

export const dimensionTypeSchema = z
  .object({ code: codeSchema, ...bilingualNames, is_active: z.boolean().default(true) })
  .refine(requireOneName, nameIssue);

export const dimensionValueSchema = z
  .object({
    dimension_type_id: uuidSchema,
    code: codeSchema,
    ...bilingualNames,
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue);

export const journalTypeSchema = z
  .object({ code: codeSchema, ...bilingualNames, is_active: z.boolean().default(true) })
  .refine(requireOneName, nameIssue);

export const distributionTemplateSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    is_active: z.boolean().default(true),
    lines: z
      .array(z.object({ cost_center_id: uuidSchema, percent: amountSchema }))
      .min(1),
  })
  .refine(requireOneName, nameIssue);

export const exchangeRateSchema = z.object({
  currency_code: currencyCodeSchema,
  rate_date: dateSchema,
  rate_type: z.enum(RATE_TYPES).default('SPOT'),
  rate: rateSchema,
});

export const fiscalYearSchema = z.object({
  code: z.string().trim().min(1).max(20),
  start_date: dateSchema,
  with_adjustment_period: z.boolean().default(true),
});

export const periodStatusSchema = z.object({
  module: z.enum(MODULES),
  status: z.enum(PERIOD_STATUSES),
});

// ---------- Journals ----------

export const lineDistributionSchema = z.object({
  cost_center_id: uuidSchema,
  percent: amountSchema.optional(),
  amount: amountSchema.optional(),
});

export const journalLineSchema = z
  .object({
    account_id: uuidSchema,
    cost_center_id: uuidSchema.nullish(),
    description: z.string().trim().max(500).nullish(),
    currency_code: currencyCodeSchema.optional(),
    exchange_rate: rateSchema.nullish(),
    debit: amountSchema.default('0'),
    credit: amountSchema.default('0'),
    distribution_template_id: uuidSchema.nullish(),
    distribution: z.array(lineDistributionSchema).nullish(),
    dimensions: z
      .array(z.object({ dimension_type_id: uuidSchema, dimension_value_id: uuidSchema }))
      .default([]),
  })
  .refine((l) => !(l.distribution?.length && l.distribution_template_id), {
    message: 'Use either a template or a manual distribution',
    path: ['distribution'],
  });
export type JournalLineInput = z.infer<typeof journalLineSchema>;

export const journalEntrySchema = z.object({
  journal_type_id: uuidSchema,
  entry_date: dateSchema,
  /** Post into the adjustment period (13) of the fiscal year ending on entry_date. */
  adjustment_period: z.boolean().default(false),
  description: z.string().trim().max(1000).nullish(),
  reference: z.string().trim().max(100).nullish(),
  /** Accrual: a reversal is posted automatically on this date. */
  auto_reverse_date: dateSchema.nullish(),
  lines: z.array(journalLineSchema).min(2).max(2000),
  version: z.number().int().optional(),
});
export type JournalEntryInput = z.infer<typeof journalEntrySchema>;

/** Programmatic posting from sub-ledgers / integrations. Always posts immediately. */
export const postingRequestSchema = journalEntrySchema.omit({ version: true }).extend({
  journal_type_code: codeSchema,
  journal_type_id: uuidSchema.optional(),
  source_module: z.enum(MODULES),
  source_doc_type: z.string().trim().min(1).max(50),
  source_doc_id: z.string().trim().min(1).max(100),
  idempotency_key: z.string().trim().min(8).max(200),
});
export type PostingRequest = z.infer<typeof postingRequestSchema>;

export const reverseSchema = z.object({
  reversal_date: dateSchema.optional(),
  description: z.string().trim().max(1000).optional(),
});

export const rejectSchema = z.object({ reason: z.string().trim().min(1).max(1000) });

export const journalListQuerySchema = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED']).optional(),
  journal_type_id: uuidSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

// ---------- Reports ----------

const reportFormat = {
  format: z.enum(['json', 'pdf', 'xlsx']).default('json'),
  lang: z.enum(REPORT_LANGUAGES).default('ar'),
  digits: z.enum(DIGIT_STYLES).default('latn'),
};

export const trialBalanceQuerySchema = z.object({
  from_period_id: uuidSchema,
  to_period_id: uuidSchema,
  cost_center_id: uuidSchema.optional(),
  level: z.coerce.number().int().min(1).max(20).optional(),
  include_zero: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  ...reportFormat,
});

export const ledgerQuerySchema = z.object({
  account_id: uuidSchema,
  from: dateSchema,
  to: dateSchema,
  cost_center_id: uuidSchema.optional(),
  ...reportFormat,
});

export const journalRegisterQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  journal_type_id: uuidSchema.optional(),
  ...reportFormat,
});

export const costCenterReportQuerySchema = z.object({
  from_period_id: uuidSchema,
  to_period_id: uuidSchema,
  parent_cost_center_id: uuidSchema.optional(),
  account_scope: z.enum(['PL', 'EXPENSE', 'REVENUE']).default('PL'),
  hierarchy_version_id: uuidSchema.optional(),
  ...reportFormat,
});

export const costCenterSummaryQuerySchema = z.object({
  from_period_id: uuidSchema,
  to_period_id: uuidSchema,
  hierarchy_version_id: uuidSchema.optional(),
  ...reportFormat,
});

export const incomeStatementQuerySchema = z.object({
  from_period_id: uuidSchema,
  to_period_id: uuidSchema,
  cost_center_id: uuidSchema.optional(),
  level: z.coerce.number().int().min(1).max(20).optional(),
  compare: z.enum(['none', 'prior_year']).default('none'),
  ...reportFormat,
});

export const balanceSheetQuerySchema = z.object({
  period_id: uuidSchema,
  level: z.coerce.number().int().min(1).max(20).optional(),
  compare: z.enum(['none', 'prior_year']).default('none'),
  ...reportFormat,
});

// ---------- Phase 2 ----------

export const RECURRENCE_FREQUENCIES = ['MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY'] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

export const recurringSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    frequency: z.enum(RECURRENCE_FREQUENCIES),
    day_of_month: z.number().int().min(1).max(31),
    start_date: dateSchema,
    end_date: dateSchema.nullish(),
    auto_post: z.boolean().default(true),
    is_active: z.boolean().default(true),
    /** On create: copy journal type, description and lines from this entry. */
    from_entry_id: uuidSchema.optional(),
  })
  .refine(requireOneName, nameIssue)
  .refine((v) => !v.end_date || v.end_date >= v.start_date, { message: 'end_date before start_date', path: ['end_date'] });
export type RecurringInput = z.infer<typeof recurringSchema>;

export const fxRevaluationSchema = z.object({
  revaluation_date: dateSchema,
  rate_type: z.enum(RATE_TYPES).default('CLOSING'),
  auto_reverse: z.boolean().default(true),
});

export const driverSchema = z
  .object({ code: codeSchema, ...bilingualNames, unit: z.string().trim().max(30).default(''), is_active: z.boolean().default(true) })
  .refine(requireOneName, nameIssue);

export const driverValuesSchema = z.object({
  period_id: uuidSchema,
  values: z.array(z.object({ cost_center_id: uuidSchema, value: amountSchema })),
});

export const allocationRuleSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    step_no: z.number().int().min(1).max(99).default(1),
    method: z.enum(['FIXED', 'DRIVER']),
    driver_id: uuidSchema.nullish(),
    source_account_ids: z.array(uuidSchema).min(1),
    source_cost_center_ids: z.array(uuidSchema).min(1),
    target_account_id: uuidSchema.nullish(),
    is_active: z.boolean().default(true),
    targets: z.array(z.object({ cost_center_id: uuidSchema, percent: amountSchema.nullish() })).min(1),
  })
  .refine(requireOneName, nameIssue)
  .refine((v) => v.method !== 'DRIVER' || !!v.driver_id, { message: 'Driver is required', path: ['driver_id'] });
export type AllocationRuleInput = z.infer<typeof allocationRuleSchema>;

export const periodRefSchema = z.object({ period_id: uuidSchema });

export const budgetSchema = z
  .object({ code: codeSchema, ...bilingualNames, fiscal_year_id: uuidSchema })
  .refine(requireOneName, nameIssue);

export const budgetLinesSchema = z.object({
  lines: z
    .array(
      z.object({
        account_id: uuidSchema,
        cost_center_id: uuidSchema.nullish(),
        period_id: uuidSchema,
        amount: z
          .union([z.string(), z.number()])
          .transform((v) => (typeof v === 'number' ? String(v) : v.trim() || '0'))
          .refine((v) => /^-?\d{1,15}(\.\d{1,4})?$/.test(v), { message: 'Invalid amount' }),
      }),
    )
    .max(20000),
});

export const budgetGenerateSchema = z.object({
  source_fiscal_year_id: uuidSchema,
  adjust_percent: z.coerce.number().min(-100).max(1000).default(0),
  by_cost_center: z.boolean().default(true),
});

export const appropriationRuleSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    sequence: z.number().int().min(1).max(99).default(1),
    stage: z.enum(['EXPENSE', 'RESERVE']),
    base: z.enum(['PROFIT', 'AFTER_RESERVE']).default('PROFIT'),
    percent: amountSchema,
    cap_percent_of_capital: amountSchema.nullish(),
    capital_account_id: uuidSchema.nullish(),
    debit_account_id: uuidSchema,
    credit_account_id: uuidSchema,
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue);
export type AppropriationRuleInput = z.infer<typeof appropriationRuleSchema>;

export const yearEndSchema = z.object({ fiscal_year_id: uuidSchema, apply_appropriations: z.boolean().default(true) });

export const STATEMENT_ROW_TYPES = ['HEADER', 'ACCOUNTS', 'FORMULA', 'RESULT', 'SPACER'] as const;

export const statementSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    basis: z.enum(['PERIOD', 'POSITION']),
    is_active: z.boolean().default(true),
    rows: z
      .array(
        z.object({
          row_key: z.string().trim().max(30).regex(/^[A-Za-z0-9_]*$/).nullish(),
          label_ar: z.string().trim().max(200).default(''),
          label_en: z.string().trim().max(200).default(''),
          row_type: z.enum(STATEMENT_ROW_TYPES),
          accounts: z.string().trim().max(1000).nullish(),
          sign: z.enum(['DEBIT', 'CREDIT']).default('CREDIT'),
          formula: z.string().trim().max(500).nullish(),
          show_detail: z.boolean().default(false),
          bold: z.boolean().default(false),
          indent: z.number().int().min(0).max(5).default(0),
        }),
      )
      .min(1)
      .max(300),
  })
  .refine(requireOneName, nameIssue);
export type StatementInput = z.infer<typeof statementSchema>;

export const budgetVsActualQuerySchema = z.object({
  budget_id: uuidSchema,
  from_period_id: uuidSchema,
  to_period_id: uuidSchema,
  cost_center_id: uuidSchema.optional(),
  level: z.coerce.number().int().min(1).max(20).optional(),
  ...reportFormat,
});

export const statementQuerySchema = z.object({
  statement_id: uuidSchema,
  from_period_id: uuidSchema.optional(),
  to_period_id: uuidSchema.optional(),
  period_id: uuidSchema.optional(),
  cost_center_id: uuidSchema.optional(),
  compare: z.enum(['none', 'prior_year']).default('none'),
  ...reportFormat,
});

export const voucherQuerySchema = z.object({ ...reportFormat });

// ---------- Phase 3 ----------

export const cashFlowQuerySchema = z.object({
  from_period_id: uuidSchema,
  to_period_id: uuidSchema,
  ...reportFormat,
});

export const intercompanyPartnerSchema = z.object({
  partner_company_id: uuidSchema,
  due_from_account_id: uuidSchema,
  due_to_account_id: uuidSchema,
});

const icLineSchema = z.object({
  account_id: uuidSchema,
  cost_center_id: uuidSchema.nullish(),
  description: z.string().trim().max(500).nullish(),
  debit: amountSchema.default('0'),
  credit: amountSchema.default('0'),
});

/** One business event booked in two companies; each side is balanced by its intercompany account. */
export const intercompanyTransactionSchema = z.object({
  target_company_id: uuidSchema,
  entry_date: dateSchema,
  description: z.string().trim().max(1000).nullish(),
  reference: z.string().trim().max(100).nullish(),
  source_lines: z.array(icLineSchema).min(1).max(500),
  target_lines: z.array(icLineSchema).min(1).max(500),
});
export type IntercompanyTransactionInput = z.infer<typeof intercompanyTransactionSchema>;

export const intercompanyReconciliationQuerySchema = z.object({ as_of: dateSchema, ...reportFormat });

export const consolidationGroupSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    parent_company_id: uuidSchema,
    presentation_currency: currencyCodeSchema,
    member_company_ids: z.array(uuidSchema).min(1),
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue);
export type ConsolidationGroupInput = z.infer<typeof consolidationGroupSchema>;

export const consolidationAdjustmentSchema = z.object({
  adjustment_date: dateSchema,
  description: z.string().trim().max(500).default(''),
  lines: z
    .array(z.object({ account_code: z.string().trim().min(1).max(30), debit: amountSchema.default('0'), credit: amountSchema.default('0') }))
    .min(2)
    .max(200),
});

export const consolidatedRangeQuerySchema = z.object({ from: dateSchema, to: dateSchema, ...reportFormat });
export const consolidatedPositionQuerySchema = z.object({ as_of: dateSchema, ...reportFormat });

export const costCenterVersionSchema = z
  .object({ code: codeSchema, ...bilingualNames, effective_date: dateSchema })
  .refine(requireOneName, nameIssue);

export const mfaCodeSchema = z.object({ code: z.string().trim().regex(/^\d{6}$/) });

// ---------- Bank, cash, customers and suppliers ----------

export const ledgerSideSchema = z.enum(LEDGER_SIDES);

export const bankAccountSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    kind: z.enum(['BANK', 'CASH']).default('BANK'),
    account_id: uuidSchema,
    currency_code: currencyCodeSchema,
    bank_name: z.string().trim().max(200).nullish(),
    account_number: z.string().trim().max(60).nullish(),
    iban: z.string().trim().max(40).nullish(),
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue);

export const bankTransferSchema = z
  .object({
    transfer_date: dateSchema,
    from_account_id: uuidSchema,
    to_account_id: uuidSchema,
    amount: amountSchema.refine((v) => Number(v) > 0, { message: 'Amount must be positive' }),
    /** Amount received, when the two accounts use different currencies. */
    to_amount: amountSchema.nullish(),
    reference: z.string().trim().max(100).nullish(),
    description: z.string().trim().max(500).nullish(),
  })
  .refine((v) => v.from_account_id !== v.to_account_id, { message: 'Choose two different accounts', path: ['to_account_id'] });

export const partySchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    currency_code: currencyCodeSchema,
    control_account_id: uuidSchema.nullish(),
    default_account_id: uuidSchema.nullish(),
    payment_terms_days: z.number().int().min(0).max(3650).default(30),
    credit_limit: amountSchema.nullish(),
    contact_name: z.string().trim().max(200).nullish(),
    email: z.string().trim().max(200).nullish(),
    phone: z.string().trim().max(60).nullish(),
    address: z.string().trim().max(500).nullish(),
    tax_no: z.string().trim().max(60).nullish(),
    commercial_reg_no: z.string().trim().max(60).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue);
export type PartyInput = z.infer<typeof partySchema>;

const allocationInput = z.object({ document_id: uuidSchema, amount: amountSchema.refine((v) => Number(v) > 0, { message: 'Amount must be positive' }) });

export const partyDocumentSchema = z.object({
  doc_type: z.enum(['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']).default('INVOICE'),
  party_id: uuidSchema,
  doc_date: dateSchema,
  due_date: dateSchema.nullish(),
  exchange_rate: rateSchema.nullish(),
  reference: z.string().trim().max(100).nullish(),
  description: z.string().trim().max(500).nullish(),
  lines: z
    .array(
      z.object({
        description: z.string().trim().max(500).default(''),
        account_id: uuidSchema,
        cost_center_id: uuidSchema.nullish(),
        quantity: amountSchema.refine((v) => Number(v) > 0, { message: 'Quantity must be positive' }).default('1'),
        unit_price: amountSchema,
        tax_code_id: uuidSchema.nullish(),
      }),
    )
    .min(1)
    .max(500),
  /** Credit / debit notes: open invoices this note settles when posted. */
  allocations: z.array(allocationInput).max(200).default([]),
});
export type PartyDocumentInput = z.infer<typeof partyDocumentSchema>;

export const settlementSchema = z.object({
  party_id: uuidSchema,
  bank_account_id: uuidSchema,
  settle_date: dateSchema,
  amount: amountSchema.refine((v) => Number(v) > 0, { message: 'Amount must be positive' }),
  exchange_rate: rateSchema.nullish(),
  /** Amount in the bank account's currency when it differs from the party's currency. */
  bank_amount: amountSchema.nullish(),
  reference: z.string().trim().max(100).nullish(),
  description: z.string().trim().max(500).nullish(),
  allocations: z.array(allocationInput).max(500).default([]),
});
export type SettlementInput = z.infer<typeof settlementSchema>;

export const taxCodeSchema = z
  .object({
    code: codeSchema,
    ...bilingualNames,
    rate: amountSchema.refine((v) => Number(v) <= 100, { message: 'At most 100' }),
    sales_account_id: uuidSchema.nullish(),
    purchase_account_id: uuidSchema.nullish(),
    is_active: z.boolean().default(true),
  })
  .refine(requireOneName, nameIssue);

/** Applies an already-posted receipt / payment or credit / debit note to open invoices. */
export const allocateSchema = z.object({
  source_type: z.enum(['SETTLEMENT', 'DOCUMENT']),
  source_id: uuidSchema,
  date: dateSchema.nullish(),
  allocations: z.array(allocationInput).min(1).max(500),
});

export type AllocateInput = z.infer<typeof allocateSchema>;
export type TaxCodeInput = z.infer<typeof taxCodeSchema>;

export const unallocateSchema = z.object({ date: dateSchema.nullish() });

export const statementPostSchema = z.object({
  account_id: uuidSchema,
  cost_center_id: uuidSchema.nullish(),
  description: z.string().trim().max(500).nullish(),
});

export const voidSchema = z.object({ void_date: dateSchema.nullish() });

export const reconciliationSchema = z.object({ bank_account_id: uuidSchema, statement_date: dateSchema, statement_balance: z.union([z.string(), z.number()]).transform(String).refine((v) => /^-?\d{1,15}(\.\d{1,4})?$/.test(v.trim()), { message: 'Invalid amount' }) });
export const reconciliationItemsSchema = z.object({ line_ids: z.array(uuidSchema).max(10000) });

// ---------- Fixed asset reports ----------

export const faRegisterQuerySchema = z.object({ as_of: dateSchema, category_id: uuidSchema.optional(), ...reportFormat });
export const faMovementQuerySchema = z.object({ from: dateSchema, to: dateSchema, ...reportFormat });
export const faForecastQuerySchema = z.object({ period_id: uuidSchema, months: z.coerce.number().int().min(1).max(24).default(12), ...reportFormat });

// ---------- Receivables / payables reports ----------

export const agingQuerySchema = z.object({ as_of: dateSchema, ...reportFormat });
export const partyStatementQuerySchema = z.object({ party_id: uuidSchema, from: dateSchema, to: dateSchema, ...reportFormat });
export const documentPrintQuerySchema = z.object({ ...reportFormat, format: z.enum(['json', 'pdf', 'xlsx']).default('pdf') });
export const taxReportQuerySchema = z.object({ from: dateSchema, to: dateSchema, ...reportFormat });
