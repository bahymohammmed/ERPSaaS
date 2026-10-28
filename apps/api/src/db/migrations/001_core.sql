-- Core platform schema: tenants, users, roles, companies, currencies, audit.
-- Isolation: every tenant-owned table carries tenant_id and is protected by RLS
-- keyed on the transaction-local setting app.tenant_id. The application role
-- (erp_app) is neither owner nor BYPASSRLS.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS gl;

CREATE FUNCTION core.current_tenant() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

CREATE FUNCTION core.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- Arabic search normalisation: unify alef forms, ta marbuta, alef maqsura; drop tashkeel and tatweel.
CREATE FUNCTION core.ar_normalize(t text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(translate(regexp_replace(coalesce(t, ''), '[ً-ْٰـ]', '', 'g'),
                         'أإآٱةى', 'ااااهي'))
$$;

CREATE FUNCTION core.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------- reference

CREATE TABLE core.currencies (
  code        char(3) PRIMARY KEY,
  name_ar     text NOT NULL,
  name_en     text NOT NULL,
  minor_units smallint NOT NULL CHECK (minor_units BETWEEN 0 AND 4),
  minor_name_ar text,
  minor_name_en text,
  is_active   boolean NOT NULL DEFAULT true
);

-- ---------------------------------------------------------------- tenancy

CREATE TABLE core.tenants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  plan_code     text NOT NULL DEFAULT 'standard',
  max_companies int  NOT NULL DEFAULT 3,
  max_users     int  NOT NULL DEFAULT 25,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            citext NOT NULL UNIQUE,
  password_hash    text NOT NULL,
  full_name        text NOT NULL,
  preferred_locale text NOT NULL DEFAULT 'ar' CHECK (preferred_locale IN ('ar', 'en')),
  digit_style      text NOT NULL DEFAULT 'latn' CHECK (digit_style IN ('latn', 'arab')),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_login_at    timestamptz
);

CREATE TABLE core.roles (
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id),
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  code        text NOT NULL,
  name_ar     text NOT NULL DEFAULT '',
  name_en     text NOT NULL DEFAULT '',
  permissions text[] NOT NULL DEFAULT '{}',
  is_system   boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE core.tenant_users (
  tenant_id          uuid NOT NULL REFERENCES core.tenants(id),
  user_id            uuid NOT NULL REFERENCES core.users(id),
  role_id            uuid NOT NULL,
  is_active          boolean NOT NULL DEFAULT true,
  -- Root cost centers the user may see (whole subtree). NULL = unrestricted.
  cost_center_scope  uuid[],
  created_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, role_id) REFERENCES core.roles(tenant_id, id)
);
CREATE INDEX tenant_users_user_idx ON core.tenant_users(user_id);

CREATE TABLE core.companies (
  tenant_id                    uuid NOT NULL REFERENCES core.tenants(id),
  id                           uuid NOT NULL DEFAULT gen_random_uuid(),
  code                         text NOT NULL,
  name_ar                      text NOT NULL DEFAULT '',
  name_en                      text NOT NULL DEFAULT '',
  base_currency                char(3) NOT NULL REFERENCES core.currencies(code),
  country                      char(2) NOT NULL DEFAULT 'KW',
  commercial_reg_no            text,
  tax_no                       text,
  fiscal_year_start_month      smallint NOT NULL DEFAULT 1 CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  require_approval             boolean NOT NULL DEFAULT false,
  rounding_account_id          uuid,
  retained_earnings_account_id uuid,
  is_active                    boolean NOT NULL DEFAULT true,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER companies_touch BEFORE UPDATE ON core.companies FOR EACH ROW EXECUTE FUNCTION core.touch_updated_at();

-- Append-only audit trail.
CREATE TABLE core.audit_log (
  tenant_id   uuid NOT NULL REFERENCES core.tenants(id),
  id          bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  user_id     uuid,
  ip          text,
  company_id  uuid,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   uuid,
  old_data    jsonb,
  new_data    jsonb,
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX audit_log_entity_idx ON core.audit_log(tenant_id, entity_type, entity_id);
CREATE INDEX audit_log_time_idx ON core.audit_log(tenant_id, occurred_at DESC);

-- ---------------------------------------------------------------- RLS

ALTER TABLE core.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core.tenants USING (id = core.current_tenant()) WITH CHECK (id = core.current_tenant());

ALTER TABLE core.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core.roles USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());

ALTER TABLE core.tenant_users ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core.tenant_users USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());

ALTER TABLE core.companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core.companies USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());

ALTER TABLE core.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON core.audit_log USING (tenant_id = core.current_tenant()) WITH CHECK (tenant_id = core.current_tenant());

-- Users are global; a session sees itself and members of its current tenant.
ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_visibility ON core.users
  USING (
    id = core.current_user_id()
    OR EXISTS (SELECT 1 FROM core.tenant_users tu WHERE tu.user_id = users.id AND tu.tenant_id = core.current_tenant())
  );
CREATE POLICY user_insert ON core.users FOR INSERT WITH CHECK (true);
CREATE POLICY user_update ON core.users FOR UPDATE
  USING (id = core.current_user_id()) WITH CHECK (id = core.current_user_id());

-- ---------------------------------------------------------------- auth helpers
-- SECURITY DEFINER functions run as the table owner (not subject to RLS) and expose
-- only the narrow facts needed before a tenant context exists.

CREATE FUNCTION core.auth_lookup(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT id, password_hash, is_active FROM core.users WHERE email = p_email::citext
$$;

CREATE FUNCTION core.find_user_id(p_email text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT id FROM core.users WHERE email = p_email::citext
$$;

CREATE FUNCTION core.user_tenants(p_user_id uuid)
RETURNS TABLE (tenant_id uuid, tenant_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT t.id, t.name
  FROM core.tenant_users tu JOIN core.tenants t ON t.id = tu.tenant_id
  WHERE tu.user_id = p_user_id AND tu.is_active AND t.is_active
  ORDER BY t.name
$$;
