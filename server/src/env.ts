/** Server configuration from environment variables. Never hardcode secrets. */
function num(name: string, def: number): number {
  const v = process.env[name];
  return v === undefined || v === '' ? def : Number(v);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: num('PORT', 3000),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://mini:mini_dev_password@localhost:5432/mini_empire',
  sessionTtlHours: num('SESSION_TTL_HOURS', 24 * 30),
  /** Telegram bot token for Mini App initData verification. Leave empty to disable Telegram login. */
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
  /** Salt for hashing client IPs (multi-account detection without storing raw IPs). */
  ipHashSalt: process.env.IP_HASH_SALT ?? 'dev-only-salt-change-me',
  corsOrigin: process.env.CORS_ORIGIN ?? '',
  /** Path to the built client (served in production). */
  clientDist: process.env.CLIENT_DIST ?? new URL('../../client/dist', import.meta.url).pathname,
  /** ISO date for the first season start when the database has no season yet (defaults to now). */
  firstSeasonStart: process.env.FIRST_SEASON_START ?? '',
  seasonTickSeconds: num('SEASON_TICK_SECONDS', 60),
};
