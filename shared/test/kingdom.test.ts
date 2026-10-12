import { describe, it, expect } from 'vitest';
import {
  createStartingKingdom, placeBuilding, startUpgrade, settle, collect, cancelUpgrade, moveBuilding,
  storageCapacity, producedAmount, validatePlacement, hqLevel, GameRuleError, DEFAULT_CONFIG, PVE_STAGES,
  territoryGarrison, TERRITORIES, GRID_SIZE, type KingdomState,
} from '../src/index.js';
import { ctx, T0 } from './helpers.js';

const H = 3_600_000;
const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as GameRuleError).code; } return 'NO_ERROR'; };

function rich(k: KingdomState) { k.resources = { gold: 1e6, wood: 1e6, stone: 1e6 }; }

describe('starting kingdom', () => {
  it('contains exactly a level-1 HQ, a level-1 defensive tower and one level-1 wall', () => {
    const k = createStartingKingdom(ctx());
    expect(k.buildings.map((b) => [b.type, b.level]).sort()).toEqual([['archer_tower', 1], ['headquarters', 1], ['wall', 1]]);
    expect(k.resources).toEqual(DEFAULT_CONFIG.economy.startingResources);
    expect(k.trainingQueue).toEqual([]);
    expect(Object.values(k.troops).every((v) => v === 0)).toBe(true);
  });
  it('starting layout is a valid placement', () => {
    const k = createStartingKingdom(ctx());
    for (const b of k.buildings) {
      expect(validatePlacement(k.buildings, b.type, b.x, b.y, DEFAULT_CONFIG, b.id).ok).toBe(true);
    }
  });
});

describe('placement validation', () => {
  it('rejects overlap, out-of-bounds, deploy ring and water', () => {
    const k = createStartingKingdom(ctx());
    expect(validatePlacement(k.buildings, 'gold_mine', 11, 11, DEFAULT_CONFIG)).toMatchObject({ ok: false, code: 'OVERLAP' });
    expect(validatePlacement(k.buildings, 'gold_mine', 0, 5, DEFAULT_CONFIG)).toMatchObject({ ok: false, code: 'INVALID_TERRAIN' });
    expect(validatePlacement(k.buildings, 'gold_mine', GRID_SIZE - 2, 5, DEFAULT_CONFIG)).toMatchObject({ ok: false, code: 'INVALID_TERRAIN' });
    expect(validatePlacement(k.buildings, 'gold_mine', 3, 17, DEFAULT_CONFIG)).toMatchObject({ ok: false, code: 'INVALID_TERRAIN' });
    expect(validatePlacement(k.buildings, 'gold_mine', 2.5, 4, DEFAULT_CONFIG)).toMatchObject({ ok: false });
    expect(validatePlacement(k.buildings, 'gold_mine', 2, 4, DEFAULT_CONFIG)).toEqual({ ok: true });
  });
  it('placeBuilding enforces placement, count limits and cost', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    expect(code(() => placeBuilding(k, c, 'gold_mine', 11, 11))).toBe('OVERLAP');
    const before = { ...k.resources };
    const { building } = placeBuilding(k, c, 'gold_mine', 2, 2);
    const cost = DEFAULT_CONFIG.buildings.gold_mine.levels[0].cost;
    expect(k.resources.gold).toBe(before.gold - cost.gold);
    expect(k.resources.wood).toBe(before.wood - cost.wood);
    expect(building.level).toBe(0);
    rich(k);
    // HQ1 allows only one gold mine.
    expect(code(() => placeBuilding(k, c, 'gold_mine', 5, 2))).toBe('LIMIT_REACHED');
    // Heavy tower requires HQ 3.
    expect(code(() => placeBuilding(k, c, 'heavy_tower', 5, 2))).toBe('LIMIT_REACHED');
    expect(code(() => placeBuilding(k, c, 'headquarters', 5, 2))).toBe('NOT_PLACEABLE');
  });
  it('move validates the new spot', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    const tower = k.buildings.find((b) => b.type === 'archer_tower')!;
    expect(code(() => moveBuilding(k, c, tower.id, 10, 10))).toBe('OVERLAP');
    moveBuilding(k, c, tower.id, 4, 4);
    expect([tower.x, tower.y]).toEqual([4, 4]);
  });
});

