-- Subscription plans: which modules (bundles of related screens, reports and API routes) a
-- tenant can use, with default company and user limits. The module catalog itself lives in code
-- (packages/shared/src/features.ts); a plan stores the module keys it includes.
-- Plans are not tenant data: every session can read them, only platform admins can change them.

CREATE TABLE core.plans (
  code            text PRIMARY KEY CHECK (code ~ '^[a-z0-9][a-z0-9_-]{0,29}$'),
  name_ar         text NOT NULL,
  name_en         text NOT NULL,
  description_ar  text NOT NULL DEFAULT '',
  description_en  text NOT NULL DEFAULT '',
  features        text[] NOT NULL DEFAULT '{gl}',
  max_companies   int NOT NULL DEFAULT 3 CHECK (max_companies BETWEEN 1 AND 1000),
  max_users       int NOT NULL DEFAULT 25 CHECK (max_users BETWEEN 1 AND 10000),
  price_monthly   numeric(12, 3),
  price_currency  text NOT NULL DEFAULT 'KWD',
  is_active       boolean NOT NULL DEFAULT true,
  is_default      boolean NOT NULL DEFAULT false,
  sort_order      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
-- At most one plan is used for self-service sign-up.
CREATE UNIQUE INDEX plans_one_default ON core.plans (is_default) WHERE is_default;

INSERT INTO core.plans (code, name_ar, name_en, description_ar, description_en, features, max_companies, max_users, is_default, sort_order) VALUES
  ('starter', 'البداية', 'Starter', 'المحاسبة والمبيعات والمشتريات والبنوك لشركة واحدة', 'Accounting, sales, purchases and bank for one company',
   '{gl,tax,banking,sales,purchases}', 1, 5, false, 10),
  ('business', 'الأعمال', 'Business', 'إضافة الأصول الثابتة والموازنات وإقفال الفترات والقوائم المصممة', 'Adds fixed assets, budgets, period-end and the statement designer',
   '{gl,tax,banking,sales,purchases,fixed_assets,period_end,budgets,statements}', 3, 25, false, 20),
  ('enterprise', 'المؤسسات', 'Enterprise', 'جميع الوحدات بما فيها شركات المجموعة والتوحيد', 'Every module, including group companies and consolidation',
   '{gl,period_end,budgets,statements,tax,banking,sales,purchases,fixed_assets,group}', 20, 500, false, 30),
  -- Existing tenants are on 'standard': it keeps every module so nothing disappears for them.
  ('standard', 'القياسية', 'Standard', 'جميع الوحدات', 'Every module',
   '{gl,period_end,budgets,statements,tax,banking,sales,purchases,fixed_assets,group}', 3, 25, true, 40);

-- Any other plan code already on a tenant becomes a plan with every module.
INSERT INTO core.plans (code, name_ar, name_en, features, sort_order)
SELECT DISTINCT t.plan_code, t.plan_code, t.plan_code, '{gl,period_end,budgets,statements,tax,banking,sales,purchases,fixed_assets,group}'::text[], 90
FROM core.tenants t WHERE NOT EXISTS (SELECT 1 FROM core.plans p WHERE p.code = t.plan_code)
  AND t.plan_code ~ '^[a-z0-9][a-z0-9_-]{0,29}$';
UPDATE core.tenants SET plan_code = 'standard' WHERE plan_code !~ '^[a-z0-9][a-z0-9_-]{0,29}$';

ALTER TABLE core.tenants ADD CONSTRAINT tenants_plan_fk FOREIGN KEY (plan_code) REFERENCES core.plans(code) ON UPDATE CASCADE;

ALTER TABLE core.plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY plans_read ON core.plans FOR SELECT USING (true);
CREATE POLICY plans_insert ON core.plans FOR INSERT WITH CHECK (core.is_platform_admin(core.current_user_id()));
CREATE POLICY plans_update ON core.plans FOR UPDATE USING (core.is_platform_admin(core.current_user_id())) WITH CHECK (core.is_platform_admin(core.current_user_id()));
CREATE POLICY plans_delete ON core.plans FOR DELETE USING (core.is_platform_admin(core.current_user_id()));
GRANT SELECT, INSERT, UPDATE, DELETE ON core.plans TO erp_app;

-- Plan in use per tenant, for the console (tenants are otherwise invisible across RLS).
CREATE FUNCTION core.platform_plan_usage()
RETURNS TABLE (plan_code text, tenant_count int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
BEGIN
  PERFORM core.assert_platform_admin();
  RETURN QUERY SELECT t.plan_code, count(*)::int FROM core.tenants t GROUP BY t.plan_code;
END $$;
GRANT EXECUTE ON FUNCTION core.platform_plan_usage() TO erp_app;
