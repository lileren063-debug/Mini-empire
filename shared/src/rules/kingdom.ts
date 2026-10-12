import type { GameConfig } from '../config/index.js';
import { STARTING_LAYOUT } from '../config/map.js';
import {
  emptyTroops,
  type Building,
  type BuildingType,
  type GameEvent,
  type KingdomState,
  type Resources,
} from '../types.js';
import { fail } from './errors.js';
import { validatePlacement } from './grid.js';
import { creditCapped, scaleResources, spend, addResources } from './resources.js';
import { settleTraining } from './training.js';

export interface RuleCtx {
  /** Trusted server time (epoch ms). */
  now: number;
  cfg: GameConfig;
  newId: () => string;
}

const HOUR_MS = 3_600_000;

export function createStartingKingdom(ctx: RuleCtx): KingdomState {
  return {
    resources: { ...ctx.cfg.economy.startingResources },
    buildings: STARTING_LAYOUT.map((s) => ({
      id: ctx.newId(),
      type: s.type,
      level: 1,
      x: s.x,
      y: s.y,
      upgrade: null,
      stored: 0,
      lastTickAt: ctx.now,
    })),
    troops: emptyTroops(),
    trainingQueue: [],
  };
}

export function hqLevel(state: KingdomState): number {
  return state.buildings.find((b) => b.type === 'headquarters')?.level ?? 1;
}

export function buildingLevelStats(cfg: GameConfig, type: BuildingType, level: number) {
  return level >= 1 ? cfg.buildings[type].levels[level - 1] : undefined;
}

export function storageCapacity(state: KingdomState, cfg: GameConfig): number {
  let cap = 0;
  for (const b of state.buildings) {
    if (b.level < 1) continue;
    if (b.type === 'headquarters' || b.type === 'storage') cap += cfg.buildings[b.type].levels[b.level - 1].storageCap ?? 0;
  }
  return Math.min(cap, cfg.economy.hardResourceCeiling);
}

export function builderCount(state: KingdomState, cfg: GameConfig): number {
  return cfg.buildings.headquarters.levels[hqLevel(state) - 1].builders ?? 1;
}

export function activeConstructions(state: KingdomState): number {
  return state.buildings.filter((b) => b.upgrade).length;
}

export function countOfType(state: KingdomState, type: BuildingType): number {
  return state.buildings.filter((b) => b.type === type).length;
}

export function maxCountOfType(state: KingdomState, type: BuildingType, cfg: GameConfig): number {
  return cfg.buildings[type].maxCountByHq[hqLevel(state) - 1] ?? 0;
}

/** Amount (fractional) a producer holds at `now`. Production stops at the building's buffer cap. */
export function producedAmount(b: Building, now: number, cfg: GameConfig): number {
  const def = cfg.buildings[b.type];
  if (!def.produces || b.level < 1) return 0;
  const lvl = def.levels[b.level - 1];
  const maxElapsed = cfg.economy.maxOfflineAccrualHours * HOUR_MS;
  const elapsed = Math.max(0, Math.min(now - b.lastTickAt, maxElapsed));
  const produced = b.stored + ((lvl.productionPerHour ?? 0) * elapsed) / HOUR_MS;
  return Math.min(lvl.bufferCap ?? 0, produced);
}

/**
 * Bring the kingdom up to `now`: finish constructions whose timers have elapsed (in time order,
 * so producers earn at their old level until the upgrade completes) and finish trained troops.
 * Pure function of (state, now): calling it twice with the same `now` is a no-op.
 */
