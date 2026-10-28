import { Client } from 'pg';
import { migrate } from '../src/db/migrate';

const OWNER_URL = process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://erp_owner:erp_owner_dev@localhost:5432/erp_test';

/** Rebuilds the test database schema from the migrations before the suite runs. */
export default async function setup(): Promise<void> {
  const client = new Client({ connectionString: OWNER_URL });
  await client.connect();
  await client.query('DROP SCHEMA IF EXISTS gl CASCADE; DROP SCHEMA IF EXISTS core CASCADE; DROP TABLE IF EXISTS public.schema_migrations;');
  await client.end();
  await migrate(OWNER_URL, () => undefined);
}
