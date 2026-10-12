import { buildConfig, type GameConfig, type Tunables } from '@mini-empire/shared';
import type { Db } from './db.js';
import { RateLimiter } from './lib/rateLimit.js';

/** Everything a request handler needs. Created once per server (or per test). */
export interface AppContext {
  db: Db;
  /** Trusted server clock (epoch ms). Injectable for tests. */
  now: () => number;
  cfg: GameConfig;
  rate: RateLimiter;
  telegramBotToken: string;
  ipHashSalt: string;
  sessionTtlHours: number;
  errors: { at: number; message: string }[];
}

export function createContext(opts: { db: Db; now?: () => number; telegramBotToken?: string; ipHashSalt?: string; sessionTtlHours?: number }): AppContext {
  const now = opts.now ?? (() => Date.now());
  return {
    db: opts.db,
    now,
    cfg: buildConfig(),
    rate: new RateLimiter(now),
    telegramBotToken: opts.telegramBotToken ?? '',
    ipHashSalt: opts.ipHashSalt ?? 'test-salt',
    sessionTtlHours: opts.sessionTtlHours ?? 720,
    errors: [],
  };
}

/** Load the latest operator tunables from the database into the context. */
export async function loadTunables(ctx: AppContext): Promise<void> {
  const { rows } = await ctx.db.query('SELECT id, tunables FROM game_config ORDER BY id DESC LIMIT 1');
  ctx.cfg = rows[0] ? buildConfig(rows[0].tunables as Tunables, `v${rows[0].id}`) : buildConfig();
}