export function settle(state: KingdomState, ctx: RuleCtx): GameEvent[] {
  const events: GameEvent[] = [];
  const due = state.buildings.filter((b) => b.upgrade && b.upgrade.endsAt <= ctx.now).sort((a, b) => a.upgrade!.endsAt - b.upgrade!.endsAt);
  for (const b of due) {
    const up = b.upgrade!;
    if (ctx.cfg.buildings[b.type].produces) {
      if (b.level >= 1) b.stored = producedAmount(b, up.endsAt, ctx.cfg);
      b.lastTickAt = up.endsAt;
    }
    b.level = up.toLevel;
    b.upgrade = null;
    events.push({ type: 'building_upgraded', buildingType: b.type, level: b.level });
  }
  events.push(...settleTraining(state, ctx));
  return events;
}

/** Collect produced resources from one producer (or all, if no id). Limited by storage space. */
export function collect(state: KingdomState, ctx: RuleCtx, buildingId?: string): { collected: Resources; events: GameEvent[] } {
  const cap = storageCapacity(state, ctx.cfg);
  const collected: Resources = { gold: 0, wood: 0, stone: 0 };
  const targets = state.buildings.filter((b) => ctx.cfg.buildings[b.type].produces && (!buildingId || b.id === buildingId));
  if (buildingId && targets.length === 0) fail('NOT_A_PRODUCER', 'That building does not produce resources.');
  for (const b of targets) {
    if (b.level < 1) continue;
    const res = ctx.cfg.buildings[b.type].produces!;
    const produced = producedAmount(b, ctx.now, ctx.cfg);
    const whole = Math.floor(produced);
    const got = creditCapped(state.resources, { gold: 0, wood: 0, stone: 0, [res]: whole } as Resources, cap)[res];
    collected[res] += got;
    b.stored = produced - got;
    b.lastTickAt = ctx.now;
  }
  const amount = collected.gold + collected.wood + collected.stone;
  const events: GameEvent[] = amount > 0 ? [{ type: 'resources_collected', amount, resources: collected }] : [];
  return { collected, events };
}

function checkLevelRequirements(state: KingdomState, type: BuildingType, level: number, ctx: RuleCtx) {
  const def = ctx.cfg.buildings[type];
  const lvl = def.levels[level - 1];
  if (!lvl) fail('MAX_LEVEL', `${def.name} is already at maximum level.`);
  const hq = hqLevel(state);
  if (hq < lvl.hqRequired) fail('HQ_TOO_LOW', `Requires Headquarters level ${lvl.hqRequired}.`);
  for (const req of lvl.requires ?? []) {
    const ok = state.buildings.some((b) => b.type === req.type && b.level >= req.level);
    if (!ok) fail('PREREQUISITE', `Requires ${ctx.cfg.buildings[req.type].name} level ${req.level}.`);
  }
  return lvl;
}

function requireBuilder(state: KingdomState, ctx: RuleCtx) {
  if (activeConstructions(state) >= builderCount(state, ctx.cfg)) {
    fail('NO_BUILDER', 'All builders are busy. Wait for a construction to finish.');
  }
}

export function placeBuilding(state: KingdomState, ctx: RuleCtx, type: BuildingType, x: number, y: number): { building: Building; events: GameEvent[] } {
  const def = ctx.cfg.buildings[type];
  if (!def) fail('UNKNOWN_BUILDING', 'Unknown building type.');
  if (type === 'headquarters') fail('NOT_PLACEABLE', 'You can only have one Headquarters.');
  if (countOfType(state, type) >= maxCountOfType(state, type, ctx.cfg)) {
    fail('LIMIT_REACHED', `You cannot build more ${def.name}s at this Headquarters level.`);
  }
  const lvl = checkLevelRequirements(state, type, 1, ctx);
  const placement = validatePlacement(state.buildings, type, x, y, ctx.cfg);
  if (!placement.ok) fail(placement.code, placement.reason);
  const instant = lvl.durationSec === 0;
  if (!instant) requireBuilder(state, ctx);
  spend(state.resources, lvl.cost);
  const building: Building = {
    id: ctx.newId(),
    type,
    level: instant ? 1 : 0,
    x,
    y,
    upgrade: instant ? null : { toLevel: 1, startedAt: ctx.now, endsAt: ctx.now + lvl.durationSec * 1000 },
    stored: 0,
    lastTickAt: ctx.now,
  };
  state.buildings.push(building);
  const events: GameEvent[] = instant
    ? [{ type: 'building_upgraded', buildingType: type, level: 1 }]
    : [{ type: 'building_upgrade_started', buildingType: type, toLevel: 1 }];
  return { building, events };
}

