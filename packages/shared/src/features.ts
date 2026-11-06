/**
 * Modules a subscription plan can include. Each module bundles the screens, reports and API
 * routes that belong together, so a plan never shows a screen whose related screens are hidden.
 * `requires` lists modules it cannot work without: switching a module on switches those on too,
 * and switching one off switches off everything that requires it.
 */
export const FEATURE_KEYS = ['gl', 'period_end', 'budgets', 'statements', 'tax', 'banking', 'sales', 'purchases', 'fixed_assets', 'group'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

type Text = { ar: string; en: string };

export type FeatureDef = {
  key: FeatureKey;
  name: Text;
  description: Text;
  /** Always part of every plan. */
  core?: boolean;
  requires: FeatureKey[];
  /** Web routes (prefixes) of the module's screens. */
  screens: string[];
  /** Report keys under /reports/:key. */
  reports: string[];
  /** API route prefixes, without the /api prefix. */
  api: string[];
};

export const FEATURES: readonly FeatureDef[] = [
  {
    key: 'gl',
    core: true,
    name: { ar: 'الأستاذ العام', en: 'General ledger' },
    description: {
      ar: 'دليل الحسابات ومراكز التكلفة والأبعاد والعملات والفترات والقيود اليومية والتقارير المالية الأساسية',
      en: 'Chart of accounts, cost centers, dimensions, currencies, periods, journal entries and the core financial reports',
    },
    requires: [],
    screens: ['/dashboard', '/gl/journals', '/gl/accounts', '/gl/cost-centers', '/gl/dimensions', '/gl/journal-types', '/gl/distribution-templates', '/gl/currencies', '/gl/periods'],
    reports: ['trial-balance', 'ledger', 'journal-register', 'income-statement', 'balance-sheet', 'cash-flow', 'cost-center-matrix', 'cost-center-summary'],
    api: [],
  },
  {
    key: 'period_end',
    name: { ar: 'إقفال الفترات', en: 'Period-end' },
    description: {
      ar: 'القيود المتكررة وإعادة تقييم العملات والتوزيع وإقفال السنة واستيراد البيانات',
      en: 'Recurring entries, FX revaluation, allocations, year-end close and data import',
    },
    requires: [],
    screens: ['/gl/recurring', '/gl/fx-revaluation', '/gl/allocation', '/gl/year-end', '/gl/import'],
    reports: [],
    api: ['gl/recurring', 'gl/fx-revaluation', 'gl/allocation', 'gl/year-end', 'gl/import'],
  },
  {
    key: 'budgets',
    name: { ar: 'الموازنات', en: 'Budgets' },
    description: { ar: 'الموازنات ورقابتها وتقرير الموازنة مقابل الفعلي', en: 'Budgets, budget control and budget vs actual' },
    requires: [],
    screens: ['/gl/budgets'],
    reports: ['budget-vs-actual'],
    api: ['gl/budgets', 'gl/reports/budget-vs-actual'],
  },
  {
    key: 'statements',
    name: { ar: 'القوائم المصممة', en: 'Statement designer' },
    description: { ar: 'تصميم القوائم المالية الخاصة وعرضها', en: 'Design and run your own financial statements' },
    requires: [],
    screens: ['/gl/statements'],
    reports: ['statement'],
    api: ['gl/statements', 'gl/reports/statement'],
  },
  {
    key: 'tax',
    name: { ar: 'الضريبة', en: 'Tax' },
    description: { ar: 'رموز الضريبة على أسطر الفواتير وتقرير الضريبة', en: 'Tax codes on invoice lines and the tax report' },
    requires: [],
    screens: ['/gl/tax-codes'],
    reports: ['tax-report'],
    api: ['tax'],
  },
  {
    key: 'banking',
    name: { ar: 'البنوك والنقدية', en: 'Bank and cash' },
    description: { ar: 'الحسابات البنكية والتحويلات والتسوية البنكية واستيراد الكشوف', en: 'Bank accounts, transfers, reconciliation and statement import' },
    requires: [],
    screens: ['/cb'],
    reports: [],
    api: ['cb'],
  },
  {
    key: 'sales',
    name: { ar: 'المبيعات والذمم المدينة', en: 'Sales and receivables' },
    description: { ar: 'العملاء وفواتير المبيعات والإشعارات الدائنة وسندات القبض وأعمار الديون', en: 'Customers, sales invoices, credit notes, receipts and ageing' },
    requires: ['banking'],
    screens: ['/ar'],
    reports: ['ar-aging', 'customer-statement'],
    api: ['sl/AR'],
  },
  {
    key: 'purchases',
    name: { ar: 'المشتريات والذمم الدائنة', en: 'Purchases and payables' },
    description: { ar: 'الموردون وفواتير المشتريات والإشعارات المدينة وسندات الصرف وأعمار الأرصدة', en: 'Suppliers, purchase invoices, debit notes, payments and ageing' },
    requires: ['banking'],
    screens: ['/ap'],
    reports: ['ap-aging', 'supplier-statement'],
    api: ['sl/AP'],
  },
  {
    key: 'fixed_assets',
    name: { ar: 'الأصول الثابتة', en: 'Fixed assets' },
    description: { ar: 'سجل الأصول والاستهلاك والاستبعاد وتقارير الممتلكات والمعدات', en: 'Asset register, depreciation, disposals and PP&E reports' },
    requires: [],
    screens: ['/fa'],
    reports: ['fa-register', 'fa-movement', 'fa-forecast'],
    api: ['fa'],
  },
  {
    key: 'group',
    name: { ar: 'شركات المجموعة', en: 'Group companies' },
    description: { ar: 'المعاملات بين الشركات والتوحيد والتقارير الموحدة', en: 'Intercompany transactions, consolidation and consolidated reports' },
    requires: [],
    screens: ['/gl/intercompany', '/consolidation'],
    reports: ['intercompany-reconciliation', 'consolidation-worksheet', 'consolidated-balance-sheet', 'consolidated-income-statement'],
    api: ['gl/intercompany', 'gl/reports/intercompany-reconciliation', 'consolidation'],
  },
];

export const featureDef = (key: string): FeatureDef | undefined => FEATURES.find((f) => f.key === key);
export const CORE_FEATURES: FeatureKey[] = FEATURES.filter((f) => f.core).map((f) => f.key);

const under = (path: string, prefix: string) => {
  const p = path.toLowerCase();
  const x = prefix.toLowerCase();
  return p === x || p.startsWith(`${x}/`);
};

/** Adds core modules and everything the chosen modules require; drops unknown keys. */
export const withDependencies = (keys: readonly string[]): FeatureKey[] => {
  const out = new Set<FeatureKey>(CORE_FEATURES);
  const add = (key: string) => {
    const def = featureDef(key);
    if (!def || out.has(def.key)) return;
    out.add(def.key);
    def.requires.forEach(add);
  };
  keys.forEach(add);
  // Core modules may themselves require others.
  [...out].forEach((k) => featureDef(k)?.requires.forEach(add));
  return FEATURE_KEYS.filter((k) => out.has(k));
};

/** Removes a module and every module that (directly or indirectly) requires it. */
export const withoutFeature = (keys: readonly FeatureKey[], removed: FeatureKey): FeatureKey[] => {
  if (featureDef(removed)?.core) return [...keys];
  const gone = new Set<FeatureKey>([removed]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of FEATURES) {
      if (!gone.has(f.key) && f.requires.some((r) => gone.has(r))) {
        gone.add(f.key);
        changed = true;
      }
    }
  }
  return keys.filter((k) => !gone.has(k));
};

