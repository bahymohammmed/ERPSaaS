export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const NORMAL_BALANCES = ['DEBIT', 'CREDIT'] as const;
export type NormalBalance = (typeof NORMAL_BALANCES)[number];

export const DEFAULT_NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  REVENUE: 'CREDIT',
};

/** Accounts of these types are closed to retained earnings at year end. */
export const PROFIT_AND_LOSS_TYPES: readonly AccountType[] = ['REVENUE', 'EXPENSE'];

export const isProfitAndLoss = (type: AccountType): boolean => PROFIT_AND_LOSS_TYPES.includes(type);

export const DIMENSION_RULES = ['REQUIRED', 'OPTIONAL', 'NOT_ALLOWED'] as const;
export type DimensionRule = (typeof DIMENSION_RULES)[number];

export const COST_CENTER_TYPES = ['PRODUCTION', 'SERVICE', 'ADMINISTRATIVE', 'SALES', 'OTHER'] as const;
export type CostCenterType = (typeof COST_CENTER_TYPES)[number];

export const CASH_FLOW_CATEGORIES = ['CASH', 'OPERATING', 'INVESTING', 'FINANCING'] as const;
export type CashFlowCategory = (typeof CASH_FLOW_CATEGORIES)[number];

export const MODULES = ['GL', 'AP', 'AR', 'INV', 'PAY'] as const;
export type ModuleCode = (typeof MODULES)[number];

export const PERIOD_STATUSES = ['OPEN', 'CLOSED', 'LOCKED'] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const JOURNAL_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED'] as const;
export type JournalStatus = (typeof JOURNAL_STATUSES)[number];

export const RATE_TYPES = ['SPOT', 'AVERAGE', 'CLOSING'] as const;
export type RateType = (typeof RATE_TYPES)[number];

export const LOCALES = ['ar', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const REPORT_LANGUAGES = ['ar', 'en', 'both'] as const;
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

export const DIGIT_STYLES = ['latn', 'arab'] as const;
export type DigitStyle = (typeof DIGIT_STYLES)[number];
