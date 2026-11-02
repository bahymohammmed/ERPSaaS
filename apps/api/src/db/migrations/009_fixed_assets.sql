-- Fixed assets (IAS 16): categories, asset register, depreciation runs, disposals and transfers.
-- The module posts to the general ledger through the posting engine with source module 'FA'.

-- ---------------------------------------------------------------- FA as a module

ALTER TABLE gl.period_statuses DROP CONSTRAINT period_statuses_module_check,
  ADD CONSTRAINT period_statuses_module_check CHECK (module IN ('GL', 'AP', 'AR', 'INV', 'PAY', 'FA'));
ALTER TABLE gl.accounts DROP CONSTRAINT accounts_control_module_check,
  ADD CONSTRAINT accounts_control_module_check CHECK (control_module IN ('GL', 'AP', 'AR', 'INV', 'PAY', 'FA'));
ALTER TABLE gl.journal_types DROP CONSTRAINT journal_types_source_module_check,
  ADD CONSTRAINT journal_types_source_module_check CHECK (source_module IN ('GL', 'AP', 'AR', 'INV', 'PAY', 'FA'));
ALTER TABLE gl.journal_entries DROP CONSTRAINT journal_entries_source_module_check,
  ADD CONSTRAINT journal_entries_source_module_check CHECK (source_module IN ('GL', 'AP', 'AR', 'INV', 'PAY', 'FA'));

-- Existing periods get an FA status mirroring their GL status.
INSERT INTO gl.period_statuses (tenant_id, company_id, period_id, module, status)
SELECT s.tenant_id, s.company_id, s.period_id, 'FA', s.status FROM gl.period_statuses s
WHERE s.module = 'GL'
ON CONFLICT DO NOTHING;

INSERT INTO gl.journal_types (tenant_id, company_id, code, name_ar, name_en, is_system, source_module)
SELECT c.tenant_id, c.id, 'FA', 'قيود الأصول الثابتة', 'Fixed asset postings', true, 'FA' FROM core.companies c
ON CONFLICT (tenant_id, company_id, code) DO NOTHING;

CREATE SCHEMA IF NOT EXISTS fa;

-- ---------------------------------------------------------------- categories

CREATE TABLE fa.categories (
  tenant_id                 uuid NOT NULL,
  company_id                uuid NOT NULL,
  id                        uuid NOT NULL DEFAULT gen_random_uuid(),
  code                      text NOT NULL,
  name_ar                   text NOT NULL DEFAULT '',
  name_en                   text NOT NULL DEFAULT '',
  asset_account_id          uuid NOT NULL,
  accum_dep_account_id      uuid,
  dep_expense_account_id    uuid,
  -- Net gain (credit) or loss (debit) on disposal.
  disposal_account_id       uuid NOT NULL,
  method                    text NOT NULL DEFAULT 'STRAIGHT_LINE' CHECK (method IN ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'NONE')),
  useful_life_months        int CHECK (useful_life_months BETWEEN 1 AND 1200),
  -- Declining balance: annual rate in percent of net book value.
  declining_rate            numeric(7, 4) CHECK (declining_rate > 0 AND declining_rate <= 100),
  residual_percent          numeric(7, 4) NOT NULL DEFAULT 0 CHECK (residual_percent >= 0 AND residual_percent < 100),
  is_active                 boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  CHECK (method = 'NONE' OR (accum_dep_account_id IS NOT NULL AND dep_expense_account_id IS NOT NULL)),
  CHECK (method <> 'STRAIGHT_LINE' OR useful_life_months IS NOT NULL),
  CHECK (method <> 'DECLINING_BALANCE' OR declining_rate IS NOT NULL),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, asset_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, accum_dep_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, dep_expense_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, disposal_account_id) REFERENCES gl.accounts(tenant_id, company_id, id)
);

-- ---------------------------------------------------------------- register

