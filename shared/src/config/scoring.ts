/**
 * Season scoring rules. Shown to players on the Season screen (see `SCORING_EXPLANATION`).
 * Points are only ever created by the server from validated events, each with a unique source
 * reference, so the same battle/mission can never be counted twice.
 */
export const SCORING = {
  individual: {
    /** Points per star in a PvP battle (before diminishing returns). */
    pvpPointsPerStar: 10,
    /** Points per star in a clan-war battle. */
    warPointsPerStar: 15,
    /** Points per star in a PvE battle (only first 3 rewarded attempts per stage/day). */
    pvePointsPerStar: 2,
    /** Bonus for capturing a territory. */
    territoryCapture: 40,
  },
  clan: {
    /** Clan points per member war star. */
    warStar: 10,
    /** Clan points per territory capture. */
    territoryCapture: 60,
    /** Clan points per hour a territory is held during the war phase (x territory value). */
    territoryHoldPerHour: 2,
    /** Share of each member's individual battle points credited to the clan. */
    memberContributionShare: 0.25,
    /** Clan mission completion. */
    clanMission: 50,
  },
  participation: {
    /** Max participation points a player can earn per UTC day. */
    dailyCap: 40,
    /** Points per day of activity (any validated action), once per day. */
    activeDay: 5,
  },
};

export const TIE_BREAK_RULES = [
  'Higher score ranks first.',
  'If tied, the entry that reached its final score earliest (earliest last scoring event) ranks first.',
  'If still tied, the older account / clan (lower creation time) ranks first.',
];

export const SCORING_EXPLANATION = [
  `Battle score: ${SCORING.individual.pvpPointsPerStar} pts per star in player battles, ${SCORING.individual.warPointsPerStar} per star in clan wars, ${SCORING.individual.pvePointsPerStar} per star in campaign battles.`,
  'Repeated attacks on the same player within 24h earn 100% / 50% / 25% of points; further attacks are blocked.',
  `Clan score: ${SCORING.clan.warStar} pts per member war star, ${SCORING.clan.territoryCapture} per territory capture, ${SCORING.clan.territoryHoldPerHour} pts/hour per territory value held during wars, ${SCORING.clan.clanMission} per clan mission, plus ${SCORING.clan.memberContributionShare * 100}% of members' battle points.`,
  `Participation score: mission claims and daily activity, capped at ${SCORING.participation.dailyCap} pts per day so grinding cannot inflate it.`,
  ...TIE_BREAK_RULES.map((r) => `Tie-break: ${r}`),
];
