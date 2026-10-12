import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ACHIEVEMENTS, COSMETICS, TOKEN_UNIT } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { parse, requireUser } from '../lib/http.js';
import { currentSeason } from '../services/scores.js';

export const AVATARS = ['knight', 'archer', 'queen', 'king', 'wizard', 'ranger', 'smith', 'monk'] as const;

/** Public profile: never includes credentials, Telegram ids, IP hashes or moderation flags. */
async function publicProfile(ctx: AppContext, userId: string) {
  const u = (
    await ctx.db.query(
      `SELECT u.id, u.username, u.created_at, p.avatar, p.title, p.equipped, p.battles_won, p.battles_lost, p.defenses_won, p.defenses_lost,
              k.hq_level, k.power, c.id AS clan_id, c.name AS clan_name, c.tag AS clan_tag, c.emblem AS clan_emblem, m.role AS clan_role
         FROM users u JOIN player_profiles p ON p.user_id=u.id JOIN kingdoms k ON k.user_id=u.id
         LEFT JOIN clan_memberships m ON m.user_id=u.id LEFT JOIN clans c ON c.id=m.clan_id
        WHERE u.id=$1`,
      [userId],
    )
  ).rows[0];
  if (!u) throw notFound('Player not found');
  const achievements = (await ctx.db.query('SELECT achievement_id, earned_at FROM achievements WHERE user_id=$1 ORDER BY earned_at', [userId])).rows.map((a) => ({ ...ACHIEVEMENTS.find((d) => d.id === a.achievement_id), earnedAt: a.earned_at }));
  const cosmetics = (await ctx.db.query('SELECT cosmetic_id, source, acquired_at FROM cosmetic_inventory WHERE user_id=$1', [userId])).rows.map((c) => ({ ...COSMETICS.find((d) => d.id === c.cosmetic_id), acquiredAt: c.acquired_at }));
  const seasons = (await ctx.db.query('SELECT s.number, sp.hq_level, sp.battle_score, sp.battle_rank, sp.participation_rank, sp.clan_rank FROM season_participants sp JOIN seasons s ON s.id=sp.season_id WHERE sp.user_id=$1 ORDER BY s.number DESC', [userId])).rows;
  const season = await currentSeason(ctx.db);
  return {
    id: u.id,
    username: u.username,
    avatar: u.avatar,
    title: u.title,
    equipped: u.equipped,
    createdAt: u.created_at,
    currentSeason: season.number,
    hqLevel: u.hq_level,
    power: u.power,
    clan: u.clan_id ? { id: u.clan_id, name: u.clan_name, tag: u.clan_tag, emblem: u.clan_emblem, role: u.clan_role } : null,
    record: { battlesWon: u.battles_won, battlesLost: u.battles_lost, defensesWon: u.defenses_won, defensesLost: u.defenses_lost },
    achievements,
    titles: achievements.filter((a) => a.title).map((a) => a.title as string),
    cosmetics,
    seasonHistory: seasons,
  };
}

export async function profileRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/profile/me', async (req) => {
    const user = requireUser(req);
    const p = await publicProfile(ctx, user.id);
    const token = (await ctx.db.query('SELECT units::text AS units FROM token_balances WHERE user_id=$1', [user.id])).rows[0];
    const onboarding = (await ctx.db.query('SELECT onboarding_done FROM player_profiles WHERE user_id=$1', [user.id])).rows[0];
    return { ...p, role: user.role, onboardingDone: onboarding.onboarding_done, testTokenBalance: token ? (Number(BigInt(token.units)) / TOKEN_UNIT).toFixed(6) : '0' };
  });

  app.get('/profile/:id', async (req) => {
    requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return publicProfile(ctx, id);
  });

  app.put('/profile', async (req) => {
    const user = requireUser(req);
    const body = parse(z.object({ avatar: z.enum(AVATARS).optional(), title: z.string().max(40).nullable().optional(), equipped: z.record(z.string(), z.string().max(40)).optional() }), req.body);
    if (body.title) {
      const titles = (await ctx.db.query('SELECT achievement_id FROM achievements WHERE user_id=$1', [user.id])).rows.map((r) => ACHIEVEMENTS.find((a) => a.id === r.achievement_id)?.title).filter(Boolean);
      if (!titles.includes(body.title)) throw badRequest('TITLE_LOCKED', 'You have not earned that title.');
    }
    if (body.equipped) {
      const owned = new Set((await ctx.db.query('SELECT cosmetic_id FROM cosmetic_inventory WHERE user_id=$1', [user.id])).rows.map((r) => r.cosmetic_id));
      for (const [slot, id] of Object.entries(body.equipped)) {
        const def = COSMETICS.find((c) => c.id === id);
        if (!def || def.slot !== slot || !owned.has(id)) throw badRequest('COSMETIC_LOCKED', 'You do not own that cosmetic.');
      }
    }
    await ctx.db.query('UPDATE player_profiles SET avatar=COALESCE($2,avatar), title=CASE WHEN $5 THEN $3 ELSE title END, equipped=COALESCE($4,equipped) WHERE user_id=$1', [
      user.id, body.avatar ?? null, body.title ?? null, body.equipped ? JSON.stringify(body.equipped) : null, body.title !== undefined,
    ]);
    return { ok: true };
  });

  app.post('/profile/onboarding', async (req) => {
    const user = requireUser(req);
    await ctx.db.query('UPDATE player_profiles SET onboarding_done=true WHERE user_id=$1', [user.id]);
    return { ok: true };
  });

  app.get('/store', async (req) => {
    const user = requireUser(req);
    const owned = new Set((await ctx.db.query('SELECT cosmetic_id FROM cosmetic_inventory WHERE user_id=$1', [user.id])).rows.map((r) => r.cosmetic_id));
    return { paymentsEnabled: false, items: COSMETICS.map((c) => ({ ...c, owned: owned.has(c.id) })) };
  });

  app.post('/store/purchase', async (req) => {
    requireUser(req);
    throw new AppError(501, 'PAYMENTS_DISABLED', 'Purchases are not enabled yet. Cosmetics can currently be earned through achievements and seasons.');
  });
}
