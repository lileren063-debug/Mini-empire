import { BATTLE_ECONOMY } from '../config/economy.js';

export interface ScoreEntry {
  id: string;
  name: string;
  score: number;
  /** Time (epoch ms) of the last scoring event — earlier wins ties. */
  lastScoredAt: number;
  /** Creation time (epoch ms) of the account / clan — older wins remaining ties. */
  createdAt: number;
}

export interface RankedEntry extends ScoreEntry {
  rank: number;
}

/** Deterministic ranking with the published tie-break rules (see TIE_BREAK_RULES). */
export function rankEntries(entries: ScoreEntry[]): RankedEntry[] {
  return [...entries]
    .sort((a, b) => b.score - a.score || a.lastScoredAt - b.lastScoredAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Diminishing returns for attacking the same defender repeatedly in 24h.
 * `previousAttacks` = number of earlier attacks on this defender in the window.
 * Returns null when the attack must be refused.
 */
export function repeatAttackMultiplier(previousAttacks: number, multipliers: number[] = BATTLE_ECONOMY.repeatAttackScoreMultipliers, maxAttacks = BATTLE_ECONOMY.maxAttacksOnSameDefenderPer24h): number | null {
  if (previousAttacks >= maxAttacks) return null;
  return multipliers[Math.min(previousAttacks, multipliers.length - 1)] ?? 0;
}

/** Apply a per-day cap to participation points. */
export function cappedParticipation(alreadyToday: number, points: number, dailyCap: number): number {
  return Math.max(0, Math.min(points, dailyCap - alreadyToday));
}
