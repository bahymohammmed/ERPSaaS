-- Phase 2: accruals & recurring entries, approval threshold, FX revaluation, cost allocation,
-- budgets, year-end close with statutory appropriations, financial statement designer.

-- ---------------------------------------------------------------- settings

ALTER TABLE core.companies
  ADD COLUMN approval_threshold numeric(19, 4) CHECK (approval_threshold IS NULL OR approval_threshold >= 0),
  ADD COLUMN fx_gain_account_id uuid,
  ADD COLUMN fx_loss_account_id uuid,
  ADD FOREIGN KEY (tenant_id, id, fx_gain_account_id) REFERENCES gl.accounts(tenant_id, company_id, id) DEFERRABLE INITIALLY DEFERRED,
  ADD FOREIGN KEY (tenant_id, id, fx_loss_account_id) REFERENCES gl.accounts(tenant_id, company_id, id) DEFERRABLE INITIALLY DEFERRED;

-- Monetary accounts carried in foreign currency are revalued at period end.
ALTER TABLE gl.accounts ADD COLUMN revalue boolean NOT NULL DEFAULT false;

-- An accrual posted with auto_reverse_date gets its reversal posted on that date automatically.
ALTER TABLE gl.journal_entries ADD COLUMN auto_reverse_date date;
CREATE INDEX journal_entries_source_idx ON gl.journal_entries(tenant_id, company_id, source_doc_type, source_doc_id);

ALTER TABLE gl.fiscal_years
  ADD COLUMN closed_at timestamptz,
  ADD COLUMN closed_by uuid;

-- ---------------------------------------------------------------- recurring entries

CREATE TABLE gl.recurring_entries (
  tenant_id       uuid NOT NULL,
  company_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  code            text NOT NULL,
  name_ar         text NOT NULL DEFAULT '',
  name_en         text NOT NULL DEFAULT '',
  journal_type_id uuid NOT NULL,
  frequency       text NOT NULL CHECK (frequency IN ('MONTHLY', 'QUARTERLY', 'SEMIANNUAL', 'YEARLY')),
  day_of_month    smallint NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  start_date      date NOT NULL,
  end_date        date,
  next_run_date   date NOT NULL,
  last_run_date   date,
  last_entry_id   uuid,
  last_error      text,
  auto_post       boolean NOT NULL DEFAULT true,
  is_active       boolean NOT NULL DEFAULT true,
  -- {description, reference, lines: JournalLineInput[]}
  template        jsonb NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id, journal_type_id) REFERENCES gl.journal_types(tenant_id, company_id, id)
);
CREATE INDEX recurring_entries_due_idx ON gl.recurring_entries(next_run_date) WHERE is_active;
CREATE TRIGGER recurring_entries_touch BEFORE UPDATE ON gl.recurring_entries FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- ---------------------------------------------------------------- cost allocation

