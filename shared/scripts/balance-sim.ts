/**
 * Balance simulation: plays a "regular, non-hardcore" player through the real game rules and
 * reports how many days it takes to reach each Headquarters level. Target: HQ 10 in ~90 days.
 *
 *   npm run balance                 # 3 sessions/day (default)
 *   npm run balance -- --sessions 2 # casual player
 *   npm run balance -- --table      # also print the HQ level table as markdown
 */
import {
  buildConfig, createStartingKingdom, settle, collect, placeBuilding, startUpgrade, hqLevel, storageCapacity,
  builderCount, activeConstructions, validatePlacement, grantResources, hasResources, GRID_SIZE,
  type BuildingType, type KingdomState, type RuleCtx, type Tunables,
} from '../src/index.js';

const args = process.argv.slice(2);
const sessionsPerDay = Number(args[args.indexOf('--sessions') + 1]) || 3;
const tunables: Tunables = {};
const cfg = buildConfig(tunables);
const DAY = 86_400_000;
const H = 3_600_000;
const start = Date.UTC(2026, 0, 1);
let id = 0;
const mk = (now: number): RuleCtx => ({ now, cfg, newId: () => `b${++id}` });

const sessionHours = sessionsPerDay === 1 ? [19] : sessionsPerDay === 2 ? [8, 20] : [8, 13, 20];
/** Approximate daily mission rewards a regular player claims (collect + construction missions). */
const dailyMissionReward = { gold: 500, wood: 500, stone: 200 };
const weeklyMissionReward = { gold: 5500, wood: 5500, stone: 3000 };

function findSpot(k: KingdomState, type: BuildingType): [number, number] | null {
  for (let y = 1; y < GRID_SIZE - 1; y++) for (let x = 1; x < GRID_SIZE - 1; x++) {
    if (validatePlacement(k.buildings, type, x, y, cfg).ok) return [x, y];
  }
  return null;
}

function tryAct(k: KingdomState, c: RuleCtx, fn: () => unknown): boolean {
  try { fn(); return true; } catch { return false; }
}

function session(k: KingdomState, now: number) {
  const c = mk(now);
  settle(k, c);
  collect(k, c);
  for (let guard = 0; guard < 20 && activeConstructions(k) < builderCount(k, cfg); guard++) {
    const hq = k.buildings.find((b) => b.type === 'headquarters')!;
    const hqNext = cfg.buildings.headquarters.levels[hq.level];
    let acted = false;
    // 1. New buildings (economy first).
    for (const t of ['gold_mine', 'lumber_camp', 'stone_quarry', 'storage', 'barracks', 'archer_tower', 'heavy_tower'] as BuildingType[]) {
      const count = k.buildings.filter((b) => b.type === t).length;
      if (count < cfg.buildings[t].maxCountByHq[hqLevel(k) - 1]) {
        const spot = findSpot(k, t);
        if (spot && tryAct(k, c, () => placeBuilding(k, c, t, spot[0], spot[1]))) { acted = true; break; }
      }
    }
    if (acted) continue;
    // 2. HQ upgrade.
    if (hqNext && !hq.upgrade && tryAct(k, c, () => startUpgrade(k, c, hq.id))) continue;
    // 3. HQ prerequisites.
    if (hqNext && !hq.upgrade) {
      for (const req of hqNext.requires ?? []) {
        const b = k.buildings.filter((x) => x.type === req.type && !x.upgrade).sort((a, b2) => b2.level - a.level)[0];
        if (b && b.level < req.level && tryAct(k, c, () => startUpgrade(k, c, b.id))) { acted = true; break; }
      }
      if (acted) continue;
      // 4. Storage if HQ cost does not fit.
      if (Math.max(hqNext.cost.gold, hqNext.cost.wood, hqNext.cost.stone) > storageCapacity(k, cfg)) {
        const s = k.buildings.filter((x) => x.type === 'storage' && !x.upgrade).sort((a, b2) => a.level - b2.level)[0];
        if (s && tryAct(k, c, () => startUpgrade(k, c, s.id))) continue;
      }
      // Save up for the HQ if it is affordable within ~a day of income: don't spend on other things.
      if (hasResources(k.resources, hqNext.cost)) continue;
    }
    // 5. Producers / storage, lowest level first.
    const cands = k.buildings
      .filter((b) => !b.upgrade && ['gold_mine', 'lumber_camp', 'stone_quarry', 'storage', 'barracks', 'archer_tower'].includes(b.type))
      .sort((a, b2) => a.level - b2.level);
    for (const b of cands) if (tryAct(k, c, () => startUpgrade(k, c, b.id))) { acted = true; break; }
    if (!acted) break;
  }
}

const k = createStartingKingdom(mk(start));
const reached: Record<number, number> = { 1: 0 };
for (let day = 0; day < 200 && hqLevel(k) < 10; day++) {
  for (const h of sessionHours) session(k, start + day * DAY + h * H);
  grantResources(k, cfg, dailyMissionReward);
  if (day % 7 === 6) grantResources(k, cfg, weeklyMissionReward);
  settle(k, mk(start + (day + 1) * DAY));
  const lvl = hqLevel(k);
  if (!(lvl in reached)) reached[lvl] = day + 1;
}
console.log(`Sessions per day: ${sessionsPerDay} (${sessionHours.join(':00, ')}:00 UTC)`);
console.log('HQ level -> day reached');
for (const [lvl, day] of Object.entries(reached)) console.log(`  HQ ${lvl.padStart(2)}: day ${day}`);
console.log(`Final buildings: ${k.buildings.length}, levels: ${k.buildings.filter((b) => b.type !== 'wall').map((b) => `${b.type}:${b.level}`).join(' ')}`);

if (args.includes('--table')) {
  console.log('\n| HQ level | Gold | Wood | Stone | Duration | Storage | Builders | Requires |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const l of cfg.buildings.headquarters.levels) {
    const d = l.durationSec >= 86400 ? `${l.durationSec / 86400} d` : l.durationSec >= 3600 ? `${l.durationSec / 3600} h` : `${l.durationSec / 60} min`;
    console.log(`| ${l.level} | ${l.cost.gold} | ${l.cost.wood} | ${l.cost.stone} | ${d} | ${l.storageCap} | ${l.builders} | ${(l.requires ?? []).map((r) => `${r.type} ${r.level}`).join(', ') || '-'} |`);
  }
}
