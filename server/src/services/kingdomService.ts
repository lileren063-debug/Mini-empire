import { randomUUID } from 'node:crypto';
import { hqLevel, kingdomPower, settle, type GameEvent, type KingdomState, type RuleCtx } from '@mini-empire/shared';
import type { AppContext } from '../context.js';
import type { Tx } from '../db.js';
import { cloneState, loadKingdom, logResourceTx, saveKingdom, type LoadedKingdom } from './kingdomRepo.js';
import { markActiveDay, processGameEvents } from './progress.js';

export function ruleCtx(ctx: AppContext, now: number): RuleCtx {
  return { now, cfg: ctx.cfg, newId: randomUUID };
}

/**
 * The single entry point for changing a kingdom:
 *  1. lock the kingdom row (serialises concurrent requests from the same player),
 *  2. settle timers to trusted server time,
 *  3. run the action (pure game rules from @mini-empire/shared),
 *  4. persist the diff, audit the balance change and turn rule events into mission progress.
 * Everything happens inside the caller's transaction, so a failure changes nothing.
 */
export async function withKingdom<T>(
  ctx: AppContext,
  tx: Tx,
  userId: string,
  reason: string,
  action: (state: KingdomState, rc: RuleCtx, k: LoadedKingdom) => { result: T; events?: GameEvent[]; ref?: string } | Promise<{ result: T; events?: GameEvent[]; ref?: string }>,
): Promise<{ result: T; state: KingdomState; kingdom: LoadedKingdom }> {
  const now = ctx.now();
  const k = await loadKingdom(tx, userId, true);
  const before = cloneState(k.state);
  const rc = ruleCtx(ctx, now);
  const settleEvents = settle(k.state, rc);
  const afterSettle = cloneState(k.state);
  const out = await action(k.state, rc, k);
  await saveKingdom(tx, k.kingdomId, before, k.state, { hqLevel: hqLevel(k.state), power: kingdomPower(k.state, ctx.cfg) });
  await logResourceTx(tx, k.kingdomId, userId, afterSettle.resources, k.state.resources, reason, out.ref);
  await processGameEvents(tx, ctx.cfg, userId, [...settleEvents, ...(out.events ?? [])], now);
  if (reason !== 'view' && reason !== 'defense') await markActiveDay(tx, userId, now);
  return { result: out.result, state: k.state, kingdom: k };
}
