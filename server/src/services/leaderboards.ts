import { rankEntries, type RankedEntry } from '@mini-empire/shared';
import type { Tx } from '../db.js';
import type { SeasonRow } from './scores.js';
import { territoryHoldPoints } from './territories.js';

export type Board = 'clan' | 'individual' | 'participation';

/**
 * Live leaderboard computed from score events. During the war phase, clan boards also include
 * provisional territory-hold points (they are converted into real score events when the war
 * phase ends, so they are never counted twice).
 */
export async function computeBoard(tx: Pick<Tx, 'query'>, season: SeasonRow, board: Board, now: number): Promise<RankedEntry[]> {
  if (board === 'clan') {
    const { rows } = await tx.query(
      `SELECT c.id, c.name || ' [' || c.tag || ']' AS name, c.created_at,
              COALESCE(sum(s.points),0)::int AS score, max(s.created_at) AS last_at
         FROM clans c LEFT JOIN score_events s ON s.clan_id = c.id AND s.category='clan' AND s.season_id=$1
        WHERE c.disbanded_at IS NULL GROUP BY c.id`,
      [season.id],
    );
    const provisional = new Map<string, number>();
    if (season.state === 'WAR_ACTIVE') {
      for (const h of await territoryHoldPoints(tx as Tx, season, now)) provisional.set(h.clanId, (provisional.get(h.clanId) ?? 0) + h.points);
    }
    return rankEntries(
      rows.map((r) => ({ id: r.id, name: r.name, score: r.score + (provisional.get(r.id) ?? 0), lastScoredAt: r.last_at ? r.last_at.getTime() : Number.MAX_SAFE_INTEGER, createdAt: r.created_at.getTime() })).filter((e) => e.score > 0),
    );
  }
  const category = board === 'individual' ? 'battle' : 'participation';
  const { rows } = await tx.query(
    `SELECT u.id, u.username AS name, u.created_at, sum(s.points)::int AS score, max(s.created_at) AS last_at
       FROM score_events s JOIN users u ON u.id = s.user_id
      WHERE s.season_id=$1 AND s.category=$2 AND s.user_id IS NOT NULL AND NOT u.suspended
      GROUP BY u.id`,
    [season.id, category],
  );
  return rankEntries(rows.map((r) => ({ id: r.id, name: r.name, score: r.score, lastScoredAt: r.last_at.getTime(), createdAt: r.created_at.getTime() })));
}

/** Store an immutable snapshot (final snapshots are unique per season & board). */
export async function snapshotBoards(tx: Tx, season: SeasonRow, reason: 'final' | 'manual', now: number) {
  for (const board of ['clan', 'individual', 'participation'] as Board[]) {
    const entries = await computeBoard(tx, season, board, now);
    await tx.query('INSERT INTO leaderboard_snapshots (season_id, board, reason, entries, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
      season.id, board, reason, JSON.stringify(entries), new Date(now),
    ]);
  }
}

export async function finalSnapshot(tx: Pick<Tx, 'query'>, seasonId: number, board: Board): Promise<RankedEntry[] | null> {
  const { rows } = await tx.query("SELECT entries FROM leaderboard_snapshots WHERE season_id=$1 AND board=$2 AND reason='final'", [seasonId, board]);
  return rows[0]?.entries ?? null;
}
