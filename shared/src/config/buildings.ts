import type { BuildingType, ResourceType, Resources } from '../types.js';

/**
 * Building balancing tables.
 *
 * Every number the game uses for buildings lives here. Level tables are explicit arrays
 * (index 0 = level 1) so they can be printed, reviewed and overridden. `levelTable()` only
 * generates the default arrays from a few seed numbers; edit the seeds (or replace the arrays
 * with hand-written ones) to rebalance. See docs/ECONOMY.md.
 */

export interface BuildingLevel {
  level: number;
  /** Cost to reach this level (level 1 = cost to build). */
  cost: Resources;
  /** Construction / upgrade duration to reach this level. */
  durationSec: number;
  /** Minimum Headquarters level required to start building this level. */
  hqRequired: number;
  /** Other buildings that must exist at a minimum level before this level can be started. */
  requires?: { type: BuildingType; level: number }[];
  hp: number;
  /** Producers: units per hour. */
  productionPerHour?: number;
  /** Producers: internal buffer; production stops when the buffer is full. */
  bufferCap?: number;
  /** HQ / Storage: added storage capacity for each resource. */
  storageCap?: number;
  /** Barracks: army housing capacity. */
  armyCapacity?: number;
  /** Towers. */
  damage?: number;
  range?: number;
  /** Seconds between attacks. */
  attackInterval?: number;
  /** Heavy tower: splash radius in tiles. */
  splashRadius?: number;
  /** HQ: number of simultaneous constructions. */
  builders?: number;
  /** Human readable unlock notes shown in the UI. */
  unlocks?: string[];
}

export type BuildingCategory = 'core' | 'resource' | 'military' | 'defense';

export interface BuildingDef {
  type: BuildingType;
  name: string;
  description: string;
  category: BuildingCategory;
  /** Square footprint in tiles. */
  size: number;
  maxLevel: number;
  produces?: ResourceType;
  /** Max number of this building allowed per HQ level (index 0 = HQ 1). */
  maxCountByHq: number[];
  levels: BuildingLevel[];
  /** Tower target selection rule (see battle engine). */
  targeting?: 'nearest' | 'strongest';
}

const r = (n: number) => {
  if (n < 100) return Math.round(n);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
};

function cost(gold: number, wood: number, stone: number): Resources {
  return { gold: r(gold), wood: r(wood), stone: r(stone) };
}

interface Seed {
  gold: number;
  wood: number;
  stone: number;
  costGrowth: number;
  durationsSec: number[]; // explicit per level (index 0 = level 1)
  hp: number;
  hpGrowth: number;
  hqRequired?: (level: number) => number;
}

function levelTable(seed: Seed, extra: (level: number) => Partial<BuildingLevel>): BuildingLevel[] {
  const out: BuildingLevel[] = [];
  for (let level = 1; level <= 10; level++) {
    const g = Math.pow(seed.costGrowth, level - 1);
    out.push({
      level,
      cost: cost(seed.gold * g, seed.wood * g, seed.stone * g),
      durationSec: seed.durationsSec[level - 1],
      hqRequired: seed.hqRequired ? seed.hqRequired(level) : Math.max(1, level - 1),
      hp: Math.round(seed.hp * Math.pow(seed.hpGrowth, level - 1)),
      ...extra(level),
    });
  }
  return out;
}

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;

/** Durations for ordinary buildings (resource, storage, barracks, towers). */
const STD_DURATIONS = [10, 2 * MIN, 15 * MIN, 1 * HOUR, 3 * HOUR, 6 * HOUR, 10 * HOUR, 16 * HOUR, 1 * DAY, 1.5 * DAY];
const WALL_DURATIONS = [0, 10, 30, 1 * MIN, 2 * MIN, 5 * MIN, 10 * MIN, 20 * MIN, 30 * MIN, 1 * HOUR];

