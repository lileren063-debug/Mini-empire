import { BUILDINGS, type BuildingDef } from './buildings.js';
import { TROOPS, type TroopDef } from './troops.js';
import { ECONOMY, BATTLE_ECONOMY } from './economy.js';
import { MISSIONS, CLAN_MISSIONS, type MissionDef } from './missions.js';
import { CLAN_WAR } from './season.js';
import type { BuildingType, Resources, TroopType } from '../types.js';

export * from './buildings.js';
export * from './troops.js';
export * from './economy.js';
export * from './missions.js';
export * from './season.js';
export * from './scoring.js';
export * from './rewards.js';
export * from './territories.js';
export * from './pve.js';
export * from './map.js';
export * from './progression.js';

/**
 * Operator-adjustable balancing knobs. Stored server-side (game_config table) and edited from
 * the admin panel. Every field is optional; missing fields fall back to the defaults in code.
 */
export interface Tunables {
  productionMultiplier?: number;
  costMultiplier?: number;
  durationMultiplier?: number;
  trainingCostMultiplier?: number;
  trainingDurationMultiplier?: number;
  troopHpMultiplier?: Partial<Record<TroopType, number>>;
  troopDamageMultiplier?: Partial<Record<TroopType, number>>;
  missionRewardMultiplier?: number;
  disabledMissions?: string[];
  battle?: Partial<typeof BATTLE_ECONOMY>;
  clanWar?: Partial<typeof CLAN_WAR>;
}

export interface GameConfig {
  version: string;
  buildings: Record<BuildingType, BuildingDef>;
  troops: Record<TroopType, TroopDef>;
  economy: typeof ECONOMY;
  battle: typeof BATTLE_ECONOMY;
  missions: MissionDef[];
  clanMissions: typeof CLAN_MISSIONS;
  clanWar: typeof CLAN_WAR;
}

const scaleRes = (r: Resources, m: number): Resources => ({
  gold: Math.round(r.gold * m),
  wood: Math.round(r.wood * m),
  stone: Math.round(r.stone * m),
});

/** Merge tunables into the code defaults. Pure: never mutates the defaults. */
export function buildConfig(t: Tunables = {}, version = 'default'): GameConfig {
  const pm = t.productionMultiplier ?? 1;
  const cm = t.costMultiplier ?? 1;
  const dm = t.durationMultiplier ?? 1;
  const buildings = {} as Record<BuildingType, BuildingDef>;
  for (const [type, def] of Object.entries(BUILDINGS) as [BuildingType, BuildingDef][]) {
    buildings[type] = {
      ...def,
      levels: def.levels.map((l) => ({
        ...l,
        cost: scaleRes(l.cost, cm),
        durationSec: Math.round(l.durationSec * dm),
        productionPerHour: l.productionPerHour === undefined ? undefined : Math.round(l.productionPerHour * pm),
        bufferCap: l.bufferCap === undefined ? undefined : Math.round(l.bufferCap * pm),
      })),
    };
  }
  const troops = {} as Record<TroopType, TroopDef>;
  for (const [type, def] of Object.entries(TROOPS) as [TroopType, TroopDef][]) {
    troops[type] = {
      ...def,
      hp: Math.round(def.hp * (t.troopHpMultiplier?.[type] ?? 1)),
      damage: Math.round(def.damage * (t.troopDamageMultiplier?.[type] ?? 1)),
      cost: scaleRes(def.cost, t.trainingCostMultiplier ?? 1),
      trainSec: Math.max(1, Math.round(def.trainSec * (t.trainingDurationMultiplier ?? 1))),
    };
  }
  const mm = t.missionRewardMultiplier ?? 1;
  const disabled = new Set(t.disabledMissions ?? []);
  return {
    version,
    buildings,
    troops,
    economy: ECONOMY,
    battle: { ...BATTLE_ECONOMY, ...(t.battle ?? {}) },
    missions: MISSIONS.map((m) => ({ ...m, reward: scaleRes(m.reward, mm), enabled: m.enabled && !disabled.has(m.id) })),
    clanMissions: CLAN_MISSIONS,
    clanWar: { ...CLAN_WAR, ...(t.clanWar ?? {}) },
  };
}

export const DEFAULT_CONFIG = buildConfig();
