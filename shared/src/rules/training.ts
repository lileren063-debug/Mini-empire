import type { GameConfig } from '../config/index.js';
import { TRAINING_CANCEL_REFUND, TRAINING_CANCEL_REFUND_IN_PROGRESS, TRAINING_QUEUE_MAX_ITEMS, troopStatMultiplier } from '../config/troops.js';
import { TROOP_TYPES, type GameEvent, type KingdomState, type Resources, type TroopCounts, type TroopType } from '../types.js';
import { fail } from './errors.js';
import { creditCapped, scaleResources, spend, addResources } from './resources.js';
import type { RuleCtx } from './kingdom.js';

export function barracksLevel(state: KingdomState): number {
  return state.buildings.find((b) => b.type === 'barracks')?.level ?? 0;
}

export function armyCapacity(state: KingdomState, cfg: GameConfig): number {
  const lvl = barracksLevel(state);
  return lvl >= 1 ? cfg.buildings.barracks.levels[lvl - 1].armyCapacity ?? 0 : 0;
}

export function housingOf(counts: Partial<TroopCounts>, cfg: GameConfig): number {
  let h = 0;
  for (const t of TROOP_TYPES) h += (counts[t] ?? 0) * cfg.troops[t].housing;
  return h;
}

export function housingUsed(state: KingdomState, cfg: GameConfig): number {
  let h = housingOf(state.troops, cfg);
  for (const item of state.trainingQueue) h += item.remaining * cfg.troops[item.troop].housing;
  return h;
}

export function troopMultiplier(state: KingdomState): number {
  return troopStatMultiplier(barracksLevel(state));
}

export function queueEndsAt(state: KingdomState, now: number): number {
  let t = now;
  for (const item of state.trainingQueue) t = Math.max(t, item.startsAt + item.remaining * item.perUnitMs);
  return t;
}

export function enqueueTraining(state: KingdomState, ctx: RuleCtx, troop: TroopType, count: number): { cost: Resources; events: GameEvent[] } {
  if (!TROOP_TYPES.includes(troop)) fail('UNKNOWN_TROOP', 'Unknown troop type.');
  if (!Number.isInteger(count) || count < 1 || count > 100) fail('INVALID_COUNT', 'Count must be a whole number between 1 and 100.');
  const def = ctx.cfg.troops[troop];
  const bl = barracksLevel(state);
  if (bl < 1) fail('NO_BARRACKS', 'Build a Barracks first.');
  if (bl < def.barracksLevel) fail('TROOP_LOCKED', `${def.name} unlock at Barracks level ${def.barracksLevel}.`);
  if (state.trainingQueue.length >= TRAINING_QUEUE_MAX_ITEMS) fail('QUEUE_FULL', 'The training queue is full.');
  const cap = armyCapacity(state, ctx.cfg);
  if (housingUsed(state, ctx.cfg) + count * def.housing > cap) fail('ARMY_FULL', `Not enough army capacity (${cap}). Upgrade the Barracks.`);
  const cost: Resources = { gold: def.cost.gold * count, wood: def.cost.wood * count, stone: def.cost.stone * count };
  spend(state.resources, cost);
  const startsAt = queueEndsAt(state, ctx.now);
  state.trainingQueue.push({ id: ctx.newId(), troop, remaining: count, perUnitMs: def.trainSec * 1000, startsAt, unitCost: { ...def.cost } });
  return { cost, events: [{ type: 'troops_training_started', troop, count }] };
}

/** Move finished units from the queue into the army. Idempotent for a given `now`. */
export function settleTraining(state: KingdomState, ctx: RuleCtx): GameEvent[] {
  const events: GameEvent[] = [];
  const done: Partial<Record<TroopType, number>> = {};
  for (const item of state.trainingQueue) {
    if (ctx.now <= item.startsAt) break;
    const n = Math.min(item.remaining, Math.floor((ctx.now - item.startsAt) / item.perUnitMs));
    if (n <= 0) break;
    item.remaining -= n;
    item.startsAt += n * item.perUnitMs;
    state.troops[item.troop] += n;
    done[item.troop] = (done[item.troop] ?? 0) + n;
    if (item.remaining > 0) break;
  }
  state.trainingQueue = state.trainingQueue.filter((i) => i.remaining > 0);
  for (const [troop, count] of Object.entries(done)) events.push({ type: 'troops_trained', troop: troop as TroopType, count: count! });
  return events;
}

/**
 * Cancel a queue item. Units not yet started are refunded fully, the unit currently in
 * training is refunded at 50%. Refunds are capped by storage space.
 */
export function cancelTraining(state: KingdomState, ctx: RuleCtx, itemId: string, storageCap: number): { refund: Resources } {
  const idx = state.trainingQueue.findIndex((i) => i.id === itemId);
  if (idx < 0) fail('NOT_FOUND', 'Training item not found.');
  const item = state.trainingQueue[idx];
  const inProgress = idx === 0 && ctx.now > item.startsAt ? 1 : 0;
  const refund = addResources(
    scaleResources(item.unitCost, (item.remaining - inProgress) * TRAINING_CANCEL_REFUND),
    scaleResources(item.unitCost, inProgress * TRAINING_CANCEL_REFUND_IN_PROGRESS),
  );
  state.trainingQueue.splice(idx, 1);
  // Later items move up.
  let t = idx === 0 ? ctx.now : state.trainingQueue[idx - 1].startsAt + state.trainingQueue[idx - 1].remaining * state.trainingQueue[idx - 1].perUnitMs;
  for (let i = idx; i < state.trainingQueue.length; i++) {
    const it = state.trainingQueue[i];
    it.startsAt = Math.max(ctx.now, t);
    t = it.startsAt + it.remaining * it.perUnitMs;
  }
  creditCapped(state.resources, refund, storageCap);
  return { refund };
}
