import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

/**
 * Accès base minimal : du SQL paramétré, sans ORM.
 * Deux implémentations : PostgreSQL (`pg`, production) et PGlite (PostgreSQL embarqué, développement et tests).
 */
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Plusieurs instructions sans paramètres (migrations). */
  exec(sql: string): Promise<void>;
  transaction<R>(fn: (tx: Db) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

export async function createPgliteDb(dataDir: string | null): Promise<Db> {
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? await PGlite.create(dataDir) : await PGlite.create();
  type Queryable = Pick<PGlite, 'query' | 'exec'>;
  const wrap = (q: Queryable, inTx: boolean): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query<T>(sql, params)).rows;
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
    async transaction<R>(fn: (tx: Db) => Promise<R>) {
      if (inTx) return fn(wrap(q, true));
      return client.transaction((tx) => fn(wrap(tx as unknown as Queryable, true)));
    },
    async close() {
      if (!inTx) await client.close();
    },
  });
  return wrap(client, false);
}

export function createPgDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const wrap = (q: pg.Pool | pg.PoolClient, inTx: boolean): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await q.query(sql, params)).rows as T[];
    },
    async exec(sql: string) {
      await q.query(sql);
    },
    async transaction<R>(fn: (tx: Db) => Promise<R>) {
      if (inTx) return fn(wrap(q, true));
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(wrap(client, true));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      if (!inTx) await pool.end();
    },
  });
  return wrap(pool, false);
}
