-- Password changes, e-mailed reset links and administrator resets.
-- password_changed_at ends every session issued before it; must_change_password forces a new
-- password after an administrator set a temporary one.

ALTER TABLE core.users
  ADD COLUMN password_changed_at timestamptz,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

-- Reset links: only a SHA-256 hash of the token is stored; one use, short expiry.
CREATE TABLE core.password_resets (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES core.users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  request_ip  text
);
CREATE INDEX password_resets_user_idx ON core.password_resets(user_id, created_at DESC);
-- The application role has no direct access: only the functions below touch this table.
REVOKE ALL ON core.password_resets FROM PUBLIC;

DROP FUNCTION core.auth_lookup(text);
CREATE FUNCTION core.auth_lookup(p_email text)
RETURNS TABLE (user_id uuid, password_hash text, is_active boolean, mfa_enabled boolean, mfa_secret text, must_change_password boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT id, password_hash, is_active, mfa_enabled, mfa_secret, must_change_password FROM core.users WHERE email = p_email::citext
$$;

-- Records a reset token for an active user and returns who to e-mail; nothing for an unknown,
-- inactive or just-asked address (one request per user per minute). Earlier unused links stop working.
CREATE FUNCTION core.password_reset_request(p_email text, p_token_hash text, p_ttl_minutes int, p_ip text)
RETURNS TABLE (user_id uuid, email text, full_name text, preferred_locale text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
DECLARE u core.users%ROWTYPE;
BEGIN
  SELECT * INTO u FROM core.users WHERE core.users.email = p_email::citext AND is_active;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM core.password_resets r WHERE r.user_id = u.id AND r.created_at > now() - interval '1 minute') THEN
    RETURN;
  END IF;
  DELETE FROM core.password_resets r WHERE r.user_id = u.id AND (r.used_at IS NOT NULL OR r.expires_at < now() OR r.created_at < now() - interval '1 day');
  UPDATE core.password_resets r SET expires_at = least(r.expires_at, now()) WHERE r.user_id = u.id AND r.used_at IS NULL;
  INSERT INTO core.password_resets (token_hash, user_id, expires_at, request_ip)
  VALUES (p_token_hash, u.id, now() + make_interval(mins => p_ttl_minutes), p_ip);
  RETURN QUERY SELECT u.id, u.email::text, u.full_name, u.preferred_locale;
END $$;

-- Whether a token is still usable (for the reset page), without using it.
CREATE FUNCTION core.password_reset_check(p_token_hash text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM core.password_resets r JOIN core.users u ON u.id = r.user_id
    WHERE r.token_hash = p_token_hash AND r.used_at IS NULL AND r.expires_at > now() AND u.is_active
  )
$$;

-- Sets the new password with a valid token and uses the token up. Returns the user, or null.
CREATE FUNCTION core.password_reset_complete(p_token_hash text, p_password_hash text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
DECLARE v_user uuid;
BEGIN
  UPDATE core.password_resets r SET used_at = now()
  FROM core.users u
  WHERE r.token_hash = p_token_hash AND u.id = r.user_id AND r.used_at IS NULL AND r.expires_at > now() AND u.is_active
  RETURNING r.user_id INTO v_user;
  IF v_user IS NULL THEN RETURN NULL; END IF;
  UPDATE core.users SET password_hash = p_password_hash, password_changed_at = now(), must_change_password = false WHERE id = v_user;
  UPDATE core.password_resets SET expires_at = least(expires_at, now()) WHERE user_id = v_user AND used_at IS NULL;
  RETURN v_user;
END $$;

-- A tenant administrator sets a temporary password for a member of the current tenant. Refused
-- for users who also belong to another tenant (their account is not this tenant's to control)
-- and for platform administrators.
CREATE FUNCTION core.reset_member_password(p_user_id uuid, p_password_hash text) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM core.tenant_users WHERE user_id = p_user_id AND tenant_id = core.current_tenant()) THEN
    RETURN 'not_member';
  END IF;
  IF core.is_platform_admin(p_user_id) THEN RETURN 'platform'; END IF;
  IF EXISTS (SELECT 1 FROM core.tenant_users WHERE user_id = p_user_id AND tenant_id <> core.current_tenant()) THEN
    RETURN 'shared';
  END IF;
  UPDATE core.users SET password_hash = p_password_hash, password_changed_at = now(), must_change_password = true WHERE id = p_user_id;
  RETURN 'ok';
END $$;

-- Platform support resets also force a new password and end existing sessions.
CREATE OR REPLACE FUNCTION core.platform_reset_credentials(p_tenant_id uuid, p_user_id uuid, p_password_hash text, p_reset_mfa boolean)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
BEGIN
  PERFORM core.assert_platform_admin();
  IF NOT EXISTS (SELECT 1 FROM core.tenant_users WHERE tenant_id = p_tenant_id AND user_id = p_user_id) THEN
    RETURN false;
  END IF;
  IF core.is_platform_admin(p_user_id) THEN
    RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE core.users SET password_hash = p_password_hash, password_changed_at = now(), must_change_password = true,
    mfa_enabled = CASE WHEN p_reset_mfa THEN false ELSE mfa_enabled END,
    mfa_secret  = CASE WHEN p_reset_mfa THEN NULL ELSE mfa_secret END
  WHERE id = p_user_id;
  RETURN true;
END $$;

-- Session check for platform tokens (platform admins have no tenant context to read users through).
CREATE FUNCTION core.user_session_state(p_user_id uuid)
RETURNS TABLE (password_changed_at timestamptz, must_change_password boolean, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = core, public, pg_temp AS $$
  SELECT password_changed_at, must_change_password, is_active FROM core.users WHERE id = p_user_id
$$;

GRANT EXECUTE ON FUNCTION core.auth_lookup(text), core.password_reset_request(text, text, int, text), core.password_reset_check(text),
  core.password_reset_complete(text, text), core.reset_member_password(uuid, text), core.user_session_state(uuid) TO erp_app;
