import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { env } from './env.js';
import { createPool, withTx, type Db } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Apply pending SQL migrations in filename order. Each migration runs in its own transaction. */
export async function migrate(db: Db, log: (m: string) => void = console.log): Promise<string[]> {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const done = await withTx(db, async (tx) => {
      // Serialise concurrent migrators (several server instances starting at once).
      await tx.query('SELECT pg_advisory_xact_lock(424242)');
      const exists = await tx.query('SELECT 1 FROM schema_migrations WHERE name=$1', [file]);
      return !!exists.rowCount;
    });
    if (done) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    try {
      await db.exec(`BEGIN;\n${sql}\n;INSERT INTO schema_migrations (name) VALUES ('${file.replace(/'/g, "''")}');\nCOMMIT;`);
    } catch (e) {
      await db.exec('ROLLBACK').catch(() => undefined);
      throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
    }
    applied.push(file);
    log(`applied ${file}`);
  }
  return applied;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = createPool(env.databaseUrl);
  migrate(db)
    .then(async (a) => { console.log(a.length ? `${a.length} migration(s) applied` : 'database up to date'); await db.end(); })
    .catch((e) => { console.error(e); process.exit(1); });
}
