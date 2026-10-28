-- New phase 2 permissions for the built-in roles.
UPDATE core.roles SET permissions = array(SELECT DISTINCT unnest(permissions || ARRAY['gl.budget.manage', 'gl.close.manage']))
WHERE is_system AND code IN ('ADMIN', 'CHIEF_ACCOUNTANT');
