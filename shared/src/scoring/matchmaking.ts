export interface WarCandidate {
  clanId: string;
  /** Roster strength (sum of member power). */
  strength: number;
  rosterSize: number;
  /** 0..1: share of the roster that was active recently. */
  activity: number;
}

export interface WarPairing {
  clanA: string;
  clanB: string | null; // null = bye
}

/** Effective rating: strength per member, weighted by activity, plus a size term. */
export function warRating(c: WarCandidate): number {
  const perMember = c.rosterSize ? c.strength / c.rosterSize : 0;
  return perMember * (0.5 + 0.5 * c.activity) * Math.sqrt(Math.max(1, c.rosterSize));
}

/**
 * Pair clans with the closest ratings (sorted adjacent pairing). Deterministic: ties broken by id.
 * With an odd count the weakest clan gets a bye (no points, no loss).
 */
export function generateWarPairings(cands: WarCandidate[]): WarPairing[] {
  const sorted = [...cands].sort((a, b) => warRating(b) - warRating(a) || (a.clanId < b.clanId ? -1 : 1));
  const out: WarPairing[] = [];
  for (let i = 0; i + 1 < sorted.length; i += 2) out.push({ clanA: sorted[i].clanId, clanB: sorted[i + 1].clanId });
  if (sorted.length % 2 === 1) out.push({ clanA: sorted[sorted.length - 1].clanId, clanB: null });
  return out;
}

/**
 * War score: each attacker's best result against each defender counts once.
 * `attacks` = list of (attackerClan, defenderUser, stars, destruction).
 */
export function warScore(attacks: { clanId: string; defenderId: string; stars: number; destruction: number }[], clanId: string, pointsPerStar: number) {
  const best = new Map<string, { stars: number; destruction: number }>();
  for (const a of attacks) {
    if (a.clanId !== clanId) continue;
    const cur = best.get(a.defenderId);
    if (!cur || a.stars > cur.stars || (a.stars === cur.stars && a.destruction > cur.destruction)) best.set(a.defenderId, { stars: a.stars, destruction: a.destruction });
  }
  let stars = 0, destruction = 0;
  for (const v of best.values()) { stars += v.stars; destruction += v.destruction; }
  return { stars, points: stars * pointsPerStar, destruction };
}

/** Decide a war: more points wins; tie -> higher total destruction; still tied -> draw. */
export function warOutcome(a: { points: number; destruction: number }, b: { points: number; destruction: number }): 'A' | 'B' | 'DRAW' {
  if (a.points !== b.points) return a.points > b.points ? 'A' : 'B';
  if (a.destruction !== b.destruction) return a.destruction > b.destruction ? 'A' : 'B';
  return 'DRAW';
}
