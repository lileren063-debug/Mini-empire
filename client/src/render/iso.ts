/** Isometric projection helpers. Tile (x, y) at height z (px) -> screen point. */
export const TW = 64;
export const TH = 32;

export type Pt = [number, number];

export function p(x: number, y: number, z = 0): Pt {
  return [(x - y) * (TW / 2), (x + y) * (TH / 2) - z];
}

export function pts(list: Pt[]): string {
  return list.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
}

/** Inverse projection: screen -> fractional tile coordinates. */
export function unproject(sx: number, sy: number): [number, number] {
  const a = sx / (TW / 2);
  const b = sy / (TH / 2);
  return [(a + b) / 2, (b - a) / 2];
}

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Visual tier index 0..5 for a level (wood, timber, stone, masonry, royal, legendary). */
export function tierOf(level: number): number {
  if (level >= 10) return 5;
  if (level >= 9) return 4;
  if (level >= 7) return 3;
  if (level >= 5) return 2;
  if (level >= 3) return 1;
  return 0;
}