CREATE TABLE fa.assets (
  tenant_id             uuid NOT NULL,
  company_id            uuid NOT NULL,
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  code                  text NOT NULL,
  name_ar               text NOT NULL DEFAULT '',
  name_en               text NOT NULL DEFAULT '',
  category_id           uuid NOT NULL,
  cost_center_id        uuid NOT NULL,
  location              text,
  custodian             text,
  serial_no             text,
  acquisition_date      date NOT NULL,
  -- Depreciation starts on this date (pro rata by days in the first month).
  in_service_date       date NOT NULL,
  cost                  numeric(19, 4) NOT NULL CHECK (cost > 0),
  residual_value        numeric(19, 4) NOT NULL DEFAULT 0 CHECK (residual_value >= 0),
  method                text NOT NULL CHECK (method IN ('STRAIGHT_LINE', 'DECLINING_BALANCE', 'NONE')),
  useful_life_months    int CHECK (useful_life_months BETWEEN 1 AND 1200),
  declining_rate        numeric(7, 4),
  -- Taken over from a previous system: depreciation already charged up to opening_dep_date.
  opening_accum_dep     numeric(19, 4) NOT NULL DEFAULT 0 CHECK (opening_accum_dep >= 0),
  -- Depreciation has been charged up to and including this date.
  depreciated_to        date,
  status                text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ACTIVE', 'FULLY_DEPRECIATED', 'DISPOSED')),
  acquisition_entry_id  uuid,
  disposal_date         date,
  disposal_proceeds     numeric(19, 4),
  disposal_entry_id     uuid,
  notes                 text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  CHECK (residual_value < cost),
  CHECK (opening_accum_dep <= cost - residual_value),
  CHECK (in_service_date >= acquisition_date),
  FOREIGN KEY (tenant_id, company_id, category_id) REFERENCES fa.categories(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, acquisition_entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, disposal_entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);
CREATE INDEX assets_category_idx ON fa.assets(tenant_id, company_id, category_id);

-- ---------------------------------------------------------------- depreciation

CREATE TABLE fa.depreciation_runs (
  tenant_id    uuid NOT NULL,
  company_id   uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  period_id    uuid NOT NULL,
  entry_id     uuid,
  status       text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  total        numeric(19, 4) NOT NULL DEFAULT 0,
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES gl.fiscal_periods(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);
CREATE UNIQUE INDEX depreciation_runs_live ON fa.depreciation_runs(tenant_id, company_id, period_id) WHERE status = 'POSTED';

CREATE TABLE fa.depreciation_lines (
  tenant_id            uuid NOT NULL,
  company_id           uuid NOT NULL,
  run_id               uuid NOT NULL,
  asset_id             uuid NOT NULL,
  from_date            date NOT NULL,
  to_date              date NOT NULL,
  amount               numeric(19, 4) NOT NULL,
  -- Restored on reversal.
  prev_depreciated_to  date,
  prev_status          text NOT NULL,
  PRIMARY KEY (tenant_id, run_id, asset_id),
  FOREIGN KEY (tenant_id, company_id, run_id) REFERENCES fa.depreciation_runs(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, asset_id) REFERENCES fa.assets(tenant_id, company_id, id)
);
CREATE INDEX depreciation_lines_asset_idx ON fa.depreciation_lines(tenant_id, asset_id);

-- ---------------------------------------------------------------- history

CREATE TABLE fa.asset_events (
  tenant_id    uuid NOT NULL,
  company_id   uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  asset_id     uuid NOT NULL,
  event_type   text NOT NULL CHECK (event_type IN ('ACQUIRE', 'TRANSFER', 'DISPOSE', 'DISPOSAL_REVERSED')),
  event_date   date NOT NULL,
  amount       numeric(19, 4),
  entry_id     uuid,
  details      jsonb NOT NULL DEFAULT '{}',
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, asset_id) REFERENCES fa.assets(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);
CREATE INDEX asset_events_asset_idx ON fa.asset_events(tenant_id, asset_id, created_at);

-- ---------------------------------------------------------------- default categories for existing companies

INSERT INTO fa.categories (tenant_id, company_id, code, name_ar, name_en, asset_account_id, accum_dep_account_id, dep_expense_account_id,
  disposal_account_id, method, useful_life_months)
SELECT c.tenant_id, c.id, d.code, d.name_ar, d.name_en, asset.id, accum.id, expense.id, gain.id, d.method, d.life
FROM core.companies c
CROSS JOIN (VALUES
  ('LND', 'أراضي', 'Land', '120101', NULL, 'NONE', NULL),
  ('BLD', 'مباني', 'Buildings', '120102', '120201', 'STRAIGHT_LINE', 240),
  ('MCH', 'آلات ومعدات', 'Machinery and equipment', '120103', '120202', 'STRAIGHT_LINE', 120),
  ('VEH', 'سيارات', 'Vehicles', '120104', '120203', 'STRAIGHT_LINE', 60),
  ('FUR', 'أثاث وتجهيزات', 'Furniture and fixtures', '120105', '120204', 'STRAIGHT_LINE', 60),
  ('CMP', 'أجهزة حاسب آلي', 'Computer equipment', '120106', '120205', 'STRAIGHT_LINE', 36)
) AS d(code, name_ar, name_en, asset_code, accum_code, method, life)
JOIN gl.accounts asset ON asset.company_id = c.id AND asset.code = d.asset_code
LEFT JOIN gl.accounts accum ON accum.company_id = c.id AND accum.code = d.accum_code
JOIN gl.accounts expense ON expense.company_id = c.id AND expense.code = '5501'
JOIN gl.accounts gain ON gain.company_id = c.id AND gain.code = '4203'
WHERE d.method = 'NONE' OR accum.id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------- RLS, grants, permissions

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories', 'assets', 'depreciation_runs', 'depreciation_lines', 'asset_events'] LOOP
    EXECUTE format('ALTER TABLE fa.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON fa.%I USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant())', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA fa TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA fa TO erp_app;

UPDATE core.roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['fa.view', 'fa.manage']))
WHERE is_system AND code IN ('ADMIN', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT');
UPDATE core.roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['fa.view']))
WHERE is_system AND code = 'VIEWER';
