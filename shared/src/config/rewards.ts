/**
 * Simulated token reward ledger configuration.
 *
 * IMPORTANT: These numbers are an illustrative, configurable example. They are NOT a funded
 * reward commitment, carry no price, and the game makes no promise of financial return.
 * Amounts are integer "micro-units" (1 token = 1_000_000 units) to avoid float rounding.
 */
export const TOKEN_UNIT = 1_000_000;

export const REWARD_ALLOCATION = {
  clan: 0.4,
  individual: 0.3,
  participation: 0.2,
  special: 0.1,
};

export const REWARD_ELIGIBILITY = {
  minHqLevel: 3,
  /** Minimum participation score for the participation pool. */
  minParticipationScore: 20,
  /** Top N players paid from the individual pool. */
  individualTopN: 100,
  /** Top N clans paid from the clan pool. */
  clanTopN: 20,
  /** Accounts with open "under review" flags are excluded until cleared. */
  excludeUnderReview: true,
};

/** Default simulated pool size per season (in whole test tokens). */
export const DEFAULT_SEASON_POOL_TOKENS = 100_000;
