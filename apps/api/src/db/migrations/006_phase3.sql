-- Phase 3: budget control, intercompany, consolidation, cost center hierarchy versions, MFA.

-- ---------------------------------------------------------------- budget control

ALTER TABLE core.companies
  ADD COLUMN budget_control text NOT NULL DEFAULT 'NONE' CHECK (budget_control IN ('NONE', 'WARN', 'BLOCK')),
  ADD COLUMN control_budget_id uuid,
  ADD FOREIGN KEY (tenant_id, id, control_budget_id) REFERENCES gl.budgets(tenant_id, company_id, id) DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------- intercompany

-- Each company defines, per partner company, where amounts due from / to that partner are kept.
CREATE TABLE gl.intercompany_partners (
  tenant_id            uuid NOT NULL,
  company_id           uuid NOT NULL,
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_company_id   uuid NOT NULL,
  due_from_account_id  uuid NOT NULL,
  due_to_account_id    uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, partner_company_id),
  CHECK (partner_company_id <> company_id),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id),
  FOREIGN KEY (tenant_id, partner_company_id) REFERENCES core.companies(tenant_id, id),
  FOREIGN KEY (tenant_id, company_id, due_from_account_id) REFERENCES gl.accounts(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, company_id, due_to_account_id) REFERENCES gl.accounts(tenant_id, company_id, id)
);

CREATE TABLE gl.intercompany_links (
  tenant_id         uuid NOT NULL,
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  source_company_id uuid NOT NULL,
  source_entry_id   uuid NOT NULL,
  target_company_id uuid NOT NULL,
  target_entry_id   uuid NOT NULL,
  created_by        uuid NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, source_company_id, source_entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id),
  FOREIGN KEY (tenant_id, target_company_id, target_entry_id) REFERENCES gl.journal_entries(tenant_id, company_id, id)
);

INSERT INTO gl.journal_types (tenant_id, company_id, code, name_ar, name_en, is_system, source_module)
SELECT c.tenant_id, c.id, 'IC', 'قيود بين الشركات', 'Intercompany', true, 'GL' FROM core.companies c
ON CONFLICT (tenant_id, company_id, code) DO NOTHING;

-- ---------------------------------------------------------------- consolidation

CREATE TABLE gl.consolidation_groups (
  tenant_id             uuid NOT NULL,
  id                    uuid NOT NULL DEFAULT gen_random_uuid(),
  code                  text NOT NULL,
  name_ar               text NOT NULL DEFAULT '',
  name_en               text NOT NULL DEFAULT '',
  -- The parent's chart of accounts and exchange rates are used for the consolidated view.
  parent_company_id     uuid NOT NULL,
  presentation_currency char(3) NOT NULL REFERENCES core.currencies(code),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, parent_company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.consolidation_members (
  tenant_id  uuid NOT NULL,
  group_id   uuid NOT NULL,
  company_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, group_id, company_id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES gl.consolidation_groups(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

-- Manual consolidation adjustments (e.g. eliminating intercompany sales), by account code,
-- in the group's presentation currency. They never touch any company's ledger.
CREATE TABLE gl.consolidation_adjustments (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  group_id        uuid NOT NULL,
  adjustment_date date NOT NULL,
  description     text NOT NULL DEFAULT '',
  lines           jsonb NOT NULL,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, group_id) REFERENCES gl.consolidation_groups(tenant_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- cost center hierarchy versions

CREATE TABLE gl.cost_center_versions (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  code           text NOT NULL,
  name_ar        text NOT NULL DEFAULT '',
  name_en        text NOT NULL DEFAULT '',
  effective_date date NOT NULL,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, company_id, id),
  UNIQUE (tenant_id, company_id, code),
  FOREIGN KEY (tenant_id, company_id) REFERENCES core.companies(tenant_id, id)
);

CREATE TABLE gl.cost_center_version_nodes (
  tenant_id      uuid NOT NULL,
  company_id     uuid NOT NULL,
  version_id     uuid NOT NULL,
  cost_center_id uuid NOT NULL,
  parent_id      uuid,
  PRIMARY KEY (tenant_id, version_id, cost_center_id),
  FOREIGN KEY (tenant_id, company_id, version_id) REFERENCES gl.cost_center_versions(tenant_id, company_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, company_id, cost_center_id) REFERENCES gl.cost_centers(tenant_id, company_id, id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- MFA

ALTER TABLE core.users
  ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false,
  -- AES-256-GCM encrypted TOTP secret (iv:tag:ciphertext, base64).
  ADD COLUMN mfa_secret text;

DROP FUNCTION core.auth_lookup(text);
CREATE FUNCTION core.auth_lookup(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, is_active boolean, mfa_enabled boolean, mfa_secret text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT id, password_hash, is_active, mfa_enabled, mfa_secret FROM core.users WHERE email = p_email::citext
$$;

-- Lets a tenant administrator clear MFA for a member of the current tenant only.
CREATE FUNCTION core.reset_member_mfa(p_user_id uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  UPDATE core.users u SET mfa_enabled = false, mfa_secret = NULL
  WHERE u.id = p_user_id
    AND EXISTS (SELECT 1 FROM core.tenant_users tu WHERE tu.user_id = p_user_id AND tu.tenant_id = core.current_tenant())
  RETURNING true
$$;

-- ---------------------------------------------------------------- RLS & grants

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'intercompany_partners', 'intercompany_links', 'consolidation_groups', 'consolidation_members',
    'consolidation_adjustments', 'cost_center_versions', 'cost_center_version_nodes'
  ] LOOP
    EXECUTE format('ALTER TABLE gl.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON gl.%I USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gl TO erp_app;
GRANT EXECUTE ON FUNCTION core.auth_lookup(text), core.reset_member_mfa(uuid) TO erp_app;

UPDATE core.roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['gl.consolidation.manage']))
WHERE is_system AND code IN ('ADMIN', 'CHIEF_ACCOUNTANT');
