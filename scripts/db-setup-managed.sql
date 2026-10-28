-- One-time setup on a managed PostgreSQL 16+ service (Neon, Supabase, RDS, ...), run as the
-- admin user the provider gives you, against its default database:
--
--   psql "$ADMIN_DATABASE_URL" -v owner_password=... -v app_password=... -f scripts/db-setup-managed.sql
--
-- erp_owner owns the schema and runs migrations; erp_app is what the application connects as.
-- erp_app must not own tables or have BYPASSRLS, or tenant isolation is not enforced.

CREATE ROLE erp_owner LOGIN PASSWORD :'owner_password';
CREATE ROLE erp_app LOGIN PASSWORD :'app_password' NOBYPASSRLS;
GRANT erp_owner TO CURRENT_USER;
CREATE DATABASE erp OWNER erp_owner;
REVOKE ALL ON DATABASE erp FROM PUBLIC;
GRANT CONNECT ON DATABASE erp TO erp_app, erp_owner;
