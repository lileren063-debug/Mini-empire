import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { grantResources, nextDailyReset, nextWeeklyReset, periodKey } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { mutation, parse, requireUser } from '../lib/http.js';
import { withKingdom } from '../services/kingdomService.js';
import { addScore, clanOf, currentSeason } from '../services/scores.js';

export async function missionRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/missions', async (req) => {
    const user = requireUser(req);
    const now = ctx.now();
    const keys = [periodKey('daily', now), periodKey('weekly', now)];
    const { rows } = await ctx.db.query('SELECT mission_id, period_key, progress, claimed_at FROM mission_progress WHERE user_id=$1 AND period_key = ANY($2)', [user.id, keys]);
    const prog = new Map(rows.map((r) => [`${r.mission_id}|${r.period_key}`, r]));
    const missions = ctx.cfg.missions.filter((m) => m.enabled).map((m) => {
      const p = prog.get(`${m.id}|${periodKey(m.period, now)}`);
      return { ...m, progress: p?.progress ?? 0, claimed: !!p?.claimed_at, resetsAt: m.period === 'daily' ? nextDailyReset(now) : nextWeeklyReset(now) };
    });
    const clan = await clanOf(ctx.db, user.id);
    let clanMissions: unknown[] = [];
    if (clan) {
      const wk = periodKey('weekly', now);
      const cp = await ctx.db.query('SELECT mission_id, progress, completed_at FROM clan_mission_progress WHERE clan_id=$1 AND period_key=$2', [clan.clanId, wk]);
      const mine = await ctx.db.query('SELECT mission_id, amount FROM clan_mission_contributors WHERE clan_id=$1 AND user_id=$2 AND period_key=$3', [clan.clanId, user.id, wk]);
      const claims = await ctx.db.query('SELECT mission_id FROM clan_mission_claims WHERE user_id=$1 AND period_key=$2', [user.id, wk]);
      clanMissions = ctx.cfg.clanMissions.map((m) => {
        const p = cp.rows.find((r) => r.mission_id === m.id);
        return {
          ...m,
          progress: p?.progress ?? 0,
          completed: !!p?.completed_at,
          myContribution: mine.rows.find((r) => r.mission_id === m.id)?.amount ?? 0,
          claimed: claims.rows.some((r) => r.mission_id === m.id),
          resetsAt: nextWeeklyReset(now),
        };
      });
    }
    return { missions, clanMissions, serverTime: now };
  });

  app.post('/missions/:id/claim', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const def = ctx.cfg.missions.find((m) => m.id === id && m.enabled);
    if (!def) throw notFound('Unknown mission');
    return mutation(ctx, req, async (tx, user) => {
      const now = ctx.now();
      const pk = periodKey(def.period, now);
      // Row lock + claimed_at check: the same reward can only ever be claimed once per period.
      const { rows } = await tx.query('SELECT progress, claimed_at FROM mission_progress WHERE user_id=$1 AND mission_id=$2 AND period_key=$3 FOR UPDATE', [user.id, id, pk]);
      const p = rows[0];
      if (!p || p.progress < def.target) throw badRequest('NOT_COMPLETE', 'This mission is not complete yet.');
      if (p.claimed_at) throw new AppError(409, 'ALREADY_CLAIMED', 'You already claimed this reward.');
      await tx.query('UPDATE mission_progress SET claimed_at=$4 WHERE user_id=$1 AND mission_id=$2 AND period_key=$3', [user.id, id, pk, new Date(now)]);
      const r = await withKingdom(ctx, tx, user.id, 'mission_reward', (s) => ({ result: grantResources(s, ctx.cfg, def.reward), ref: `${id}:${pk}` }));
      const season = await currentSeason(tx);
      await addScore(tx, { seasonId: season.id, userId: user.id, clanId: null, category: 'participation', points: def.participationPoints, source: 'mission', ref: `mission:${user.id}:${id}:${pk}` }, now);
      return { credited: r.result, resources: r.state.resources };
    });
  });

  app.post('/clan-missions/:id/claim', async (req) => {
    const { id } = parse(z.object({ id: z.string().max(40) }), req.params);
    const def = ctx.cfg.clanMissions.find((m) => m.id === id);
    if (!def) throw notFound('Unknown clan mission');
    return mutation(ctx, req, async (tx, user) => {
      const now = ctx.now();
      const pk = periodKey('weekly', now);
      const clan = await clanOf(tx, user.id);
      if (!clan) throw badRequest('NO_CLAN', 'You are not in a clan.');
      const prog = await tx.query('SELECT completed_at FROM clan_mission_progress WHERE clan_id=$1 AND mission_id=$2 AND period_key=$3', [clan.clanId, id, pk]);
      if (!prog.rows[0]?.completed_at) throw badRequest('NOT_COMPLETE', 'Your clan has not completed this mission yet.');
      const contrib = await tx.query('SELECT amount FROM clan_mission_contributors WHERE clan_id=$1 AND user_id=$2 AND mission_id=$3 AND period_key=$4', [clan.clanId, user.id, id, pk]);
      if (!contrib.rows[0]?.amount) throw badRequest('NO_CONTRIBUTION', 'Only members who contributed can claim this reward.');
      const ins = await tx.query('INSERT INTO clan_mission_claims (user_id, clan_id, mission_id, period_key, claimed_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [user.id, clan.clanId, id, pk, new Date(now)]);
      if (!ins.rowCount) throw new AppError(409, 'ALREADY_CLAIMED', 'You already claimed this reward.');
      const r = await withKingdom(ctx, tx, user.id, 'clan_mission_reward', (s) => ({ result: grantResources(s, ctx.cfg, def.memberReward), ref: `${id}:${pk}` }));
      return { credited: r.result, resources: r.state.resources };
    });
  });
}
