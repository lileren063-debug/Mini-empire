import type { PveLayoutBuilding } from './pve.js';

export type TerritoryKind = 'neutral' | 'resource' | 'strategic' | 'event';

export interface TerritoryDef {
  id: string;
  name: string;
  kind: TerritoryKind;
  /** Score value (multiplies hold points). */
  value: number;
  /** Map position (0..100 percent) for the world map. */
  mapX: number;
  mapY: number;
  /** Garrison strength level used to build its NPC defense. */
  garrisonLevel: number;
  adjacent: string[];
}

export const TERRITORY_RULES = {
  /** After a capture the territory cannot be attacked for this long. */
  captureCooldownHours: 6,
  /** Each player may attack each territory at most this many times per UTC day. */
  attemptsPerPlayerPerDay: 2,
  /** Stars required to capture. */
  starsToCapture: 2,
  /** Owned territories gain this many garrison levels while held (owner fortification). */
  ownedGarrisonBonus: 1,
};

const T = (id: string, name: string, kind: TerritoryKind, value: number, mapX: number, mapY: number, garrisonLevel: number, adjacent: string[]): TerritoryDef => ({ id, name, kind, value, mapX, mapY, garrisonLevel, adjacent });

export const TERRITORIES: TerritoryDef[] = [
  T('t01', 'Greenvale', 'neutral', 1, 15, 20, 3, ['t02', 't05']),
  T('t02', 'Goldcrest Mines', 'resource', 2, 35, 12, 4, ['t01', 't03', 't06']),
  T('t03', 'Timberwood', 'resource', 2, 58, 15, 4, ['t02', 't04', 't07']),
  T('t04', 'Frostpeak', 'neutral', 1, 82, 18, 3, ['t03', 't08']),
  T('t05', 'Riverford', 'neutral', 1, 12, 45, 3, ['t01', 't06', 't09']),
  T('t06', 'Stonehold Quarry', 'resource', 2, 33, 38, 5, ['t02', 't05', 't07', 't10']),
  T('t07', 'Crown Citadel', 'strategic', 4, 55, 42, 7, ['t03', 't06', 't08', 't11']),
  T('t08', 'Eagle Pass', 'strategic', 3, 80, 40, 6, ['t04', 't07', 't12']),
  T('t09', 'Marshlands', 'neutral', 1, 15, 70, 3, ['t05', 't10']),
  T('t10', 'Sunfield', 'resource', 2, 38, 65, 4, ['t06', 't09', 't11']),
  T('t11', 'Dragon Shrine', 'event', 3, 60, 68, 8, ['t07', 't10', 't12']),
  T('t12', 'Iron Coast', 'strategic', 3, 84, 66, 6, ['t08', 't11']),
  T('t13', 'Wolf Hollow', 'neutral', 1, 28, 86, 3, ['t09', 't10']),
  T('t14', 'Amber Bay', 'resource', 2, 70, 88, 5, ['t11', 't12']),
];

/** Build the NPC garrison layout for a territory at a given garrison level. */
export function territoryGarrison(level: number): PveLayoutBuilding[] {
  const lvl = Math.min(10, Math.max(1, level));
  const out: PveLayoutBuilding[] = [{ type: 'headquarters', level: lvl, x: 10, y: 10 }];
  out.push({ type: 'archer_tower', level: lvl, x: 6, y: 6 }, { type: 'archer_tower', level: lvl, x: 15, y: 15 });
  if (lvl >= 4) out.push({ type: 'heavy_tower', level: lvl, x: 15, y: 6 });
  if (lvl >= 6) out.push({ type: 'archer_tower', level: lvl, x: 6, y: 15 });
  if (lvl >= 8) out.push({ type: 'heavy_tower', level: lvl, x: 10, y: 16 });
  for (let x = 9; x <= 13; x++) {
    out.push({ type: 'wall', level: lvl, x, y: 8 });
    out.push({ type: 'wall', level: lvl, x, y: 14 });
  }
  for (let y = 9; y <= 13; y++) {
    out.push({ type: 'wall', level: lvl, x: 8, y });
    out.push({ type: 'wall', level: lvl, x: 14, y });
  }
  out.push({ type: 'storage', level: lvl, x: 3, y: 10 }, { type: 'gold_mine', level: lvl, x: 19, y: 10 });
  return out;
}
