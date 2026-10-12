/** Core domain types shared by server (authoritative) and client (display / replay). */

export const RESOURCE_TYPES = ['gold', 'wood', 'stone'] as const;
export type ResourceType = (typeof RESOURCE_TYPES)[number];
export type Resources = Record<ResourceType, number>;

export const BUILDING_TYPES = [
  'headquarters',
  'gold_mine',
  'lumber_camp',
  'stone_quarry',
  'storage',
  'barracks',
  'archer_tower',
  'heavy_tower',
  'wall',
] as const;
export type BuildingType = (typeof BUILDING_TYPES)[number];

export const TROOP_TYPES = ['infantry', 'archer', 'cavalry', 'siege'] as const;
export type TroopType = (typeof TROOP_TYPES)[number];
export type TroopCounts = Record<TroopType, number>;

export interface UpgradeState {
  /** Level the building will have once the timer finishes. */
  toLevel: number;
  startedAt: number; // epoch ms (server clock)
  endsAt: number; // epoch ms (server clock)
}

export interface Building {
  id: string;
  type: BuildingType;
  /** 0 = first construction in progress (not yet functional). */
  level: number;
  x: number;
  y: number;
  upgrade: UpgradeState | null;
  /** Resource producers only: amount already produced but not collected. */
  stored: number;
  /** Resource producers only: last time production was materialised. */
  lastTickAt: number;
}

export interface TrainingItem {
  id: string;
  troop: TroopType;
  /** Units still to be produced by this item. */
  remaining: number;
  perUnitMs: number;
  /** When the *next* unit of this item started training. */
  startsAt: number;
  /** Cost paid per unit (stored so cancellation refunds are exact even if balancing changes). */
  unitCost: Resources;
}

export interface KingdomState {
  resources: Resources;
  buildings: Building[];
  troops: TroopCounts;
  trainingQueue: TrainingItem[];
}

export type GameEvent =
  | { type: 'resources_collected'; amount: number; resources: Resources }
  | { type: 'building_upgraded'; buildingType: BuildingType; level: number }
  | { type: 'building_upgrade_started'; buildingType: BuildingType; toLevel: number }
  | { type: 'troops_trained'; troop: TroopType; count: number }
  | { type: 'troops_training_started'; troop: TroopType; count: number };

export function emptyResources(): Resources {
  return { gold: 0, wood: 0, stone: 0 };
}
export function emptyTroops(): TroopCounts {
  return { infantry: 0, archer: 0, cavalry: 0, siege: 0 };
}
