import { describe, it, expect } from 'vitest';
import { simulateBattle, DEFAULT_CONFIG, PVE_STAGES, type BattleInput } from '../src/index.js';

const layout = (stage: number) => PVE_STAGES[stage - 1].layout.map((b, i) => ({ ...b, id: `b${i}` }));

describe('battle engine', () => {
  it('is deterministic for identical inputs', () => {
    const input: BattleInput = { seed: 42, defense: layout(3), deployments: [{ troop: 'infantry', count: 15, side: 'north' }, { troop: 'archer', count: 5, side: 'west' }], attackerMultiplier: 1 };
    const a = simulateBattle(input, DEFAULT_CONFIG).result;
    const b = simulateBattle(input, DEFAULT_CONFIG).result;
    expect(a).toEqual(b);
    // Recording a replay does not change the outcome.
    const c = simulateBattle(input, DEFAULT_CONFIG, { record: true });
    expect(c.result).toEqual(a);
    expect(c.frames.length).toBeGreaterThan(5);
  });
  it('an empty army deals no damage and loses', () => {
    const r = simulateBattle({ seed: 1, defense: layout(1), deployments: [], attackerMultiplier: 1 }, DEFAULT_CONFIG).result;
    expect(r.victory).toBe(false);
    expect(r.stars).toBe(0);
    expect(r.destructionPercent).toBe(0);
  });
  it('a strong army beats the first stage; a tiny one loses to a fortified stage', () => {
    const win = simulateBattle({ seed: 7, defense: layout(1), deployments: [{ troop: 'infantry', count: 20, side: 'south' }], attackerMultiplier: 1 }, DEFAULT_CONFIG).result;
    expect(win.victory).toBe(true);
    expect(win.stars).toBe(3);
    expect(win.destructionPercent).toBe(100);
    const lose = simulateBattle({ seed: 7, defense: layout(8), deployments: [{ troop: 'infantry', count: 3, side: 'south' }], attackerMultiplier: 1 }, DEFAULT_CONFIG).result;
    expect(lose.victory).toBe(false);
    expect(lose.casualties.infantry).toBe(3);
  });
  it('casualties + survivors equal deployed troops', () => {
    const r = simulateBattle({ seed: 9, defense: layout(4), deployments: [{ troop: 'infantry', count: 12, side: 'east' }, { troop: 'archer', count: 8, side: 'east' }], attackerMultiplier: 1 }, DEFAULT_CONFIG).result;
    for (const t of ['infantry', 'archer', 'cavalry', 'siege'] as const) expect(r.casualties[t] + r.survivors[t]).toBe(r.deployed[t]);
  });
  it('siege units break walls far faster than archers', () => {
    const wallsOnly = [{ id: 'hq', type: 'headquarters' as const, level: 1, x: 10, y: 10 }, ...Array.from({ length: 22 }, (_, i) => ({ id: `w${i}`, type: 'wall' as const, level: 5, x: 1 + i, y: 6 }))];
    const siege = simulateBattle({ seed: 3, defense: wallsOnly, deployments: [{ troop: 'siege', count: 2, side: 'north' }], attackerMultiplier: 1 }, DEFAULT_CONFIG).result;
    const archers = simulateBattle({ seed: 3, defense: wallsOnly, deployments: [{ troop: 'archer', count: 2, side: 'north' }], attackerMultiplier: 1, maxTicks: siege.ticks }, DEFAULT_CONFIG).result;
    expect(siege.hqDestroyed).toBe(true);
    expect(archers.hqDestroyed).toBe(false);
  });
});

describe('result comparison', () => {
  it('ignores key order (jsonb round-trips reorder keys)', async () => {
    const { sameBattleResult } = await import('../src/index.js');
    const r = simulateBattle({ seed: 5, defense: layout(2), deployments: [{ troop: 'infantry', count: 5, side: 'north' }], attackerMultiplier: 1 }, DEFAULT_CONFIG).result;
    const reordered = JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(r).reverse())));
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(r));
    expect(sameBattleResult(reordered, r)).toBe(true);
    expect(sameBattleResult({ ...r, stars: (r.stars + 1) % 4 }, r)).toBe(false);
  });
});
