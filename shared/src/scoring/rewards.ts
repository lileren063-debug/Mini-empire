import { REWARD_ALLOCATION } from '../config/rewards.js';

export type RewardCategory = 'clan' | 'individual' | 'participation' | 'special';

export interface RewardInputs {
  /** Total pool in integer micro-units. */
  poolUnits: bigint;
  allocation?: Record<RewardCategory, number>;
  /** Ranked clans (already filtered to eligible / top N) with eligible member contributions. */
  clans: { clanId: string; score: number; members: { userId: string; contribution: number }[] }[];
  /** Ranked individuals (already filtered). */
  individuals: { userId: string; score: number }[];
  /** Eligible participants with their participation score. */
  participants: { userId: string; score: number }[];
  /** Eligible special-pool recipients (special achievements + clean record). */
  special: { userId: string; weight: number }[];
}

export interface RewardLine {
  userId: string;
  category: RewardCategory;
  units: bigint;
  basis: string;
}

/** Split `total` proportionally to integer weights. Rounds down; the remainder stays in the pool. */
export function proportionalSplit(total: bigint, weights: { key: string; weight: number }[]): Map<string, bigint> {
  const out = new Map<string, bigint>();
  // Work in integer weights (x1000) so the arithmetic stays exact.
  const w = weights.filter((x) => x.weight > 0).map((x) => ({ key: x.key, w: BigInt(Math.round(x.weight * 1000)) }));
  const sum = w.reduce((a, b) => a + b.w, 0n);
  if (sum === 0n || total <= 0n) return out;
  for (const { key, w: wi } of w) out.set(key, (out.get(key) ?? 0n) + (total * wi) / sum);
  return out;
}

/**
 * Pure reward calculation for a season. Produces preview lines; the server stores them as
 * PREVIEW allocations which an operator must approve before anything is credited.
 */
export function calculateRewards(input: RewardInputs): { lines: RewardLine[]; categoryTotals: Record<RewardCategory, bigint>; undistributed: bigint } {
  const alloc = input.allocation ?? REWARD_ALLOCATION;
  const sumAlloc = alloc.clan + alloc.individual + alloc.participation + alloc.special;
  if (sumAlloc > 1.000001) throw new Error('Reward allocation exceeds 100%');
  const share = (p: number) => (input.poolUnits * BigInt(Math.round(p * 1_000_000))) / 1_000_000n;
  const lines: RewardLine[] = [];
  const categoryTotals: Record<RewardCategory, bigint> = { clan: 0n, individual: 0n, participation: 0n, special: 0n };

  // Clan pool: split between clans by score, then inside each clan by member contribution.
  const clanPool = share(alloc.clan);
  const perClan = proportionalSplit(clanPool, input.clans.map((c) => ({ key: c.clanId, weight: c.score })));
  for (const c of input.clans) {
    const clanUnits = perClan.get(c.clanId) ?? 0n;
    const perMember = proportionalSplit(clanUnits, c.members.map((m) => ({ key: m.userId, weight: m.contribution })));
    for (const [userId, units] of perMember) if (units > 0n) lines.push({ userId, category: 'clan', units, basis: `clan ${c.clanId}` });
  }
  const indiv = proportionalSplit(share(alloc.individual), input.individuals.map((i) => ({ key: i.userId, weight: i.score })));
  for (const [userId, units] of indiv) if (units > 0n) lines.push({ userId, category: 'individual', units, basis: 'battle score' });
  const part = proportionalSplit(share(alloc.participation), input.participants.map((p) => ({ key: p.userId, weight: p.score })));
  for (const [userId, units] of part) if (units > 0n) lines.push({ userId, category: 'participation', units, basis: 'participation score' });
  const spec = proportionalSplit(share(alloc.special), input.special.map((s) => ({ key: s.userId, weight: s.weight })));
  for (const [userId, units] of spec) if (units > 0n) lines.push({ userId, category: 'special', units, basis: 'achievements & fair play' });

  for (const l of lines) categoryTotals[l.category] += l.units;
  const distributed = lines.reduce((a, l) => a + l.units, 0n);
  return { lines, categoryTotals, undistributed: input.poolUnits - distributed };
}