describe('upgrades', () => {
  it('requires resources and deducts them atomically', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    k.resources = { gold: 10, wood: 10, stone: 0 };
    const hq = k.buildings.find((b) => b.type === 'headquarters')!;
    expect(code(() => startUpgrade(k, c, hq.id))).toBe('INSUFFICIENT_RESOURCES');
    expect(k.resources).toEqual({ gold: 10, wood: 10, stone: 0 });
    expect(hq.upgrade).toBeNull();
  });
  it('requires HQ level, prerequisites and a free builder', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    rich(k);
    const wall = k.buildings.find((b) => b.type === 'wall')!;
    // Wall level 3 requires HQ 2.
    startUpgrade(k, c, wall.id);
    settle(k, ctx(T0 + H));
    expect(wall.level).toBe(2);
    expect(code(() => startUpgrade(k, ctx(T0 + H), wall.id))).toBe('HQ_TOO_LOW');
    const hq = k.buildings.find((b) => b.type === 'headquarters')!;
    startUpgrade(k, ctx(T0 + H), hq.id);
    // HQ 1 has one builder.
    const tower = k.buildings.find((b) => b.type === 'archer_tower')!;
    expect(code(() => startUpgrade(k, ctx(T0 + H), tower.id))).toBe('NO_BUILDER');
    expect(code(() => startUpgrade(k, ctx(T0 + H), hq.id))).toBe('ALREADY_UPGRADING');
    settle(k, ctx(T0 + 2 * H));
    expect(hqLevel(k)).toBe(2);
    // HQ 3 requires a Barracks.
    expect(code(() => startUpgrade(k, ctx(T0 + 2 * H), hq.id))).toBe('PREREQUISITE');
  });
  it('timers complete only once the server time passes endsAt', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    rich(k);
    const hq = k.buildings.find((b) => b.type === 'headquarters')!;
    startUpgrade(k, c, hq.id);
    const ends = hq.upgrade!.endsAt;
    expect(settle(k, ctx(ends - 1))).toEqual([]);
    expect(hq.level).toBe(1);
    const ev = settle(k, ctx(ends));
    expect(ev).toEqual([{ type: 'building_upgraded', buildingType: 'headquarters', level: 2 }]);
    expect(settle(k, ctx(ends + 1000))).toEqual([]);
  });
  it('cancel refunds half and removes brand-new buildings', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    const { building } = placeBuilding(k, c, 'lumber_camp', 2, 2);
    const after = { ...k.resources };
    const res = cancelUpgrade(k, c, building.id);
    expect(res.removed).toBe(true);
    expect(k.buildings.find((b) => b.id === building.id)).toBeUndefined();
    expect(k.resources.gold).toBe(after.gold + Math.floor(DEFAULT_CONFIG.buildings.lumber_camp.levels[0].cost.gold / 2));
  });
  it('walls are built instantly at level 1', () => {
    const c = ctx();
    const k = createStartingKingdom(c);
    const { building } = placeBuilding(k, c, 'wall', 2, 2);
    expect(building.level).toBe(1);
    expect(building.upgrade).toBeNull();
  });
});

describe('production', () => {
  function withMine() {
    const c = ctx();
    const k = createStartingKingdom(c);
    const { building } = placeBuilding(k, c, 'gold_mine', 2, 2);
    settle(k, ctx(building.upgrade!.endsAt));
    return { k, mine: building, t: building.lastTickAt };
  }
  it('produces from server timestamps, including offline', () => {
    const { k, mine, t } = withMine();
    const rate = DEFAULT_CONFIG.buildings.gold_mine.levels[0].productionPerHour!;
    expect(producedAmount(mine, t + 2 * H, DEFAULT_CONFIG)).toBeCloseTo(rate * 2);
    k.resources.gold = 0;
    const { collected } = collect(k, ctx(t + 2 * H));
    expect(collected.gold).toBe(rate * 2);
    // Collecting again at the same time yields nothing (no duplication).
    expect(collect(k, ctx(t + 2 * H)).collected.gold).toBe(0);
  });
  it('stops producing when the building buffer is full and caps offline time', () => {
    const { mine, t } = withMine();
    const lvl = DEFAULT_CONFIG.buildings.gold_mine.levels[0];
    expect(producedAmount(mine, t + 1000 * H, DEFAULT_CONFIG)).toBe(lvl.bufferCap);
    // Clock going backwards never produces negative amounts.
    expect(producedAmount(mine, t - 5 * H, DEFAULT_CONFIG)).toBe(0);
  });
  it('collection is limited by storage capacity and keeps the remainder', () => {
    const { k, mine, t } = withMine();
    const cap = storageCapacity(k, DEFAULT_CONFIG);
    k.resources.gold = cap - 100;
    const { collected } = collect(k, ctx(t + 5 * H));
    expect(collected.gold).toBe(100);
    expect(k.resources.gold).toBe(cap);
    expect(mine.stored).toBeGreaterThan(0);
  });
  it('producer earns at old rate until its upgrade completes', () => {
    const { k, mine, t } = withMine();
    rich(k);
    const lv1 = DEFAULT_CONFIG.buildings.gold_mine.levels[0].productionPerHour!;
    const lv2 = DEFAULT_CONFIG.buildings.gold_mine.levels[1].productionPerHour!;
    startUpgrade(k, ctx(t), mine.id);
    const ends = mine.upgrade!.endsAt; // 2 minutes
    settle(k, ctx(t + H));
    const expected = (lv1 * (ends - t)) / H + (lv2 * (t + H - ends)) / H;
    expect(producedAmount(mine, t + H, DEFAULT_CONFIG)).toBeCloseTo(expected, 5);
  });
});

describe('content tables', () => {
  it('every building has 10 levels with increasing cost and hp', () => {
    for (const def of Object.values(DEFAULT_CONFIG.buildings)) {
      expect(def.levels).toHaveLength(10);
      for (let i = 1; i < 10; i++) {
        expect(def.levels[i].hp).toBeGreaterThan(def.levels[i - 1].hp);
        const tot = (l: typeof def.levels[0]) => l.cost.gold + l.cost.wood + l.cost.stone;
        expect(tot(def.levels[i])).toBeGreaterThanOrEqual(tot(def.levels[i - 1]));
      }
    }
  });
  it('PvE stages and territory garrisons have valid, non-overlapping layouts', () => {
    const layouts = [...PVE_STAGES.map((s) => s.layout), ...TERRITORIES.map((t) => territoryGarrison(t.garrisonLevel))];
    for (const layout of layouts) {
      const placed: KingdomState['buildings'] = [];
      for (const b of layout) {
        const r = validatePlacement(placed, b.type, b.x, b.y, DEFAULT_CONFIG);
        expect(r, `${b.type}@${b.x},${b.y}`).toEqual({ ok: true });
        placed.push({ id: String(placed.length), type: b.type, level: b.level, x: b.x, y: b.y, upgrade: null, stored: 0, lastTickAt: 0 });
      }
    }
  });
});
