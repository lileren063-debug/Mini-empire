import pg from 'pg';

// BIGINT / NUMERIC come back as strings by default; resources fit safely in JS numbers
// (hard ceiling 10M), token units are kept as strings/BigInt explicitly where used.
pg.types.setTypeParser(20, (v) => Number(v)); // int8

export type Db = pg.Pool;
export type Tx = pg.PoolClient;

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString, max: 10 });
}

/** Run `fn` inside a transaction. Rolls back on any error. */
export async function withTx<T>(pool: pg.Pool, fn: (tx: Tx) => Promise<T>): Promise<T> {
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
