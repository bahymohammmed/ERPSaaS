-- Bank and cash, customers and suppliers (AR / AP sub-ledgers).
-- Documents post to the general ledger through the posting engine with source module AR or AP;
-- bank transfers post as GL entries. Amounts are kept in the document currency with the base
-- equivalent, and realised exchange differences are posted when settlements are allocated.

CREATE SCHEMA IF NOT EXISTS sl;

-- ---------------------------------------------------------------- bank and cash

CREATE TABLE sl.bank_accounts (
  tenant_id       uuid NOT NULL,
  company_id      uuid NOT NULL,
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  code            text NOT NULL,
  name_ar         text NOT NULL DEFAULT '',
  name_en         text NOT NULL DEFAULT '',
  kind            text NOT NULL DEFAULT 'BANK' CHECK (kind IN ('BANK', 'CASH')),
  account_id      uuid NOT NULL,
  currency_code   char(3) NOT NULL REFERENCES core.currencies(code),
  bank_name       text,
  account_number  text,
  iban            text,
  is_active       boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  UNIQUE (tenant_id, company_id, account_id),
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES gl.accounts(tenant_id, company_id, id)
);

CREATE TABLE sl.bank_transfers (
  tenant_id        uuid NOT NULL,
  company_id       uuid NOT NULL,
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  transfer_date    date NOT NULL,
  from_account_id  uuid NOT NULL,
  to_account_id    uuid NOT NULL,
  amount           numeric(19, 4) NOT NULL CHECK (amount > 0),
  -- Received amount when the two accounts are in different currencies.
  to_amount        numeric(19, 4) NOT NULL CHECK (to_amount > 0),
  reference        text,
  description      text,
  entry_id         uuid,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  CHECK (from_account_id <> to_account_id),
  FOREIGN KEY (tenant_id, company_id, from_account_id) REFERENCES sl.bank_accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, to_account_id) REFERENCES sl.bank_accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);

CREATE TABLE sl.reconciliations (
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  bank_account_id    uuid NOT NULL,
  statement_date     date NOT NULL,
  statement_balance  numeric(19, 4) NOT NULL,
  status             text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'COMPLETED')),
  completed_by       uuid,
  completed_at       timestamptz,
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, bank_account_id) REFERENCES sl.bank_accounts(tenant_id, company_id, id)
);
CREATE UNIQUE INDEX reconciliations_one_draft ON sl.reconciliations(tenant_id, bank_account_id) WHERE status = 'DRAFT';

-- Posted ledger lines on the bank account that the statement shows as cleared.
CREATE TABLE sl.reconciliation_items (
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  reconciliation_id  uuid NOT NULL,
  line_id            uuid NOT NULL,
  PRIMARY KEY (tenant_id, reconciliation_id, line_id),
  FOREIGN KEY (tenant_id, company_id, reconciliation_id) REFERENCES sl.reconciliations(tenant_id, company_id, id) ON DELETE CASCADE
);
CREATE INDEX reconciliation_items_line_idx ON sl.reconciliation_items(tenant_id, line_id);

-- ---------------------------------------------------------------- customers and suppliers

CREATE TABLE sl.parties (
  tenant_id            uuid NOT NULL,
  company_id           uuid NOT NULL,
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  side                 text NOT NULL CHECK (side IN ('AR', 'AP')),
  code                 text NOT NULL,
  name_ar              text NOT NULL DEFAULT '',
  name_en              text NOT NULL DEFAULT '',
  currency_code        char(3) NOT NULL REFERENCES core.currencies(code),
  -- Receivable (AR) or payable (AP) control account.
  control_account_id   uuid NOT NULL,
  -- Default revenue (AR) or expense (AP) account for new document lines.
  default_account_id   uuid,
  payment_terms_days   int NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 3650),
  credit_limit         numeric(19, 4),
  contact_name         text,
  email                text,
  phone                text,
  address              text,
  tax_no               text,
  commercial_reg_no    text,
  notes                text,
  is_active            boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, side, code),
  FOREIGN KEY (tenant_id, company_id, control_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, default_account_id) REFERENCES gl.accounts(tenant_id, company_id, id)
);

-- ---------------------------------------------------------------- documents

-- INVOICE increases what the party owes (AR) or what we owe (AP); CREDIT_NOTE (AR) and
-- DEBIT_NOTE (AP) reduce it and can be allocated against open invoices.
CREATE TABLE sl.documents (
  tenant_id         uuid NOT NULL,
  company_id        uuid NOT NULL,
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  side              text NOT NULL CHECK (side IN ('AR', 'AP')),
  doc_type          text NOT NULL CHECK (doc_type IN ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE')),
  doc_no            text,
  party_id          uuid NOT NULL,
  doc_date          date NOT NULL,
  due_date          date NOT NULL,
  currency_code     char(3) NOT NULL,
  exchange_rate     numeric(19, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  reference         text,
  description       text,
  total             numeric(19, 4) NOT NULL DEFAULT 0,
  total_base        numeric(19, 4) NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'POSTED', 'VOID')),
  entry_id          uuid,
  void_entry_id     uuid,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  posted_by         uuid,
  posted_at         timestamptz,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, side, doc_no),
  CHECK (due_date >= doc_date),
  CHECK ((side = 'AR' AND doc_type IN ('INVOICE', 'CREDIT_NOTE')) OR (side = 'AP' AND doc_type IN ('INVOICE', 'DEBIT_NOTE'))),
  FOREIGN KEY (tenant_id, company_id, party_id) REFERENCES sl.parties(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, void_entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);
