/**
 * Deterministic, tick-based asynchronous battle simulator.
 *
 * The same inputs (layout, army, deployment, seed, config) always produce the same result, on
 * the server and in the browser. The server runs it to decide the authoritative outcome; the
 * client runs it again with `record: true` only to draw the replay.
 *
 * No Math.random, no Date, no iteration over unordered structures: everything is ordered by
 * array index so the simulation is reproducible for debugging and anti-cheat analysis.
 */
import type { GameConfig } from '../config/index.js';
import { GRID_SIZE } from '../config/map.js';
import { POND, tileKey } from '../rules/grid.js';
import { TROOP_TYPES, emptyTroops, type BuildingType, type TroopCounts, type TroopType } from '../types.js';
import { mulberry32 } from './rng.js';

export const TICK_SEC = 0.1;
export const DEFAULT_MAX_TICKS = 1800; // 3 minutes

export type DeploySide = 'north' | 'south' | 'east' | 'west';

export interface DefenseBuilding {
  id: string;
  type: BuildingType;
  level: number;
  x: number;
  y: number;
}

export interface Deployment {
  troop: TroopType;
  count: number;
  side: DeploySide;
}

export interface BattleInput {
  seed: number;
  defense: DefenseBuilding[];
  deployments: Deployment[];
  /** Attacker troop stat multiplier (from Barracks level). */
  attackerMultiplier: number;
  maxTicks?: number;
}

export interface BattleResult {
  victory: boolean;
  stars: number;
  destructionPercent: number;
  hqDestroyed: boolean;
  ticks: number;
  deployed: TroopCounts;
  casualties: TroopCounts;
  survivors: TroopCounts;
  buildingsDestroyed: number;
  totalBuildings: number;
  wallsDestroyed: number;
}

export interface ReplayFrame {
  tick: number;
  units: { id: number; troop: TroopType; x: number; y: number; hp: number; maxHp: number }[];
  buildings: { idx: number; hp: number }[];
  shots: { fromX: number; fromY: number; toX: number; toY: number; kind: 'tower' | 'heavy' | 'unit' }[];
}

interface SimBuilding {
  idx: number;
  id: string;
  type: BuildingType;
  level: number;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  category: 'wall' | 'defense' | 'other';
  damage: number;
  range: number;
  interval: number;
  splash: number;
  targeting: 'nearest' | 'strongest';
  cooldown: number;
}

interface SimUnit {
  id: number;
  troop: TroopType;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  damage: number;
  interval: number;
  speed: number;
  range: number;
  cooldown: number;
  spawnTick: number;
  spawned: boolean;
  alive: boolean;
  target: number; // building idx or -1
  path: number[]; // tile keys
  pathIdx: number;
}

function rectDist(px: number, py: number, b: SimBuilding): number {
  const dx = Math.max(b.x - px, 0, px - (b.x + b.size));
  const dy = Math.max(b.y - py, 0, py - (b.y + b.size));
  return Math.sqrt(dx * dx + dy * dy);
}

/** Attack reach: range plus a small tolerance so a unit on an adjacent (or diagonal) tile centre can hit. */
const reach = (u: { range: number }) => u.range + 0.25;

const WALL_STEP_COST = 8;
const BUILDING_STEP_COST = 40;

/** Dijkstra on the tiny tile grid with a binary heap. Ties are broken by tile key => deterministic. */
function findPath(start: number, isGoal: (k: number) => boolean, stepCost: (k: number) => number): number[] {
  const N = GRID_SIZE * GRID_SIZE;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const done = new Uint8Array(N);
  dist[start] = 0;
  const heap: [number, number][] = [[0, start]];
  const less = (a: [number, number], b: [number, number]) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  const push = (e: [number, number]) => {
    heap.push(e);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && less(heap[l], heap[m])) m = l;
        if (r < heap.length && less(heap[r], heap[m])) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [, cur] = pop();
    if (done[cur]) continue;
    done[cur] = 1;
    if (isGoal(cur)) {
      const path: number[] = [];
      for (let k = cur; k !== -1 && k !== start; k = prev[k]) path.push(k);
      return path.reverse();
    }
    const cx = cur % GRID_SIZE, cy = (cur - cx) / GRID_SIZE;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= GRID_SIZE || ny >= GRID_SIZE) continue;
        const nk = tileKey(nx, ny);
        if (done[nk]) continue;
        const sc = stepCost(nk);
        if (!isFinite(sc)) continue;
        if (dx && dy) {
          // No corner cutting past blocked/occupied tiles.
          if (stepCost(tileKey(cx + dx, cy)) !== 1 || stepCost(tileKey(cx, cy + dy)) !== 1) continue;
        }
        const nd = dist[cur] + sc * (dx && dy ? 1.4142 : 1);
        if (nd < dist[nk]) {
          dist[nk] = nd;
          prev[nk] = cur;
          push([nd, nk]);
        }
      }
    }
  }
  return [];
}

