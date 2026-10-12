import { phaseStartAt, generateWarPairings, warOutcome, warScore, warRating, SCORING, type Deployment } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import type { Tx } from '../db.js';
import { AppError, badRequest } from '../lib/errors.js';
import { awardBattleScore, layoutFromState, runBattle, type BattleOutcome } from './battles.js';
import { loadKingdom } from './kingdomRepo.js';
import { addScore, clanOf, currentSeason, type SeasonRow } from './scores.js';

export async function rosterEligibility(ctx: AppContext, tx: Tx, clanId: string, _now: number) {
  const season = await currentSeason(tx);
  const { rows } = await tx.query(
    `SELECT m.user_id, u.username, m.joined_at, k.hq_level, u.suspended, r.user_id IS NOT NULL AS on_roster, r.locked
       FROM clan_memberships m JOIN users u ON u.id=m.user_id JOIN kingdoms k ON k.user_id=m.user_id
       LEFT JOIN clan_war_rosters r ON r.user_id=m.user_id AND r.season_id=$2 AND r.clan_id=m.clan_id
      WHERE m.clan_id=$1 ORDER BY k.hq_level DESC, u.username`,
    [clanId, season.id],
  );
  // Rosters lock when the war phase starts.
  const lockAt = phaseStartAt(season.starts_at.getTime(), season.schedule.warActiveDays[0]);
  return rows.map((r) => {
    const hqOk = r.hq_level >= ctx.cfg.clanWar.minHqLevel;
    const tenureOk = lockAt - r.joined_at.getTime() >= ctx.cfg.clanWar.minMembershipHours * 3_600_000;
    return { userId: r.user_id as string, username: r.username as string, hqLevel: r.hq_level as number, hqOk, tenureOk, eligible: hqOk && tenureOk && !r.suspended, onRoster: r.on_roster as boolean, locked: !!r.locked };
  });
}

/**
 * Roster lock + matchmaking, executed once when the season enters WAR_ACTIVE.
 * Ineligible entries are removed (and logged in the clan history); clans whose valid roster is
 * smaller than the minimum are not entered. Pairing uses roster strength and activity.
 */
export async function lockRostersAndMatch(ctx: AppContext, tx: Tx, season: SeasonRow, now: number) {
  const cw = ctx.cfg.clanWar;
  const entries = (
    await tx.query(
      `SELECT r.user_id, r.clan_id, k.hq_level, k.power, u.suspended, m.clan_id AS member_clan, m.joined_at,
              EXISTS (SELECT 1 FROM battles b WHERE b.attacker_id=r.user_id AND b.created_at > $2::timestamptz - interval '7 days') AS active
         FROM clan_war_rosters r JOIN kingdoms k ON k.user_id=r.user_id JOIN users u ON u.id=r.user_id
         LEFT JOIN clan_memberships m ON m.user_id=r.user_id
        WHERE r.season_id=$1 AND NOT r.locked ORDER BY r.clan_id, r.user_id`,
      [season.id, new Date(now)],
    )
  ).rows;
  const byClan = new Map<string, typeof entries>();
  for (const e of entries) {
    const valid = e.member_clan === e.clan_id && !e.suspended && e.hq_level >= cw.minHqLevel && now - e.joined_at.getTime() >= cw.minMembershipHours * 3_600_000;
    if (!valid) {
      await tx.query('DELETE FROM clan_war_rosters WHERE season_id=$1 AND user_id=$2', [season.id, e.user_id]);
      await tx.query("INSERT INTO clan_events (clan_id, user_id, type, details, created_at) VALUES ($1,$2,'roster_removed_ineligible','{}',$3)", [e.clan_id, e.user_id, new Date(now)]);
      continue;
    }
    if (!byClan.has(e.clan_id)) byClan.set(e.clan_id, []);
    byClan.get(e.clan_id)!.push(e);
  }
  const candidates = [];
  for (const [clanId, list] of byClan) {
    const roster = list.slice(0, cw.maxRosterSize);
    if (roster.length < cw.minRosterSize) {
      await tx.query('DELETE FROM clan_war_rosters WHERE season_id=$1 AND clan_id=$2', [season.id, clanId]);
      await tx.query("INSERT INTO clan_events (clan_id, type, details, created_at) VALUES ($1,'war_not_entered',$2,$3)", [clanId, JSON.stringify({ reason: `roster below ${cw.minRosterSize}` }), new Date(now)]);
      continue;
    }
    for (const r of roster) await tx.query('UPDATE clan_war_rosters SET locked=true, power=$3 WHERE season_id=$1 AND user_id=$2', [season.id, r.user_id, r.power]);
    candidates.push({ clanId, strength: roster.reduce((a, r) => a + r.power, 0), rosterSize: roster.length, activity: roster.filter((r) => r.active).length / roster.length });
  }
  const pairings = generateWarPairings(candidates);
  const rating = new Map(candidates.map((c) => [c.clanId, warRating(c)]));
  for (const p of pairings) {
    await tx.query('INSERT INTO clan_wars (season_id, clan_a, clan_b, status, rating_a, rating_b, outcome, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
      season.id, p.clanA, p.clanB, p.clanB ? 'active' : 'bye', rating.get(p.clanA), p.clanB ? rating.get(p.clanB) : 0, p.clanB ? null : 'BYE', new Date(now),
    ]);
    await tx.query("INSERT INTO clan_events (clan_id, type, details, created_at) VALUES ($1,'war_matched',$2,$3)", [p.clanA, JSON.stringify({ opponent: p.clanB }), new Date(now)]);
    if (p.clanB) await tx.query("INSERT INTO clan_events (clan_id, type, details, created_at) VALUES ($1,'war_matched',$2,$3)", [p.clanB, JSON.stringify({ opponent: p.clanA }), new Date(now)]);
  }
  return { clansEntered: candidates.length, wars: pairings.length };
}

