import { SCORING, TERRITORIES, TERRITORY_RULES, territoryGarrison, type Deployment } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import type { Tx } from '../db.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { awardBattleScore, runBattle, type BattleOutcome } from './battles.js';
import { grantAchievement, recordProgress } from './progress.js';
import { addScore, clanOf, currentSeason, type SeasonRow } from './scores.js';
import { loadKingdom } from './kingdomRepo.js';
import { hqLevel } from '@mini-empire/shared';

export const TERRITORY_MIN_HQ = 3;

export async function ensureTerritories(db: Pick<Tx, 'query'>) {
  for (const t of TERRITORIES) await db.query('INSERT INTO territories (id) VALUES ($1) ON CONFLICT DO NOTHING', [t.id]);
}

export function garrisonLevel(def: (typeof TERRITORIES)[number], owned: boolean) {
  return def.garrisonLevel + (owned ? TERRITORY_RULES.ownedGarrisonBonus : 0);
}

export async function worldMap(ctx: AppContext, tx: Tx, userId: string) {
  const season = await currentSeason(tx);
  const rows = (
    await tx.query(
      `SELECT t.id, t.owner_clan_id, t.captured_at, t.cooldown_until, c.name AS owner_name, c.tag AS owner_tag, c.emblem AS owner_emblem
         FROM territories t LEFT JOIN clans c ON c.id = t.owner_clan_id`,
    )
  ).rows;
  const clan = await clanOf(tx, userId);
  const attempts = (
    await tx.query("SELECT territory_id, count(*)::int AS n FROM battles WHERE attacker_id=$1 AND kind='territory' AND created_at >= date_trunc('day', $2::timestamptz) GROUP BY territory_id", [userId, new Date(ctx.now()).toISOString()])
  ).rows;
  const holds = await territoryHoldPoints(tx, season, ctx.now());
  return {
    season: { state: season.state },
    attacksOpen: season.state === 'WAR_ACTIVE',
    rules: { ...TERRITORY_RULES, minHq: TERRITORY_MIN_HQ, holdPointsPerHour: SCORING.clan.territoryHoldPerHour },
    myClanId: clan?.clanId ?? null,
    territories: TERRITORIES.map((def) => {
      const r = rows.find((x) => x.id === def.id);
      const myAttempts = attempts.find((a) => a.territory_id === def.id)?.n ?? 0;
      return {
        ...def,
        ownerClanId: r?.owner_clan_id ?? null,
        owner: r?.owner_clan_id ? { name: r.owner_name, tag: r.owner_tag, emblem: r.owner_emblem } : null,
        capturedAt: r?.captured_at ?? null,
        cooldownUntil: r?.cooldown_until ?? null,
        status: !r?.owner_clan_id ? 'neutral' : r.cooldown_until && r.cooldown_until.getTime() > ctx.now() ? 'protected' : 'contested',
        effectiveGarrison: garrisonLevel(def, !!r?.owner_clan_id),
        myAttemptsLeft: Math.max(0, TERRITORY_RULES.attemptsPerPlayerPerDay - myAttempts),
        holdPoints: holds.filter((h) => h.territoryId === def.id),
        layout: territoryGarrison(garrisonLevel(def, !!r?.owner_clan_id)),
      };
    }),
  };
}

export async function territoryHistory(tx: Tx, territoryId: string) {
  const own = (await tx.query('SELECT h.*, c.name, c.tag FROM territory_ownership_history h JOIN clans c ON c.id=h.clan_id WHERE territory_id=$1 ORDER BY started_at DESC LIMIT 20', [territoryId])).rows;
  const battles = (await tx.query('SELECT b.id, b.stars, b.destruction, b.victory, b.created_at, u.username FROM battles b JOIN users u ON u.id=b.attacker_id WHERE b.territory_id=$1 ORDER BY b.created_at DESC LIMIT 20', [territoryId])).rows;
  return { ownership: own, battles };
}

