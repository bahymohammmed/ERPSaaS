-- Privileges of the application role. It owns nothing, cannot bypass RLS,
-- and cannot rewrite or delete the audit trail.
GRANT USAGE ON SCHEMA core, gl TO erp_app;

GRANT SELECT ON core.currencies TO erp_app;
GRANT SELECT, INSERT, UPDATE ON core.tenants, core.users, core.companies TO erp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.roles, core.tenant_users TO erp_app;
GRANT SELECT, INSERT ON core.audit_log TO erp_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA gl TO erp_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA core, gl TO erp_app;
