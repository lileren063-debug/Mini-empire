import { ACHIEVEMENTS, SCORING, periodKey, type GameConfig, type GameEvent, type ProgressEvent } from '@mini-empire/shared';
import type { Tx } from '../db.js';
import { addScore, clanOf, currentSeason } from './scores.js';

/**
 * Advance missions (personal + clan) from a validated server-side event. Called only by server
 * services after the underlying action has been committed to the same transaction — the client
 * can never report progress directly.
 */
export async function recordProgress(tx: Tx, cfg: GameConfig, userId: string, event: ProgressEvent, amount: number, now: number): Promise<void> {
  if (amount <= 0) return;
  for (const m of cfg.missions) {
    if (!m.enabled || m.event !== event) continue;
    await tx.query(
      `INSERT INTO mission_progress (user_id, mission_id, period_key, progress) VALUES ($1,$2,$3,LEAST($4::int,$5::int))
       ON CONFLICT (user_id, mission_id, period_key) DO UPDATE SET progress = LEAST(mission_progress.progress + $4::int, $5::int)`,
      [userId, m.id, periodKey(m.period, now), amount, m.target],
    );
  }
  const clan = await clanOf(tx, userId);
  if (!clan) return;
  for (const cm of cfg.clanMissions) {
    if (cm.event !== event) continue;
    const pk = periodKey('weekly', now);
    await tx.query(
      `INSERT INTO clan_mission_contributors (clan_id, user_id, mission_id, period_key, amount) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (clan_id, user_id, mission_id, period_key) DO UPDATE SET amount = clan_mission_contributors.amount + $5::int`,
      [clan.clanId, userId, cm.id, pk, amount],
    );
    const { rows } = await tx.query(
      `INSERT INTO clan_mission_progress (clan_id, mission_id, period_key, progress) VALUES ($1,$2,$3,LEAST($4::int,$5::int))
       ON CONFLICT (clan_id, mission_id, period_key) DO UPDATE SET progress = LEAST(clan_mission_progress.progress + $4::int, $5::int)
       RETURNING progress, completed_at`,
      [clan.clanId, cm.id, pk, amount, cm.target],
    );
    if (rows[0].progress >= cm.target && !rows[0].completed_at) {
      await tx.query('UPDATE clan_mission_progress SET completed_at=$4 WHERE clan_id=$1 AND mission_id=$2 AND period_key=$3', [clan.clanId, cm.id, pk, new Date(now)]);
      const season = await currentSeason(tx);
      await addScore(tx, { seasonId: season.id, userId: null, clanId: clan.clanId, category: 'clan', points: SCORING.clan.clanMission, source: 'clan_mission', ref: `cm:${clan.clanId}:${cm.id}:${pk}` }, now);
      await tx.query("INSERT INTO clan_events (clan_id, type, details, created_at) VALUES ($1,'mission_completed',$2,$3)", [clan.clanId, JSON.stringify({ mission: cm.id, period: pk }), new Date(now)]);
    }
  }
}

/** Grant a permanent achievement (+ its title/cosmetic). Idempotent. */
export async function grantAchievement(tx: Tx, userId: string, achievementId: string, now: number): Promise<boolean> {
  const def = ACHIEVEMENTS.find((a) => a.id === achievementId);
  if (!def) return false;
  const season = await currentSeason(tx);
  const r = await tx.query('INSERT INTO achievements (user_id, achievement_id, season_id, earned_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [
    userId, achievementId, season.id, new Date(now),
  ]);
  if (r.rowCount && def.cosmetic) {
    await tx.query("INSERT INTO cosmetic_inventory (user_id, cosmetic_id, source, acquired_at) VALUES ($1,$2,'achievement',$3) ON CONFLICT DO NOTHING", [userId, def.cosmetic, new Date(now)]);
  }
  return !!r.rowCount;
}

/** Translate kingdom rule events into missions, achievements and score. */
export async function processGameEvents(tx: Tx, cfg: GameConfig, userId: string, events: GameEvent[], now: number): Promise<void> {
  for (const e of events) {
    if (e.type === 'building_upgraded') {
      await recordProgress(tx, cfg, userId, 'building_upgraded', 1, now);
      await grantAchievement(tx, userId, 'first_build', now);
      if (e.buildingType === 'headquarters' && e.level >= 5) await grantAchievement(tx, userId, 'hq5', now);
      if (e.buildingType === 'headquarters' && e.level >= 10) await grantAchievement(tx, userId, 'hq10', now);
    } else if (e.type === 'resources_collected') {
      await recordProgress(tx, cfg, userId, 'resources_collected', e.amount, now);
    } else if (e.type === 'troops_trained') {
      await recordProgress(tx, cfg, userId, 'troops_trained', e.count, now);
    }
  }
}

/** Once-per-day participation points for any validated action. */
export async function markActiveDay(tx: Tx, userId: string, now: number) {
  const season = await currentSeason(tx);
  const day = new Date(now).toISOString().slice(0, 10);
  await addScore(tx, { seasonId: season.id, userId, clanId: null, category: 'participation', points: SCORING.participation.activeDay, source: 'active_day', ref: `active:${userId}:${day}` }, now);
}