/** Modules that require the given one (directly or indirectly). */
export const dependentsOf = (key: FeatureKey): FeatureKey[] => {
  const kept = withoutFeature([...FEATURE_KEYS], key);
  return FEATURE_KEYS.filter((k) => k !== key && !kept.includes(k));
};

/** The module an API path (without /api) belongs to; the longest matching prefix wins. */
export const featureForApiPath = (path: string): FeatureKey | null => {
  const clean = path.replace(/^\/+/, '').replace(/^api\//, '').split('?')[0] ?? '';
  let best: { key: FeatureKey; len: number } | null = null;
  for (const f of FEATURES) {
    for (const prefix of f.api) {
      if (under(clean, prefix) && (!best || prefix.length > best.len)) best = { key: f.key, len: prefix.length };
    }
  }
  return best?.key ?? null;
};

/** The module a web route belongs to, or null for screens every plan has (admin, help). */
export const featureForScreen = (pathname: string): FeatureKey | null => {
  let best: { key: FeatureKey; len: number } | null = null;
  for (const f of FEATURES) {
    for (const prefix of f.screens) {
      if (under(pathname, prefix) && (!best || prefix.length > best.len)) best = { key: f.key, len: prefix.length };
    }
  }
  return best?.key ?? null;
};

export const featureForReport = (key: string): FeatureKey | null => FEATURES.find((f) => f.reports.includes(key))?.key ?? null;
