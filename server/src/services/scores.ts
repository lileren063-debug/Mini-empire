import { SCORING, cappedParticipation, dailyKey } from '@mini-empire/shared';
import type { Tx } from '../db.js';

export const SCORING_STATES = ['DEVELOPMENT', 'WAR_PREPARATION', 'WAR_ACTIVE'];

export interface SeasonRow {
  id: number;
  number: number;
  starts_at: Date;
  schedule: import('@mini-empire/shared').SeasonSchedule;
  state: import('@mini-empire/shared').SeasonState;
  published: boolean;
  state_changed_at: Date;
}

export async function currentSeason(tx: Pick<Tx, 'query'>): Promise<SeasonRow> {
  const { rows } = await tx.query("SELECT * FROM seasons WHERE state <> 'COMPLETED' ORDER BY id DESC LIMIT 1");
  if (rows[0]) return rows[0];
  const last = await tx.query('SELECT * FROM seasons ORDER BY id DESC LIMIT 1');
  if (!last.rows[0]) throw new Error('No season configured. Run the server once (it bootstraps season 1).');
  return last.rows[0];
}

/**
 * Record score points from a validated server event. `ref` must uniquely identify the source
 * event: inserting the same (season, category, ref) twice is a no-op, so no event can be counted
 * twice. Returns the points actually recorded.
 */
export async function addScore(
  tx: Tx,
  e: { seasonId: number; userId: string | null; clanId: string | null; category: 'battle' | 'participation' | 'clan'; points: number; source: string; ref: string },
  now: number,
): Promise<number> {
  let points = Math.max(0, Math.floor(e.points));
  // Scores are frozen once the season leaves the competitive phases.
  const st = await tx.query('SELECT state FROM seasons WHERE id = $1', [e.seasonId]);
  if (!SCORING_STATES.includes(st.rows[0]?.state)) return 0;
  if (e.category === 'participation' && e.userId) {
    const day = dailyKey(now);
    const { rows } = await tx.query(
      `SELECT COALESCE(SUM(points),0)::int AS p FROM score_events
        WHERE season_id=$1 AND category='participation' AND user_id=$2 AND created_at >= $3::date AND created_at < ($3::date + 1)`,
      [e.seasonId, e.userId, day.slice(1)],
    );
    points = cappedParticipation(rows[0].p, points, SCORING.participation.dailyCap);
  }
  if (points <= 0) return 0;
  const r = await tx.query(
    `INSERT INTO score_events (season_id, user_id, clan_id, category, points, source, source_ref, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
    [e.seasonId, e.userId, e.clanId, e.category, points, e.source, e.ref, new Date(now)],
  );
  return r.rowCount ? points : 0;
}

export async function clanOf(tx: Pick<Tx, 'query'>, userId: string): Promise<{ clanId: string; role: string; joinedAt: Date } | null> {
  const { rows } = await tx.query('SELECT clan_id, role, joined_at FROM clan_memberships WHERE user_id = $1', [userId]);
  return rows[0] ? { clanId: rows[0].clan_id, role: rows[0].role, joinedAt: rows[0].joined_at } : null;
}
