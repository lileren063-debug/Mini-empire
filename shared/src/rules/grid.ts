import { GRID_SIZE, DEPLOY_MARGIN, POND_TILES, ROCK_TILES } from '../config/map.js';
import type { GameConfig } from '../config/index.js';
import type { Building, BuildingType } from '../types.js';

const key = (x: number, y: number) => y * GRID_SIZE + x;

export const BLOCKED_TERRAIN = new Set<number>([...POND_TILES, ...ROCK_TILES].map(([x, y]) => key(x, y)));
export const POND = new Set<number>(POND_TILES.map(([x, y]) => key(x, y)));

export function tileKey(x: number, y: number): number {
  return key(x, y);
}

export function footprint(x: number, y: number, size: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dx = 0; dx < size; dx++) for (let dy = 0; dy < size; dy++) out.push([x + dx, y + dy]);
  return out;
}

export type PlacementResult = { ok: true } | { ok: false; code: string; reason: string };

/** Buildable area: inside the grid, outside the deploy ring and not on pond/rock tiles. */
export function isBuildableTile(x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  if (x < DEPLOY_MARGIN || y < DEPLOY_MARGIN || x >= GRID_SIZE - DEPLOY_MARGIN || y >= GRID_SIZE - DEPLOY_MARGIN) return false;
  return !BLOCKED_TERRAIN.has(key(x, y));
}

export function occupiedTiles(buildings: Building[], cfg: GameConfig, ignoreId?: string): Map<number, string> {
  const occ = new Map<number, string>();
  for (const b of buildings) {
    if (b.id === ignoreId) continue;
    const size = cfg.buildings[b.type].size;
    for (const [tx, ty] of footprint(b.x, b.y, size)) occ.set(key(tx, ty), b.id);
  }
  return occ;
}

export function validatePlacement(
  buildings: Building[],
  type: BuildingType,
  x: number,
  y: number,
  cfg: GameConfig,
  ignoreId?: string,
): PlacementResult {
  const size = cfg.buildings[type].size;
  const occ = occupiedTiles(buildings, cfg, ignoreId);
  for (const [tx, ty] of footprint(x, y, size)) {
    if (!isBuildableTile(tx, ty)) return { ok: false, code: 'INVALID_TERRAIN', reason: 'Cannot build outside the kingdom or on water/rocks.' };
    if (occ.has(key(tx, ty))) return { ok: false, code: 'OVERLAP', reason: 'That spot overlaps another building.' };
  }
  return { ok: true };
}
