import { z } from 'zod';
import {
  ACCOUNT_TYPES,
  CASH_FLOW_CATEGORIES,
  COST_CENTER_TYPES,
  DIGIT_STYLES,
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
});
export type LoginInput = z.infer<typeof loginSchema>;

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
  ...reportFormat,
});

export const costCenterSummaryQuerySchema = z.object({
  from_period_id: uuidSchema,
  to_period_id: uuidSchema,
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
