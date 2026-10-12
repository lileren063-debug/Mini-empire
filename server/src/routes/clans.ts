import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CLAN_EMBLEM_COLORS, CLAN_EMBLEM_ICONS, spend } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { withTx, type Tx } from '../db.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { limit, mutation, parse, requireUser } from '../lib/http.js';
import { withKingdom } from '../services/kingdomService.js';
import { grantAchievement } from '../services/progress.js';
import { clanOf, currentSeason } from '../services/scores.js';
import { attackWarOpponent, rosterEligibility, warStatus } from '../services/clanWar.js';
import { deploymentsSchema } from './battles.js';

export const MAX_CLAN_MEMBERS = 30;

const emblem = z.object({ icon: z.enum(CLAN_EMBLEM_ICONS), color: z.enum(CLAN_EMBLEM_COLORS) });
const clanName = z.string().trim().min(3).max(24).regex(/^[\p{L}\p{N} _'-]+$/u, 'letters, digits, spaces, _ - \' only');
const clanTag = z.string().trim().min(2).max(5).regex(/^[A-Za-z0-9]+$/, 'letters and digits only').transform((s) => s.toUpperCase());

async function event(tx: Tx, clanId: string, userId: string | null, type: string, details: Record<string, unknown>, now: number) {
  await tx.query('INSERT INTO clan_events (clan_id, user_id, type, details, created_at) VALUES ($1,$2,$3,$4,$5)', [clanId, userId, type, JSON.stringify(details), new Date(now)]);
}

/** Lock the actor's membership + clan row; returns the actor's role. */
async function lockMyClan(tx: Tx, userId: string) {
  const m = await clanOf(tx, userId);
  if (!m) throw badRequest('NO_CLAN', 'You are not in a clan.');
  await tx.query('SELECT id FROM clans WHERE id=$1 FOR UPDATE', [m.clanId]);
  const fresh = await tx.query('SELECT role FROM clan_memberships WHERE user_id=$1 AND clan_id=$2', [userId, m.clanId]);
  if (!fresh.rows[0]) throw badRequest('NO_CLAN', 'You are not in a clan.');
  return { clanId: m.clanId, role: fresh.rows[0].role as 'leader' | 'officer' | 'member' };
}

/** Remove a member's unlocked war roster entry when they leave. Locked rosters are history. */
async function dropUnlockedRoster(tx: Tx, userId: string) {
  await tx.query('DELETE FROM clan_war_rosters WHERE user_id=$1 AND NOT locked', [userId]);
}

export async function clanRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/clans', async (req) => {
    requireUser(req);
    const q = parse(z.object({ search: z.string().max(30).optional() }), req.query);
    const season = await currentSeason(ctx.db);
    const { rows } = await ctx.db.query(
      `SELECT c.id, c.name, c.tag, c.description, c.emblem, c.join_policy,
              (SELECT count(*)::int FROM clan_memberships m WHERE m.clan_id = c.id) AS members,
              (SELECT COALESCE(sum(points),0)::int FROM score_events s WHERE s.clan_id = c.id AND s.category='clan' AND s.season_id=$2) AS score
         FROM clans c WHERE c.disbanded_at IS NULL AND ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.tag ILIKE '%' || $1 || '%')
        ORDER BY score DESC, c.created_at LIMIT 50`,
      [q.search ?? null, season.id],
    );
    return { clans: rows };
  });

  app.get('/clans/mine', async (req) => {
    const user = requireUser(req);
    const m = await clanOf(ctx.db, user.id);
    if (!m) return { clan: null };
    return { clan: await clanDetails(ctx, m.clanId, user.id), myRole: m.role };
  });

  app.get('/clans/:id', async (req) => {
    const user = requireUser(req);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return { clan: await clanDetails(ctx, id, user.id) };
  });

  app.post('/clans', async (req) => {
    limit(ctx, req, 'clan', 30, 60_000);
    const body = parse(z.object({ name: clanName, tag: clanTag, description: z.string().max(300).default(''), emblem, joinPolicy: z.enum(['open', 'closed']).default('open') }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const now = ctx.now();
      if (await clanOf(tx, user.id)) throw conflict('ALREADY_IN_CLAN', 'Leave your current clan first.');
      const dup = await tx.query('SELECT 1 FROM clans WHERE disbanded_at IS NULL AND (lower(name)=lower($1) OR upper(tag)=upper($2))', [body.name, body.tag]);
      if (dup.rowCount) throw conflict('CLAN_EXISTS', 'A clan with that name or tag already exists.');
      await withKingdom(ctx, tx, user.id, 'clan_creation', (s) => {
        spend(s.resources, ctx.cfg.economy.clanCreationCost);
        return { result: null };
      });
      const clanId = (await tx.query('INSERT INTO clans (name, tag, description, emblem, join_policy, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [
        body.name, body.tag, body.description, JSON.stringify(body.emblem), body.joinPolicy, user.id, new Date(now),
      ])).rows[0].id;
      await tx.query("INSERT INTO clan_memberships (user_id, clan_id, role, joined_at) VALUES ($1,$2,'leader',$3)", [user.id, clanId, new Date(now)]);
      await event(tx, clanId, user.id, 'founded', { name: body.name, tag: body.tag }, now);
      await grantAchievement(tx, user.id, 'clan_founder', now);
      return { clanId };
    });
  });

  app.post('/clans/:id/join', async (req) => {
    limit(ctx, req, 'clan', 30, 60_000);
    const { id } = parse(z.object({ id: z.string().uuid() }), req.params);
    return mutation(ctx, req, async (tx, user) => {
      const now = ctx.now();
      const c = (await tx.query('SELECT id, join_policy FROM clans WHERE id=$1 AND disbanded_at IS NULL FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('Clan not found');
      if (await clanOf(tx, user.id)) throw conflict('ALREADY_IN_CLAN', 'Leave your current clan first.');
      const count = (await tx.query('SELECT count(*)::int AS n FROM clan_memberships WHERE clan_id=$1', [id])).rows[0].n;
      if (count >= MAX_CLAN_MEMBERS) throw badRequest('CLAN_FULL', 'That clan is full.');
      if (c.join_policy === 'closed') {
        await tx.query('INSERT INTO clan_join_requests (clan_id, user_id, created_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, user.id, new Date(now)]);
        return { status: 'requested' };
      }
      await tx.query("INSERT INTO clan_memberships (user_id, clan_id, role, joined_at) VALUES ($1,$2,'member',$3)", [user.id, id, new Date(now)]);
      await tx.query('DELETE FROM clan_join_requests WHERE user_id=$1', [user.id]);
      await event(tx, id, user.id, 'joined', {}, now);
      return { status: 'joined' };
    });
  });

  app.post('/clans/requests/:userId/:decision', async (req) => {
    const p = parse(z.object({ userId: z.string().uuid(), decision: z.enum(['approve', 'reject']) }), req.params);
    return mutation(ctx, req, async (tx, user) => {
      const now = ctx.now();
      const me = await lockMyClan(tx, user.id);
      if (me.role === 'member') throw forbidden('Only leaders and officers can handle join requests.');
      const r = await tx.query('DELETE FROM clan_join_requests WHERE clan_id=$1 AND user_id=$2', [me.clanId, p.userId]);
      if (!r.rowCount) throw notFound('Join request not found');
      if (p.decision === 'reject') return { status: 'rejected' };
      if (await clanOf(tx, p.userId)) throw conflict('ALREADY_IN_CLAN', 'That player already joined another clan.');
      const count = (await tx.query('SELECT count(*)::int AS n FROM clan_memberships WHERE clan_id=$1', [me.clanId])).rows[0].n;
      if (count >= MAX_CLAN_MEMBERS) throw badRequest('CLAN_FULL', 'Your clan is full.');
      await tx.query("INSERT INTO clan_memberships (user_id, clan_id, role, joined_at) VALUES ($1,$2,'member',$3)", [p.userId, me.clanId, new Date(now)]);
      await tx.query('DELETE FROM clan_join_requests WHERE user_id=$1', [p.userId]);
      await event(tx, me.clanId, p.userId, 'joined', { approvedBy: user.id }, now);
      return { status: 'approved' };
    });
  });

  app.post('/clans/leave', async (req) => {
    return mutation(ctx, req, async (tx, user) => {
      const now = ctx.now();
      const me = await lockMyClan(tx, user.id);
      const count = (await tx.query('SELECT count(*)::int AS n FROM clan_memberships WHERE clan_id=$1', [me.clanId])).rows[0].n;
      if (me.role === 'leader' && count > 1) throw badRequest('LEADER_MUST_TRANSFER', 'Transfer leadership before leaving.');
      await tx.query('DELETE FROM clan_memberships WHERE user_id=$1', [user.id]);
      await dropUnlockedRoster(tx, user.id);
      await event(tx, me.clanId, user.id, 'left', {}, now);
      if (count === 1) {
        await tx.query('UPDATE clans SET disbanded_at=$2 WHERE id=$1', [me.clanId, new Date(now)]);
        await tx.query('DELETE FROM clan_join_requests WHERE clan_id=$1', [me.clanId]);
        await event(tx, me.clanId, user.id, 'disbanded', {}, now);
      }
      return { ok: true };
    });
  });

  app.post('/clans/members/:userId/role', async (req) => {
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.params);
    const body = parse(z.object({ role: z.enum(['officer', 'member']) }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const me = await lockMyClan(tx, user.id);
      if (me.role !== 'leader') throw forbidden('Only the leader can change roles.');
      if (userId === user.id) throw badRequest('INVALID_TARGET', 'Use leadership transfer instead.');
      const r = await tx.query("UPDATE clan_memberships SET role=$3 WHERE user_id=$1 AND clan_id=$2 AND role <> 'leader'", [userId, me.clanId, body.role]);
      if (!r.rowCount) throw notFound('Member not found');
      await event(tx, me.clanId, userId, body.role === 'officer' ? 'promoted' : 'demoted', { by: user.id }, ctx.now());
      return { ok: true };
    });
  });

  app.post('/clans/members/:userId/kick', async (req) => {
    const { userId } = parse(z.object({ userId: z.string().uuid() }), req.params);
    return mutation(ctx, req, async (tx, user) => {
      const me = await lockMyClan(tx, user.id);
      if (userId === user.id) throw badRequest('INVALID_TARGET', 'Use leave instead.');
      const target = (await tx.query('SELECT role FROM clan_memberships WHERE user_id=$1 AND clan_id=$2', [userId, me.clanId])).rows[0];
      if (!target) throw notFound('Member not found');
      const allowed = me.role === 'leader' || (me.role === 'officer' && target.role === 'member');
      if (!allowed) throw forbidden('You cannot kick that member.');
      await tx.query('DELETE FROM clan_memberships WHERE user_id=$1', [userId]);
      await dropUnlockedRoster(tx, userId);
      await event(tx, me.clanId, userId, 'kicked', { by: user.id }, ctx.now());
      return { ok: true };
    });
  });

  app.post('/clans/transfer', async (req) => {
    const body = parse(z.object({ userId: z.string().uuid() }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const me = await lockMyClan(tx, user.id);
      if (me.role !== 'leader') throw forbidden('Only the leader can transfer leadership.');
      if (body.userId === user.id) throw badRequest('INVALID_TARGET', 'You are already the leader.');
      const t = await tx.query('SELECT 1 FROM clan_memberships WHERE user_id=$1 AND clan_id=$2', [body.userId, me.clanId]);
      if (!t.rowCount) throw notFound('Member not found');
      await tx.query("UPDATE clan_memberships SET role='officer' WHERE user_id=$1", [user.id]);
      await tx.query("UPDATE clan_memberships SET role='leader' WHERE user_id=$1", [body.userId]);
      await event(tx, me.clanId, body.userId, 'leadership_transferred', { from: user.id }, ctx.now());
      return { ok: true };
    });
  });

  app.put('/clans/settings', async (req) => {
    const body = parse(z.object({ description: z.string().max(300).optional(), emblem: emblem.optional(), joinPolicy: z.enum(['open', 'closed']).optional() }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const me = await lockMyClan(tx, user.id);
      if (me.role === 'member') throw forbidden('Only leaders and officers can edit clan settings.');
      await tx.query('UPDATE clans SET description=COALESCE($2,description), emblem=COALESCE($3,emblem), join_policy=COALESCE($4,join_policy) WHERE id=$1', [
        me.clanId, body.description ?? null, body.emblem ? JSON.stringify(body.emblem) : null, body.joinPolicy ?? null,
      ]);
      await event(tx, me.clanId, user.id, 'settings_changed', body, ctx.now());
      return { ok: true };
    });
  });

  // ------------------------------------------------------------------ chat (polling-based)
  app.get('/clans/chat', async (req) => {
    const user = requireUser(req);
    const q = parse(z.object({ after: z.coerce.number().int().min(0).default(0) }), req.query);
    const m = await clanOf(ctx.db, user.id);
    if (!m) throw badRequest('NO_CLAN', 'You are not in a clan.');
    const { rows } = await ctx.db.query(
      `SELECT * FROM (SELECT cm.id, cm.body, cm.created_at, u.username, cm.user_id FROM clan_messages cm JOIN users u ON u.id = cm.user_id
        WHERE cm.clan_id=$1 AND cm.id > $2 ORDER BY cm.id DESC LIMIT 50) t ORDER BY id`,
      [m.clanId, q.after],
    );
    return { messages: rows };
  });

  app.post('/clans/chat', async (req) => {
    limit(ctx, req, 'chat', 10, 60_000);
    const body = parse(z.object({ body: z.string().trim().min(1).max(500) }), req.body);
    const user = requireUser(req);
    return withTx(ctx.db, async (tx) => {
      const m = await clanOf(tx, user.id);
      if (!m) throw badRequest('NO_CLAN', 'You are not in a clan.');
      const r = await tx.query('INSERT INTO clan_messages (clan_id, user_id, body, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [m.clanId, user.id, body.body, new Date(ctx.now())]);
      return { id: r.rows[0].id };
    });
  });

  // ------------------------------------------------------------------ clan war
  app.get('/clans/war', async (req) => {
    const user = requireUser(req);
    return withTx(ctx.db, (tx) => warStatus(ctx, tx, user.id));
  });

  app.put('/clans/war/roster', async (req) => {
    const body = parse(z.object({ userIds: z.array(z.string().uuid()).max(50) }), req.body);
    return mutation(ctx, req, async (tx, user) => {
      const now = ctx.now();
      const me = await lockMyClan(tx, user.id);
      if (me.role === 'member') throw forbidden('Only leaders and officers can edit the war roster.');
      const season = await currentSeason(tx);
      if (!['DEVELOPMENT', 'WAR_PREPARATION'].includes(season.state)) throw new AppError(409, 'ROSTER_LOCKED', 'The war roster is locked for this season.');
      const ids = [...new Set(body.userIds)];
      if (ids.length > ctx.cfg.clanWar.maxRosterSize) throw badRequest('ROSTER_TOO_BIG', `At most ${ctx.cfg.clanWar.maxRosterSize} players.`);
      const elig = await rosterEligibility(ctx, tx, me.clanId, now);
      for (const id of ids) {
        const e = elig.find((x) => x.userId === id);
        if (!e) throw badRequest('NOT_A_MEMBER', 'Roster players must be clan members.');
        if (!e.hqOk) throw badRequest('NOT_ELIGIBLE', `${e.username} needs Headquarters level ${ctx.cfg.clanWar.minHqLevel}.`);
      }
      await tx.query('DELETE FROM clan_war_rosters WHERE season_id=$1 AND clan_id=$2 AND NOT locked', [season.id, me.clanId]);
      for (const id of ids) {
        await tx.query('INSERT INTO clan_war_rosters (season_id, user_id, clan_id, added_by, added_at) VALUES ($1,$2,$3,$4,$5)', [season.id, id, me.clanId, user.id, new Date(now)]);
      }
      await event(tx, me.clanId, user.id, 'roster_updated', { size: ids.length }, now);
      return { ok: true, roster: ids };
    });
  });

  app.post('/clans/war/attack', async (req) => {
    limit(ctx, req, 'battle', 20, 60_000);
    const body = parse(z.object({ defenderId: z.string().uuid(), deployments: deploymentsSchema }), req.body);
    return mutation(ctx, req, (tx, user) => attackWarOpponent(ctx, tx, user.id, body.defenderId, body.deployments));
  });
}

async function clanDetails(ctx: AppContext, clanId: string, viewerId: string) {
  const c = (await ctx.db.query('SELECT id, name, tag, description, emblem, join_policy, created_at, disbanded_at FROM clans WHERE id=$1', [clanId])).rows[0];
  if (!c) throw notFound('Clan not found');
  const season = await currentSeason(ctx.db);
  const members = (
    await ctx.db.query(
      `SELECT m.user_id, u.username, m.role, m.joined_at, m.contribution, k.hq_level, p.avatar
         FROM clan_memberships m JOIN users u ON u.id=m.user_id JOIN kingdoms k ON k.user_id=m.user_id JOIN player_profiles p ON p.user_id=m.user_id
        WHERE m.clan_id=$1 ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END, m.contribution DESC, m.joined_at`,
      [clanId],
    )
  ).rows;
  const viewer = members.find((m) => m.user_id === viewerId);
  const requests = viewer && viewer.role !== 'member'
    ? (await ctx.db.query('SELECT r.user_id, u.username, r.created_at, k.hq_level FROM clan_join_requests r JOIN users u ON u.id=r.user_id JOIN kingdoms k ON k.user_id=r.user_id WHERE r.clan_id=$1 ORDER BY r.created_at', [clanId])).rows
    : [];
  const events = (await ctx.db.query('SELECT e.type, e.details, e.created_at, u.username FROM clan_events e LEFT JOIN users u ON u.id=e.user_id WHERE e.clan_id=$1 ORDER BY e.id DESC LIMIT 30', [clanId])).rows;
  const score = (await ctx.db.query("SELECT COALESCE(sum(points),0)::int AS s FROM score_events WHERE clan_id=$1 AND category='clan' AND season_id=$2", [clanId, season.id])).rows[0].s;
  const history = (
    await ctx.db.query(
      `SELECT s.number AS season, e->>'rank' AS rank, e->>'score' AS score FROM leaderboard_snapshots ls JOIN seasons s ON s.id=ls.season_id,
              jsonb_array_elements(ls.entries) e WHERE ls.board='clan' AND ls.reason='final' AND e->>'id' = $1 ORDER BY s.number DESC`,
      [clanId],
    )
  ).rows;
  const wars = (
    await ctx.db.query(
      `SELECT w.id, s.number AS season, w.outcome, w.points_a, w.points_b, w.clan_a, w.clan_b, ca.name AS name_a, cb.name AS name_b
         FROM clan_wars w JOIN seasons s ON s.id=w.season_id JOIN clans ca ON ca.id=w.clan_a LEFT JOIN clans cb ON cb.id=w.clan_b
        WHERE w.clan_a=$1 OR w.clan_b=$1 ORDER BY w.created_at DESC LIMIT 10`,
      [clanId],
    )
  ).rows;
  return { ...c, members, requests, events, seasonScore: score, seasonHistory: history, wars };
}
