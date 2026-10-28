import type { AccountType, CashFlowCategory, DimensionRule, ModuleCode } from '@erp/shared';

export type TemplateAccount = {
  code: string;
  parent: string | null;
  ar: string;
  en: string;
  type: AccountType;
  posting: boolean;
  cc?: DimensionRule;
  cashFlow?: CashFlowCategory;
  control?: ModuleCode;
  reconcilable?: boolean;
  revalue?: boolean;
};

type Row = [code: string, ar: string, en: string, opts?: Partial<Omit<TemplateAccount, 'code' | 'ar' | 'en' | 'parent' | 'type'>>];

/**
 * Builds the template from a compact definition: the parent is inferred as the longest
 * existing code that prefixes the child code; accounts without children are posting accounts.
 */
const build = (type: AccountType, defaultCc: DimensionRule, rows: Row[]): TemplateAccount[] => {
  const codes = rows.map(([code]) => code);
  return rows.map(([code, ar, en, opts]) => {
    const parent = codes.filter((c) => c !== code && code.startsWith(c)).sort((a, b) => b.length - a.length)[0] ?? null;
    const hasChildren = codes.some((c) => c !== code && c.startsWith(code));
    return { code, parent, ar, en, type, posting: !hasChildren, cc: defaultCc, ...opts };
  });
};

const ASSETS = build('ASSET', 'NOT_ALLOWED', [
  ['1', 'الأصول', 'Assets'],
  ['11', 'الأصول المتداولة', 'Current assets'],
  ['1101', 'النقد وما في حكمه', 'Cash and cash equivalents'],
  ['110101', 'الصندوق', 'Cash on hand', { cashFlow: 'CASH' }],
  ['110102', 'العهد النقدية', 'Petty cash', { cashFlow: 'CASH' }],
  ['110103', 'البنوك - حسابات جارية بالدينار', 'Banks - current accounts (KWD)', { cashFlow: 'CASH', reconcilable: true }],
  ['110104', 'البنوك - حسابات جارية بالعملات الأجنبية', 'Banks - current accounts (foreign currency)', { cashFlow: 'CASH', reconcilable: true, revalue: true }],
  ['110105', 'ودائع قصيرة الأجل', 'Short-term deposits', { cashFlow: 'CASH', reconcilable: true }],
  ['1102', 'المدينون والأرصدة المدينة الأخرى', 'Trade and other receivables'],
  ['110201', 'ذمم مدينة تجارية', 'Trade receivables', { control: 'AR', cashFlow: 'OPERATING', revalue: true }],
  ['110202', 'مخصص خسائر الائتمان المتوقعة', 'Allowance for expected credit losses', { cashFlow: 'OPERATING' }],
  ['110203', 'ذمم الموظفين', 'Employee receivables', { cashFlow: 'OPERATING' }],
  ['110204', 'مصروفات مدفوعة مقدماً', 'Prepaid expenses', { cashFlow: 'OPERATING' }],
  ['110205', 'دفعات مقدمة للموردين', 'Advances to suppliers', { cashFlow: 'OPERATING' }],
  ['110206', 'تأمينات مستردة', 'Refundable deposits', { cashFlow: 'OPERATING' }],
  ['110207', 'أرصدة مدينة أخرى', 'Other receivables', { cashFlow: 'OPERATING' }],
  ['1103', 'المخزون', 'Inventories'],
  ['110301', 'بضاعة', 'Merchandise', { control: 'INV', cashFlow: 'OPERATING' }],
  ['110302', 'مواد خام', 'Raw materials', { cashFlow: 'OPERATING' }],
  ['110303', 'بضاعة بالطريق', 'Goods in transit', { cashFlow: 'OPERATING' }],
  ['110304', 'مخصص مخزون بطيء الحركة', 'Provision for slow-moving inventory', { cashFlow: 'OPERATING' }],
  ['1104', 'مستحق من أطراف ذات صلة', 'Due from related parties'],
  ['110401', 'مستحق من أطراف ذات صلة', 'Due from related parties', { cashFlow: 'OPERATING' }],
  ['12', 'الأصول غير المتداولة', 'Non-current assets'],
  ['1201', 'الممتلكات والمعدات', 'Property and equipment'],
  ['120101', 'أراضي', 'Land', { cashFlow: 'INVESTING' }],
  ['120102', 'مباني', 'Buildings', { cashFlow: 'INVESTING' }],
  ['120103', 'آلات ومعدات', 'Machinery and equipment', { cashFlow: 'INVESTING' }],
  ['120104', 'سيارات', 'Vehicles', { cashFlow: 'INVESTING' }],
  ['120105', 'أثاث وتجهيزات', 'Furniture and fixtures', { cashFlow: 'INVESTING' }],
  ['120106', 'أجهزة حاسب آلي', 'Computer equipment', { cashFlow: 'INVESTING' }],
  ['120107', 'أعمال رأسمالية قيد التنفيذ', 'Capital work in progress', { cashFlow: 'INVESTING' }],
  ['1202', 'مجمع الاستهلاك', 'Accumulated depreciation'],
  ['120201', 'مجمع استهلاك المباني', 'Accumulated depreciation - buildings'],
  ['120202', 'مجمع استهلاك الآلات والمعدات', 'Accumulated depreciation - machinery'],
  ['120203', 'مجمع استهلاك السيارات', 'Accumulated depreciation - vehicles'],
  ['120204', 'مجمع استهلاك الأثاث والتجهيزات', 'Accumulated depreciation - furniture'],
  ['120205', 'مجمع استهلاك أجهزة الحاسب', 'Accumulated depreciation - computers'],
  ['1203', 'الموجودات غير الملموسة', 'Intangible assets'],
  ['120301', 'برامج', 'Software', { cashFlow: 'INVESTING' }],
  ['120302', 'مجمع الإطفاء', 'Accumulated amortisation'],
  ['1204', 'موجودات حق الاستخدام', 'Right-of-use assets'],
  ['120401', 'موجودات حق الاستخدام', 'Right-of-use assets'],
  ['120402', 'مجمع استهلاك موجودات حق الاستخدام', 'Accumulated depreciation - right-of-use'],
  ['1205', 'الاستثمارات', 'Investments'],
  ['120501', 'استثمارات بالقيمة العادلة من خلال الدخل الشامل الآخر', 'Investments at FVOCI', { cashFlow: 'INVESTING' }],
  ['120502', 'استثمار في شركات زميلة', 'Investment in associates', { cashFlow: 'INVESTING' }],
]);

