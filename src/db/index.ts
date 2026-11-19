import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const isCloudSqlConfigured = Boolean(
  process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME,
);

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      idleTimeoutMillis: 20000,
      connectionTimeoutMillis: 25000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    global._postgresPool.on('error', (err) => {
      if (isTransientPgError(err)) {
        return;
      }
      const msg = String(err?.message || '');
      if (msg.includes('client has already been connected')) {
        return;
      }
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

const TRANSIENT_PG_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now (e.g. database system is starting up)
  '08000', // connection_exception
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08003', // connection_does_not_exist
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '08006', // connection_failure
  '08P01', // protocol_violation
  '53300', // too_many_connections
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
]);

const TRANSIENT_PG_MSG_PATTERNS = [
  'connection terminated',
  'timeout exceeded when trying to connect',
  'the database system is starting up',
  'terminating connection',
  'client has encountered a connection error',
  'server closed the connection unexpectedly',
  'socket hang up',
  'econnreset',
  'econnrefused',
  'etimedout',
  'epipe',
  'cannot acquire a connection',
];

export function isTransientPgError(error: unknown): boolean {
  let curr: unknown = error;
  for (let depth = 0; depth < 5 && curr && typeof curr === 'object'; depth++) {
    const rec = curr as { code?: unknown; message?: unknown; cause?: unknown };
    const code = typeof rec.code === 'string' ? rec.code.trim() : '';
    if (code && TRANSIENT_PG_CODES.has(code)) {
      return true;
    }
    const msg = typeof rec.message === 'string' ? rec.message.toLowerCase() : '';
    if (msg && TRANSIENT_PG_MSG_PATTERNS.some((p) => msg.includes(p))) {
      return true;
    }
    curr = rec.cause;
  }
  return false;
}

const RETRY_DELAYS_MS = [350, 1000, 2200];

export async function withPgRetry<T>(op: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await op();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientPgError(error)) {
        throw error;
      }
      const delayMs = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

const pool = createPool();

export const db = drizzle(pool, { schema });
