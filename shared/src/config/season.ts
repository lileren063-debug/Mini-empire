export const SEASON_STATES = [
  'DEVELOPMENT',
  'WAR_PREPARATION',
  'WAR_ACTIVE',
  'RESULT_VERIFICATION',
  'REWARD_DISTRIBUTION',
  'SEASON_RESET',
  'COMPLETED',
] as const;
export type SeasonState = (typeof SEASON_STATES)[number];

/** Day boundaries (1-based, inclusive) of a season. All times are server UTC. */
export interface SeasonSchedule {
  lengthDays: number;
  developmentDays: [number, number];
  warPreparationDays: [number, number];
  warActiveDays: [number, number];
  verificationDays: [number, number];
}

export const DEFAULT_SEASON_SCHEDULE: SeasonSchedule = {
  lengthDays: 100,
  developmentDays: [1, 90],
  warPreparationDays: [91, 93],
  warActiveDays: [94, 98],
  verificationDays: [99, 100],
};

export const CLAN_WAR = {
  /** Minimum HQ level for a member to be placed on a war roster. */
  minHqLevel: 5,
  /** Member must have been in the clan at least this many hours before roster lock. */
  minMembershipHours: 48,
  minRosterSize: 3,
  maxRosterSize: 20,
  /** War attacks each roster member may make. */
  attacksPerMember: 3,
  /** Points for the best star result against each enemy roster member. */
  pointsPerStar: 10,
  /** Clan season score bonus for winning / drawing a war. */
  winBonus: 150,
  drawBonus: 50,
};
