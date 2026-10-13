import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PGlite } from '@electric-sql/pglite';

// BIGINT comes back as a string by default; resources fit safely in JS numbers
// (hard ceiling 10M), token units are kept as strings/BigInt explicitly where used.
pg.types.setTypeParser(20, (v) => Number(v)); // int8

export interface QueryResult<R = any> {
  rows: R[];
  rowCount: number | null;
}
/** The subset of node-postgres the game uses. Implemented by pg.Pool and by the embedded PGlite adapter. */
export interface Tx {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  release(): void;
}
export interface Db {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
  connect(): Promise<Tx>;
  end(): Promise<void>;
  /** Run a multi-statement SQL script (migrations). */
  exec(sql: string): Promise<void>;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** `pglite:<dir>` or `pglite:memory` → embedded PostgreSQL (no installation needed). */
export function isEmbedded(url: string): boolean {
  return url.startsWith('pglite:');
}

export function createPool(connectionString: string): Db {
  if (isEmbedded(connectionString)) return createEmbedded(connectionString.slice('pglite:'.length));
  const pool = new pg.Pool({ connectionString, max: 10 });
  return {
    query: (text, params) => pool.query(text, params as unknown[]),
    connect: () => pool.connect(),
    end: () => pool.end(),
    async exec(sql) {
      await pool.query(sql);
    },
  };
}

/**
 * Embedded PostgreSQL (PGlite, WebAssembly) for zero-install local play. It has a single connection,
 * so a mutex gives each transaction exclusive use of it; plain queries also wait their turn.
 */
function createEmbedded(location: string): Db {
  const dataDir = location === 'memory' ? undefined : path.resolve(repoRoot, location);
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  let tail: Promise<void> = Promise.resolve();
  const acquire = () => {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const ready = tail.then(() => release);
    tail = tail.then(() => next);
    return ready;
  };
  const run = async (text: string, params?: unknown[]) => {
    const r = await db.query(text, params as any[]);
    return { rows: r.rows as any[], rowCount: r.rows.length > 0 ? r.rows.length : (r.affectedRows ?? 0) };
  };
  return {
    async query(text, params) {
      const release = await acquire();
      try {
        return await run(text, params);
      } finally {
        release();
      }
    },
    async connect() {
      const release = await acquire();
      let released = false;
      return {
        query: (text: string, params?: unknown[]) => run(text, params),
        release: () => {
          if (!released) { released = true; release(); }
        },
      };
    },
    end: () => db.close(),
    async exec(sql) {
      const release = await acquire();
      try {
        await db.exec(sql);
      } finally {
        release();
      }
    },
  } as Db;
}

/** Run `fn` inside a transaction. Rolls back on any error. */
export async function withTx<T>(pool: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}
