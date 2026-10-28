import 'dotenv/config';

const required = (name: string, fallback?: string): string => {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
};

export const config = {
  databaseUrl: required('DATABASE_URL', 'postgres://erp_app:erp_app_dev@localhost:5432/erp'),
  migrationDatabaseUrl: required('MIGRATION_DATABASE_URL', 'postgres://erp_owner:erp_owner_dev@localhost:5432/erp'),
  jwtSecret: required('JWT_SECRET', process.env.NODE_ENV === 'production' ? undefined : 'dev-only-secret-change-me'),
  jwtTtlSeconds: Number(process.env.JWT_TTL_SECONDS ?? 28800),
  port: Number(process.env.PORT ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',
  storageDir: process.env.STORAGE_DIR ?? './storage',
  /** 'disk' (under storageDir) or 'database' (gl.attachment_contents) for hosts without a persistent disk. */
  attachmentStorage: (process.env.ATTACHMENT_STORAGE === 'database' ? 'database' : 'disk') as 'disk' | 'database',
  chromiumPath: process.env.CHROMIUM_PATH || undefined,
  // COOKIE_SECURE=false lets the production image run over plain http on a local machine.
  secureCookies: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
};