CREATE TABLE gl.statistical_drivers (
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  name_ar    text NOT NULL DEFAULT '',
  name_en    text NOT NULL DEFAULT '',
  unit       text NOT NULL DEFAULT '',
  is_active  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.driver_values (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  driver_id      uuid NOT NULL,
  period_id      uuid NOT NULL,
  cost_center_id uuid NOT NULL,
  value          numeric(19, 4) NOT NULL CHECK (value >= 0),
  PRIMARY KEY (tenant_id, driver_id, period_id, cost_center_id),
  FOREIGN KEY (tenant_id, company_id, driver_id) REFERENCES gl.statistical_drivers(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES gl.fiscal_periods(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);

CREATE TABLE gl.allocation_rules (
  tenant_id              uuid NOT NULL,
  company_id             uuid NOT NULL,
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  code                   text NOT NULL,
  name_ar                text NOT NULL DEFAULT '',
  name_en                text NOT NULL DEFAULT '',
  -- Rules run in ascending step order; later steps see the amounts allocated by earlier ones (step-down).
  step_no                int NOT NULL DEFAULT 1,
  method                 text NOT NULL CHECK (method IN ('FIXED', 'DRIVER')),
  driver_id              uuid,
  -- Accounts (headers include their subtree) whose balances on the source cost centers are allocated.
  source_account_ids     uuid[] NOT NULL,
  source_cost_center_ids uuid[] NOT NULL,
  -- NULL: debit targets on the same account as the source; otherwise everything is reclassified here.
  target_account_id      uuid,
  is_active              boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  CHECK (method <> 'DRIVER' OR driver_id IS NOT NULL),
  FOREIGN KEY (tenant_id, company_id, driver_id) REFERENCES gl.statistical_drivers(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, target_account_id) REFERENCES gl.accounts(tenant_id, company_id, id)
);

CREATE TABLE gl.allocation_targets (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  rule_id        uuid NOT NULL,
  cost_center_id uuid NOT NULL,
  -- FIXED rules only.
  percent        numeric(9, 6) CHECK (percent IS NULL OR (percent > 0 AND percent <= 100)),
  PRIMARY KEY (tenant_id, rule_id, cost_center_id),
  FOREIGN KEY (tenant_id, company_id, rule_id) REFERENCES gl.allocation_rules(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);

CREATE TABLE gl.allocation_runs (
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  period_id  uuid NOT NULL,
  status     text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'REVERSED')),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid,
  reversed_at timestamptz,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES gl.fiscal_periods(tenant_id, company_id, id)
);
-- One live run per period.
CREATE UNIQUE INDEX allocation_runs_live_idx ON gl.allocation_runs(tenant_id, company_id, period_id) WHERE status = 'POSTED';

-- ---------------------------------------------------------------- budgets

CREATE TABLE gl.budgets (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  code           text NOT NULL,
  name_ar        text NOT NULL DEFAULT '',
  name_en        text NOT NULL DEFAULT '',
  fiscal_year_id uuid NOT NULL,
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'APPROVED')),
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES gl.fiscal_years(tenant_id, company_id, id)
);