const HQ_LEVELS: BuildingLevel[] = [
  { level: 1, cost: cost(0, 0, 0), durationSec: 0, hqRequired: 1, hp: 1500, storageCap: 4000, builders: 1, unlocks: ['Gold Mine', 'Lumber Camp', 'Stone Quarry', 'Storage', 'Barracks', 'Archer Tower', 'Walls'] },
  { level: 2, cost: cost(800, 800, 0), durationSec: 5 * MIN, hqRequired: 1, hp: 1900, storageCap: 8000, builders: 1, unlocks: ['Level 3 buildings', 'More walls'] },
  { level: 3, cost: cost(3000, 3000, 1500), durationSec: 1 * HOUR, hqRequired: 2, requires: [{ type: 'barracks', level: 1 }], hp: 2400, storageCap: 15000, builders: 2, unlocks: ['Heavy Tower', 'Second builder', '2nd Gold Mine / Lumber Camp / Quarry'] },
  { level: 4, cost: cost(9000, 9000, 6000), durationSec: 4 * HOUR, hqRequired: 3, requires: [{ type: 'storage', level: 2 }], hp: 3000, storageCap: 25000, builders: 2, unlocks: ['Cavalry (Barracks 4)'] },
  { level: 5, cost: cost(20000, 20000, 15000), durationSec: 10 * HOUR, hqRequired: 4, requires: [{ type: 'archer_tower', level: 3 }], hp: 3800, storageCap: 40000, builders: 2, unlocks: ['Second Storage', 'Clan war eligibility'] },
  { level: 6, cost: cost(42000, 42000, 34000), durationSec: 18 * HOUR, hqRequired: 5, requires: [{ type: 'barracks', level: 4 }], hp: 4700, storageCap: 60000, builders: 3, unlocks: ['Siege units (Barracks 6)', 'Third builder'] },
  { level: 7, cost: cost(80000, 80000, 66000), durationSec: 1 * DAY, hqRequired: 6, requires: [{ type: 'storage', level: 5 }], hp: 5900, storageCap: 90000, builders: 3, unlocks: ['Stone walls tier'] },
  { level: 8, cost: cost(140000, 140000, 120000), durationSec: 2 * DAY, hqRequired: 7, requires: [{ type: 'heavy_tower', level: 5 }], hp: 7400, storageCap: 130000, builders: 3, unlocks: ['Third Storage'] },
  { level: 9, cost: cost(250000, 250000, 215000), durationSec: 3 * DAY, hqRequired: 8, requires: [{ type: 'barracks', level: 7 }], hp: 9200, storageCap: 180000, builders: 3, unlocks: ['Royal defenses'] },
  { level: 10, cost: cost(380000, 380000, 330000), durationSec: 4.5 * DAY, hqRequired: 9, requires: [{ type: 'storage', level: 8 }], hp: 11500, storageCap: 240000, builders: 3, unlocks: ['Legendary visuals', 'Season title: Emperor'] },
];

