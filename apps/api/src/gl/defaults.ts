import type { Tx } from '../db/db.service';

/**
 * Phase 2 defaults for a company built on the Kuwait template: IFRS statement layouts and the
 * statutory year-end appropriation rules. Idempotent; codes that already exist are left alone,
 * and nothing is created when the template accounts are missing.
 */
export const ensureCompanyDefaults = async (tx: Tx, tenantId: string, companyId: string): Promise<void> => {
  const accounts = new Map(
    (await tx.query<{ code: string; id: string }>('SELECT code, id FROM gl.accounts WHERE company_id = $1 AND is_posting', [companyId])).map((a) => [a.code, a.id]),
  );
  await seedAppropriations(tx, tenantId, companyId, accounts);
  await seedStatements(tx, tenantId, companyId);
};

type Rule = {
  code: string;
  ar: string;
  en: string;
  sequence: number;
  stage: 'EXPENSE' | 'RESERVE';
  base: 'PROFIT' | 'AFTER_RESERVE';
  percent: string;
  cap?: string;
  debit: string;
  credit: string;
  active: boolean;
};

// Rates are the commonly applied Kuwaiti rates; they are configuration and must be confirmed with the
// company's auditor. NLST applies to Boursa-listed companies and Zakat to shareholding companies,
// so both start inactive.
const KUWAIT_RULES: Rule[] = [
  { code: 'STAT_RES', ar: 'الاحتياطي الإجباري', en: 'Statutory reserve', sequence: 1, stage: 'RESERVE', base: 'PROFIT', percent: '10', cap: '50', debit: '3301', credit: '3201', active: true },
  { code: 'KFAS', ar: 'حصة مؤسسة الكويت للتقدم العلمي', en: 'KFAS contribution', sequence: 2, stage: 'EXPENSE', base: 'AFTER_RESERVE', percent: '1', debit: '5801', credit: '210401', active: true },
  { code: 'NLST', ar: 'ضريبة دعم العمالة الوطنية', en: 'National Labour Support Tax', sequence: 3, stage: 'EXPENSE', base: 'PROFIT', percent: '2.5', debit: '5802', credit: '210402', active: false },
  { code: 'ZAKAT', ar: 'الزكاة', en: 'Zakat', sequence: 4, stage: 'EXPENSE', base: 'PROFIT', percent: '1', debit: '5803', credit: '210403', active: false },
];

const seedAppropriations = async (tx: Tx, tenantId: string, companyId: string, accounts: Map<string, string>): Promise<void> => {
  for (const r of KUWAIT_RULES) {
    const debit = accounts.get(r.debit);
    const credit = accounts.get(r.credit);
    if (!debit || !credit) continue;
    await tx.query(
      `INSERT INTO gl.appropriation_rules (tenant_id, company_id, code, name_ar, name_en, sequence, stage, base, percent,
         cap_percent_of_capital, capital_account_id, debit_account_id, credit_account_id, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (tenant_id, company_id, code) DO NOTHING`,
      [tenantId, companyId, r.code, r.ar, r.en, r.sequence, r.stage, r.base, r.percent, r.cap ?? null, r.cap ? (accounts.get('3101') ?? null) : null, debit, credit, r.active],
    );
  }
};

type Row = [key: string | null, ar: string, en: string, type: 'HEADER' | 'ACCOUNTS' | 'FORMULA' | 'RESULT' | 'SPACER', accounts: string | null, sign: 'DEBIT' | 'CREDIT', formula: string | null, detail: boolean, bold: boolean, indent: number];

