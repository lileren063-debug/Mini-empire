import { describe, it, expect } from 'vitest';
import { rankEntries, repeatAttackMultiplier, cappedParticipation, calculateRewards, proportionalSplit, generateWarPairings, warScore, warOutcome, dailyKey, weeklyKey } from '../src/index.js';

describe('leaderboards', () => {
  it('ranks by score then earliest last score then account age', () => {
    const r = rankEntries([
      { id: 'a', name: 'A', score: 10, lastScoredAt: 5, createdAt: 1 },
      { id: 'b', name: 'B', score: 20, lastScoredAt: 9, createdAt: 1 },
      { id: 'c', name: 'C', score: 10, lastScoredAt: 3, createdAt: 2 },
      { id: 'd', name: 'D', score: 10, lastScoredAt: 3, createdAt: 1 },
    ]);
    expect(r.map((e) => e.id)).toEqual(['b', 'd', 'c', 'a']);
    expect(r.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });
  it('applies diminishing returns and blocks farming', () => {
    expect(repeatAttackMultiplier(0)).toBe(1);
    expect(repeatAttackMultiplier(1)).toBe(0.5);
    expect(repeatAttackMultiplier(2)).toBe(0.25);
    expect(repeatAttackMultiplier(3)).toBeNull();
    expect(cappedParticipation(35, 10, 40)).toBe(5);
    expect(cappedParticipation(40, 10, 40)).toBe(0);
  });
});

describe('reward calculation', () => {
  it('splits exactly by configured allocation and never exceeds the pool', () => {
    const pool = 1_000_000_000n;
    const r = calculateRewards({
      poolUnits: pool,
      clans: [{ clanId: 'c1', score: 300, members: [{ userId: 'u1', contribution: 3 }, { userId: 'u2', contribution: 1 }] }, { clanId: 'c2', score: 100, members: [{ userId: 'u3', contribution: 1 }] }],
      individuals: [{ userId: 'u1', score: 50 }, { userId: 'u3', score: 50 }],
      participants: [{ userId: 'u1', score: 10 }, { userId: 'u2', score: 10 }, { userId: 'u3', score: 20 }],
      special: [{ userId: 'u2', weight: 1 }],
    });
    expect(r.categoryTotals.clan).toBe(400_000_000n);
    expect(r.categoryTotals.individual).toBe(300_000_000n);
    expect(r.categoryTotals.participation).toBe(200_000_000n);
    expect(r.categoryTotals.special).toBe(100_000_000n);
    const u1clan = r.lines.find((l) => l.userId === 'u1' && l.category === 'clan')!.units;
    expect(u1clan).toBe(225_000_000n);
    expect(r.undistributed).toBeGreaterThanOrEqual(0n);
  });
  it('rounds down and leaves remainders in the pool', () => {
    const m = proportionalSplit(10n, [{ key: 'a', weight: 1 }, { key: 'b', weight: 1 }, { key: 'c', weight: 1 }]);
    expect([...m.values()]).toEqual([3n, 3n, 3n]);
  });
  it('rejects allocations above 100%', () => {
    expect(() => calculateRewards({ poolUnits: 1n, allocation: { clan: 0.5, individual: 0.5, participation: 0.2, special: 0 }, clans: [], individuals: [], participants: [], special: [] })).toThrow();
  });
});

describe('clan war matchmaking', () => {
  it('pairs clans of similar strength, not just size, and gives a bye', () => {
    const p = generateWarPairings([
      { clanId: 'big-weak', strength: 2000, rosterSize: 20, activity: 0.5 },
      { clanId: 'small-strong', strength: 1500, rosterSize: 5, activity: 1 },
      { clanId: 'mid', strength: 1000, rosterSize: 10, activity: 1 },
      { clanId: 'mid2', strength: 1100, rosterSize: 10, activity: 1 },
      { clanId: 'tiny', strength: 100, rosterSize: 3, activity: 1 },
    ]);
    expect(p).toHaveLength(3);
    expect(p[p.length - 1]).toEqual({ clanA: 'tiny', clanB: null });
    const flat = p.flatMap((x) => [x.clanA, x.clanB]);
    expect(new Set(flat.filter(Boolean)).size).toBe(5);
  });
  it('counts only the best attack per defender and resolves ties', () => {
    const s = warScore([
      { clanId: 'A', defenderId: 'x', stars: 1, destruction: 50 },
      { clanId: 'A', defenderId: 'x', stars: 3, destruction: 100 },
      { clanId: 'A', defenderId: 'y', stars: 2, destruction: 70 },
      { clanId: 'B', defenderId: 'z', stars: 3, destruction: 100 },
    ], 'A', 10);
    expect(s).toEqual({ stars: 5, points: 50, destruction: 170 });
    expect(warOutcome({ points: 10, destruction: 5 }, { points: 10, destruction: 9 })).toBe('B');
    expect(warOutcome({ points: 10, destruction: 9 }, { points: 10, destruction: 9 })).toBe('DRAW');
  });
});

describe('mission periods', () => {
  it('uses UTC day and ISO week keys', () => {
    expect(dailyKey(Date.UTC(2026, 9, 12, 23, 59))).toBe('D2026-10-12');
    expect(weeklyKey(Date.UTC(2026, 0, 1))).toBe('W2026-01');
    expect(weeklyKey(Date.UTC(2026, 9, 12))).toBe('W2026-42');
    expect(weeklyKey(Date.UTC(2025, 11, 29))).toBe('W2026-01');
  });
});
