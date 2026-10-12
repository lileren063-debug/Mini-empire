import { RESOURCE_TYPES, type Resources } from '../types.js';
import { fail } from './errors.js';

export function hasResources(balance: Resources, cost: Resources): boolean {
  return RESOURCE_TYPES.every((r) => balance[r] >= cost[r]);
}

export function addResources(a: Resources, b: Resources): Resources {
  return { gold: a.gold + b.gold, wood: a.wood + b.wood, stone: a.stone + b.stone };
}

export function scaleResources(a: Resources, m: number): Resources {
  return { gold: Math.floor(a.gold * m), wood: Math.floor(a.wood * m), stone: Math.floor(a.stone * m) };
}

export function negate(a: Resources): Resources {
  return { gold: -a.gold, wood: -a.wood, stone: -a.stone };
}

export function totalResources(a: Resources): number {
  return a.gold + a.wood + a.stone;
}

/** Deduct `cost` in place. Throws (and changes nothing) if any balance would go negative. */
export function spend(balance: Resources, cost: Resources): void {
  if (!hasResources(balance, cost)) {
    const missing = RESOURCE_TYPES.filter((r) => balance[r] < cost[r])
      .map((r) => `${cost[r] - balance[r]} ${r}`)
      .join(', ');
    fail('INSUFFICIENT_RESOURCES', `Not enough resources (missing ${missing}).`);
  }
  for (const r of RESOURCE_TYPES) balance[r] -= cost[r];
}

/** Credit `amount` in place, capped at `cap` per resource (never reduces an existing balance). */
export function creditCapped(balance: Resources, amount: Resources, cap: number): Resources {
  const credited: Resources = { gold: 0, wood: 0, stone: 0 };
  for (const r of RESOURCE_TYPES) {
    const space = Math.max(0, cap - balance[r]);
    const add = Math.max(0, Math.min(amount[r], space));
    balance[r] += add;
    credited[r] = add;
  }
  return credited;
}