CREATE INDEX documents_party_idx ON sl.documents(tenant_id, party_id, doc_date);

CREATE TABLE sl.document_lines (
  tenant_id       uuid NOT NULL,
  company_id      uuid NOT NULL,
  document_id     uuid NOT NULL,
  line_no         int NOT NULL,
  description     text NOT NULL DEFAULT '',
  account_id      uuid NOT NULL,
  cost_center_id  uuid,
  quantity        numeric(19, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price      numeric(19, 4) NOT NULL CHECK (unit_price >= 0),
  amount          numeric(19, 4) NOT NULL,
  PRIMARY KEY (tenant_id, document_id, line_no),
  FOREIGN KEY (tenant_id, company_id, document_id) REFERENCES sl.documents(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id)
);

-- ---------------------------------------------------------------- receipts and payments

CREATE TABLE sl.settlements (
  tenant_id         uuid NOT NULL,
  company_id        uuid NOT NULL,
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  side              text NOT NULL CHECK (side IN ('AR', 'AP')),
  doc_no            text,
  party_id          uuid NOT NULL,
  bank_account_id   uuid NOT NULL,
  settle_date       date NOT NULL,
  currency_code     char(3) NOT NULL,
  exchange_rate     numeric(19, 8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  amount            numeric(19, 4) NOT NULL CHECK (amount > 0),
  reference         text,
  description       text,
  status            text NOT NULL DEFAULT 'POSTED' CHECK (status IN ('POSTED', 'VOID')),
  entry_id          uuid,
  void_entry_id     uuid,
  created_by        uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, side, doc_no),
  FOREIGN KEY (tenant_id, company_id, party_id) REFERENCES sl.parties(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, bank_account_id) REFERENCES sl.bank_accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, void_entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);
CREATE INDEX settlements_party_idx ON sl.settlements(tenant_id, party_id, settle_date);

-- What a receipt / payment or a credit / debit note settles. Amounts in the document currency.
CREATE TABLE sl.allocations (
  tenant_id            uuid NOT NULL,
  company_id           uuid NOT NULL,
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  settlement_id        uuid,
  source_document_id   uuid,
  target_document_id   uuid NOT NULL,
  amount               numeric(19, 4) NOT NULL CHECK (amount > 0),
  -- Realised exchange difference in base currency (positive = gain).
  fx_difference        numeric(19, 4) NOT NULL DEFAULT 0,
  is_active            boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  CHECK ((settlement_id IS NULL) <> (source_document_id IS NULL)),
  FOREIGN KEY (tenant_id, company_id, settlement_id) REFERENCES sl.settlements(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, source_document_id) REFERENCES sl.documents(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, target_document_id) REFERENCES sl.documents(tenant_id, company_id, id)
);
CREATE INDEX allocations_target_idx ON sl.allocations(tenant_id, target_document_id) WHERE is_active;
CREATE INDEX allocations_settlement_idx ON sl.allocations(tenant_id, settlement_id) WHERE is_active;
CREATE INDEX allocations_source_idx ON sl.allocations(tenant_id, source_document_id) WHERE is_active;

-- Gapless document numbers per company, kind and year.
CREATE TABLE sl.number_sequences (
  tenant_id   uuid NOT NULL,
  company_id  uuid NOT NULL,
  prefix      text NOT NULL,
  year        int NOT NULL,
  last_no     int NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, company_id, prefix, year)
);

-- ---------------------------------------------------------------- journal types, RLS, grants, permissions

INSERT INTO gl.journal_types (tenant_id, company_id, code, name_ar, name_en, is_system, source_module)
SELECT c.tenant_id, c.id, 'BNK', 'تحويلات بنكية', 'Bank transfers', true, 'GL' FROM core.companies c
ON CONFLICT (tenant_id, company_id, code) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bank_accounts', 'bank_transfers', 'reconciliations', 'reconciliation_items', 'parties', 'documents',
                           'document_lines', 'settlements', 'allocations', 'number_sequences'] LOOP
    EXECUTE format('ALTER TABLE sl.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON sl.%I USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant())', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA sl TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sl TO erp_app;

UPDATE core.roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['ar.view', 'ar.manage', 'ap.view', 'ap.manage', 'cb.view', 'cb.manage']))
WHERE is_system AND code IN ('ADMIN', 'CHIEF_ACCOUNTANT', 'ACCOUNTANT');
UPDATE core.roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['ar.view', 'ap.view', 'cb.view']))
WHERE is_system AND code = 'VIEWER';

-- Existing companies with the template chart get their bank and cash accounts registered.
INSERT INTO sl.bank_accounts (tenant_id, company_id, code, name_ar, name_en, kind, account_id, currency_code)
SELECT a.tenant_id, a.company_id, d.code, a.name_ar, a.name_en, d.kind, a.id, c.base_currency
FROM (VALUES ('CASH', '110101', 'CASH'), ('BANK', '110103', 'BANK')) AS d(code, account_code, kind)
JOIN gl.accounts a ON a.code = d.account_code
JOIN core.companies c ON c.id = a.company_id
ON CONFLICT DO NOTHING;