const STATEMENTS: { code: string; ar: string; en: string; basis: 'PERIOD' | 'POSITION'; rows: Row[] }[] = [
  {
    code: 'IS-IFRS',
    ar: 'بيان الأرباح أو الخسائر',
    en: 'Statement of profit or loss',
    basis: 'PERIOD',
    rows: [
      ['REV', 'الإيرادات', 'Revenue', 'ACCOUNTS', '41', 'CREDIT', null, true, false, 0],
      ['COS', 'تكلفة الإيرادات', 'Cost of revenue', 'ACCOUNTS', '51', 'DEBIT', null, false, false, 0],
      ['GP', 'مجمل الربح', 'Gross profit', 'FORMULA', null, 'CREDIT', 'REV-COS', false, true, 0],
      ['OI', 'إيرادات أخرى', 'Other income', 'ACCOUNTS', '42', 'CREDIT', null, false, false, 0],
      ['STAFF', 'تكاليف الموظفين', 'Staff costs', 'ACCOUNTS', '52', 'DEBIT', null, false, false, 0],
      ['GA', 'مصروفات عمومية وإدارية', 'General and administrative expenses', 'ACCOUNTS', '53', 'DEBIT', null, false, false, 0],
      ['SM', 'مصروفات البيع والتسويق', 'Selling and marketing expenses', 'ACCOUNTS', '54', 'DEBIT', null, false, false, 0],
      ['DEP', 'الاستهلاك والإطفاء', 'Depreciation and amortisation', 'ACCOUNTS', '55', 'DEBIT', null, false, false, 0],
      ['OTH', 'مصروفات أخرى', 'Other expenses', 'ACCOUNTS', '57', 'DEBIT', null, false, false, 0],
      ['OP', 'ربح التشغيل', 'Operating profit', 'FORMULA', null, 'CREDIT', 'GP+OI-STAFF-GA-SM-DEP-OTH', false, true, 0],
      ['FIN', 'تكاليف التمويل', 'Finance costs', 'ACCOUNTS', '56', 'DEBIT', null, false, false, 0],
      ['PBC', 'الربح قبل الاستقطاعات القانونية', 'Profit before statutory contributions', 'FORMULA', null, 'CREDIT', 'OP-FIN', false, true, 0],
      ['CONTR', 'حصة مؤسسة الكويت للتقدم العلمي وضريبة دعم العمالة والزكاة ومكافأة أعضاء مجلس الإدارة', "KFAS, NLST, Zakat and directors' remuneration", 'ACCOUNTS', '58', 'DEBIT', null, true, false, 0],
      ['NP', 'ربح السنة', 'Profit for the year', 'FORMULA', null, 'CREDIT', 'PBC-CONTR', false, true, 0],
    ],
  },
  {
    code: 'BS-IFRS',
    ar: 'بيان المركز المالي',
    en: 'Statement of financial position',
    basis: 'POSITION',
    rows: [
      [null, 'الموجودات', 'Assets', 'HEADER', null, 'DEBIT', null, false, true, 0],
      ['PPE', 'ممتلكات ومعدات', 'Property and equipment', 'ACCOUNTS', '1201,1202', 'DEBIT', null, false, false, 1],
      ['INTANG', 'موجودات غير ملموسة', 'Intangible assets', 'ACCOUNTS', '1203', 'DEBIT', null, false, false, 1],
      ['ROU', 'موجودات حق الاستخدام', 'Right-of-use assets', 'ACCOUNTS', '1204', 'DEBIT', null, false, false, 1],
      ['INVEST', 'استثمارات', 'Investments', 'ACCOUNTS', '1205', 'DEBIT', null, false, false, 1],
      ['NCA', 'مجموع الموجودات غير المتداولة', 'Total non-current assets', 'FORMULA', null, 'DEBIT', 'PPE+INTANG+ROU+INVEST', false, true, 0],
      ['INV', 'المخزون', 'Inventories', 'ACCOUNTS', '1103', 'DEBIT', null, false, false, 1],
      ['REC', 'مدينون وأرصدة مدينة أخرى', 'Trade and other receivables', 'ACCOUNTS', '1102', 'DEBIT', null, false, false, 1],
      ['RP', 'مستحق من أطراف ذات صلة', 'Due from related parties', 'ACCOUNTS', '1104', 'DEBIT', null, false, false, 1],
      ['CASH', 'النقد وما في حكمه', 'Cash and cash equivalents', 'ACCOUNTS', '1101', 'DEBIT', null, false, false, 1],
      ['CA', 'مجموع الموجودات المتداولة', 'Total current assets', 'FORMULA', null, 'DEBIT', 'INV+REC+RP+CASH', false, true, 0],
      ['TA', 'مجموع الموجودات', 'Total assets', 'FORMULA', null, 'DEBIT', 'NCA+CA', false, true, 0],
      [null, '', '', 'SPACER', null, 'CREDIT', null, false, false, 0],
      [null, 'حقوق الملكية والمطلوبات', 'Equity and liabilities', 'HEADER', null, 'CREDIT', null, false, true, 0],
      ['CAP', 'رأس المال', 'Share capital', 'ACCOUNTS', '31', 'CREDIT', null, false, false, 1],
      ['RES', 'الاحتياطيات', 'Reserves', 'ACCOUNTS', '32', 'CREDIT', null, true, false, 1],
      ['TS', 'أسهم الخزينة', 'Treasury shares', 'ACCOUNTS', '34', 'CREDIT', null, false, false, 1],
      ['RE', 'الأرباح المرحلة', 'Retained earnings', 'ACCOUNTS', '33', 'CREDIT', null, false, false, 1],
      ['PL', 'أرباح غير موزعة للفترة', 'Unappropriated profit', 'RESULT', null, 'CREDIT', null, false, false, 1],
      ['EQ', 'مجموع حقوق الملكية', 'Total equity', 'FORMULA', null, 'CREDIT', 'CAP+RES+TS+RE+PL', false, true, 0],
      ['NCL', 'المطلوبات غير المتداولة', 'Non-current liabilities', 'ACCOUNTS', '22', 'CREDIT', null, true, false, 1],
      ['CL', 'المطلوبات المتداولة', 'Current liabilities', 'ACCOUNTS', '21', 'CREDIT', null, true, false, 1],
      ['TL', 'مجموع المطلوبات', 'Total liabilities', 'FORMULA', null, 'CREDIT', 'NCL+CL', false, true, 0],
      ['TLE', 'مجموع حقوق الملكية والمطلوبات', 'Total equity and liabilities', 'FORMULA', null, 'CREDIT', 'EQ+TL', false, true, 0],
    ],
  },
];

const seedStatements = async (tx: Tx, tenantId: string, companyId: string): Promise<void> => {
  const hasTemplate = await tx.maybeOne("SELECT 1 FROM gl.accounts WHERE company_id = $1 AND code = '4101'", [companyId]);
  if (!hasTemplate) return;
  for (const st of STATEMENTS) {
    const created = await tx.maybeOne<{ id: string }>(
      `INSERT INTO gl.statements (tenant_id, company_id, code, name_ar, name_en, basis) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, company_id, code) DO NOTHING RETURNING id`,
      [tenantId, companyId, st.code, st.ar, st.en, st.basis],
    );
    if (!created) continue;
    for (const [index, [key, ar, en, type, accounts, sign, formula, detail, bold, indent]] of st.rows.entries()) {
      await tx.query(
        `INSERT INTO gl.statement_rows (tenant_id, company_id, statement_id, line_no, row_key, label_ar, label_en, row_type, accounts, sign,
           formula, show_detail, bold, indent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [tenantId, companyId, created.id, index + 1, key, ar, en, type, accounts, sign, formula, detail, bold, indent],
      );
    }
  }
};
