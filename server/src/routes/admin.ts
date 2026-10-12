import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BUILDINGS, MISSIONS, SEASON_STATES, TROOPS, TROOP_TYPES, buildConfig, simulateBattle, type Tunables } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { loadTunables } from '../context.js';
import { withTx } from '../db.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { parse, requireRole } from '../lib/http.js';
import { audit } from '../services/audit.js';
import { computeBoard } from '../services/leaderboards.js';
import { approveRewards, distributeRewards, rewardPreview, rewardStatus } from '../services/rewards.js';
import { currentSeason } from '../services/scores.js';
import { forceTransition, reschedule, resetSeason } from '../services/season.js';

const startedAt = Date.now();

const multiplier = z.number().min(0.1).max(10);
const troopMult = z.object(Object.fromEntries(TROOP_TYPES.map((t) => [t, multiplier.optional()])) as Record<string, z.ZodOptional<typeof multiplier>>).partial();
export const tunablesSchema = z
  .object({
    productionMultiplier: multiplier.optional(),
    costMultiplier: multiplier.optional(),
    durationMultiplier: multiplier.optional(),
    trainingCostMultiplier: multiplier.optional(),
    trainingDurationMultiplier: multiplier.optional(),
    troopHpMultiplier: troopMult.optional(),
    troopDamageMultiplier: troopMult.optional(),
    missionRewardMultiplier: multiplier.optional(),
    disabledMissions: z.array(z.enum(MISSIONS.map((m) => m.id) as [string, ...string[]])).optional(),
    battle: z
      .object({
        pvpLootShare: z.number().min(0).max(0.5),
        defenderShieldHours: z.number().min(0).max(72),
        maxAttacksOnSameDefenderPer24h: z.number().int().min(1).max(20),
        matchmakingHqRange: z.number().int().min(0).max(9),
        minSecondsBetweenBattles: z.number().int().min(0).max(600),
      })
      .partial()
      .optional(),
    clanWar: z
      .object({
        minHqLevel: z.number().int().min(1).max(10),
        minMembershipHours: z.number().min(0).max(720),
        minRosterSize: z.number().int().min(1).max(50),
        maxRosterSize: z.number().int().min(1).max(50),
        attacksPerMember: z.number().int().min(1).max(10),
      })
      .partial()
      .optional(),
  })
  .strict();

