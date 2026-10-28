import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, type PoolClient, type QueryResultRow, types } from 'pg';
import { AppError } from '../common/app-error';
import { config } from '../config';

// Keep NUMERIC as exact strings and DATE as plain 'YYYY-MM-DD' (no timezone shifting).
types.setTypeParser(types.builtins.NUMERIC, (v) => v);
types.setTypeParser(types.builtins.DATE, (v) => v);
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

export type TenantContext = { tenantId: string; userId: string | null };

/** A transaction bound to one tenant. All queries go through RLS for that tenant. */
export class Tx {
  constructor(private readonly client: PoolClient) {}

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    try {
      const result = await this.client.query<T>(sql, params);
      return result.rows;
    } catch (error) {
      throw translatePgError(error);
    }
  }

  async one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T> {
    const rows = await this.query<T>(sql, params);
    const row = rows[0];
    if (!row) throw new AppError('NOT_FOUND', { entity: 'record' });
    return row;
  }

  async maybeOne<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }
}

type PgError = { code?: string; message?: string; constraint?: string; detail?: string };

const translatePgError = (error: unknown): unknown => {
  const pg = error as PgError;
  if (pg.code === 'P0001' && pg.message === 'POSTED_IMMUTABLE') return new AppError('POSTED_IMMUTABLE');
  if (pg.code === '23505') {
    const match = /\(([^)]*)\)=\(([^)]*)\)/.exec(pg.detail ?? '');
    const values = match?.[2]?.split(', ') ?? [];
    return new AppError('DUPLICATE_CODE', { code: values[values.length - 1] ?? '' });
  }
  if (pg.code === '23503') return new AppError('VALIDATION_FAILED', { constraint: pg.constraint ?? '' });
  return error;
};

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({ connectionString: config.databaseUrl, max: 20, statement_timeout: 60_000 });
  }

  /** Runs fn in a transaction with app.tenant_id / app.user_id set for RLS. */
  async withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.transaction(fn, ctx);
  }

  /** Runs fn with tenant context and always rolls back: used for previews that execute the real logic. */
  async previewWithTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [ctx.tenantId, ctx.userId ?? '']);
      return await fn(new Tx(client));
    } catch (error) {
      throw translatePgError(error);
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  }

  /** Transaction without tenant context: only SECURITY DEFINER helpers and global tables are usable. */
  async withoutTenant<T>(fn: (tx: Tx) => Promise<T>, userId: string | null = null): Promise<T> {
    return this.transaction(fn, { tenantId: '', userId });
  }

  private async transaction<T>(fn: (tx: Tx) => Promise<T>, ctx: { tenantId: string; userId: string | null }): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.user_id', $2, true)", [
        ctx.tenantId,
        ctx.userId ?? '',
      ]);
      const result = await fn(new Tx(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw translatePgError(error);
    } finally {
      client.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