const LIABILITIES = build('LIABILITY', 'NOT_ALLOWED', [
  ['2', 'المطلوبات', 'Liabilities'],
  ['21', 'المطلوبات المتداولة', 'Current liabilities'],
  ['2101', 'الدائنون والأرصدة الدائنة الأخرى', 'Trade and other payables'],
  ['210101', 'ذمم دائنة تجارية', 'Trade payables', { control: 'AP', cashFlow: 'OPERATING', revalue: true }],
  ['210102', 'مصروفات مستحقة', 'Accrued expenses', { cashFlow: 'OPERATING' }],
  ['210103', 'رواتب مستحقة', 'Accrued salaries', { cashFlow: 'OPERATING' }],
  ['210104', 'دفعات مقدمة من العملاء', 'Advances from customers', { cashFlow: 'OPERATING' }],
  ['210105', 'أرصدة دائنة أخرى', 'Other payables', { cashFlow: 'OPERATING' }],
  ['2102', 'التمويل قصير الأجل', 'Short-term borrowings'],
  ['210201', 'سحب على المكشوف', 'Bank overdraft', { cashFlow: 'CASH' }],
  ['210202', 'مرابحات دائنة - الجزء المتداول', 'Murabaha payables - current', { cashFlow: 'FINANCING' }],
  ['2103', 'التزامات عقود الإيجار - متداولة', 'Lease liabilities - current'],
  ['210301', 'التزامات عقود الإيجار - متداولة', 'Lease liabilities - current', { cashFlow: 'FINANCING' }],
  ['2104', 'الاستقطاعات القانونية المستحقة', 'Statutory contributions payable'],
  ['210401', 'حصة مؤسسة الكويت للتقدم العلمي المستحقة', 'KFAS contribution payable', { cashFlow: 'OPERATING' }],
  ['210402', 'ضريبة دعم العمالة الوطنية المستحقة', 'NLST payable', { cashFlow: 'OPERATING' }],
  ['210403', 'الزكاة المستحقة', 'Zakat payable', { cashFlow: 'OPERATING' }],
  ['210404', 'التأمينات الاجتماعية المستحقة', 'PIFSS contributions payable', { cashFlow: 'OPERATING' }],
  ['210405', 'مكافأة أعضاء مجلس الإدارة المستحقة', "Directors' remuneration payable", { cashFlow: 'OPERATING' }],
  ['2105', 'مستحق إلى أطراف ذات صلة', 'Due to related parties'],
  ['210501', 'مستحق إلى أطراف ذات صلة', 'Due to related parties', { cashFlow: 'OPERATING' }],
  ['22', 'المطلوبات غير المتداولة', 'Non-current liabilities'],
  ['2201', 'التمويل طويل الأجل', 'Long-term borrowings'],
  ['220101', 'مرابحات دائنة - غير متداولة', 'Murabaha payables - non-current', { cashFlow: 'FINANCING' }],
  ['220102', 'قروض لأجل', 'Term loans', { cashFlow: 'FINANCING' }],
  ['2202', 'التزامات عقود الإيجار - غير متداولة', 'Lease liabilities - non-current'],
  ['220201', 'التزامات عقود الإيجار - غير متداولة', 'Lease liabilities - non-current', { cashFlow: 'FINANCING' }],
  ['2203', 'مخصص مكافأة نهاية الخدمة', "Employees' end of service benefits"],
  ['220301', 'مخصص مكافأة نهاية الخدمة', "Employees' end of service benefits", { cashFlow: 'OPERATING' }],
]);

