-- Platform (SaaS operator) administration.
-- Platform admins are global users listed in core.platform_admins. The application role has no
-- privileges on that table: it is written only by the owner (scripts/CLI), and read through the
-- SECURITY DEFINER functions below, which check the caller (app.user_id) on every call.

CREATE TABLE core.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES core.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON core.platform_admins FROM PUBLIC;

CREATE FUNCTION core.is_platform_admin(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.platform_admins pa JOIN core.users u ON u.id = pa.user_id
    WHERE pa.user_id = p_user_id AND u.is_active
  )
$$;

CREATE FUNCTION core.assert_platform_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
BEGIN
  IF NOT core.is_platform_admin(core.current_user_id()) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
END $$;

-- Every tenant with its usage, for the platform console.
CREATE FUNCTION core.platform_tenants()
RETURNS TABLE (
  id uuid, name text, plan_code text, max_companies int, max_users int, is_active boolean, created_at timestamptz,
  company_count int, user_count int, last_login_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
BEGIN
  PERFORM core.assert_platform_admin();
  RETURN QUERY
  SELECT t.id, t.name, t.plan_code, t.max_companies, t.max_users, t.is_active, t.created_at,
         (SELECT count(*)::int FROM core.companies c WHERE c.tenant_id = t.id),
         (SELECT count(*)::int FROM core.tenant_users tu WHERE tu.tenant_id = t.id AND tu.is_active),
         (SELECT max(u.last_login_at) FROM core.tenant_users tu JOIN core.users u ON u.id = tu.user_id WHERE tu.tenant_id = t.id)
  FROM core.tenants t
  ORDER BY t.created_at DESC;
END $$;

-- Support action: sets a new password (and optionally clears 2FA) for a member of the given tenant.
CREATE FUNCTION core.platform_reset_credentials(p_tenant_id uuid, p_user_id uuid, p_password_hash text, p_reset_mfa boolean)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
BEGIN
  PERFORM core.assert_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM core.tenant_users WHERE tenant_id = p_tenant_id AND user_id = p_user_id) THEN
    RETURN false;
  END IF;
  -- Platform admin accounts are managed with the CLI only.
  IF core.is_platform_admin(p_user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE core.users SET password_hash = p_password_hash,
    mfa_enabled = CASE WHEN p_reset_mfa THEN false ELSE mfa_enabled END,
    mfa_secret  = CASE WHEN p_reset_mfa THEN NULL ELSE mfa_secret END
  WHERE id = p_user_id;
  RETURN true;
END $$;

GRANT EXECUTE ON FUNCTION core.is_platform_admin(uuid), core.assert_platform_admin(), core.platform_tenants(),
  core.platform_reset_credentials(uuid, uuid, text, boolean) TO erp_app;