export async function attackTerritory(ctx: AppContext, tx: Tx, userId: string, territoryId: string, deployments: Deployment[]): Promise<BattleOutcome> {
  const def = TERRITORIES.find((t) => t.id === territoryId);
  if (!def) throw notFound('Unknown territory');
  const season = await currentSeason(tx);
  if (season.state !== 'WAR_ACTIVE') throw new AppError(409, 'NOT_WAR_TIME', 'Territories can only be attacked during the war phase (days 94–98).');
  const clan = await clanOf(tx, userId);
  if (!clan) throw badRequest('NO_CLAN', 'Join a clan to fight for territories.');
  const me = await loadKingdom(tx, userId, false);
  if (hqLevel(me.state) < TERRITORY_MIN_HQ) throw badRequest('HQ_TOO_LOW', `Territory battles require Headquarters level ${TERRITORY_MIN_HQ}.`);
  const now = ctx.now();
  // Lock the territory: captures are serialised.
  const t = (await tx.query('SELECT * FROM territories WHERE id=$1 FOR UPDATE', [territoryId])).rows[0];
  if (t.owner_clan_id === clan.clanId) throw badRequest('OWN_TERRITORY', 'Your clan already holds this territory.');
  if (t.cooldown_until && t.cooldown_until.getTime() > now) throw badRequest('PROTECTED', 'This territory was captured recently and is protected.');
  const tries = await tx.query("SELECT count(*)::int AS n FROM battles WHERE attacker_id=$1 AND territory_id=$2 AND created_at >= date_trunc('day', $3::timestamptz)", [userId, territoryId, new Date(now).toISOString()]);
  if (tries.rows[0].n >= TERRITORY_RULES.attemptsPerPlayerPerDay) throw badRequest('ATTEMPT_LIMIT', 'You have used your attempts on this territory today.');
  const level = garrisonLevel(def, !!t.owner_clan_id);
  const defense = territoryGarrison(level).map((b, i) => ({ ...b, id: `${territoryId}-${i}` }));
  return runBattle(ctx, tx, userId, {
    kind: 'territory',
    defense,
    deployments,
    territoryId,
    settleRewards: async (r, _att, battleId) => {
      const notes: string[] = [];
      await recordProgress(tx, ctx.cfg, userId, 'territory_battle', 1, now);
      let scorePoints = await awardBattleScore(tx, ctx, userId, battleId, r.stars * SCORING.individual.pvpPointsPerStar, 'territory');
      if (r.stars >= TERRITORY_RULES.starsToCapture) {
        await tx.query('UPDATE territory_ownership_history SET ended_at=$2 WHERE territory_id=$1 AND ended_at IS NULL', [territoryId, new Date(now)]);
        await tx.query('INSERT INTO territory_ownership_history (territory_id, clan_id, season_id, battle_id, started_at) VALUES ($1,$2,$3,$4,$5)', [territoryId, clan.clanId, season.id, battleId, new Date(now)]);
        await tx.query('UPDATE territories SET owner_clan_id=$2, captured_at=$3, cooldown_until=$4, season_id=$5 WHERE id=$1', [
          territoryId, clan.clanId, new Date(now), new Date(now + TERRITORY_RULES.captureCooldownHours * 3_600_000), season.id,
        ]);
        scorePoints += await addScore(tx, { seasonId: season.id, userId, clanId: null, category: 'battle', points: SCORING.individual.territoryCapture, source: 'territory_capture', ref: `capture:${battleId}` }, now);
        await addScore(tx, { seasonId: season.id, userId, clanId: clan.clanId, category: 'clan', points: SCORING.clan.territoryCapture * def.value, source: 'territory_capture', ref: `clancapture:${battleId}` }, now);
        await tx.query("INSERT INTO clan_events (clan_id, user_id, type, details, created_at) VALUES ($1,$2,'territory_captured',$3,$4)", [clan.clanId, userId, JSON.stringify({ territory: def.name }), new Date(now)]);
        if (t.owner_clan_id) await tx.query("INSERT INTO clan_events (clan_id, type, details, created_at) VALUES ($1,'territory_lost',$2,$3)", [t.owner_clan_id, JSON.stringify({ territory: def.name }), new Date(now)]);
        await grantAchievement(tx, userId, 'territory_capture', now);
        notes.push(`${def.name} captured for your clan!`);
      } else {
        notes.push(`Capturing requires ${TERRITORY_RULES.starsToCapture} stars.`);
      }
      return { rewards: { gold: 0, wood: 0, stone: 0 }, scorePoints, notes };
    },
  });
}

/** Hold points: hours each clan held each territory during the war window x value x rate. */
export async function territoryHoldPoints(tx: Tx, season: SeasonRow, now: number) {
  const start = season.starts_at.getTime() + (season.schedule.warActiveDays[0] - 1) * 86_400_000;
  const end = Math.min(now, season.starts_at.getTime() + season.schedule.warActiveDays[1] * 86_400_000);
  if (end <= start) return [];
  const rows = (await tx.query('SELECT territory_id, clan_id, started_at, ended_at FROM territory_ownership_history WHERE season_id=$1', [season.id])).rows;
  const acc = new Map<string, number>();
  for (const r of rows) {
    const s = Math.max(start, r.started_at.getTime());
    const e = Math.min(end, r.ended_at ? r.ended_at.getTime() : end);
    if (e <= s) continue;
    const key = `${r.territory_id}|${r.clan_id}`;
    acc.set(key, (acc.get(key) ?? 0) + (e - s));
  }
  return [...acc.entries()].map(([k, msHeld]) => {
    const [territoryId, clanId] = k.split('|');
    const value = TERRITORIES.find((t) => t.id === territoryId)?.value ?? 1;
    return { territoryId, clanId, hours: msHeld / 3_600_000, points: Math.floor((msHeld / 3_600_000) * value * SCORING.clan.territoryHoldPerHour) };
  });
}

/** At the end of the war phase: convert hold time into clan score (once per clan & territory). */
export async function finalizeTerritories(ctx: AppContext, tx: Tx, season: SeasonRow, now: number) {
  const holds = await territoryHoldPoints(tx, season, now);
  for (const h of holds) {
    await addScore(tx, { seasonId: season.id, userId: null, clanId: h.clanId, category: 'clan', points: h.points, source: 'territory_hold', ref: `hold:${h.clanId}:${h.territoryId}` }, now);
  }
  return { holds: holds.length };
}