const EQUITY = build('EQUITY', 'NOT_ALLOWED', [
  ['3', 'حقوق الملكية', 'Equity'],
  ['31', 'رأس المال', 'Share capital'],
  ['3101', 'رأس المال المدفوع', 'Paid-up share capital', { cashFlow: 'FINANCING' }],
  ['32', 'الاحتياطيات', 'Reserves'],
  ['3201', 'الاحتياطي الإجباري', 'Statutory reserve'],
  ['3202', 'الاحتياطي الاختياري', 'Voluntary reserve'],
  ['3203', 'احتياطي القيمة العادلة', 'Fair value reserve'],
  ['3204', 'احتياطي ترجمة العملات الأجنبية', 'Foreign currency translation reserve'],
  ['33', 'الأرباح المرحلة', 'Retained earnings'],
  ['3301', 'الأرباح المرحلة', 'Retained earnings'],
  ['34', 'أسهم الخزينة', 'Treasury shares'],
  ['3401', 'أسهم الخزينة', 'Treasury shares', { cashFlow: 'FINANCING' }],
]);

const REVENUE = build('REVENUE', 'OPTIONAL', [
  ['4', 'الإيرادات', 'Revenue'],
  ['41', 'إيرادات النشاط', 'Operating revenue'],
  ['4101', 'المبيعات', 'Sales'],
  ['4102', 'إيرادات الخدمات', 'Service revenue'],
  ['4103', 'مردودات ومسموحات المبيعات', 'Sales returns and allowances'],
  ['42', 'إيرادات أخرى', 'Other income'],
  ['4201', 'إيرادات ودائع ومرابحات', 'Deposit and murabaha income'],
  ['4202', 'أرباح فروقات العملة', 'Foreign exchange gains', { cc: 'NOT_ALLOWED' }],
  ['4203', 'أرباح بيع ممتلكات ومعدات', 'Gain on disposal of property and equipment'],
  ['4204', 'إيرادات متنوعة', 'Miscellaneous income'],
]);