async function warForClan(tx: Tx, seasonId: number, clanId: string) {
  return (await tx.query('SELECT * FROM clan_wars WHERE season_id=$1 AND (clan_a=$2 OR clan_b=$2)', [seasonId, clanId])).rows[0] ?? null;
}

async function warAttacks(tx: Tx, warId: string) {
  return (
    await tx.query(
      `SELECT b.attacker_clan_id AS "clanId", b.defender_id AS "defenderId", b.stars, b.destruction, b.attacker_id FROM battles b WHERE b.war_id=$1`,
      [warId],
    )
  ).rows;
}

export async function warStanding(tx: Tx, ctx: AppContext, war: { id: string; clan_a: string; clan_b: string | null }) {
  const attacks = await warAttacks(tx, war.id);
  const a = warScore(attacks, war.clan_a, ctx.cfg.clanWar.pointsPerStar);
  const b = war.clan_b ? warScore(attacks, war.clan_b, ctx.cfg.clanWar.pointsPerStar) : { stars: 0, points: 0, destruction: 0 };
  return { a, b, attacks };
}

export async function warStatus(ctx: AppContext, tx: Tx, userId: string) {
  const season = await currentSeason(tx);
  const clan = await clanOf(tx, userId);
  if (!clan) return { season: { state: season.state }, clan: null };
  const eligibility = await rosterEligibility(ctx, tx, clan.clanId, ctx.now());
  const war = await warForClan(tx, season.id, clan.clanId);
  let warInfo = null;
  if (war) {
    const mine = war.clan_a === clan.clanId ? 'a' : 'b';
    const oppId = mine === 'a' ? war.clan_b : war.clan_a;
    const { a, b, attacks } = await warStanding(tx, ctx, war);
    const opp = oppId ? (await tx.query('SELECT id, name, tag, emblem FROM clans WHERE id=$1', [oppId])).rows[0] : null;
    const enemyRoster = oppId
      ? (await tx.query('SELECT r.user_id, u.username, k.hq_level, r.power FROM clan_war_rosters r JOIN users u ON u.id=r.user_id JOIN kingdoms k ON k.user_id=r.user_id WHERE r.season_id=$1 AND r.clan_id=$2 AND r.locked ORDER BY r.power DESC', [season.id, oppId])).rows
      : [];
    const myAttacks = attacks.filter((x) => x.attacker_id === userId).length;
    const onRoster = eligibility.find((e) => e.userId === userId)?.locked ?? false;
    warInfo = {
      id: war.id,
      status: war.status,
      outcome: war.outcome,
      opponent: opp,
      myScore: mine === 'a' ? a : b,
      enemyScore: mine === 'a' ? b : a,
      enemyRoster: enemyRoster.map((r) => ({ ...r, bestStarsAgainst: Math.max(0, ...attacks.filter((x) => x.clanId === clan.clanId && x.defenderId === r.user_id).map((x) => x.stars)) })),
      attacksLeft: onRoster ? Math.max(0, ctx.cfg.clanWar.attacksPerMember - myAttacks) : 0,
      onRoster,
    };
  }
  return { season: { state: season.state }, clan: { id: clan.clanId, role: clan.role }, rules: ctx.cfg.clanWar, eligibility, war: warInfo };
}