export async function adminRoutes(app: FastifyInstance, ctx: AppContext) {
  // ---------------------------------------------------------------- overview & health
  app.get('/admin/overview', async (req) => {
    requireRole(req, 'moderator');
    const season = await currentSeason(ctx.db);
    const counts = (
      await ctx.db.query(`SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM clans WHERE disbanded_at IS NULL) AS clans,
        (SELECT count(*)::int FROM battles WHERE created_at > now() - interval '24 hours') AS battles_24h,
        (SELECT count(*)::int FROM suspicious_events WHERE status='open') AS open_flags,
        (SELECT count(*)::int FROM users WHERE last_seen_at > now() - interval '24 hours') AS active_24h`)
    ).rows[0];
    const errors = (await ctx.db.query('SELECT message, context, created_at FROM error_logs ORDER BY id DESC LIMIT 20')).rows;
    return {
      season,
      counts,
      health: { db: 'ok', uptimeSec: Math.round((Date.now() - startedAt) / 1000), memoryMb: Math.round(process.memoryUsage().rss / 1e6), configVersion: ctx.cfg.version, node: process.version },
      recentErrors: errors,
    };
  });

  // ---------------------------------------------------------------- players
  app.get('/admin/players', async (req) => {
    requireRole(req, 'moderator');
    const q = parse(z.object({ q: z.string().max(40).default('') }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT u.id, u.username, u.role, u.suspended, u.under_review, u.created_at, u.last_seen_at, k.hq_level, k.power
         FROM users u JOIN kingdoms k ON k.user_id=u.id WHERE u.username ILIKE '%' || $1 || '%' OR u.id::text = $1 ORDER BY u.created_at DESC LIMIT 50`,
      [q.q],
    );
    return { players: rows };
  });

  app.get('/admin/players/:id', async (req) => {
    requireRole(req, 'moderator');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const user = (await ctx.db.query('SELECT id, username, role, suspended, under_review, created_at, last_seen_at, telegram_id IS NOT NULL AS telegram_linked, ip_hash FROM users WHERE id=$1', [id])).rows[0];
    if (!user) throw notFound('Player not found');
    const sameIp = (await ctx.db.query('SELECT id, username FROM users WHERE ip_hash=$1 AND id<>$2 LIMIT 20', [user.ip_hash, id])).rows;
    const kingdom = (await ctx.db.query('SELECT k.*, rb.gold, rb.wood, rb.stone FROM kingdoms k JOIN resource_balances rb ON rb.kingdom_id=k.id WHERE k.user_id=$1', [id])).rows[0];
    const buildings = (await ctx.db.query('SELECT type, level, x, y FROM buildings WHERE kingdom_id=$1 ORDER BY type', [kingdom.id])).rows;
    const troops = (await ctx.db.query('SELECT troop_type, count FROM troops WHERE kingdom_id=$1', [kingdom.id])).rows;
    const transactions = (await ctx.db.query('SELECT delta_gold, delta_wood, delta_stone, reason, ref, created_at FROM resource_transactions WHERE user_id=$1 ORDER BY id DESC LIMIT 50', [id])).rows;
    const battles = (await ctx.db.query('SELECT id, kind, defender_id, stars, destruction, victory, score_points, rewards, created_at FROM battles WHERE attacker_id=$1 ORDER BY created_at DESC LIMIT 30', [id])).rows;
    const flags = (await ctx.db.query('SELECT * FROM suspicious_events WHERE user_id=$1 ORDER BY id DESC LIMIT 30', [id])).rows;
    const scores = (await ctx.db.query('SELECT category, source, sum(points)::int AS points, count(*)::int AS events FROM score_events WHERE user_id=$1 GROUP BY category, source', [id])).rows;
    const token = (await ctx.db.query('SELECT units::text FROM token_balances WHERE user_id=$1', [id])).rows[0];
    delete user.ip_hash;
    return { user, sameIpAccounts: sameIp, kingdom, buildings, troops, transactions, battles, flags, scores, tokenUnits: token?.units ?? '0' };
  });

  app.post('/admin/players/:id/review', async (req) => {
    const actor = requireRole(req, 'moderator');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ underReview: z.boolean(), note: z.string().min(3).max(500) }), req.body);
    await withTx(ctx.db, async (tx) => {
      const r = await tx.query('UPDATE users SET under_review=$2 WHERE id=$1', [id, body.underReview]);
      if (!r.rowCount) throw notFound('Player not found');
      await audit(tx, actor.id, 'player.review_flag', 'user', id, body, ctx.now());
    });
    return { ok: true };
  });

  app.post('/admin/players/:id/suspend', async (req) => {
    const actor = requireRole(req, 'admin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ suspended: z.boolean(), note: z.string().min(3).max(500) }), req.body);
    if (id === actor.id) throw badRequest('SELF', 'You cannot suspend yourself.');
    await withTx(ctx.db, async (tx) => {
      const r = await tx.query('UPDATE users SET suspended=$2 WHERE id=$1', [id, body.suspended]);
      if (!r.rowCount) throw notFound('Player not found');
      if (body.suspended) await tx.query('DELETE FROM sessions WHERE user_id=$1', [id]);
      await audit(tx, actor.id, body.suspended ? 'player.suspend' : 'player.unsuspend', 'user', id, body, ctx.now());
    });
    return { ok: true };
  });

  app.post('/admin/players/:id/role', async (req) => {
    const actor = requireRole(req, 'superadmin');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const body = parse(z.object({ role: z.enum(['player', 'moderator', 'admin', 'superadmin']), note: z.string().min(3).max(500) }), req.body);
    await withTx(ctx.db, async (tx) => {
      const r = await tx.query('UPDATE users SET role=$2 WHERE id=$1', [id, body.role]);
      if (!r.rowCount) throw notFound('Player not found');
      await audit(tx, actor.id, 'player.role', 'user', id, body, ctx.now());
    });
    return { ok: true };
  });

  // ---------------------------------------------------------------- clans
  app.get('/admin/clans', async (req) => {
    requireRole(req, 'moderator');
    const q = parse(z.object({ q: z.string().max(40).default('') }), req.query);
    const { rows } = await ctx.db.query(
      `SELECT c.id, c.name, c.tag, c.created_at, c.disbanded_at, (SELECT count(*)::int FROM clan_memberships m WHERE m.clan_id=c.id) AS members
         FROM clans c WHERE c.name ILIKE '%' || $1 || '%' OR c.tag ILIKE '%' || $1 || '%' ORDER BY c.created_at DESC LIMIT 50`,
      [q.q],
    );
    return { clans: rows };
  });

  app.get('/admin/clans/:id', async (req) => {
    requireRole(req, 'moderator');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const clan = (await ctx.db.query('SELECT * FROM clans WHERE id=$1', [id])).rows[0];
    if (!clan) throw notFound('Clan not found');
    const members = (await ctx.db.query('SELECT m.*, u.username FROM clan_memberships m JOIN users u ON u.id=m.user_id WHERE m.clan_id=$1', [id])).rows;
    const events = (await ctx.db.query('SELECT * FROM clan_events WHERE clan_id=$1 ORDER BY id DESC LIMIT 100', [id])).rows;
    const rosters = (await ctx.db.query('SELECT r.*, u.username FROM clan_war_rosters r JOIN users u ON u.id=r.user_id WHERE r.clan_id=$1 ORDER BY r.season_id DESC', [id])).rows;
    return { clan, members, events, rosters };
  });

  // ---------------------------------------------------------------- balancing config
  app.get('/admin/config', async (req) => {
    requireRole(req, 'moderator');
    const history = (await ctx.db.query('SELECT g.id, g.tunables, g.note, g.created_at, u.username FROM game_config g LEFT JOIN users u ON u.id=g.created_by ORDER BY g.id DESC LIMIT 20')).rows;
    return { version: ctx.cfg.version, tunables: history[0]?.tunables ?? {}, history, defaults: { buildings: BUILDINGS, troops: TROOPS, missions: MISSIONS }, effective: ctx.cfg };
  });

  app.put('/admin/config', async (req) => {
    const actor = requireRole(req, 'admin');
    const body = parse(z.object({ tunables: tunablesSchema, note: z.string().min(3).max(300) }), req.body);
    buildConfig(body.tunables as Tunables); // throws if unusable
    await withTx(ctx.db, async (tx) => {
      const before = (await tx.query('SELECT tunables FROM game_config ORDER BY id DESC LIMIT 1')).rows[0]?.tunables ?? {};
      const r = await tx.query('INSERT INTO game_config (tunables, note, created_by, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [JSON.stringify(body.tunables), body.note, actor.id, new Date(ctx.now())]);
      await audit(tx, actor.id, 'config.update', 'game_config', String(r.rows[0].id), { before, after: body.tunables, note: body.note }, ctx.now());
    });
    await loadTunables(ctx);
    return { version: ctx.cfg.version };
  });

  // ---------------------------------------------------------------- season
  app.get('/admin/season', async (req) => {
    requireRole(req, 'moderator');
    const season = await currentSeason(ctx.db);
    const transitions = (await ctx.db.query('SELECT t.*, u.username FROM season_transitions t LEFT JOIN users u ON u.id=t.actor_id WHERE season_id=$1 ORDER BY id', [season.id])).rows;
    const wars = (await ctx.db.query('SELECT w.*, a.name AS name_a, b.name AS name_b FROM clan_wars w JOIN clans a ON a.id=w.clan_a LEFT JOIN clans b ON b.id=w.clan_b WHERE w.season_id=$1', [season.id])).rows;
    const resets = (await ctx.db.query('SELECT * FROM season_reset_log ORDER BY season_id DESC LIMIT 10')).rows;
    return { season, transitions, wars, resets, states: SEASON_STATES };
  });

  app.post('/admin/season/transition', async (req) => {
    const actor = requireRole(req, 'superadmin');
    const body = parse(z.object({ to: z.enum(SEASON_STATES), reason: z.string().min(5).max(300) }), req.body);
    return forceTransition(ctx, actor.id, body.to, body.reason);
  });

  app.post('/admin/season/schedule', async (req) => {
    const actor = requireRole(req, 'superadmin');
    const range = z.tuple([z.number().int(), z.number().int()]);
    const body = parse(
      z.object({
        startsAt: z.number().int(),
        schedule: z.object({ lengthDays: z.number().int().min(4).max(400), developmentDays: range, warPreparationDays: range, warActiveDays: range, verificationDays: range }),
        reason: z.string().min(5).max(300),
      }),
      req.body,
    );
    return reschedule(ctx, actor.id, body);
  });

  app.post('/admin/season/reset', async (req) => {
    const actor = requireRole(req, 'superadmin');
    const season = await currentSeason(ctx.db);
    const body = parse(z.object({ confirm: z.string() }), req.body);
    if (body.confirm !== `RESET SEASON ${season.number}`) throw badRequest('CONFIRMATION_REQUIRED', `Type "RESET SEASON ${season.number}" to confirm.`);
    return resetSeason(ctx, actor.id);
  });

  // ---------------------------------------------------------------- leaderboards
  app.get('/admin/leaderboards', async (req) => {
    requireRole(req, 'moderator');
    const season = await currentSeason(ctx.db);
    const snapshots = (await ctx.db.query('SELECT id, board, reason, created_at, jsonb_array_length(entries) AS n FROM leaderboard_snapshots WHERE season_id=$1 ORDER BY id DESC', [season.id])).rows;
    return {
      clan: (await computeBoard(ctx.db, season, 'clan', ctx.now())).slice(0, 50),
      individual: (await computeBoard(ctx.db, season, 'individual', ctx.now())).slice(0, 50),
      participation: (await computeBoard(ctx.db, season, 'participation', ctx.now())).slice(0, 50),
      snapshots,
    };
  });

  // ---------------------------------------------------------------- rewards
  app.get('/admin/rewards', async (req) => {
    requireRole(req, 'moderator');
    const season = await currentSeason(ctx.db);
    return { season: { id: season.id, state: season.state }, ...(await rewardStatus(ctx.db, season.id)) };
  });

  app.post('/admin/rewards/preview', async (req) => {
    const actor = requireRole(req, 'admin');
    const pct = z.number().min(0).max(1);
    const body = parse(z.object({ poolTokens: z.number().int().min(0).max(1e12), allocation: z.object({ clan: pct, individual: pct, participation: pct, special: pct }).optional() }), req.body);
    return rewardPreview(ctx, actor.id, body);
  });

  app.post('/admin/rewards/approve', async (req) => {
    const actor = requireRole(req, 'superadmin');
    return approveRewards(ctx, actor.id);
  });

  app.post('/admin/rewards/retry', async (req) => {
    const actor = requireRole(req, 'admin');
    const season = (await ctx.db.query('SELECT p.id FROM reward_pools p ORDER BY p.id DESC LIMIT 1')).rows[0];
    if (!season) throw notFound('No reward pool');
    await audit(ctx.db, actor.id, 'rewards.retry', 'reward_pool', String(season.id), {}, ctx.now());
    return distributeRewards(ctx, season.id);
  });

  // ---------------------------------------------------------------- anti-cheat review
  app.get('/admin/suspicious', async (req) => {
    requireRole(req, 'moderator');
    const q = parse(z.object({ status: z.enum(['open', 'dismissed', 'actioned']).default('open') }), req.query);
    const { rows } = await ctx.db.query('SELECT s.*, u.username FROM suspicious_events s LEFT JOIN users u ON u.id=s.user_id WHERE s.status=$1 ORDER BY s.id DESC LIMIT 100', [q.status]);
    return { events: rows };
  });

  app.post('/admin/suspicious/:id/review', async (req) => {
    const actor = requireRole(req, 'moderator');
    const { id } = parse(z.object({ id: z.coerce.number().int() }), req.params);
    const body = parse(z.object({ status: z.enum(['dismissed', 'actioned']), note: z.string().min(3).max(500) }), req.body);
    await withTx(ctx.db, async (tx) => {
      const r = await tx.query("UPDATE suspicious_events SET status=$2, decision_note=$3, reviewed_by=$4, reviewed_at=$5 WHERE id=$1 AND status='open'", [id, body.status, body.note, actor.id, new Date(ctx.now())]);
      if (!r.rowCount) throw notFound('Open event not found');
      await audit(tx, actor.id, 'suspicious.review', 'suspicious_event', String(id), body, ctx.now());
    });
    return { ok: true };
  });

  /** Re-run a stored battle from its recorded inputs and compare with the stored outcome. */
  app.get('/admin/battles/:id/verify', async (req) => {
    requireRole(req, 'moderator');
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    const b = (await ctx.db.query('SELECT input, result, config_version FROM battles WHERE id=$1', [id])).rows[0];
    if (!b) throw notFound('Battle not found');
    if (b.config_version !== ctx.cfg.version) {
      throw new AppError(409, 'CONFIG_CHANGED', `Battle used config ${b.config_version}; current is ${ctx.cfg.version}. Load that config version to verify.`);
    }
    const { result } = simulateBattle(b.input, ctx.cfg);
    return { matches: JSON.stringify(result) === JSON.stringify(b.result), stored: b.result, recomputed: result };
  });

  app.get('/admin/audit', async (req) => {
    requireRole(req, 'admin');
    const { rows } = await ctx.db.query('SELECT a.*, u.username FROM admin_audit_logs a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT 200');
    return { logs: rows };
  });
}