const EXPENSES = build('EXPENSE', 'REQUIRED', [
  ['5', 'المصروفات', 'Expenses'],
  ['51', 'تكلفة الإيرادات', 'Cost of revenue'],
  ['5101', 'تكلفة البضاعة المباعة', 'Cost of goods sold', { cc: 'OPTIONAL' }],
  ['5102', 'عمالة مباشرة', 'Direct labour'],
  ['52', 'تكاليف الموظفين', 'Staff costs'],
  ['5201', 'الرواتب والأجور', 'Salaries and wages'],
  ['5202', 'البدلات', 'Allowances'],
  ['5203', 'حصة الشركة في التأمينات الاجتماعية', 'Social security contributions (PIFSS)'],
  ['5204', 'مكافأة نهاية الخدمة', 'End of service benefits'],
  ['5205', 'الإجازات وتذاكر السفر', 'Leave and air tickets'],
  ['5206', 'التأمين الصحي', 'Medical insurance'],
  ['53', 'المصروفات العمومية والإدارية', 'General and administrative expenses'],
  ['5301', 'الإيجارات', 'Rent'],
  ['5302', 'الكهرباء والماء', 'Utilities'],
  ['5303', 'الاتصالات', 'Communications'],
  ['5304', 'الصيانة والإصلاحات', 'Repairs and maintenance'],
  ['5305', 'أتعاب مهنية', 'Professional fees'],
  ['5306', 'رسوم حكومية وتراخيص', 'Government fees and licences'],
  ['5307', 'السفر', 'Travel'],
  ['5308', 'قرطاسية ومطبوعات', 'Stationery and printing'],
  ['5309', 'التأمين', 'Insurance'],
  ['5310', 'عمولات بنكية', 'Bank charges', { cc: 'OPTIONAL' }],
  ['54', 'مصروفات البيع والتسويق', 'Selling and marketing expenses'],
  ['5401', 'الإعلان', 'Advertising'],
  ['5402', 'عمولات المبيعات', 'Sales commissions'],
  ['5403', 'مصروفات التوصيل', 'Delivery expenses'],
  ['55', 'الاستهلاك والإطفاء', 'Depreciation and amortisation'],
  ['5501', 'استهلاك الممتلكات والمعدات', 'Depreciation - property and equipment'],
  ['5502', 'إطفاء الموجودات غير الملموسة', 'Amortisation of intangible assets'],
  ['5503', 'استهلاك موجودات حق الاستخدام', 'Depreciation - right-of-use assets'],
  ['56', 'تكاليف التمويل', 'Finance costs', { cc: 'OPTIONAL' }],
  ['5601', 'تكاليف المرابحات والتمويل', 'Murabaha and financing costs', { cc: 'OPTIONAL' }],
  ['5602', 'فوائد التزامات عقود الإيجار', 'Interest on lease liabilities', { cc: 'OPTIONAL' }],
  ['57', 'مصروفات أخرى', 'Other expenses', { cc: 'OPTIONAL' }],
  ['5701', 'خسائر فروقات العملة', 'Foreign exchange losses', { cc: 'NOT_ALLOWED' }],
  ['5702', 'خسائر الائتمان المتوقعة', 'Expected credit losses', { cc: 'OPTIONAL' }],
  ['5703', 'فروقات التقريب', 'Rounding differences', { cc: 'NOT_ALLOWED' }],
  ['58', 'الاستقطاعات القانونية', 'Statutory contributions', { cc: 'NOT_ALLOWED' }],
  ['5801', 'حصة مؤسسة الكويت للتقدم العلمي', 'KFAS contribution', { cc: 'NOT_ALLOWED' }],
  ['5802', 'ضريبة دعم العمالة الوطنية', 'National Labour Support Tax (NLST)', { cc: 'NOT_ALLOWED' }],
  ['5803', 'الزكاة', 'Zakat', { cc: 'NOT_ALLOWED' }],
  ['5804', 'مكافأة أعضاء مجلس الإدارة', "Directors' remuneration", { cc: 'NOT_ALLOWED' }],
]);

export const KUWAIT_IFRS_COA: TemplateAccount[] = [...ASSETS, ...LIABILITIES, ...EQUITY, ...REVENUE, ...EXPENSES];

export const TEMPLATE_ROUNDING_ACCOUNT = '5703';
export const TEMPLATE_RETAINED_EARNINGS_ACCOUNT = '3301';
export const TEMPLATE_FX_GAIN_ACCOUNT = '4202';
export const TEMPLATE_FX_LOSS_ACCOUNT = '5701';

export const DEFAULT_JOURNAL_TYPES: { code: string; ar: string; en: string; system: boolean; module: ModuleCode }[] = [
  { code: 'JV', ar: 'قيد يومية', en: 'Journal voucher', system: false, module: 'GL' },
  { code: 'OPN', ar: 'قيد افتتاحي', en: 'Opening balances', system: false, module: 'GL' },
  { code: 'ADJ', ar: 'قيد تسوية', en: 'Adjustment', system: false, module: 'GL' },
  { code: 'REV', ar: 'قيد عكسي', en: 'Reversal', system: true, module: 'GL' },
  { code: 'CLS', ar: 'قيد إقفال', en: 'Year-end closing', system: true, module: 'GL' },
  { code: 'FXR', ar: 'إعادة تقييم العملات', en: 'FX revaluation', system: true, module: 'GL' },
  { code: 'ALC', ar: 'قيد توزيع التكاليف', en: 'Cost allocation', system: true, module: 'GL' },
  { code: 'IC', ar: 'قيود بين الشركات', en: 'Intercompany', system: true, module: 'GL' },
  { code: 'AP', ar: 'قيود الموردين', en: 'Payables postings', system: true, module: 'AP' },
  { code: 'AR', ar: 'قيود العملاء', en: 'Receivables postings', system: true, module: 'AR' },
  { code: 'INV', ar: 'قيود المخزون', en: 'Inventory postings', system: true, module: 'INV' },
  { code: 'PAY', ar: 'قيود الرواتب', en: 'Payroll postings', system: true, module: 'PAY' },
];
