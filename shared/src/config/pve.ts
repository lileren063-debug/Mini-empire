import type { BuildingType, Resources } from '../types.js';

export interface PveLayoutBuilding {
  type: BuildingType;
  level: number;
  x: number;
  y: number;
}

export interface PveStage {
  id: number;
  name: string;
  hqRequired: number;
  reward: Resources;
  /** Extra reward granted only the first time the stage is cleared with at least one star. */
  firstClearBonus: Resources;
  layout: PveLayoutBuilding[];
}

function ring(cx: number, cy: number, radius: number, level: number): PveLayoutBuilding[] {
  const out: PveLayoutBuilding[] = [];
  for (let x = cx - radius; x <= cx + radius; x++) {
    for (let y = cy - radius; y <= cy + radius; y++) {
      const edge = x === cx - radius || x === cx + radius || y === cy - radius || y === cy + radius;
      if (edge) out.push({ type: 'wall', level, x, y });
    }
  }
  return out;
}

function stage(id: number, name: string, power: number, opts: { towers: number; heavy: number; walls: boolean }): PveStage {
  const lvl = Math.min(10, Math.max(1, power));
  const layout: PveLayoutBuilding[] = [{ type: 'headquarters', level: lvl, x: 10, y: 10 }];
  const towerSpots: [number, number][] = [[5, 5], [16, 5], [5, 16], [16, 16], [11, 5]];
  for (let i = 0; i < opts.towers; i++) layout.push({ type: 'archer_tower', level: lvl, x: towerSpots[i][0], y: towerSpots[i][1] });
  const heavySpots: [number, number][] = [[11, 16], [5, 11], [16, 11]];
  for (let i = 0; i < opts.heavy; i++) layout.push({ type: 'heavy_tower', level: lvl, x: heavySpots[i][0], y: heavySpots[i][1] });
  layout.push({ type: 'gold_mine', level: lvl, x: 19, y: 19 }, { type: 'lumber_camp', level: lvl, x: 2, y: 2 }, { type: 'storage', level: lvl, x: 19, y: 2 });
  if (opts.walls) layout.push(...ring(11, 11, 3, lvl));
  const base = 300 * Math.pow(1.7, id - 1);
  const rr = (n: number) => Math.round(n / 10) * 10;
  return {
    id,
    name,
    hqRequired: Math.max(1, Math.ceil(id / 2)),
    reward: { gold: rr(base), wood: rr(base), stone: rr(base * 0.5) },
    firstClearBonus: { gold: rr(base * 2), wood: rr(base * 2), stone: rr(base) },
    layout,
  };
}

export const PVE_STAGES: PveStage[] = [
  stage(1, 'Goblin Outpost', 1, { towers: 0, heavy: 0, walls: false }),
  stage(2, 'Bandit Camp', 1, { towers: 1, heavy: 0, walls: false }),
  stage(3, 'Raider Stockade', 2, { towers: 2, heavy: 0, walls: true }),
  stage(4, 'Orc Watchpost', 3, { towers: 2, heavy: 1, walls: true }),
  stage(5, 'Mercenary Fort', 4, { towers: 3, heavy: 1, walls: true }),
  stage(6, 'Dark Keep', 4, { towers: 4, heavy: 1, walls: true }),
  stage(7, 'Warlord Citadel', 5, { towers: 4, heavy: 2, walls: true }),
  stage(8, 'Iron Bastion', 6, { towers: 5, heavy: 2, walls: true }),
  stage(9, 'Dragon Gate', 7, { towers: 5, heavy: 3, walls: true }),
  stage(10, 'The Black Throne', 8, { towers: 5, heavy: 3, walls: true }),
];

/** PvE reward share by stars (0..3). A defeat (0 stars) gives nothing. */
export const PVE_STAR_REWARD_SHARE = [0, 0.4, 0.7, 1];
/** Max PvE battles that pay out resources per stage per day (anti-farming). */
export const PVE_REWARDED_ATTEMPTS_PER_STAGE_PER_DAY = 3;
