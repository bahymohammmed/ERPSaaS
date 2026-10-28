-- General Ledger schema.
-- Company-scoped tables expose UNIQUE (tenant_id, company_id, id) so that child rows can
-- reference them with composite foreign keys; a line can never point at an account,
-- cost center or period of another company or tenant, whatever the application does.

-- ---------------------------------------------------------------- calendar

CREATE TABLE gl.fiscal_years (
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  status     text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  CHECK (end_date > start_date),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.fiscal_periods (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  fiscal_year_id uuid NOT NULL,
  period_no      smallint NOT NULL CHECK (period_no BETWEEN 1 AND 13),
  code           text NOT NULL,
  name_ar        text NOT NULL,
  name_en        text NOT NULL,
  start_date     date NOT NULL,
  end_date       date NOT NULL,
  is_adjustment  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, fiscal_year_id, period_no),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES gl.fiscal_years(tenant_id, company_id, id) ON DELETE CASCADE
);
CREATE INDEX fiscal_periods_dates_idx ON gl.fiscal_periods(tenant_id, company_id, start_date, end_date);

CREATE TABLE gl.period_statuses (
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  period_id  uuid NOT NULL,
  module     text NOT NULL CHECK (module IN ('GL', 'AP', 'AR', 'INV', 'PAY')),
  status     text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'LOCKED')),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, period_id, module),
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES gl.fiscal_periods(tenant_id, company_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- cost centers & dimensions

CREATE TABLE gl.cost_centers (
  tenant_id       uuid NOT NULL,
  company_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  code            text NOT NULL,
  name_ar         text NOT NULL DEFAULT '',
  name_en         text NOT NULL DEFAULT '',
  parent_id       uuid,
  is_posting      boolean NOT NULL DEFAULT true,
  cc_type         text NOT NULL DEFAULT 'OTHER' CHECK (cc_type IN ('PRODUCTION', 'SERVICE', 'ADMINISTRATIVE', 'SALES', 'OTHER')),
  manager_user_id uuid REFERENCES core.users(id),
  valid_from      date,
  valid_to        date,
  is_active       boolean NOT NULL DEFAULT true,
  search_text     text GENERATED ALWAYS AS (lower(code) || ' ' || core.ar_normalize(name_ar) || ' ' || lower(name_en)) STORED,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, parent_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);
CREATE INDEX cost_centers_parent_idx ON gl.cost_centers(tenant_id, company_id, parent_id);
CREATE INDEX cost_centers_search_idx ON gl.cost_centers USING gin (search_text gin_trgm_ops);
CREATE TRIGGER cost_centers_touch BEFORE UPDATE ON gl.cost_centers FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

CREATE TABLE gl.dimension_types (
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  name_ar    text NOT NULL DEFAULT '',
  name_en    text NOT NULL DEFAULT '',
  is_active  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.dimension_values (
  tenant_id         uuid NOT NULL,
  company_id        uuid NOT NULL,
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  dimension_type_id uuid NOT NULL,
  code              text NOT NULL,
  name_ar           text NOT NULL DEFAULT '',
  name_en           text NOT NULL DEFAULT '',
  is_active         boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, dimension_type_id, id),
  UNIQUE (tenant_id, dimension_type_id, code),
  FOREIGN KEY (tenant_id, company_id, dimension_type_id) REFERENCES gl.dimension_types(tenant_id, company_id, id)
);

-- ---------------------------------------------------------------- chart of accounts

CREATE TABLE gl.accounts (
  tenant_id              uuid NOT NULL,
  company_id             uuid NOT NULL,
  id                     uuid NOT NULL DEFAULT gen_random_uuid(),
  code                   text NOT NULL,
  name_ar                text NOT NULL DEFAULT '',
  name_en                text NOT NULL DEFAULT '',
  parent_id              uuid,
  is_posting             boolean NOT NULL,
  account_type           text NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
  normal_balance         text NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
  cost_center_rule       text NOT NULL DEFAULT 'OPTIONAL' CHECK (cost_center_rule IN ('REQUIRED', 'OPTIONAL', 'NOT_ALLOWED')),
  default_cost_center_id uuid,
  is_control             boolean NOT NULL DEFAULT false,
  control_module         text CHECK (control_module IN ('GL', 'AP', 'AR', 'INV', 'PAY')),
  allowed_currencies     char(3)[],
  cash_flow_category     text CHECK (cash_flow_category IN ('CASH', 'OPERATING', 'INVESTING', 'FINANCING')),
  is_reconcilable        boolean NOT NULL DEFAULT false,
  is_active              boolean NOT NULL DEFAULT true,
  search_text            text GENERATED ALWAYS AS (lower(code) || ' ' || core.ar_normalize(name_ar) || ' ' || lower(name_en)) STORED,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  CHECK (parent_id IS NULL OR parent_id <> id),
  CHECK (NOT is_control OR control_module IS NOT NULL),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, parent_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, default_cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);
CREATE INDEX accounts_parent_idx ON gl.accounts(tenant_id, company_id, parent_id);
CREATE INDEX accounts_search_idx ON gl.accounts USING gin (search_text gin_trgm_ops);
CREATE TRIGGER accounts_touch BEFORE UPDATE ON gl.accounts FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

ALTER TABLE core.companies
  ADD FOREIGN KEY (tenant_id, id, rounding_account_id) REFERENCES gl.accounts(tenant_id, company_id, id) DEFERRABLE INITIALLY DEFERRED,
  ADD FOREIGN KEY (tenant_id, id, retained_earnings_account_id) REFERENCES gl.accounts(tenant_id, company_id, id) DEFERRABLE INITIALLY DEFERRED;

-- Optional whitelist: when rows exist, only these cost centers (and their subtrees) are allowed on the account.
CREATE TABLE gl.account_cost_centers (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  account_id     uuid NOT NULL,
  cost_center_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, account_id, cost_center_id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES gl.accounts(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);

CREATE TABLE gl.account_dimension_rules (
  tenant_id         uuid NOT NULL,
  company_id        uuid NOT NULL,
  account_id        uuid NOT NULL,
  dimension_type_id uuid NOT NULL,
  rule              text NOT NULL CHECK (rule IN ('REQUIRED', 'OPTIONAL', 'NOT_ALLOWED')),
  PRIMARY KEY (tenant_id, account_id, dimension_type_id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES gl.accounts(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, dimension_type_id) REFERENCES gl.dimension_types(tenant_id, company_id, id)
);

-- ---------------------------------------------------------------- currency

CREATE TABLE gl.exchange_rates (
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  currency_code char(3) NOT NULL REFERENCES core.currencies(code),
  rate_date     date NOT NULL,
  rate_type     text NOT NULL DEFAULT 'SPOT' CHECK (rate_type IN ('SPOT', 'AVERAGE', 'CLOSING')),
  -- Units of base currency per one unit of currency_code.
  rate          numeric(18, 8) NOT NULL CHECK (rate > 0),
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, currency_code, rate_type, rate_date),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

-- ---------------------------------------------------------------- journals

CREATE TABLE gl.journal_types (
  tenant_id     uuid NOT NULL,
  company_id    uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  code          text NOT NULL,
  name_ar       text NOT NULL DEFAULT '',
  name_en       text NOT NULL DEFAULT '',
  -- System types are only used by the posting engine (sub-ledgers, revaluation, closing).
  is_system     boolean NOT NULL DEFAULT false,
  source_module text NOT NULL DEFAULT 'GL' CHECK (source_module IN ('GL', 'AP', 'AR', 'INV', 'PAY')),
  is_active     boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.distribution_templates (
  tenant_id  uuid NOT NULL,
  company_id uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  code       text NOT NULL,
  name_ar    text NOT NULL DEFAULT '',
  name_en    text NOT NULL DEFAULT '',
  is_active  boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.distribution_template_lines (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  template_id    uuid NOT NULL,
  line_no        smallint NOT NULL,
  cost_center_id uuid NOT NULL,
  percent        numeric(9, 6) NOT NULL CHECK (percent > 0 AND percent <= 100),
  PRIMARY KEY (tenant_id, template_id, line_no),
  FOREIGN KEY (tenant_id, company_id, template_id) REFERENCES gl.distribution_templates(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);

CREATE TABLE gl.journal_entries (
  tenant_id        uuid NOT NULL,
  company_id       uuid NOT NULL,
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  journal_type_id  uuid NOT NULL,
  fiscal_year_id   uuid NOT NULL,
  period_id        uuid NOT NULL,
  entry_date       date NOT NULL,
  entry_seq        int,
  entry_no         text,
  status           text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REVERSED')),
  description      text,
  reference        text,
  source_module    text NOT NULL DEFAULT 'GL' CHECK (source_module IN ('GL', 'AP', 'AR', 'INV', 'PAY')),
  source_doc_type  text,
  source_doc_id    text,
  idempotency_key  text,
  reversal_of_id   uuid,
  reversed_by_id   uuid,
  total_debit      numeric(19, 4) NOT NULL DEFAULT 0,
  total_credit     numeric(19, 4) NOT NULL DEFAULT 0,
  rejection_reason text,
  version          int NOT NULL DEFAULT 1,
  created_by       uuid NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  submitted_by     uuid,
  submitted_at     timestamptz,
  approved_by      uuid,
  approved_at      timestamptz,
  posted_by        uuid,
  posted_at        timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, journal_type_id, fiscal_year_id, entry_seq),
  CHECK ((status IN ('POSTED', 'REVERSED')) = (entry_no IS NOT NULL)),
  FOREIGN KEY (tenant_id, company_id, journal_type_id) REFERENCES gl.journal_types(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES gl.fiscal_years(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES gl.fiscal_periods(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, reversal_of_id) REFERENCES gl.journal_entries(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, reversed_by_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);
CREATE UNIQUE INDEX journal_entries_idem_idx ON gl.journal_entries(tenant_id, company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX journal_entries_date_idx ON gl.journal_entries(tenant_id, company_id, entry_date);
CREATE INDEX journal_entries_status_idx ON gl.journal_entries(tenant_id, company_id, status);
CREATE INDEX journal_entries_period_idx ON gl.journal_entries(tenant_id, company_id, period_id);

CREATE TABLE gl.journal_lines (
  tenant_id                uuid NOT NULL,
  company_id               uuid NOT NULL,
  id                       uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id                 uuid NOT NULL,
  line_no                  int NOT NULL,
  account_id               uuid NOT NULL,
  cost_center_id           uuid,
  description              text,
  currency_code            char(3) NOT NULL REFERENCES core.currencies(code),
  exchange_rate            numeric(18, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  debit                    numeric(19, 4) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit                   numeric(19, 4) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  debit_base               numeric(19, 4) NOT NULL DEFAULT 0 CHECK (debit_base >= 0),
  credit_base              numeric(19, 4) NOT NULL DEFAULT 0 CHECK (credit_base >= 0),
  -- Draft-only: a split across cost centers, expanded into separate lines at posting.
  distribution_template_id uuid,
  distribution             jsonb,
  is_rounding              boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, entry_id, line_no) DEFERRABLE INITIALLY DEFERRED,
  CHECK (NOT (debit > 0 AND credit > 0)),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, distribution_template_id) REFERENCES gl.distribution_templates(tenant_id, company_id, id)
);
CREATE INDEX journal_lines_entry_idx ON gl.journal_lines(tenant_id, entry_id);
CREATE INDEX journal_lines_account_idx ON gl.journal_lines(tenant_id, company_id, account_id);
CREATE INDEX journal_lines_cc_idx ON gl.journal_lines(tenant_id, company_id, cost_center_id) WHERE cost_center_id IS NOT NULL;

CREATE TABLE gl.journal_line_dimensions (
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  line_id            uuid NOT NULL,
  dimension_type_id  uuid NOT NULL,
  dimension_value_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, line_id, dimension_type_id),
  FOREIGN KEY (tenant_id, company_id, line_id) REFERENCES gl.journal_lines(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, dimension_type_id) REFERENCES gl.dimension_types(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, dimension_type_id, dimension_value_id) REFERENCES gl.dimension_values(tenant_id, dimension_type_id, id)
);
CREATE INDEX journal_line_dimensions_value_idx ON gl.journal_line_dimensions(tenant_id, dimension_value_id);

CREATE TABLE gl.attachments (
  tenant_id    uuid NOT NULL,
  company_id   uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  entry_id     uuid NOT NULL,
  file_name    text NOT NULL,
  content_type text NOT NULL,
  size_bytes   bigint NOT NULL,
  storage_key  text NOT NULL,
  uploaded_by  uuid NOT NULL,
  uploaded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id) ON DELETE CASCADE
);

-- Gapless numbering: one row per (company, journal type, fiscal year), locked FOR UPDATE at posting.
CREATE TABLE gl.number_sequences (
  tenant_id       uuid NOT NULL,
  company_id      uuid NOT NULL,
  journal_type_id uuid NOT NULL,
  fiscal_year_id  uuid NOT NULL,
  last_no         int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, company_id, journal_type_id, fiscal_year_id),
  FOREIGN KEY (tenant_id, company_id, journal_type_id) REFERENCES gl.journal_types(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, fiscal_year_id) REFERENCES gl.fiscal_years(tenant_id, company_id, id)
);

-- Derived summary of posted lines; always rebuildable with gl.rebuild_balances().
CREATE TABLE gl.account_balances (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  period_id      uuid NOT NULL,
  account_id     uuid NOT NULL,
  cost_center_id uuid,
  currency_code  char(3) NOT NULL,
  debit          numeric(19, 4) NOT NULL DEFAULT 0,
  credit         numeric(19, 4) NOT NULL DEFAULT 0,
  debit_base     numeric(19, 4) NOT NULL DEFAULT 0,
  credit_base    numeric(19, 4) NOT NULL DEFAULT 0,
  CONSTRAINT account_balances_key UNIQUE NULLS NOT DISTINCT (tenant_id, company_id, period_id, account_id, cost_center_id, currency_code),
  FOREIGN KEY (tenant_id, company_id, period_id) REFERENCES gl.fiscal_periods(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);
CREATE INDEX account_balances_account_idx ON gl.account_balances(tenant_id, company_id, account_id);

-- ---------------------------------------------------------------- immutability

CREATE FUNCTION gl.guard_journal_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'POSTED_IMMUTABLE' USING ERRCODE = 'P0001', DETAIL = 'Only draft entries can be deleted';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'REVERSED' THEN
    RAISE EXCEPTION 'POSTED_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.status = 'POSTED' THEN
    -- The only permitted change to a posted entry is marking it reversed.
    IF NEW.status <> 'REVERSED' OR NEW.reversed_by_id IS NULL
       OR (to_jsonb(NEW) - ARRAY['status', 'reversed_by_id', 'updated_at', 'updated_by', 'version'])
          IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'reversed_by_id', 'updated_at', 'updated_by', 'version']) THEN
      RAISE EXCEPTION 'POSTED_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER journal_entries_guard BEFORE UPDATE OR DELETE ON gl.journal_entries
  FOR EACH ROW EXECUTE FUNCTION gl.guard_journal_entry();

CREATE FUNCTION gl.guard_journal_line() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status text;
  v_tenant uuid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_entry  uuid := COALESCE(NEW.entry_id, OLD.entry_id);
BEGIN
  SELECT status INTO v_status FROM gl.journal_entries WHERE tenant_id = v_tenant AND id = v_entry;
  -- v_status is NULL when the parent is being cascade-deleted (only drafts can be).
  IF v_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'POSTED_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER journal_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON gl.journal_lines
  FOR EACH ROW EXECUTE FUNCTION gl.guard_journal_line();

CREATE FUNCTION gl.guard_line_dimension() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT e.status INTO v_status
  FROM gl.journal_lines l JOIN gl.journal_entries e ON e.tenant_id = l.tenant_id AND e.id = l.entry_id
  WHERE l.tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id) AND l.id = COALESCE(NEW.line_id, OLD.line_id);
  IF v_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'POSTED_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER journal_line_dimensions_guard BEFORE INSERT OR UPDATE OR DELETE ON gl.journal_line_dimensions
  FOR EACH ROW EXECUTE FUNCTION gl.guard_line_dimension();

-- ---------------------------------------------------------------- balance rebuild

CREATE FUNCTION gl.rebuild_balances(p_company_id uuid) RETURNS void
LANGUAGE sql AS $$
  DELETE FROM gl.account_balances WHERE tenant_id = core.current_tenant() AND company_id = p_company_id;
  INSERT INTO gl.account_balances (tenant_id, company_id, period_id, account_id, cost_center_id, currency_code,
                                   debit, credit, debit_base, credit_base)
  SELECT l.tenant_id, l.company_id, e.period_id, l.account_id, l.cost_center_id, l.currency_code,
         sum(l.debit), sum(l.credit), sum(l.debit_base), sum(l.credit_base)
  FROM gl.journal_lines l
  JOIN gl.journal_entries e ON e.tenant_id = l.tenant_id AND e.id = l.entry_id
  WHERE l.tenant_id = core.current_tenant() AND l.company_id = p_company_id AND e.status IN ('POSTED', 'REVERSED')
  GROUP BY l.tenant_id, l.company_id, e.period_id, l.account_id, l.cost_center_id, l.currency_code;
$$;

-- ---------------------------------------------------------------- RLS

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'fiscal_years', 'fiscal_periods', 'period_statuses', 'cost_centers', 'dimension_types', 'dimension_values',
    'accounts', 'account_cost_centers', 'account_dimension_rules', 'exchange_rates', 'journal_types',
    'distribution_templates', 'distribution_template_lines', 'journal_entries', 'journal_lines',
    'journal_line_dimensions', 'attachments', 'number_sequences', 'account_balances'
  ] LOOP
    EXECUTE format('ALTER TABLE gl.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON gl.%I USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant())', t);
  END LOOP;
END $$;
