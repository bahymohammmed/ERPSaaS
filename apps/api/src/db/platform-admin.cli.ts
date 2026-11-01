import { randomUUID } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { Client } from 'pg';
import { config } from '../config';

/**
 * Creates (or grants) a platform administrator. Runs with the owner connection because the
 * application role cannot write core.platform_admins.
 *
 *   PLATFORM_ADMIN_EMAIL=... PLATFORM_ADMIN_PASSWORD=... [PLATFORM_ADMIN_NAME=...] pnpm platform:admin
 *
 * An existing user keeps their password. A platform admin must not belong to any tenant.
 */
const run = async (): Promise<void> => {
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? '';
  if (!email) throw new Error('Set PLATFORM_ADMIN_EMAIL');

  const client = new Client({ connectionString: config.migrationDatabaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{ id: string }>('SELECT id FROM core.users WHERE email = $1', [email]);
    let userId = found.rows[0]?.id;
    if (!userId) {
      if (password.length < 10) throw new Error('Set PLATFORM_ADMIN_PASSWORD (at least 10 characters) for a new administrator');
      userId = randomUUID();
      const passwordHash = await hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
      await client.query('INSERT INTO core.users (id, email, password_hash, full_name, preferred_locale) VALUES ($1, $2, $3, $4, $5)', [
        userId,
        email,
        passwordHash,
        process.env.PLATFORM_ADMIN_NAME ?? 'Platform administrator',
        'en',
      ]);
    } else {
      const memberships = await client.query('SELECT 1 FROM core.tenant_users WHERE user_id = $1', [userId]);
      if (memberships.rowCount) throw new Error(`${email} belongs to a tenant; use a dedicated email for the platform administrator`);
    }
    const inserted = await client.query('INSERT INTO core.platform_admins (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
    await client.query('COMMIT');
    console.log(inserted.rowCount ? `Platform administrator ready: ${email}` : `${email} is already a platform administrator`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
};

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
