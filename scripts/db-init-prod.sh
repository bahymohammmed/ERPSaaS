#!/bin/bash
# Production database roles, created once on an empty volume (docker-compose.prod.yml).
# Passwords come from the environment: ERP_OWNER_PASSWORD, ERP_APP_PASSWORD.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" -v owner_pw="$ERP_OWNER_PASSWORD" -v app_pw="$ERP_APP_PASSWORD" <<'SQL'
CREATE ROLE erp_owner LOGIN PASSWORD :'owner_pw';
CREATE ROLE erp_app LOGIN PASSWORD :'app_pw' NOBYPASSRLS;
CREATE DATABASE erp OWNER erp_owner;
REVOKE ALL ON DATABASE erp FROM PUBLIC;
GRANT CONNECT ON DATABASE erp TO erp_app, erp_owner;
SQL
