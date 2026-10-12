import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createStartingKingdom } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { withTx, type Tx } from '../db.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { createSession, deleteSession } from '../auth/sessions.js';
import { verifyTelegramInitData } from '../auth/telegram.js';
import { AppError } from '../lib/errors.js';
import { hashIp, limit, logSuspicious, parse, requireUser } from '../lib/http.js';
import { insertStartingKingdom } from '../services/kingdomRepo.js';
import { ruleCtx } from '../services/kingdomService.js';
import { currentSeason } from '../services/scores.js';

const username = z.string().trim().min(3).max(20).regex(/^[A-Za-z0-9_]+$/, 'letters, digits and _ only');
const password = z.string().min(8).max(100);

export async function createAccount(ctx: AppContext, tx: Tx, name: string, passwordHash: string | null, telegramId: number | null, ipHash: string | null): Promise<string> {
  const taken = await tx.query('SELECT 1 FROM users WHERE lower(username) = lower($1)', [name]);
  if (taken.rowCount) throw new AppError(409, 'USERNAME_TAKEN', 'That username is already taken.');
  const now = ctx.now();
  const userId = (
    await tx.query('INSERT INTO users (username, password_hash, telegram_id, ip_hash, created_at, last_seen_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING id', [
      name, passwordHash, telegramId, ipHash, new Date(now),
    ])
  ).rows[0].id as string;
  await tx.query('INSERT INTO player_profiles (user_id) VALUES ($1)', [userId]);
  const season = await currentSeason(tx);
  await insertStartingKingdom(tx, userId, season.id, createStartingKingdom(ruleCtx(ctx, now)));
  return userId;
}

export async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/auth/register', async (req) => {
    limit(ctx, req, 'register', 5, 60 * 60_000);
    const body = parse(z.object({ username, password }), req.body);
    const ipHash = hashIp(req.ip, ctx.ipHashSalt);
    const pw = await hashPassword(body.password);
    const userId = await withTx(ctx.db, (tx) => createAccount(ctx, tx, body.username, pw, null, ipHash));
    // Multi-account signal (review only, never an automatic ban).
    const same = await ctx.db.query("SELECT count(*)::int AS n FROM users WHERE ip_hash = $1 AND created_at > $2", [ipHash, new Date(ctx.now() - 86_400_000)]);
    if (same.rows[0].n >= 4) await logSuspicious(ctx, userId, 'many_accounts_same_ip', 'low', { accountsLast24h: same.rows[0].n });
    const token = await createSession(ctx.db, userId, ctx.now(), ctx.sessionTtlHours);
    return { token, user: { id: userId, username: body.username, role: 'player' } };
  });

  app.post('/auth/login', async (req) => {
    limit(ctx, req, 'login', 10, 15 * 60_000);
    const body = parse(z.object({ username: z.string().max(40), password: z.string().max(200) }), req.body);
    const { rows } = await ctx.db.query('SELECT id, username, password_hash, role, suspended FROM users WHERE lower(username) = lower($1)', [body.username]);
    const u = rows[0];
    const ok = await verifyPassword(body.password, u?.password_hash ?? null);
    if (!u || !ok) throw new AppError(401, 'BAD_CREDENTIALS', 'Wrong username or password.');
    if (u.suspended) throw new AppError(403, 'SUSPENDED', 'This account is suspended. Contact support.');
    await ctx.db.query('UPDATE users SET last_seen_at = $2 WHERE id = $1', [u.id, new Date(ctx.now())]);
    const token = await createSession(ctx.db, u.id, ctx.now(), ctx.sessionTtlHours);
    return { token, user: { id: u.id, username: u.username, role: u.role } };
  });

  /** Telegram Mini App login: identity comes only from verified initData. */
  app.post('/auth/telegram', async (req) => {
    limit(ctx, req, 'login', 10, 15 * 60_000);
    if (!ctx.telegramBotToken) throw new AppError(501, 'TELEGRAM_DISABLED', 'Telegram login is not configured on this server.');
    const body = parse(z.object({ initData: z.string().min(10).max(4096) }), req.body);
    const tg = verifyTelegramInitData(body.initData, ctx.telegramBotToken, ctx.now());
    if (!tg) throw new AppError(401, 'BAD_TELEGRAM_DATA', 'Could not verify Telegram login.');
    let { rows } = await ctx.db.query('SELECT id, username, role, suspended FROM users WHERE telegram_id = $1', [tg.id]);
    if (!rows[0]) {
      const base = (tg.username ?? `tg${tg.id}`).replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || `tg${tg.id}`;
      let name = base.length >= 3 ? base : `tg_${base}`;
      const clash = await ctx.db.query('SELECT 1 FROM users WHERE lower(username)=lower($1)', [name]);
      if (clash.rowCount) name = `${name.slice(0, 14)}_${String(tg.id).slice(-4)}`;
      const id = await withTx(ctx.db, (tx) => createAccount(ctx, tx, name, null, tg.id, hashIp(req.ip, ctx.ipHashSalt)));
      rows = [{ id, username: name, role: 'player', suspended: false }];
    }
    if (rows[0].suspended) throw new AppError(403, 'SUSPENDED', 'This account is suspended.');
    const token = await createSession(ctx.db, rows[0].id, ctx.now(), ctx.sessionTtlHours);
    return { token, user: { id: rows[0].id, username: rows[0].username, role: rows[0].role } };
  });

  app.post('/auth/logout', async (req) => {
    requireUser(req);
    await deleteSession(ctx.db, req.headers.authorization!.slice(7));
    return { ok: true };
  });

  app.get('/auth/me', async (req) => {
    const u = requireUser(req);
    return { user: { id: u.id, username: u.username, role: u.role } };
  });
}
