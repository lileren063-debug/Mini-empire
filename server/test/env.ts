import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildConfig, type Tunables } from '@mini-empire/shared';
import { createPool } from '../src/db.js';
import { createContext, type AppContext } from '../src/context.js';
import { buildApp } from '../src/app.js';
import { migrate } from '../src/migrate.js';
import { bootstrapSeason } from '../src/services/season.js';

export const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://mini:mini_dev_password@localhost:5432/mini_empire_test';
export const T0 = Date.UTC(2026, 0, 1, 12, 0, 0);
export const BOT_TOKEN = '123456:TEST-BOT-TOKEN';

let ipCounter = 0;

export interface TestEnv {
  app: FastifyInstance;
  ctx: AppContext;
  clock: { now: number; advance(ms: number): void };
  register(name: string): Promise<{ token: string; id: string }>;
  call(token: string | null, method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: any }>;
  setTunables(t: Tunables): void;
  sql(q: string, p?: unknown[]): Promise<any[]>;
  close(): Promise<void>;
}

/** Fresh schema + app with a controllable server clock. */
export async function makeEnv(): Promise<TestEnv> {
  const admin = new pg.Client({ connectionString: TEST_DB });
  await admin.connect();
  await admin.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await admin.end();
  await migrate(TEST_DB, () => undefined);
  const db = createPool(TEST_DB);
  const clock = { now: T0, advance(ms: number) { this.now += ms; } };
  const ctx = createContext({ db, now: () => clock.now, telegramBotToken: BOT_TOKEN, sessionTtlHours: 24 * 400 });
  await bootstrapSeason(ctx, T0);
  const app = await buildApp(ctx, { trustProxy: true });
  const call: TestEnv['call'] = async (token, method, url, body, headers = {}) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };
  return {
    app,
    ctx,
    clock,
    call,
    async register(name) {
      const r = await call(null, 'POST', '/api/auth/register', { username: name, password: 'correct-horse-battery' }, { 'x-forwarded-for': `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}` });
      if (r.status !== 200) throw new Error(`register failed: ${JSON.stringify(r.body)}`);
      return { token: r.body.token, id: r.body.user.id };
    },
    setTunables(t) {
      ctx.cfg = buildConfig(t, 'test');
    },
    async sql(q, p) {
      return (await db.query(q, p)).rows;
    },
    async close() {
      await app.close();
      await db.end();
    },
  };
}

/** Build a barracks and train infantry (advances the clock). */
export async function armUp(env: TestEnv, token: string, infantry = 20) {
  const b = await env.call(token, 'POST', '/api/kingdom/buildings', { type: 'barracks', x: 3, y: 3 });
  if (b.status !== 200) throw new Error(JSON.stringify(b.body));
  env.clock.advance(60_000);
  const t = await env.call(token, 'POST', '/api/army/train', { troop: 'infantry', count: infantry });
  if (t.status !== 200) throw new Error(JSON.stringify(t.body));
  env.clock.advance(infantry * 20_000 + 1000);
  return (await env.call(token, 'GET', '/api/kingdom')).body;
}
