-- Docker Compose init for local development: the same roles and databases as scripts/db-setup.sh,
-- in SQL so that a Windows checkout with CRLF line endings still works. Runs only on an empty volume.
CREATE ROLE erp_owner LOGIN PASSWORD 'erp_owner_dev';
CREATE ROLE erp_app LOGIN PASSWORD 'erp_app_dev' NOBYPASSRLS;
CREATE DATABASE erp OWNER erp_owner;
CREATE DATABASE erp_test OWNER erp_owner;
REVOKE ALL ON DATABASE erp FROM PUBLIC;
REVOKE ALL ON DATABASE erp_test FROM PUBLIC;
GRANT CONNECT ON DATABASE erp TO erp_app, erp_owner;
GRANT CONNECT ON DATABASE erp_test TO erp_app, erp_owner;