export function startUpgrade(state: KingdomState, ctx: RuleCtx, buildingId: string): { building: Building; cost: Resources; events: GameEvent[] } {
  const b = state.buildings.find((x) => x.id === buildingId);
  if (!b) fail('NOT_FOUND', 'Building not found.');
  if (b.upgrade) fail('ALREADY_UPGRADING', 'This building is already being upgraded.');
  const def = ctx.cfg.buildings[b.type];
  if (b.level >= def.maxLevel) fail('MAX_LEVEL', `${def.name} is already at maximum level.`);
  const lvl = checkLevelRequirements(state, b.type, b.level + 1, ctx);
  requireBuilder(state, ctx);
  // Materialise production at the old rate before the timer starts (keeps maths simple & exact).
  if (def.produces) {
    b.stored = producedAmount(b, ctx.now, ctx.cfg);
    b.lastTickAt = ctx.now;
  }
  spend(state.resources, lvl.cost);
  b.upgrade = { toLevel: b.level + 1, startedAt: ctx.now, endsAt: ctx.now + lvl.durationSec * 1000 };
  return { building: b, cost: lvl.cost, events: [{ type: 'building_upgrade_started', buildingType: b.type, toLevel: b.level + 1 }] };
}

/** Cancel an in-progress construction. Refunds a share of the cost; a brand-new building is removed. */
export function cancelUpgrade(state: KingdomState, ctx: RuleCtx, buildingId: string): { refund: Resources; removed: boolean } {
  const b = state.buildings.find((x) => x.id === buildingId);
  if (!b) fail('NOT_FOUND', 'Building not found.');
  if (!b.upgrade) fail('NOT_UPGRADING', 'This building is not being upgraded.');
  const lvl = ctx.cfg.buildings[b.type].levels[b.upgrade.toLevel - 1];
  const refund = scaleResources(lvl.cost, ctx.cfg.economy.upgradeCancelRefund);
  creditCapped(state.resources, refund, Math.max(storageCapacity(state, ctx.cfg), 0));
  let removed = false;
  if (b.level === 0) {
    state.buildings = state.buildings.filter((x) => x.id !== b.id);
    removed = true;
  } else {
    b.upgrade = null;
  }
  return { refund, removed };
}

export function moveBuilding(state: KingdomState, ctx: RuleCtx, buildingId: string, x: number, y: number): Building {
  const b = state.buildings.find((v) => v.id === buildingId);
  if (!b) fail('NOT_FOUND', 'Building not found.');
  const placement = validatePlacement(state.buildings, b.type, x, y, ctx.cfg, b.id);
  if (!placement.ok) fail(placement.code, placement.reason);
  b.x = x;
  b.y = y;
  return b;
}

/** Credit a reward (mission, battle) capped by storage. Returns what was actually credited. */
export function grantResources(state: KingdomState, cfg: GameConfig, amount: Resources): Resources {
  return creditCapped(state.resources, amount, storageCapacity(state, cfg));
}

/** Summary used by matchmaking and war strength. */
export function kingdomPower(state: KingdomState, cfg: GameConfig): number {
  let p = 0;
  for (const b of state.buildings) p += b.level * (b.type === 'wall' ? 1 : b.type === 'headquarters' ? 40 : 10);
  for (const [t, n] of Object.entries(state.troops)) p += n * cfg.troops[t as keyof typeof cfg.troops].housing * 2;
  return p;
}

export function totalCost(costs: Resources[]): Resources {
  return costs.reduce(addResources, { gold: 0, wood: 0, stone: 0 });
}
