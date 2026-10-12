import type { Resources } from '../types.js';

export const ECONOMY = {
  startingResources: { gold: 1500, wood: 1500, stone: 500 } as Resources,
  /** Offline production is never computed for more than this many hours since the last collection. */
  maxOfflineAccrualHours: 24,
  /** Absolute hard ceiling for any balance, independent of storage (sanity guard). */
  hardResourceCeiling: 10_000_000,
  /** Cost to found a clan. */
  clanCreationCost: { gold: 1000, wood: 0, stone: 0 } as Resources,
  /** Refund share when an in-progress building upgrade is cancelled. */
  upgradeCancelRefund: 0.5,
};

export const BATTLE_ECONOMY = {
  /** PvP: share of the defender's current balances that a 100% destruction attack loots. */
  pvpLootShare: 0.12,
  /** PvP: per-resource loot cap scales with attacker HQ level. */
  pvpLootCapPerHqLevel: 6000,
  /** Defender is shielded from further PvP attacks for this long after being attacked. */
  defenderShieldHours: 4,
  /** Attacker may attack the same defender at most this many times per 24h. */
  maxAttacksOnSameDefenderPer24h: 3,
  /** Score multipliers for repeated attacks on the same defender within 24h (diminishing returns). */
  repeatAttackScoreMultipliers: [1, 0.5, 0.25],
  /** Matchmaking: candidates must be within this many HQ levels. */
  matchmakingHqRange: 2,
  /** Minimum time between two battles started by one player (anti-automation). */
  minSecondsBetweenBattles: 5,
};
