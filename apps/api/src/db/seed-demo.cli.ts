import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { PERMISSIONS } from '@erp/shared';
import { AppModule } from '../app.module';
import type { CompanyContext } from '../common/request-context';
import { JournalsService } from '../gl/journals.service';
import { MastersService } from '../gl/masters.service';
import { AuthService } from '../platform/auth.service';
import { FixedAssetsService } from '../fa/fixed-assets.service';
import { DbService } from './db.service';

const EMAIL = process.env.DEMO_EMAIL ?? 'demo@example.com';
const PASSWORD = process.env.DEMO_PASSWORD || 'demo-password-123';

/** Creates a demo tenant with a year of realistic Kuwaiti postings. Safe to re-run: exits if the user exists. */
const run = async (): Promise<void> => {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const db = app.get(DbService);
    const existing = await db.withoutTenant((tx) => tx.one<{ id: string | null }>('SELECT core.find_user_id($1) AS id', [EMAIL]));
    if (existing.id) {
      console.log(`Demo user ${EMAIL} already exists`);
      return;
    }
    const auth = app.get(AuthService);
    const session = await auth.signup(
      {
        tenantName: 'مجموعة النور',
        companyCode: 'NOOR',
        companyNameAr: 'شركة النور للتجارة العامة ذ.م.م',
        companyNameEn: 'Al Noor General Trading Co. W.L.L.',
        baseCurrency: 'KWD',
        fiscalYearStartMonth: 1,
        firstFiscalYear: 2026,
        seedChartOfAccounts: true,
        fullName: 'مدير النظام',
        email: EMAIL,
        password: PASSWORD,
        locale: 'ar',
      },
      '127.0.0.1',
    );
    const tenantId = session.tenantId;
    if (!tenantId) throw new Error('signup returned no tenant');
    const userId = (await db.withoutTenant((tx) => tx.one<{ id: string }>('SELECT core.find_user_id($1) AS id', [EMAIL]))).id;
    const companyId = (await db.withTenant({ tenantId, userId }, (tx) => tx.one<{ id: string }>('SELECT id FROM core.companies LIMIT 1'))).id;
    const ctx: CompanyContext = { tenantId, userId, companyId, permissions: new Set(PERMISSIONS), costCenterScope: null, ip: '127.0.0.1' };

    const lookup = async (table: string) =>
      Object.fromEntries(
        (await db.withTenant(ctx, (tx) => tx.query<{ code: string; id: string }>(`SELECT code, id FROM ${table} WHERE company_id = $1`, [companyId]))).map((r) => [r.code, r.id]),
      );
    const acc = await lookup('gl.accounts');
    const cc = await lookup('gl.cost_centers');
    const jt = await lookup('gl.journal_types');

    const masters = app.get(MastersService);
    await masters.saveRate(ctx, { currency_code: 'USD', rate_date: '2026-01-01', rate_type: 'SPOT', rate: '0.30650000' });
    await masters.saveRate(ctx, { currency_code: 'USD', rate_date: '2026-06-01', rate_type: 'SPOT', rate: '0.30710000' });
    await masters.saveRate(ctx, { currency_code: 'EUR', rate_date: '2026-01-01', rate_type: 'SPOT', rate: '0.33420000' });
    const rent = await masters.saveTemplate(ctx, {
      code: 'RENT',
      name_ar: 'توزيع الإيجار',
      name_en: 'Rent allocation',
      is_active: true,
      lines: [
        { cost_center_id: cc['101']!, percent: '40' },
        { cost_center_id: cc['102']!, percent: '35' },
        { cost_center_id: cc['103']!, percent: '25' },
      ],
    });

    const journals = app.get(JournalsService);
    const post = async (date: string, description: string, lines: { a: string; d?: string; c?: string; cc?: string; cur?: string; tpl?: string }[], type = 'JV') => {
      const draft = await journals.createDraft(ctx, {
        journal_type_id: jt[type]!,
        entry_date: date,
        adjustment_period: false,
        description,
        reference: null,
        lines: lines.map((l) => ({
          account_id: acc[l.a]!,
          cost_center_id: l.cc ? cc[l.cc] : null,
          currency_code: l.cur,
          debit: l.d ?? '0',
          credit: l.c ?? '0',
          distribution_template_id: l.tpl ?? null,
          dimensions: [],
        })),
      });
      await journals.post(ctx, (draft as unknown as { id: string }).id);
    };

    await post('2026-01-01', 'أرصدة افتتاحية / Opening balances', [
      { a: '110103', d: '85000.000' },
      { a: '110101', d: '1500.000' },
      { a: '120104', d: '18000.000' },
      { a: '120105', d: '7500.000' },
      { a: '110104', d: '10000.00', cur: 'USD' },
      { a: '3101', c: '100000.000' },
      { a: '3201', c: '15065.000' },
    ], 'OPN');

    // The vehicles and furniture in the opening balances become registered fixed assets.
    const assets = app.get(FixedAssetsService);
    const category = await lookup('fa.categories');
    const period = await lookup('gl.fiscal_periods');
    for (const a of [
      { code: 'VEH-001', name_ar: 'شاحنة توصيل تويوتا هايس', name_en: 'Toyota Hiace delivery van', category_id: category.VEH!, cost_center_id: cc['102']!, cost: '18000.000', location: 'الشويخ', custodian: 'مشرف المبيعات', serial_no: 'JTFSS22P0K0123456' },
      { code: 'FUR-001', name_ar: 'أثاث المكتب الرئيسي', name_en: 'Head office furniture', category_id: category.FUR!, cost_center_id: cc['101']!, cost: '7500.000', location: 'المكتب الرئيسي', custodian: null, serial_no: null },
    ]) {
      const asset = await assets.createAsset(ctx, { ...a, acquisition_date: '2026-01-01', in_service_date: '2026-01-01' });
      await assets.activate(ctx, asset.id, { mode: 'EXISTING', opening_accum_dep: '0', opening_dep_date: null });
    }

    const months = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'];
    for (const [i, m] of months.entries()) {
      const sales = (24000 + i * 1350.5).toFixed(3);
      const service = (6200 + i * 210.25).toFixed(3);
      await post(`2026-${m}-05`, `مبيعات الشهر ${m} / Sales for month ${m}`, [
        { a: '110103', d: (Number(sales) + Number(service)).toFixed(3) },
        { a: '4101', c: sales, cc: '102' },
        { a: '4102', c: service, cc: '103' },
      ]);
      await post(`2026-${m}-10`, `تكلفة المبيعات ${m} / Cost of sales ${m}`, [
        { a: '5101', d: (Number(sales) * 0.62).toFixed(3), cc: '102' },
        { a: '110103', c: (Number(sales) * 0.62).toFixed(3) },
      ]);
      await post(`2026-${m}-25`, `رواتب شهر ${m} / Payroll ${m}`, [
        { a: '5201', d: '4200.000', cc: '101' },
        { a: '5201', d: '3100.000', cc: '102' },
        { a: '5201', d: '2650.000', cc: '103' },
        { a: '5202', d: '1450.000', cc: '101' },
        { a: '5203', d: '612.500', cc: '101' },
        { a: '110103', c: '11400.000' },
        { a: '210404', c: '612.500' },
      ]);
      await post(`2026-${m}-01`, `إيجار شهر ${m} / Rent ${m}`, [
        { a: '5301', d: '2400.000', tpl: rent.id },
        { a: '110103', c: '2400.000' },
      ]);
      await post(`2026-${m}-15`, `مصروفات عمومية ${m} / Utilities and communications ${m}`, [
        { a: '5302', d: (380 + i * 12.125).toFixed(3), cc: '103' },
        { a: '5303', d: '145.750', cc: '101' },
        { a: '5310', d: '18.500' },
        { a: '110103', c: (380 + i * 12.125 + 145.75 + 18.5).toFixed(3) },
      ]);
      await assets.postRun(ctx, period[`2026-${m}`]!);
    }
    await post('2026-03-12', 'اشتراك برمجيات بالدولار / Software subscription (USD)', [
      { a: '5305', d: '1200.00', cur: 'USD', cc: '101' },
      { a: '110104', c: '1200.00', cur: 'USD' },
    ]);
    await post('2026-07-20', 'حملة إعلانية / Advertising campaign', [
      { a: '5401', d: '3750.000', cc: '102' },
      { a: '210102', c: '3750.000' },
    ]);

    console.log(`Demo tenant ready. Sign in with ${EMAIL} / ${PASSWORD}`);
  } finally {
    await app.close();
  }
};

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