-- Amounts in the account's natural sign (revenue and expense both positive), base currency.
CREATE TABLE gl.budget_lines (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  budget_id      uuid NOT NULL,
  account_id     uuid NOT NULL,
  cost_center_id uuid,
  period_id      uuid NOT NULL,
  amount         numeric(19, 4) NOT NULL,
  CONSTRAINT budget_lines_key UNIQUE NULLS NOT DISTINCT (tenant_id, budget_id, account_id, cost_center_id, period_id),
  FOREIGN KEY (tenant_id, company_id, budget_id) REFERENCES gl.budgets(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES gl.fiscal_periods(tenant_id, company_id, id)
);

-- ---------------------------------------------------------------- year-end appropriations

CREATE TABLE gl.appropriation_rules (
  tenant_id         uuid NOT NULL,
  company_id        uuid NOT NULL,
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  code              text NOT NULL,
  name_ar           text NOT NULL DEFAULT '',
  name_en           text NOT NULL DEFAULT '',
  sequence          int NOT NULL DEFAULT 1,
  -- EXPENSE: charged to profit before closing (KFAS, NLST, Zakat, directors' fees).
  -- RESERVE: transferred from retained earnings after closing (statutory / voluntary reserve).
  stage             text NOT NULL CHECK (stage IN ('EXPENSE', 'RESERVE')),
  -- PROFIT: profit before EXPENSE-stage charges; AFTER_RESERVE: that profit less reserve-rule amounts.
  base              text NOT NULL DEFAULT 'PROFIT' CHECK (base IN ('PROFIT', 'AFTER_RESERVE')),
  percent           numeric(9, 6) NOT NULL CHECK (percent >= 0 AND percent <= 100),
  -- Optional cap: stop when the credit account reaches this % of paid-up capital (statutory reserve: 50%).
  cap_percent_of_capital numeric(9, 6),
  capital_account_id uuid,
  debit_account_id  uuid NOT NULL,
  credit_account_id uuid NOT NULL,
  is_active         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id, debit_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, credit_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, capital_account_id) REFERENCES gl.accounts(tenant_id, company_id, id)
);

-- ---------------------------------------------------------------- statement designer

CREATE TABLE gl.statements (
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  name_ar    text NOT NULL DEFAULT '',
  name_en    text NOT NULL DEFAULT '',
  -- PERIOD: movements over a period range (P&L style); POSITION: cumulative balances as at a period.
  basis      text NOT NULL CHECK (basis IN ('PERIOD', 'POSITION')),
  is_active  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.statement_rows (
  tenant_id    uuid NOT NULL,
  company_id   uuid NOT NULL,
  statement_id uuid NOT NULL,
  line_no      int NOT NULL,
  row_key      text,
  label_ar     text NOT NULL DEFAULT '',
  label_en     text NOT NULL DEFAULT '',
  row_type     text NOT NULL CHECK (row_type IN ('HEADER', 'ACCOUNTS', 'FORMULA', 'RESULT', 'SPACER')),
  -- ACCOUNTS: comma-separated codes or code ranges ("41,4201-4204"); every posting account whose code
  -- starts with a listed code or falls within a range is included.
  accounts     text,
  -- ACCOUNTS: DEBIT shows debit-minus-credit, CREDIT shows credit-minus-debit.
  sign         text NOT NULL DEFAULT 'CREDIT' CHECK (sign IN ('DEBIT', 'CREDIT')),
  -- FORMULA: row keys combined with + and -, e.g. "REV-COS".
  formula      text,
  show_detail  boolean NOT NULL DEFAULT false,
  bold         boolean NOT NULL DEFAULT false,
  indent       smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, statement_id, line_no),
  FOREIGN KEY (tenant_id, company_id, statement_id) REFERENCES gl.statements(tenant_id, company_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- RLS & grants

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'recurring_entries', 'statistical_drivers', 'driver_values', 'allocation_rules', 'allocation_targets',
    'allocation_runs', 'budgets', 'budget_lines', 'appropriation_rules', 'statements', 'statement_rows'
  ] LOOP
    EXECUTE format('ALTER TABLE gl.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON gl.%I USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gl TO erp_app;

-- The scheduler needs to find due recurring entries across tenants before it can set a tenant context.
-- It only learns ids; the actual work runs inside each tenant's RLS context.
CREATE FUNCTION gl.due_recurring_entries(p_as_of date)
RETURNS TABLE (tenant_id uuid, company_id uuid, id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = gl, pg_temp AS $$
  SELECT r.tenant_id, r.company_id, r.id FROM gl.recurring_entries r
  WHERE r.is_active AND r.next_run_date <= p_as_of AND (r.end_date IS NULL OR r.next_run_date <= r.end_date)
  ORDER BY r.next_run_date
$$;
GRANT EXECUTE ON FUNCTION gl.due_recurring_entries(date) TO erp_app;

-- ---------------------------------------------------------------- backfill existing companies

INSERT INTO gl.journal_types (tenant_id, company_id, code, name_ar, name_en, is_system, source_module)
SELECT c.tenant_id, c.id, 'ALC', 'قيد توزيع التكاليف', 'Cost allocation', true, 'GL' FROM core.companies c
ON CONFLICT (tenant_id, company_id, code) DO NOTHING;

UPDATE gl.accounts SET revalue = true WHERE code IN ('110104', '110201', '210101') AND is_posting;

UPDATE core.companies c SET
  fx_gain_account_id = (SELECT a.id FROM gl.accounts a WHERE a.tenant_id = c.tenant_id AND a.company_id = c.id AND a.code = '4202' AND a.is_posting),
  fx_loss_account_id = (SELECT a.id FROM gl.accounts a WHERE a.tenant_id = c.tenant_id AND a.company_id = c.id AND a.code = '5701' AND a.is_posting);
