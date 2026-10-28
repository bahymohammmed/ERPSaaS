#!/usr/bin/env bash
# Creates the database roles and databases for local development and tests.
# Requires superuser access (run as the postgres OS user or with PGUSER=postgres).
set -euo pipefail

OWNER_PASSWORD="${ERP_OWNER_PASSWORD:-erp_owner_dev}"
APP_PASSWORD="${ERP_APP_PASSWORD:-erp_app_dev}"
PSQL="${PSQL:-psql -U ${POSTGRES_USER:-postgres}}"

run() { $PSQL -v ON_ERROR_STOP=1 -qtAc "$1" postgres; }

run "DO \$\$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_owner') THEN
    CREATE ROLE erp_owner LOGIN PASSWORD '${OWNER_PASSWORD}';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN
    CREATE ROLE erp_app LOGIN PASSWORD '${APP_PASSWORD}' NOBYPASSRLS;
  END IF;
END \$\$;"

for db in erp erp_test; do
  if ! $PSQL -qtAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" postgres | grep -q 1; then
    run "CREATE DATABASE ${db} OWNER erp_owner"
  fi
  run "REVOKE ALL ON DATABASE ${db} FROM PUBLIC; GRANT CONNECT ON DATABASE ${db} TO erp_app, erp_owner;"
done
echo "Roles erp_owner / erp_app and databases erp / erp_test are ready."