export async function attackWarOpponent(ctx: AppContext, tx: Tx, userId: string, defenderId: string, deployments: Deployment[]): Promise<BattleOutcome> {
  const season = await currentSeason(tx);
  if (season.state !== 'WAR_ACTIVE') throw new AppError(409, 'NOT_WAR_TIME', 'Clan war battles are only possible during the war phase.');
  const clan = await clanOf(tx, userId);
  if (!clan) throw badRequest('NO_CLAN', 'You are not in a clan.');
  const war = await warForClan(tx, season.id, clan.clanId);
  if (!war || war.status !== 'active') throw badRequest('NO_WAR', 'Your clan has no active war.');
  // Serialise this clan's war attacks so the attack limit cannot be raced.
  await tx.query('SELECT id FROM clan_wars WHERE id=$1 FOR UPDATE', [war.id]);
  const me = await tx.query('SELECT 1 FROM clan_war_rosters WHERE season_id=$1 AND user_id=$2 AND clan_id=$3 AND locked', [season.id, userId, clan.clanId]);
  if (!me.rowCount) throw badRequest('NOT_ON_ROSTER', 'You are not on your clan\'s locked war roster.');
  const oppId = war.clan_a === clan.clanId ? war.clan_b : war.clan_a;
  const def = await tx.query('SELECT 1 FROM clan_war_rosters WHERE season_id=$1 AND user_id=$2 AND clan_id=$3 AND locked', [season.id, defenderId, oppId]);
  if (!def.rowCount) throw badRequest('NOT_ENEMY', 'That player is not on the enemy war roster.');
  const used = await tx.query('SELECT count(*)::int AS n FROM battles WHERE war_id=$1 AND attacker_id=$2', [war.id, userId]);
  if (used.rows[0].n >= ctx.cfg.clanWar.attacksPerMember) throw badRequest('NO_ATTACKS_LEFT', 'You have used all your war attacks.');
  const defK = await loadKingdom(tx, defenderId, false);
  return runBattle(ctx, tx, userId, {
    kind: 'war',
    defense: layoutFromState(defK.state),
    deployments,
    defenderId,
    warId: war.id,
    settleRewards: async (r, _att, battleId) => {
      const scorePoints = await awardBattleScore(tx, ctx, userId, battleId, r.stars * SCORING.individual.warPointsPerStar, 'war');
      return { rewards: { gold: 0, wood: 0, stone: 0 }, scorePoints, notes: ['War battles do not loot resources.'] };
    },
  });
}

/**
 * Close all wars of the season: compute results, award clan score (best stars per defender +
 * win/draw bonus) and write clan history. Idempotent: finished wars are skipped.
 */
export async function finalizeWars(ctx: AppContext, tx: Tx, season: SeasonRow, now: number) {
  const wars = (await tx.query("SELECT * FROM clan_wars WHERE season_id=$1 AND status='active' FOR UPDATE", [season.id])).rows;
  for (const w of wars) {
    const { a, b } = await warStanding(tx, ctx, w);
    const outcome = a.stars === 0 && b.stars === 0 ? 'DRAW' : warOutcome(a, b);
    await tx.query("UPDATE clan_wars SET status='finished', points_a=$2, points_b=$3, destruction_a=$4, destruction_b=$5, outcome=$6, finished_at=$7 WHERE id=$1", [
      w.id, a.points, b.points, a.destruction, b.destruction, outcome, new Date(now),
    ]);
    const noContest = a.stars === 0 && b.stars === 0;
    for (const [clanId, s, won] of [[w.clan_a, a, outcome === 'A'], [w.clan_b, b, outcome === 'B']] as const) {
      const bonus = won ? ctx.cfg.clanWar.winBonus : outcome === 'DRAW' && !noContest ? ctx.cfg.clanWar.drawBonus : 0;
      await addScore(tx, { seasonId: season.id, userId: null, clanId, category: 'clan', points: s.stars * SCORING.clan.warStar + bonus, source: 'war', ref: `war:${w.id}:${clanId}` }, now);
      await tx.query("INSERT INTO clan_events (clan_id, type, details, created_at) VALUES ($1,'war_finished',$2,$3)", [clanId, JSON.stringify({ warId: w.id, outcome, won, points: s.points }), new Date(now)]);
    }
  }
  return { finalized: wars.length };
}
