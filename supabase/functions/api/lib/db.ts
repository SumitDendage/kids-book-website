// Database access. One small connection pool per running copy of the function.
// Every query runs inside a transaction that first switches to the least-privilege role lww_api,
// so the API can only do what the migrations granted that role.
import postgres from 'postgres';
import { env } from './env.ts';
import { HttpError } from './http.ts';

// deno-lint-ignore no-explicit-any
export type Sql = postgres.Sql<any>;
// deno-lint-ignore no-explicit-any
export type Tx = postgres.TransactionSql<any>;

let pool: Sql | null = null;

export function setPoolForTests(sql: Sql | null) {
  pool = sql;
}

export function db(): Sql {
  if (pool) return pool;
  const url = env().dbUrl;
  if (!url) throw new HttpError(503, 'The service is briefly unavailable — please try again in a minute.', { code: 'service_unavailable' });
  pool = postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // works with Supabase's transaction pooler
    connection: { application_name: 'lww-api' },
    types: {
      // bigint ids and counts come back as JS numbers (all are far below 2^53)
      bigint: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) },
    },
    transform: { undefined: null },
    onnotice: () => {},
  });
  return pool;
}

/** Runs fn in one transaction as role lww_api. Retries once on a serialization failure. */
export async function tx<T>(fn: (q: Tx) => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const timeout = Math.max(1000, Math.min(opts.timeoutMs ?? 15000, 60000));
  for (let attempt = 0; ; attempt++) {
    try {
      return await db().begin(async (q) => {
        await q.unsafe(`set local role lww_api; set local statement_timeout = ${timeout}; set local search_path = public, extensions`);
        return await fn(q);
      }) as T;
    } catch (e) {
      const code = (e as { code?: string }).code;
      if ((code === '40001' || code === '40P01') && attempt === 0) continue;
      throw mapDbError(e);
    }
  }
}

const DOWN_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EAI_AGAIN', 'CONNECT_TIMEOUT', 'CONNECTION_CLOSED', 'CONNECTION_ENDED', 'CONNECTION_DESTROYED']);

export function mapDbError(e: unknown): unknown {
  if (e instanceof HttpError) return e;
  const code = String((e as { code?: string }).code ?? '');
  if (DOWN_CODES.has(code) || /^08/.test(code) || /^57P0/.test(code)) {
    return new HttpError(503, 'The service is briefly unavailable — please try again in a minute.', { code: 'service_unavailable' });
  }
  return e;
}

/** Postgres unique-violation? (optionally on a named constraint/index) */
export function isUnique(e: unknown, constraint?: string): boolean {
  const err = e as { code?: string; constraint_name?: string };
  return err?.code === '23505' && (!constraint || err.constraint_name === constraint);
}

export function isCheck(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  return code === '23514' || code === '23502' || code === '22P02' || code === '23503';
}
