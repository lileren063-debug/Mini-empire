import { randomUUID } from 'node:crypto';
import {
  DEFAULT_SEASON_SCHEDULE, assertTransition, createStartingKingdom, dueTransitions, validateSchedule,
  type SeasonSchedule, type SeasonState,
} from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import { withTx, type Tx } from '../db.js';
import { AppError } from '../lib/errors.js';
import { audit } from './audit.js';
import { lockRostersAndMatch, finalizeWars } from './clanWar.js';
import { insertStartingKingdom } from './kingdomRepo.js';
import { computeBoard, finalSnapshot, snapshotBoards } from './leaderboards.js';
import { grantAchievement } from './progress.js';
import type { SeasonRow } from './scores.js';
import { ensureTerritories, finalizeTerritories } from './territories.js';

/** Create season 1 if the database has none. */
export async function bootstrapSeason(ctx: AppContext, startAt?: number) {
  await withTx(ctx.db, async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(777)');
    const { rows } = await tx.query('SELECT 1 FROM seasons LIMIT 1');
    if (!rows.length) {
      await tx.query("INSERT INTO seasons (number, starts_at, schedule, state, state_changed_at) VALUES (1,$1,$2,'DEVELOPMENT',$1)", [new Date(startAt ?? ctx.now()), JSON.stringify(DEFAULT_SEASON_SCHEDULE)]);
    }
    await ensureTerritories(tx);
  });
}

async function lockSeason(tx: Tx): Promise<SeasonRow> {
  const { rows } = await tx.query("SELECT * FROM seasons WHERE state <> 'COMPLETED' ORDER BY id DESC LIMIT 1 FOR UPDATE");
  if (!rows[0]) throw new AppError(409, 'NO_OPEN_SEASON', 'There is no open season.');
  return rows[0];
}

/**
 * Enter `to` from the season's current state, running the transition's side effects in the
 * same transaction. Invalid transitions throw before anything changes.
 */
async function enterState(ctx: AppContext, tx: Tx, season: SeasonRow, to: SeasonState, actorId: string | null, reason: string) {
  assertTransition(season.state, to);
  const now = ctx.now();
  const effects: Record<string, unknown> = {};
  if (to === 'WAR_ACTIVE') Object.assign(effects, await lockRostersAndMatch(ctx, tx, season, now));
  if (to === 'RESULT_VERIFICATION') {
    // Award war + territory score while the season is still in a scoring state, then freeze.
    Object.assign(effects, await finalizeWars(ctx, tx, season, now));
    Object.assign(effects, await finalizeTerritories(ctx, tx, season, now));
  }
  await tx.query('UPDATE seasons SET state=$2, state_changed_at=$3 WHERE id=$1', [season.id, to, new Date(now)]);
  await tx.query('INSERT INTO season_transitions (season_id, from_state, to_state, actor_id, reason, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
    season.id, season.state, to, actorId, reason, new Date(now),
  ]);
  season.state = to;
  if (to === 'RESULT_VERIFICATION') {
    await snapshotBoards(tx, season, 'final', now);
    await recordParticipants(tx, season);
  }
  return effects;
}

