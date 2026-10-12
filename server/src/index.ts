import { env } from './env.js';
import { createPool } from './db.js';
import { createContext, loadTunables } from './context.js';
import { buildApp } from './app.js';
import { migrate } from './migrate.js';
import { bootstrapSeason, seasonTick } from './services/season.js';

async function main() {
  if (env.nodeEnv === 'production' && env.ipHashSalt === 'dev-only-salt-change-me') {
    throw new Error('Set IP_HASH_SALT in production.');
  }
  await migrate(env.databaseUrl);
  const db = createPool(env.databaseUrl);
  const ctx = createContext({ db, telegramBotToken: env.telegramBotToken, ipHashSalt: env.ipHashSalt, sessionTtlHours: env.sessionTtlHours });
  await loadTunables(ctx);
  await bootstrapSeason(ctx, env.firstSeasonStart ? Date.parse(env.firstSeasonStart) : undefined);
  await seasonTick(ctx);
  // The season state machine advances on server time, checked periodically (idempotent).
  setInterval(() => seasonTick(ctx).catch((e) => console.error('season tick failed', e)), env.seasonTickSeconds * 1000).unref();
  const app = await buildApp(ctx, { logger: env.nodeEnv !== 'test', clientDist: env.clientDist, corsOrigin: env.corsOrigin });
  await app.listen({ port: env.port, host: env.host });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
