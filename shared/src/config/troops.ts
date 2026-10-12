import type { Resources, TroopType } from '../types.js';

/** Which buildings a troop prefers to attack. */
export type TargetPriority = 'any' | 'defense' | 'resource';

export interface TroopDef {
  type: TroopType;
  name: string;
  description: string;
  hp: number;
  damage: number;
  /** Seconds between attacks. */
  attackInterval: number;
  /** Tiles per second. */
  moveSpeed: number;
  /** Attack range in tiles (distance to the target's footprint edge). */
  range: number;
  cost: Resources;
  trainSec: number;
  /** Army capacity consumed per unit. */
  housing: number;
  /** Barracks level needed to train. */
  barracksLevel: number;
  targetPriority: TargetPriority;
  /** Damage multipliers against building categories. */
  damageModifiers: { wall: number; defense: number; other: number };
}

export const TROOPS: Record<TroopType, TroopDef> = {
  infantry: {
    type: 'infantry',
    name: 'Infantry',
    description: 'Balanced frontline fighters. Attack the nearest building.',
    hp: 130,
    damage: 14,
    attackInterval: 1.0,
    moveSpeed: 1.0,
    range: 0.6,
    cost: { gold: 50, wood: 25, stone: 0 },
    trainSec: 20,
    housing: 1,
    barracksLevel: 1,
    targetPriority: 'any',
    damageModifiers: { wall: 1, defense: 1, other: 1 },
  },
  archer: {
    type: 'archer',
    name: 'Archers',
    description: 'Ranged attackers that shoot over walls. Fragile up close.',
    hp: 60,
    damage: 11,
    attackInterval: 1.0,
    moveSpeed: 1.1,
    range: 3.5,
    cost: { gold: 70, wood: 40, stone: 0 },
    trainSec: 25,
    housing: 1,
    barracksLevel: 2,
    targetPriority: 'any',
    damageModifiers: { wall: 0.5, defense: 1, other: 1 },
  },
  cavalry: {
    type: 'cavalry',
    name: 'Cavalry',
    description: 'Fast, tough riders that charge straight for defensive towers.',
    hp: 300,
    damage: 24,
    attackInterval: 1.2,
    moveSpeed: 2.0,
    range: 0.6,
    cost: { gold: 160, wood: 0, stone: 60 },
    trainSec: 60,
    housing: 3,
    barracksLevel: 4,
    targetPriority: 'defense',
    damageModifiers: { wall: 1, defense: 1.2, other: 1 },
  },
  siege: {
    type: 'siege',
    name: 'Siege Ram',
    description: 'Smashes walls and towers. Slow and helpless without an escort.',
    hp: 450,
    damage: 60,
    attackInterval: 3.0,
    moveSpeed: 0.6,
    range: 0.6,
    cost: { gold: 300, wood: 300, stone: 120 },
    trainSec: 180,
    housing: 5,
    barracksLevel: 6,
    targetPriority: 'defense',
    damageModifiers: { wall: 4, defense: 2, other: 0.5 },
  },
};

/** Troop stats grow with Barracks level ("army progression"). */
export const TROOP_LEVEL_BONUS_PER_BARRACKS_LEVEL = 0.06;

export function troopStatMultiplier(barracksLevel: number): number {
  return 1 + TROOP_LEVEL_BONUS_PER_BARRACKS_LEVEL * Math.max(0, barracksLevel - 1);
}

/** Cancelling a training item refunds this share for units not yet completed. */
export const TRAINING_CANCEL_REFUND = 1.0;
/** ...except the unit currently in training, which refunds this share. */
export const TRAINING_CANCEL_REFUND_IN_PROGRESS = 0.5;
/** Max simultaneous items in the training queue. */
export const TRAINING_QUEUE_MAX_ITEMS = 6;
