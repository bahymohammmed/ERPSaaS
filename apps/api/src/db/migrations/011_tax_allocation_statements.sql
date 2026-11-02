-- Tax codes on invoice lines, allocations made after posting, settlements in another
-- currency than the party, and imported bank statements for reconciliation.

-- ---------------------------------------------------------------- tax codes

CREATE TABLE sl.tax_codes (
  tenant_id            uuid NOT NULL,
  company_id           uuid NOT NULL,
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  code                 text NOT NULL,
  name_ar              text NOT NULL DEFAULT '',
  name_en              text NOT NULL DEFAULT '',
  rate                 numeric(7, 4) NOT NULL CHECK (rate >= 0 AND rate <= 100),
  -- Output tax on sales (liability) and recoverable input tax on purchases (asset).
  sales_account_id     uuid,
  purchase_account_id  uuid,
  is_active            boolean NOT NULL DEFAULT true,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  CHECK (rate = 0 OR sales_account_id IS NOT NULL OR purchase_account_id IS NOT NULL),
  FOREIGN KEY (tenant_id, company_id, sales_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, purchase_account_id) REFERENCES gl.accounts(tenant_id, company_id, id)
);

ALTER TABLE sl.document_lines
  ADD COLUMN tax_code_id uuid,
  ADD COLUMN tax_rate numeric(7, 4) NOT NULL DEFAULT 0,
  ADD COLUMN tax_amount numeric(19, 4) NOT NULL DEFAULT 0,
  ADD FOREIGN KEY (tenant_id, company_id, tax_code_id) REFERENCES sl.tax_codes(tenant_id, company_id, id);

-- total stays the amount due (net + tax).
ALTER TABLE sl.documents
  ADD COLUMN subtotal numeric(19, 4) NOT NULL DEFAULT 0,
  ADD COLUMN tax_total numeric(19, 4) NOT NULL DEFAULT 0;
UPDATE sl.documents SET subtotal = total;

-- ---------------------------------------------------------------- allocations after posting

ALTER TABLE sl.allocations
  ADD COLUMN alloc_date date,
  -- Exchange difference entry when the allocation was made after posting, and its reversal.
  ADD COLUMN entry_id uuid,
  ADD COLUMN removed_entry_id uuid,
  -- Date the allocation was taken off (unallocated); voids leave it null.
  ADD COLUMN removed_on date,
  ADD COLUMN created_by uuid,
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now(),
  ADD FOREIGN KEY (tenant_id, company_id, entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id),
  ADD FOREIGN KEY (tenant_id, company_id, removed_entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id);
UPDATE sl.allocations al SET alloc_date = COALESCE(
  (SELECT s.settle_date FROM sl.settlements s WHERE s.id = al.settlement_id),
  (SELECT d.doc_date FROM sl.documents d WHERE d.id = al.source_document_id));
ALTER TABLE sl.allocations ALTER COLUMN alloc_date SET NOT NULL;

-- ---------------------------------------------------------------- settlements in the bank's currency

-- Amount that went through the bank account when its currency differs from the party's.
ALTER TABLE sl.settlements ADD COLUMN bank_amount numeric(19, 4);

-- ---------------------------------------------------------------- imported statements

CREATE TABLE sl.statement_lines (
  tenant_id          uuid NOT NULL,
  company_id         uuid NOT NULL,
  id                 uuid NOT NULL DEFAULT gen_random_uuid(),
  reconciliation_id  uuid NOT NULL,
  line_no            int NOT NULL,
  line_date          date NOT NULL,
  description        text NOT NULL DEFAULT '',
  reference          text,
  -- Bank currency; positive = money in.
  amount             numeric(19, 4) NOT NULL,
  matched_line_id    uuid,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, reconciliation_id) REFERENCES sl.reconciliations(tenant_id, company_id, id) ON DELETE CASCADE
);
CREATE INDEX statement_lines_rec_idx ON sl.statement_lines(tenant_id, reconciliation_id, line_no);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['tax_codes', 'statement_lines'] LOOP
    EXECUTE format('ALTER TABLE sl.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON sl.%I USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sl TO erp_app;
