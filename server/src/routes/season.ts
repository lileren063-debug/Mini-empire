import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REWARD_ALLOCATION, SCORING_EXPLANATION, TOKEN_UNIT, phaseTimeline, seasonDay, seasonEndAt } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { parse, requireUser } from '../lib/http.js';
import { computeBoard, type Board } from '../services/leaderboards.js';
import { currentSeason } from '../services/scores.js';

export async function seasonRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/season', async (req) => {
    const user = requireUser(req);
    const s = await currentSeason(ctx.db);
    const start = s.starts_at.getTime();
    const now = ctx.now();
    const mine = (await ctx.db.query('SELECT category, COALESCE(sum(points),0)::int AS p FROM score_events WHERE season_id=$1 AND user_id=$2 GROUP BY category', [s.id, user.id])).rows;
    const token = (await ctx.db.query('SELECT units::text AS units FROM token_balances WHERE user_id=$1', [user.id])).rows[0];
    return {
      season: { id: s.id, number: s.number, state: s.state, startsAt: start, endsAt: seasonEndAt(start, s.schedule), day: Math.min(s.schedule.lengthDays, Math.max(1, seasonDay(start, now))), lengthDays: s.schedule.lengthDays, schedule: s.schedule },
      timeline: phaseTimeline(start, s.schedule),
      serverTime: now,
      scoring: SCORING_EXPLANATION,
      myScores: {
        battle: mine.find((m) => m.category === 'battle')?.p ?? 0,
        participation: mine.find((m) => m.category === 'participation')?.p ?? 0,
      },
      rewards: {
        simulated: true,
        disclaimer: 'Rewards are a simulated test ledger. Allocation percentages are an illustrative, configurable example — not a funded commitment, not a price and not a promise of any financial return.',
        allocation: REWARD_ALLOCATION,
        myTestBalance: token ? Number(BigInt(token.units) / BigInt(TOKEN_UNIT)) : 0,
      },
    };
  });

  app.get('/leaderboards/:board', async (req) => {
    const user = requireUser(req);
    const { board } = parse(z.object({ board: z.enum(['clan', 'individual', 'participation']) }), req.params);
    const s = await currentSeason(ctx.db);
    const entries = await computeBoard(ctx.db, s, board as Board, ctx.now());
    let meId: string = user.id;
    if (board === 'clan') {
      const m = (await ctx.db.query('SELECT clan_id FROM clan_memberships WHERE user_id=$1', [user.id])).rows[0];
      meId = m?.clan_id ?? '';
    }
    return { board, entries: entries.slice(0, 100), me: entries.find((e) => e.id === meId) ?? null, total: entries.length };
  });

  app.get('/season/history', async (req) => {
    requireUser(req);
    const seasons = (await ctx.db.query("SELECT id, number, starts_at, state FROM seasons ORDER BY id DESC LIMIT 10")).rows;
    const snaps = (await ctx.db.query("SELECT season_id, board, entries FROM leaderboard_snapshots WHERE reason='final' AND season_id = ANY($1)", [seasons.map((s) => s.id)])).rows;
    return {
      seasons: seasons.map((s) => ({
        ...s,
        top: Object.fromEntries(snaps.filter((x) => x.season_id === s.id).map((x) => [x.board, (x.entries as unknown[]).slice(0, 10)])),
      })),
    };
  });
}