/** Permanent per-player season record (historical rankings survive resets). */
async function recordParticipants(tx: Tx, season: SeasonRow) {
  const ind = (await finalSnapshot(tx, season.id, 'individual')) ?? [];
  const part = (await finalSnapshot(tx, season.id, 'participation')) ?? [];
  const clans = (await finalSnapshot(tx, season.id, 'clan')) ?? [];
  const { rows } = await tx.query('SELECT k.user_id, k.hq_level, m.clan_id FROM kingdoms k LEFT JOIN clan_memberships m ON m.user_id=k.user_id');
  for (const r of rows) {
    const i = ind.find((e) => e.id === r.user_id);
    const p = part.find((e) => e.id === r.user_id);
    const c = r.clan_id ? clans.find((e) => e.id === r.clan_id) : undefined;
    await tx.query(
      `INSERT INTO season_participants (season_id, user_id, clan_id, hq_level, battle_score, participation_score, battle_rank, participation_rank, clan_rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [season.id, r.user_id, r.clan_id, r.hq_level, i?.score ?? 0, p?.score ?? 0, i?.rank ?? null, p?.rank ?? null, c?.rank ?? null],
    );
  }
}

/** Advance through time-driven transitions that are due. Safe to call repeatedly (idempotent). */
export async function seasonTick(ctx: AppContext): Promise<SeasonState[]> {
  return withTx(ctx.db, async (tx) => {
    const season = await lockSeason(tx).catch(() => null);
    if (!season) return [];
    const due = dueTransitions(season.state, season.starts_at.getTime(), ctx.now(), season.schedule);
    for (const to of due) await enterState(ctx, tx, season, to, null, 'schedule');
    return due;
  });
}

/** Operator-forced transition (e.g. to run a test season). Requires a reason; fully audited. */
export async function forceTransition(ctx: AppContext, actorId: string, to: SeasonState, reason: string) {
  if (to === 'SEASON_RESET' || to === 'COMPLETED' || to === 'REWARD_DISTRIBUTION') {
    throw new AppError(400, 'USE_DEDICATED_ACTION', 'Use reward approval / season reset for this transition.');
  }
  return withTx(ctx.db, async (tx) => {
    const season = await lockSeason(tx);
    const from = season.state;
    const effects = await enterState(ctx, tx, season, to, actorId, `forced: ${reason}`);
    await audit(tx, actorId, 'season.force_transition', 'season', String(season.id), { from, to, reason, effects }, ctx.now());
    return { from, to, effects };
  });
}

/** Change the schedule of a published season (explicit, audited administrative action). */
export async function reschedule(ctx: AppContext, actorId: string, input: { startsAt: number; schedule: SeasonSchedule; reason: string }) {
  const err = validateSchedule(input.schedule);
  if (err) throw new AppError(400, 'INVALID_SCHEDULE', err);
  return withTx(ctx.db, async (tx) => {
    const season = await lockSeason(tx);
    if (season.state !== 'DEVELOPMENT' && season.state !== 'WAR_PREPARATION') throw new AppError(409, 'TOO_LATE', 'The schedule can no longer be changed for this season.');
    await tx.query('UPDATE seasons SET starts_at=$2, schedule=$3 WHERE id=$1', [season.id, new Date(input.startsAt), JSON.stringify(input.schedule)]);
    await audit(tx, actorId, 'season.reschedule', 'season', String(season.id), { before: { startsAt: season.starts_at, schedule: season.schedule }, after: input }, ctx.now());
    return { ok: true };
  });
}

export async function enterRewardDistribution(ctx: AppContext, tx: Tx, actorId: string) {
  const season = await lockSeason(tx);
  await enterState(ctx, tx, season, 'REWARD_DISTRIBUTION', actorId, 'rewards approved');
  return season;
}

/**
 * Seasonal reset. One transaction: archive every kingdom (backup), grant season achievements,
 * reset seasonal progress, clear territories, close the season and open the next one.
 * Idempotent: a second call finds the reset log row (or a COMPLETED season) and does nothing.
 * Permanent data (accounts, token balances, cosmetics, achievements, titles, clan history,
 * leaderboard snapshots, season records) is never touched.
 */
export async function resetSeason(ctx: AppContext, actorId: string | null, opts: { nextStartAt?: number } = {}) {
  return withTx(ctx.db, async (tx) => {
    const { rows } = await tx.query("SELECT * FROM seasons WHERE state IN ('REWARD_DISTRIBUTION','SEASON_RESET') ORDER BY id DESC LIMIT 1 FOR UPDATE");
    const season: SeasonRow | undefined = rows[0];
    if (!season) {
      const last = (await tx.query('SELECT s.id, s.state, l.season_id IS NOT NULL AS done FROM seasons s LEFT JOIN season_reset_log l ON l.season_id = s.id ORDER BY s.id DESC LIMIT 2')).rows;
      if (last.some((r) => r.done)) return { alreadyReset: true };
      throw new AppError(409, 'NOT_READY', 'Rewards must be approved before the season can be reset.');
    }
    const already = await tx.query('SELECT 1 FROM season_reset_log WHERE season_id=$1', [season.id]);
    if (already.rowCount) return { alreadyReset: true };
    const now = ctx.now();
    if (season.state === 'REWARD_DISTRIBUTION') {
      await enterState(ctx, tx, season, 'SEASON_RESET', actorId, 'season reset started');
    }

    // 1. Backup (restorable snapshot of every kingdom).
    await tx.query(
      `INSERT INTO season_archives (season_id, user_id, snapshot, created_at)
       SELECT $1, k.user_id, jsonb_build_object(
                'kingdom', to_jsonb(k), 'balances', to_jsonb(rb),
                'buildings', COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM buildings b WHERE b.kingdom_id = k.id), '[]'::jsonb),
                'construction', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM construction_queues c WHERE c.kingdom_id = k.id), '[]'::jsonb),
                'troops', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM troops t WHERE t.kingdom_id = k.id), '[]'::jsonb),
                'training', COALESCE((SELECT jsonb_agg(to_jsonb(q)) FROM training_queue q WHERE q.kingdom_id = k.id), '[]'::jsonb)), $2
         FROM kingdoms k JOIN resource_balances rb ON rb.kingdom_id = k.id
       ON CONFLICT DO NOTHING`,
      [season.id, new Date(now)],
    );

    // 2. Permanent season rewards (achievements / cosmetics are idempotent inserts).
    const veterans = (await tx.query('SELECT user_id FROM kingdoms WHERE hq_level >= 3')).rows;
    for (const v of veterans) await grantAchievement(tx, v.user_id, 'season_participant', now);
    const clanBoard = (await finalSnapshot(tx, season.id, 'clan')) ?? [];
    if (clanBoard[0]) {
      const champions = (await tx.query('SELECT user_id FROM season_participants WHERE season_id=$1 AND clan_id=$2', [season.id, clanBoard[0].id])).rows;
      for (const c of champions) {
        await tx.query("INSERT INTO cosmetic_inventory (user_id, cosmetic_id, source, acquired_at) VALUES ($1,'frame_champion','season_reward',$2) ON CONFLICT DO NOTHING", [c.user_id, new Date(now)]);
      }
      await tx.query("INSERT INTO clan_events (clan_id, type, details, created_at) VALUES ($1,'season_champion',$2,$3)", [clanBoard[0].id, JSON.stringify({ season: season.number }), new Date(now)]);
    }

    // 3. Open the next season first so kingdoms can point at it.
    await tx.query('UPDATE seasons SET state=$2, state_changed_at=$3 WHERE id=$1', [season.id, 'COMPLETED', new Date(now)]);
    await tx.query("INSERT INTO season_transitions (season_id, from_state, to_state, actor_id, reason, created_at) VALUES ($1,'SEASON_RESET','COMPLETED',$2,'season reset completed',$3)", [season.id, actorId, new Date(now)]);
    const next = (await tx.query("INSERT INTO seasons (number, starts_at, schedule, state, state_changed_at) VALUES ($1,$2,$3,'DEVELOPMENT',$4) RETURNING id", [
      season.number + 1, new Date(opts.nextStartAt ?? now), JSON.stringify(season.schedule), new Date(now),
    ])).rows[0].id as number;

    // 4. Reset seasonal progression.
    await tx.query('DELETE FROM training_queue');
    await tx.query('DELETE FROM construction_queues');
    await tx.query('DELETE FROM buildings');
    const kingdoms = (await tx.query('SELECT id, user_id FROM kingdoms ORDER BY id')).rows;
    for (const k of kingdoms) {
      const state = createStartingKingdom({ now, cfg: ctx.cfg, newId: randomUUID });
      await insertStartingKingdom(tx, k.user_id, next, state, k.id);
    }
    await tx.query('UPDATE territory_ownership_history SET ended_at=$1 WHERE ended_at IS NULL', [new Date(now)]);
    await tx.query('UPDATE territories SET owner_clan_id=NULL, captured_at=NULL, cooldown_until=NULL, season_id=NULL');
    await tx.query('UPDATE clan_memberships SET contribution = 0');

    const stats = { kingdomsReset: kingdoms.length, nextSeasonId: next, champions: clanBoard[0]?.id ?? null };
    await tx.query("INSERT INTO season_reset_log (season_id, status, actor_id, stats, completed_at) VALUES ($1,'completed',$2,$3,$4)", [season.id, actorId, JSON.stringify(stats), new Date(now)]);
    await audit(tx, actorId, 'season.reset', 'season', String(season.id), stats, now);
    return { alreadyReset: false, ...stats };
  });
}

export async function liveBoards(ctx: AppContext, season: SeasonRow) {
  return {
    clan: await computeBoard(ctx.db, season, 'clan', ctx.now()),
    individual: await computeBoard(ctx.db, season, 'individual', ctx.now()),
    participation: await computeBoard(ctx.db, season, 'participation', ctx.now()),
  };
}