export function simulateBattle(input: BattleInput, cfg: GameConfig, opts: { record?: boolean; frameEvery?: number } = {}): { result: BattleResult; frames: ReplayFrame[] } {
  const rng = mulberry32(input.seed >>> 0);
  const maxTicks = input.maxTicks ?? DEFAULT_MAX_TICKS;
  const frameEvery = opts.frameEvery ?? 2;

  // ---- Buildings
  const buildings: SimBuilding[] = input.defense
    .filter((d) => d.level >= 1)
    .map((d, idx) => {
      const def = cfg.buildings[d.type];
      const lvl = def.levels[Math.min(d.level, def.maxLevel) - 1];
      return {
        idx,
        id: d.id,
        type: d.type,
        level: d.level,
        x: d.x,
        y: d.y,
        size: def.size,
        hp: lvl.hp,
        maxHp: lvl.hp,
        category: d.type === 'wall' ? 'wall' : def.category === 'defense' ? 'defense' : 'other',
        damage: lvl.damage ?? 0,
        range: lvl.range ?? 0,
        interval: lvl.attackInterval ?? 0,
        splash: lvl.splashRadius ?? 0,
        targeting: def.targeting ?? 'nearest',
        cooldown: 0,
      };
    });
  const occupant = new Int32Array(GRID_SIZE * GRID_SIZE).fill(-1);
  for (const b of buildings) {
    for (let dx = 0; dx < b.size; dx++) for (let dy = 0; dy < b.size; dy++) {
      const tx = b.x + dx, ty = b.y + dy;
      if (tx >= 0 && ty >= 0 && tx < GRID_SIZE && ty < GRID_SIZE) occupant[tileKey(tx, ty)] = b.idx;
    }
  }
  const scoring = buildings.filter((b) => b.category !== 'wall');
  const hq = buildings.find((b) => b.type === 'headquarters');

  // ---- Units
  const units: SimUnit[] = [];
  const deployed = emptyTroops();
  let spawnTick = 0;
  for (const dep of input.deployments) {
    if (!TROOP_TYPES.includes(dep.troop) || dep.count <= 0) continue;
    const def = cfg.troops[dep.troop];
    for (let i = 0; i < dep.count; i++) {
      const along = 2 + rng() * (GRID_SIZE - 4);
      const edge = 0.3 + rng() * 0.4;
      let x = 0, y = 0;
      if (dep.side === 'north') { x = along; y = edge; }
      else if (dep.side === 'south') { x = along; y = GRID_SIZE - edge; }
      else if (dep.side === 'west') { x = edge; y = along; }
      else { x = GRID_SIZE - edge; y = along; }
      const hp = Math.round(def.hp * input.attackerMultiplier);
      units.push({
        id: units.length,
        troop: dep.troop,
        x, y,
        hp, maxHp: hp,
        damage: def.damage * input.attackerMultiplier,
        interval: def.attackInterval,
        speed: def.moveSpeed,
        range: def.range,
        cooldown: 0,
        spawnTick,
        spawned: false,
        alive: true,
        target: -1,
        path: [],
        pathIdx: 0,
      });
      deployed[dep.troop]++;
      spawnTick += 2;
    }
  }

  const frames: ReplayFrame[] = [];
  let shots: ReplayFrame['shots'] = [];

  const stepCostFor = (k: number) => {
    if (POND.has(k)) return Infinity;
    const occ = occupant[k];
    if (occ < 0) return 1;
    const b = buildings[occ];
    if (b.hp <= 0) return 1;
    return b.category === 'wall' ? WALL_STEP_COST : BUILDING_STEP_COST;
  };

  const chooseTarget = (u: SimUnit): number => {
    const def = cfg.troops[u.troop];
    let pool = scoring.filter((b) => b.hp > 0);
    if (def.targetPriority !== 'any') {
      const pref = pool.filter((b) => (def.targetPriority === 'defense' ? b.category === 'defense' : cfg.buildings[b.type].category === 'resource'));
      if (pref.length) pool = pref;
    }
    let best = -1, bestD = Infinity;
    for (const b of pool) {
      const d = rectDist(u.x, u.y, b);
      if (d < bestD) { bestD = d; best = b.idx; }
    }
    return best;
  };

  const planPath = (u: SimUnit) => {
    const t = buildings[u.target];
    const start = tileKey(Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(u.x))), Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(u.y))));
    u.path = findPath(
      start,
      (k) => {
        const kx = k % GRID_SIZE, ky = (k - kx) / GRID_SIZE;
        return occupant[k] !== t.idx && rectDist(kx + 0.5, ky + 0.5, t) <= reach(u);
      },
      stepCostFor,
    );
    u.pathIdx = 0;
  };

  const damageBuilding = (u: SimUnit, b: SimBuilding) => {
    const mods = cfg.troops[u.troop].damageModifiers;
    const m = b.category === 'wall' ? mods.wall : b.category === 'defense' ? mods.defense : mods.other;
    b.hp = Math.max(0, b.hp - u.damage * m);
    if (opts.record) shots.push({ fromX: u.x, fromY: u.y, toX: b.x + b.size / 2, toY: b.y + b.size / 2, kind: 'unit' });
  };

  let tick = 0;
  for (; tick < maxTicks; tick++) {
    // Spawn
    for (const u of units) if (!u.spawned && u.spawnTick <= tick) u.spawned = true;

    // Units act
    for (const u of units) {
      if (!u.spawned || !u.alive) continue;
      u.cooldown = Math.max(0, u.cooldown - TICK_SEC);
      if (u.target < 0 || buildings[u.target].hp <= 0) {
        u.target = chooseTarget(u);
        if (u.target < 0) continue;
        planPath(u);
      }
      const target = buildings[u.target];
      if (rectDist(u.x, u.y, target) <= reach(u)) {
        if (u.cooldown <= 0) { damageBuilding(u, target); u.cooldown = u.interval; }
        continue;
      }
      if (u.pathIdx >= u.path.length) { planPath(u); if (!u.path.length) continue; }
      const next = u.path[u.pathIdx];
      const occ = occupant[next];
      if (occ >= 0 && buildings[occ].hp > 0 && occ !== target.idx) {
        // Blocked by a wall (or a building) on the path: break through it.
        if (rectDist(u.x, u.y, buildings[occ]) <= Math.max(reach(u), 0.85)) {
          if (u.cooldown <= 0) { damageBuilding(u, buildings[occ]); u.cooldown = u.interval; }
          continue;
        }
      }
      const nx = (next % GRID_SIZE) + 0.5, ny = Math.floor(next / GRID_SIZE) + 0.5;
      const dx = nx - u.x, dy = ny - u.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const step = u.speed * TICK_SEC;
      if (d <= step) { u.x = nx; u.y = ny; u.pathIdx++; }
      else { u.x += (dx / d) * step; u.y += (dy / d) * step; }
    }

    // Towers act
    for (const b of buildings) {
      if (b.category !== 'defense' || b.hp <= 0) continue;
      b.cooldown = Math.max(0, b.cooldown - TICK_SEC);
      if (b.cooldown > 0) continue;
      let best: SimUnit | null = null, bestScore = Infinity;
      for (const u of units) {
        if (!u.spawned || !u.alive) continue;
        const d = rectDist(u.x, u.y, b);
        if (d > b.range) continue;
        const score = b.targeting === 'strongest' ? -u.hp * 1000 + d : d;
        if (score < bestScore) { bestScore = score; best = u; }
      }
      if (!best) continue;
      const cx = b.x + b.size / 2, cy = b.y + b.size / 2;
      if (b.splash > 0) {
        const tx = best.x, ty = best.y;
        for (const u of units) {
          if (!u.spawned || !u.alive) continue;
          const ddx = u.x - tx, ddy = u.y - ty;
          if (Math.sqrt(ddx * ddx + ddy * ddy) <= b.splash) { u.hp -= b.damage; if (u.hp <= 0) u.alive = false; }
        }
      } else {
        best.hp -= b.damage;
        if (best.hp <= 0) best.alive = false;
      }
      b.cooldown = b.interval;
      if (opts.record) shots.push({ fromX: cx, fromY: cy, toX: best.x, toY: best.y, kind: b.splash > 0 ? 'heavy' : 'tower' });
    }

    if (opts.record && (tick % frameEvery === 0 || shots.length)) {
      frames.push({
        tick,
        units: units.filter((u) => u.spawned && u.alive).map((u) => ({ id: u.id, troop: u.troop, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp })),
        buildings: buildings.map((b) => ({ idx: b.idx, hp: b.hp })),
        shots,
      });
      shots = [];
    }

    const allSpawned = units.every((u) => u.spawned);
    if (scoring.every((b) => b.hp <= 0)) break;
    if (allSpawned && units.every((u) => !u.alive)) break;
  }

  const destroyed = scoring.filter((b) => b.hp <= 0).length;
  const destructionPercent = scoring.length ? Math.floor((destroyed * 100) / scoring.length) : 0;
  const hqDestroyed = !!hq && hq.hp <= 0;
  const stars = (destructionPercent >= 50 ? 1 : 0) + (hqDestroyed ? 1 : 0) + (destructionPercent >= 100 ? 1 : 0);
  const casualties = emptyTroops();
  const survivors = emptyTroops();
  for (const u of units) (u.alive ? survivors : casualties)[u.troop]++;
  if (opts.record) frames.push({ tick, units: units.filter((u) => u.alive).map((u) => ({ id: u.id, troop: u.troop, x: u.x, y: u.y, hp: u.hp, maxHp: u.maxHp })), buildings: buildings.map((b) => ({ idx: b.idx, hp: b.hp })), shots: [] });
  return {
    result: {
      victory: stars >= 1,
      stars,
      destructionPercent,
      hqDestroyed,
      ticks: tick,
      deployed,
      casualties,
      survivors,
      buildingsDestroyed: destroyed,
      totalBuildings: scoring.length,
      wallsDestroyed: buildings.filter((b) => b.category === 'wall' && b.hp <= 0).length,
    },
    frames,
  };
}

/** The defense layout the engine actually uses (level >= 1), indexed like ReplayFrame.buildings. */
export function battleBuildings(defense: DefenseBuilding[]): DefenseBuilding[] {
  return defense.filter((d) => d.level >= 1);
}