function producer(type: BuildingType, name: string, produces: ResourceType, description: string, seedCost: [number, number, number]): BuildingDef {
  return {
    type,
    name,
    description,
    category: 'resource',
    size: 2,
    maxLevel: 10,
    produces,
    maxCountByHq: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4],
    levels: levelTable(
      { gold: seedCost[0], wood: seedCost[1], stone: seedCost[2], costGrowth: 1.95, durationsSec: STD_DURATIONS, hp: 400, hpGrowth: 1.18 },
      (level) => {
        const productionPerHour = Math.round(150 * Math.pow(1.27, level - 1));
        return { productionPerHour, bufferCap: productionPerHour * 10 };
      },
    ),
  };
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  headquarters: {
    type: 'headquarters',
    name: 'Headquarters',
    description: 'The heart of your kingdom. Its level unlocks new buildings, levels and troops.',
    category: 'core',
    size: 3,
    maxLevel: 10,
    maxCountByHq: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    levels: HQ_LEVELS,
  },
  gold_mine: producer('gold_mine', 'Gold Mine', 'gold', 'Digs gold over time, even while you are away.', [100, 250, 0]),
  lumber_camp: producer('lumber_camp', 'Lumber Camp', 'wood', 'Cuts wood over time, even while you are away.', [250, 100, 0]),
  stone_quarry: producer('stone_quarry', 'Stone Quarry', 'stone', 'Cuts stone over time, even while you are away.', [250, 250, 0]),
  storage: {
    type: 'storage',
    name: 'Storage',
    description: 'Raises the maximum amount of Gold, Wood and Stone you can hold.',
    category: 'core',
    size: 2,
    maxLevel: 10,
    maxCountByHq: [1, 1, 1, 1, 2, 2, 2, 3, 3, 3],
    levels: levelTable(
      { gold: 300, wood: 400, stone: 100, costGrowth: 1.95, durationsSec: STD_DURATIONS, hp: 600, hpGrowth: 1.2 },
      (level) => ({ storageCap: r(3000 * Math.pow(1.6, level - 1)) }),
    ),
  },
  barracks: {
    type: 'barracks',
    name: 'Barracks',
    description: 'Trains and houses every troop type. Higher levels unlock troops and add army capacity.',
    category: 'military',
    size: 3,
    maxLevel: 10,
    maxCountByHq: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    levels: levelTable(
      { gold: 400, wood: 300, stone: 100, costGrowth: 1.95, durationsSec: STD_DURATIONS, hp: 800, hpGrowth: 1.2 },
      (level) => ({
        armyCapacity: [20, 30, 40, 55, 70, 85, 100, 120, 140, 160][level - 1],
        unlocks: level === 1 ? ['Infantry'] : level === 2 ? ['Archers'] : level === 4 ? ['Cavalry'] : level === 6 ? ['Siege units'] : undefined,
      }),
    ),
  },
  archer_tower: {
    type: 'archer_tower',
    name: 'Archer Tower',
    description: 'Fast single-target tower. Shoots the nearest enemy in range.',
    category: 'defense',
    size: 2,
    maxLevel: 10,
    targeting: 'nearest',
    maxCountByHq: [1, 1, 2, 2, 3, 3, 4, 4, 5, 5],
    levels: levelTable(
      { gold: 300, wood: 500, stone: 100, costGrowth: 1.95, durationsSec: STD_DURATIONS, hp: 450, hpGrowth: 1.2 },
      (level) => ({ damage: Math.round(14 * Math.pow(1.2, level - 1)), range: 6, attackInterval: 1.0 }),
    ),
  },
  heavy_tower: {
    type: 'heavy_tower',
    name: 'Heavy Tower',
    description: 'Slow catapult tower with splash damage. Focuses the toughest enemy in range.',
    category: 'defense',
    size: 2,
    maxLevel: 10,
    targeting: 'strongest',
    maxCountByHq: [0, 0, 1, 1, 1, 2, 2, 2, 3, 3],
    levels: levelTable(
      { gold: 800, wood: 600, stone: 600, costGrowth: 1.9, durationsSec: STD_DURATIONS, hp: 900, hpGrowth: 1.2, hqRequired: (l) => Math.max(3, l - 1) },
      (level) => ({ damage: Math.round(40 * Math.pow(1.2, level - 1)), range: 5, attackInterval: 2.5, splashRadius: 1.2 }),
    ),
  },
  wall: {
    type: 'wall',
    name: 'Wall',
    description: 'Blocks enemy paths. Troops must break through or walk around.',
    category: 'defense',
    size: 1,
    maxLevel: 10,
    maxCountByHq: [8, 16, 24, 32, 40, 50, 60, 70, 80, 90],
    levels: levelTable(
      { gold: 30, wood: 50, stone: 0, costGrowth: 1.8, durationsSec: WALL_DURATIONS, hp: 300, hpGrowth: 1.38 },
      () => ({}),
    ).map((l) => ({
      ...l,
      // From level 5 walls are made of stone.
      cost: l.level >= 5 ? { gold: l.cost.gold, wood: Math.round(l.cost.wood * 0.2), stone: l.cost.wood } : l.cost,
    })),
  },
};

/** Visual tiers shared by walls, towers and the HQ (used by the renderer and the UI). */
export const VISUAL_TIERS = [
  { minLevel: 1, name: 'Wooden' },
  { minLevel: 3, name: 'Reinforced Timber' },
  { minLevel: 5, name: 'Stone' },
  { minLevel: 7, name: 'Fortified Masonry' },
  { minLevel: 9, name: 'Royal' },
  { minLevel: 10, name: 'Legendary' },
] as const;

export function visualTier(level: number): string {
  let name: string = VISUAL_TIERS[0].name;
  for (const t of VISUAL_TIERS) if (level >= t.minLevel) name = t.name;
  return name;
}
