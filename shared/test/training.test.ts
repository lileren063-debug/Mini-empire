import { describe, it, expect } from 'vitest';
import { createStartingKingdom, placeBuilding, settle, enqueueTraining, cancelTraining, housingUsed, armyCapacity, startUpgrade, DEFAULT_CONFIG, GameRuleError } from '../src/index.js';
import { ctx, T0 } from './helpers.js';

const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as GameRuleError).code; } return 'NO_ERROR'; };

function withBarracks() {
  const c = ctx();
  const k = createStartingKingdom(c);
  k.resources = { gold: 100000, wood: 100000, stone: 100000 };
  const { building } = placeBuilding(k, c, 'barracks', 3, 3);
  const t = building.upgrade!.endsAt;
  settle(k, ctx(t));
  return { k, t, barracks: building };
}

describe('training queue', () => {
  it('requires a barracks and an unlocked troop', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    expect(code(() => enqueueTraining(k, c, 'infantry', 1))).toBe('NO_BARRACKS');
    const { k: k2, t } = withBarracks();
    expect(code(() => enqueueTraining(k2, ctx(t), 'archer', 1))).toBe('TROOP_LOCKED');
    expect(code(() => enqueueTraining(k2, ctx(t), 'infantry', 0))).toBe('INVALID_COUNT');
    expect(code(() => enqueueTraining(k2, ctx(t), 'infantry', 1.5))).toBe('INVALID_COUNT');
  });
  it('charges the cost and only delivers troops when training time has passed', () => {
    const { k, t } = withBarracks();
    const gold = k.resources.gold;
    enqueueTraining(k, ctx(t), 'infantry', 5);
    expect(k.resources.gold).toBe(gold - 5 * DEFAULT_CONFIG.troops.infantry.cost.gold);
    expect(k.troops.infantry).toBe(0);
    const per = DEFAULT_CONFIG.troops.infantry.trainSec * 1000;
    settle(k, ctx(t + per * 2 + 10));
    expect(k.troops.infantry).toBe(2);
    expect(k.trainingQueue[0].remaining).toBe(3);
    settle(k, ctx(t + per * 2 + 10)); // idempotent
    expect(k.troops.infantry).toBe(2);
    settle(k, ctx(t + per * 10));
    expect(k.troops.infantry).toBe(5);
    expect(k.trainingQueue).toHaveLength(0);
  });
  it('enforces army capacity including queued units', () => {
    const { k, t } = withBarracks();
    const cap = armyCapacity(k, DEFAULT_CONFIG);
    enqueueTraining(k, ctx(t), 'infantry', cap);
    expect(housingUsed(k, DEFAULT_CONFIG)).toBe(cap);
    expect(code(() => enqueueTraining(k, ctx(t), 'infantry', 1))).toBe('ARMY_FULL');
  });
  it('queue items run sequentially and cancellation refunds correctly', () => {
    const { k, t } = withBarracks();
    enqueueTraining(k, ctx(t), 'infantry', 2);
    enqueueTraining(k, ctx(t), 'infantry', 3);
    const per = DEFAULT_CONFIG.troops.infantry.trainSec * 1000;
    expect(k.trainingQueue[1].startsAt).toBe(t + 2 * per);
    const gold = k.resources.gold;
    // Cancel first item while its first unit is in progress: 1 unit full refund, 1 unit half refund.
    cancelTraining(k, ctx(t + per / 2), k.trainingQueue[0].id, 1e9);
    expect(k.resources.gold).toBe(gold + 50 + 25);
    expect(k.trainingQueue).toHaveLength(1);
    expect(k.trainingQueue[0].startsAt).toBe(t + per / 2);
  });
  it('higher barracks unlock more troops', () => {
    const { k, t, barracks } = withBarracks();
    startUpgrade(k, ctx(t), barracks.id);
    settle(k, ctx(barracks.upgrade!.endsAt));
    expect(code(() => enqueueTraining(k, ctx(T0 + 1e9), 'archer', 1))).toBe('NO_ERROR');
  });
});
