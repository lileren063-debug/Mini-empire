/**
 * Procedural isometric building art. Every building type has its own silhouette and every level
 * tier changes materials and details (wood -> reinforced timber -> stone -> fortified masonry ->
 * royal -> legendary). The art is generated from code so it is light, crisp at any zoom and easy
 * to replace with illustrated assets later (swap `BuildingSprite`).
 */
import type { BuildingType } from '@mini-empire/shared';
import { p, pts, shade, tierOf } from './iso';

interface Mat {
  wall: string;
  roof: string;
  trim: string;
  flag: string;
}

const TIERS: Mat[] = [
  { wall: '#9a6b3c', roof: '#7a4b22', trim: '#5a3518', flag: '#c0392b' }, // wooden
  { wall: '#7d5431', roof: '#5e3a1c', trim: '#3b3b3b', flag: '#c0392b' }, // reinforced timber
  { wall: '#9a958c', roof: '#6b3f2a', trim: '#5f5a52', flag: '#2f6db3' }, // stone
  { wall: '#c8bfae', roof: '#3f5f8a', trim: '#7d7466', flag: '#2f6db3' }, // fortified masonry
  { wall: '#efe8da', roof: '#2a4f9a', trim: '#d4a72c', flag: '#e8b84a' }, // royal
  { wall: '#3a3346', roof: '#1d1828', trim: '#f2c55c', flag: '#a855f7' }, // legendary
];

export interface SkinOpts {
  hqSkin?: string;
  wallSkin?: string;
  towerSkin?: string;
}

function material(level: number, type: BuildingType, skin?: SkinOpts): Mat {
  const m = { ...TIERS[tierOf(level)] };
  if (type === 'headquarters' && skin?.hqSkin === 'skin_hq_royal') { m.roof = '#6b21a8'; m.flag = '#a855f7'; }
  if (type === 'headquarters' && skin?.hqSkin === 'skin_hq_winter') { m.roof = '#e6eef5'; }
  if ((type === 'archer_tower' || type === 'heavy_tower') && skin?.towerSkin === 'skin_tower_gilded') { m.trim = '#f2c55c'; }
  return m;
}

/** Isometric box from tile rect (x0,y0)-(x1,y1), z0..z1 (px). */
function Box({ x0, y0, x1, y1, z0 = 0, z1, color, stroke = 'rgba(0,0,0,.35)' }: { x0: number; y0: number; x1: number; y1: number; z0?: number; z1: number; color: string; stroke?: string }) {
  return (
    <g stroke={stroke} strokeWidth={0.8} strokeLinejoin="round">
      <polygon points={pts([p(x0, y1, z0), p(x1, y1, z0), p(x1, y1, z1), p(x0, y1, z1)])} fill={shade(color, -38)} />
      <polygon points={pts([p(x1, y0, z0), p(x1, y1, z0), p(x1, y1, z1), p(x1, y0, z1)])} fill={shade(color, -16)} />
      <polygon points={pts([p(x0, y0, z1), p(x1, y0, z1), p(x1, y1, z1), p(x0, y1, z1)])} fill={shade(color, 18)} />
    </g>
  );
}

function Pyramid({ x0, y0, x1, y1, z, h, color }: { x0: number; y0: number; x1: number; y1: number; z: number; h: number; color: string }) {
  const apex = p((x0 + x1) / 2, (y0 + y1) / 2, z + h);
  return (
    <g stroke="rgba(0,0,0,.35)" strokeWidth={0.8} strokeLinejoin="round">
      <polygon points={pts([p(x0, y1, z), p(x1, y1, z), apex])} fill={shade(color, -25)} />
      <polygon points={pts([p(x1, y0, z), p(x1, y1, z), apex])} fill={shade(color, 5)} />
    </g>
  );
}

/** Gable roof with the ridge running along the x axis. */
function Gable({ x0, y0, x1, y1, z, h, color }: { x0: number; y0: number; x1: number; y1: number; z: number; h: number; color: string }) {
  const ym = (y0 + y1) / 2;
  return (
    <g stroke="rgba(0,0,0,.35)" strokeWidth={0.8} strokeLinejoin="round">
      <polygon points={pts([p(x0, y0, z), p(x1, y0, z), p(x1, ym, z + h), p(x0, ym, z + h)])} fill={shade(color, 22)} />
      <polygon points={pts([p(x0, y1, z), p(x1, y1, z), p(x1, ym, z + h), p(x0, ym, z + h)])} fill={shade(color, -18)} />
      <polygon points={pts([p(x1, y0, z), p(x1, y1, z), p(x1, ym, z + h)])} fill={shade(color, -40)} />
    </g>
  );
}

function Flag({ x, y, z, color, h = 16 }: { x: number; y: number; z: number; color: string; h?: number }) {
  const [bx, by] = p(x, y, z);
  return (
    <g>
      <line x1={bx} y1={by} x2={bx} y2={by - h} stroke="#3a2a1a" strokeWidth={1.4} />
      <path d={`M${bx} ${by - h} l10 3 l-10 4 z`} fill={color} stroke="rgba(0,0,0,.4)" strokeWidth={0.6} />
    </g>
  );
}

function Crenels({ x0, y0, x1, y1, z, color, n = 3 }: { x0: number; y0: number; x1: number; y1: number; z: number; color: string; n?: number }) {
  const out = [];
  const w = (x1 - x0) / (n * 2 - 1);
  for (let i = 0; i < n; i++) {
    const a = x0 + i * 2 * w;
    out.push(<Box key={`f${i}`} x0={a} y0={y1 - 0.12} x1={a + w} y1={y1} z0={z} z1={z + 5} color={color} />);
  }
  const d = (y1 - y0) / (n * 2 - 1);
  for (let i = 0; i < n; i++) {
    const a = y0 + i * 2 * d;
    out.push(<Box key={`s${i}`} x0={x1 - 0.12} y0={a} x1={x1} y1={a + d} z0={z} z1={z + 5} color={color} />);
  }
  return <g>{out}</g>;
}

function Glow({ x, y, s }: { x: number; y: number; s: number }) {
  const [cx, cy] = p(x + s / 2, y + s / 2);
  return <ellipse cx={cx} cy={cy} rx={s * 34} ry={s * 17} fill="url(#legend-glow)" />;
}

function Shadow({ x, y, s }: { x: number; y: number; s: number }) {
  return <polygon points={pts([p(x + 0.1, y + 0.1), p(x + s, y + 0.1), p(x + s, y + s), p(x + 0.1, y + s)])} fill="rgba(0,0,0,.18)" />;
}

function Headquarters({ x, y, level, m }: { x: number; y: number; level: number; m: Mat }) {
  const t = tierOf(level);
  const h = 22 + level * 3;
  const inset = 0.35;
  const x0 = x + inset, y0 = y + inset, x1 = x + 3 - inset, y1 = y + 3 - inset;
  const turrets = t >= 1;
  return (
    <g>
      {t >= 2 && <Box x0={x + 0.1} y0={y + 0.1} x1={x + 2.9} y1={y + 2.9} z1={6} color={m.trim} />}
      <Box x0={x0} y0={y0} x1={x1} y1={y1} z1={h} color={m.wall} />
      {/* door */}
      <polygon points={pts([p(x0 + 0.95, y1, 0), p(x0 + 1.35, y1, 0), p(x0 + 1.35, y1, 12), p(x0 + 0.95, y1, 12)])} fill="#2a1a0d" />
      {/* windows */}
      {[0.4, 1.7].map((o) => <polygon key={o} points={pts([p(x1, y0 + o, h - 14), p(x1, y0 + o + 0.25, h - 14), p(x1, y0 + o + 0.25, h - 7), p(x1, y0 + o, h - 7)])} fill={t >= 4 ? '#ffe9a8' : '#2a1a0d'} />)}
      {t >= 3 ? <Crenels x0={x0} y0={y0} x1={x1} y1={y1} z={h} color={m.wall} n={4} /> : null}
      {t < 3 && <Pyramid x0={x0 - 0.1} y0={y0 - 0.1} x1={x1 + 0.1} y1={y1 + 0.1} z={h} h={18 + level} color={m.roof} />}
      {t >= 3 && (
        <>
          <Box x0={x + 1.1} y0={y + 1.1} x1={x + 1.9} y1={y + 1.9} z0={h} z1={h + 14 + level * 2} color={m.wall} />
          <Pyramid x0={x + 1.0} y0={y + 1.0} x1={x + 2.0} y1={y + 2.0} z={h + 14 + level * 2} h={16 + level} color={m.roof} />
        </>
      )}
      {turrets &&
        ([[x0 - 0.15, y0 - 0.15], [x1 - 0.45, y0 - 0.15], [x0 - 0.15, y1 - 0.45], [x1 - 0.45, y1 - 0.45]] as const).map(([tx, ty], i) => (
          <g key={i}>
            <Box x0={tx} y0={ty} x1={tx + 0.6} y1={ty + 0.6} z1={h + 8} color={m.wall} />
            <Pyramid x0={tx - 0.05} y0={ty - 0.05} x1={tx + 0.65} y1={ty + 0.65} z={h + 8} h={12} color={m.roof} />
          </g>
        ))}
      <Flag x={x + 1.5} y={y + 1.5} z={t >= 3 ? h + 30 + level * 3 : h + 18 + level} color={m.flag} h={18} />
      {level >= 6 && <Flag x={x1 - 0.15} y={y0 + 0.15} z={h + 20} color={m.flag} h={12} />}
      {level >= 8 && <Flag x={x0 + 0.15} y={y1 - 0.15} z={h + 20} color={m.flag} h={12} />}
      {t >= 4 && <circle cx={p(x + 1.5, y + 3 - inset)[0]} cy={p(x + 1.5, y + 3 - inset, h - 4)[1]} r={4} fill={m.trim} stroke="#7a4a12" />}
    </g>
  );
}

function ArcherTower({ x, y, level, m }: { x: number; y: number; level: number; m: Mat }) {
  const t = tierOf(level);
  const h = 34 + level * 3;
  const c = 0.55;
  return (
    <g>
      {t === 0 ? (
        <>
          {/* wooden stilts */}
          {[[x + 0.5, y + 0.5], [x + 1.3, y + 0.5], [x + 0.5, y + 1.3], [x + 1.3, y + 1.3]].map(([a, b], i) => (
            <Box key={i} x0={a} y0={b} x1={a + 0.2} y1={b + 0.2} z1={h} color={m.wall} />
          ))}
        </>
      ) : (
        <Box x0={x + c} y0={y + c} x1={x + 2 - c} y1={y + 2 - c} z1={h} color={m.wall} />
      )}
      <Box x0={x + 0.3} y0={y + 0.3} x1={x + 1.7} y1={y + 1.7} z0={h} z1={h + 8} color={t <= 1 ? shade(m.wall, 10) : m.trim} />
      {t >= 2 ? <Crenels x0={x + 0.3} y0={y + 0.3} x1={x + 1.7} y1={y + 1.7} z={h + 8} color={m.wall} n={3} /> : null}
      <Pyramid x0={x + 0.35} y0={y + 0.35} x1={x + 1.65} y1={y + 1.65} z={h + (t >= 2 ? 22 : 8)} h={16 + level} color={m.roof} />
      {t >= 2 && [[x + 0.4, y + 0.4], [x + 1.5, y + 1.5]].map(([a, b], i) => <Box key={i} x0={a} y0={b} x1={a + 0.1} y1={b + 0.1} z0={h + 8} z1={h + 22} color={m.trim} />)}
      <Flag x={x + 1} y={y + 1} z={h + (t >= 2 ? 38 : 24) + level} color={m.flag} h={12} />
    </g>
  );
}

function HeavyTower({ x, y, level, m }: { x: number; y: number; level: number; m: Mat }) {
  const t = tierOf(level);
  const h = 22 + level * 2;
  const [ax, ay] = p(x + 1, y + 1, h + 6);
  return (
    <g>
      <Box x0={x + 0.3} y0={y + 0.3} x1={x + 1.7} y1={y + 1.7} z1={h} color={m.wall} />
      <Crenels x0={x + 0.3} y0={y + 0.3} x1={x + 1.7} y1={y + 1.7} z={h} color={shade(m.wall, -10)} n={3} />
      {/* catapult */}
      <Box x0={x + 0.75} y0={y + 0.75} x1={x + 1.25} y1={y + 1.25} z0={h} z1={h + 6} color={m.trim} />
      <line x1={ax} y1={ay} x2={ax - 14 - level} y2={ay - 16 - level} stroke="#4a2e14" strokeWidth={3} strokeLinecap="round" />
      <circle cx={ax - 15 - level} cy={ay - 17 - level} r={4} fill={t >= 4 ? '#f2c55c' : '#6b6b6b'} stroke="#222" strokeWidth={0.8} />
      {t >= 3 && <Flag x={x + 1.6} y={y + 0.4} z={h + 5} color={m.flag} h={12} />}
    </g>
  );
}

function Wall({ x, y, level, m, banner }: { x: number; y: number; level: number; m: Mat; banner?: boolean }) {
  const t = tierOf(level);
  const h = 12 + t * 3;
  if (t <= 1) {
    // Palisade stakes.
    const stakes = [];
    for (let i = 0; i < 4; i++) {
      const sx = x + 0.12 + i * 0.2;
      stakes.push(<Box key={i} x0={sx} y0={y + 0.35} x1={sx + 0.17} y1={y + 0.65} z1={h} color={m.wall} />);
      const [tx, ty] = p(sx + 0.085, y + 0.5, h + 6);
      const [l1, l2] = p(sx, y + 0.65, h);
      const [r1, r2] = p(sx + 0.17, y + 0.65, h);
      stakes.push(<polygon key={`t${i}`} points={`${l1},${l2} ${r1},${r2} ${tx},${ty}`} fill={shade(m.wall, 10)} stroke="rgba(0,0,0,.35)" strokeWidth={0.6} />);
    }
    return (
      <g>
        {stakes}
        {t === 1 && <Box x0={x + 0.1} y0={y + 0.6} x1={x + 0.9} y1={y + 0.68} z0={h * 0.55} z1={h * 0.55 + 3} color="#3b3b3b" />}
        {banner && <Flag x={x + 0.5} y={y + 0.5} z={h + 4} color="#c0392b" h={10} />}
      </g>
    );
  }
  return (
    <g>
      <Box x0={x + 0.08} y0={y + 0.08} x1={x + 0.92} y1={y + 0.92} z1={h} color={m.wall} />
      <Box x0={x + 0.08} y0={y + 0.72} x1={x + 0.3} y1={y + 0.92} z0={h} z1={h + 5} color={m.wall} />
      <Box x0={x + 0.7} y0={y + 0.72} x1={x + 0.92} y1={y + 0.92} z0={h} z1={h + 5} color={m.wall} />
      <Box x0={x + 0.72} y0={y + 0.08} x1={x + 0.92} y1={y + 0.3} z0={h} z1={h + 5} color={m.wall} />
      {t >= 4 && <polygon points={pts([p(x + 0.92, y + 0.35, h - 3), p(x + 0.92, y + 0.65, h - 3), p(x + 0.92, y + 0.65, h - 7), p(x + 0.92, y + 0.35, h - 7)])} fill={m.trim} />}
      {(banner || t === 5) && <Flag x={x + 0.5} y={y + 0.5} z={h + 5} color={banner ? '#c0392b' : m.flag} h={10} />}
    </g>
  );
}

function Producer({ type, x, y, level, m }: { type: BuildingType; x: number; y: number; level: number; m: Mat }) {
  const t = tierOf(level);
  const items = Math.min(6, 1 + Math.floor(level / 2));
  if (type === 'gold_mine') {
    const [ex, ey] = p(x + 1.2, y + 1.8, 0);
    return (
      <g>
        <Pyramid x0={x + 0.1} y0={y + 0.1} x1={x + 1.9} y1={y + 1.9} z={0} h={34 + level * 2} color={t >= 2 ? '#7d7466' : '#8a6a44'} />
        <Pyramid x0={x + 0.9} y0={y + 0.2} x1={x + 1.9} y1={y + 1.2} z={0} h={22 + level} color={t >= 2 ? '#8f877a' : '#9b7b52'} />
        <path d={`M${ex - 9} ${ey - 1} q9 -20 18 0 z`} fill="#1b120a" />
        <Box x0={x + 0.95} y0={y + 1.55} x1={x + 1.05} y1={y + 1.95} z1={14} color={m.trim} />
        {Array.from({ length: items }, (_, i) => {
          const [gx, gy] = p(x + 0.4 + (i % 3) * 0.35, y + 0.6 + Math.floor(i / 3) * 0.35, 18 + level);
          return <circle key={i} cx={gx} cy={gy} r={3.2} fill="#f2c55c" stroke="#8a5a12" strokeWidth={0.8} />;
        })}
        <Box x0={x + 1.45} y0={y + 1.45} x1={x + 1.85} y1={y + 1.75} z1={6} color="#6b4a2a" />
        <circle cx={p(x + 1.65, y + 1.6, 8)[0]} cy={p(x + 1.65, y + 1.6, 8)[1]} r={3} fill="#f2c55c" />
      </g>
    );
  }
  if (type === 'lumber_camp') {
    return (
      <g>
        <Box x0={x + 0.2} y0={y + 0.2} x1={x + 1.2} y1={y + 1.1} z1={14 + level} color={t >= 2 ? '#8d7a62' : m.wall} />
        <Gable x0={x + 0.12} y0={y + 0.12} x1={x + 1.28} y1={y + 1.18} z={14 + level} h={12} color={m.roof} />
        {Array.from({ length: items }, (_, i) => {
          const [lx, ly] = p(x + 1.35 + (i % 2) * 0.25, y + 1.3 + Math.floor(i / 2) * 0.18, 3 + (i % 2) * 4);
          return <rect key={i} x={lx - 10} y={ly - 3} width={20} height={6} rx={3} fill="#9b6a3a" stroke="#5a3518" strokeWidth={0.8} />;
        })}
        <circle cx={p(x + 0.3, y + 1.6)[0]} cy={p(x + 0.3, y + 1.6)[1] - 10} r={8} fill="#3f7a2a" stroke="#244f17" />
      </g>
    );
  }
  if (type === 'stone_quarry') {
    const blocks = [];
    for (let i = 0; i < items + 1; i++) {
      const bx = x + 0.2 + (i % 3) * 0.55, by = y + 0.25 + Math.floor(i / 3) * 0.55;
      blocks.push(<Box key={i} x0={bx} y0={by} x1={bx + 0.45} y1={by + 0.45} z1={8 + (i % 2) * 6 + t * 2} color={t >= 3 ? '#b3ada3' : '#8f8a82'} />);
    }
    return (
      <g>
        <polygon points={pts([p(x + 0.1, y + 0.1), p(x + 1.9, y + 0.1), p(x + 1.9, y + 1.9), p(x + 0.1, y + 1.9)])} fill="#7c766d" opacity={0.6} />
        {blocks}
        <line x1={p(x + 1.6, y + 1.7)[0]} y1={p(x + 1.6, y + 1.7)[1]} x2={p(x + 1.6, y + 1.7, 26)[0]} y2={p(x + 1.6, y + 1.7, 26)[1]} stroke="#5a3518" strokeWidth={2} />
      </g>
    );
  }
  // storage
  return (
    <g>
      <Box x0={x + 0.2} y0={y + 0.25} x1={x + 1.8} y1={y + 1.5} z1={16 + level * 1.5} color={m.wall} />
      <Gable x0={x + 0.12} y0={y + 0.17} x1={x + 1.88} y1={y + 1.58} z={16 + level * 1.5} h={14} color={m.roof} />
      <polygon points={pts([p(x + 0.8, y + 1.5, 0), p(x + 1.2, y + 1.5, 0), p(x + 1.2, y + 1.5, 11), p(x + 0.8, y + 1.5, 11)])} fill="#3a2410" />
      {Array.from({ length: Math.min(4, items) }, (_, i) => <Box key={i} x0={x + 0.25 + i * 0.35} y0={y + 1.6} x1={x + 0.5 + i * 0.35} y1={y + 1.85} z1={7} color="#b07b3e" />)}
    </g>
  );
}

function Barracks({ x, y, level, m }: { x: number; y: number; level: number; m: Mat }) {
  const t = tierOf(level);
  return (
    <g>
      <polygon points={pts([p(x + 0.1, y + 0.1), p(x + 2.9, y + 0.1), p(x + 2.9, y + 2.9), p(x + 0.1, y + 2.9)])} fill="#a08d62" opacity={0.55} />
      <Box x0={x + 0.3} y0={y + 0.3} x1={x + 2.7} y1={y + 1.6} z1={18 + level * 1.5} color={m.wall} />
      <Gable x0={x + 0.2} y0={y + 0.2} x1={x + 2.8} y1={y + 1.7} z={18 + level * 1.5} h={16} color={m.roof} />
      {t >= 2 && <Crenels x0={x + 2.2} y0={y + 0.3} x1={x + 2.7} y1={y + 1.6} z={18 + level * 1.5} color={m.wall} n={2} />}
      {/* training dummies */}
      {[0.6, 1.4, 2.2].slice(0, 1 + Math.min(2, Math.floor(level / 3))).map((o) => {
        const [dx, dy] = p(x + o, y + 2.3);
        return (
          <g key={o}>
            <line x1={dx} y1={dy} x2={dx} y2={dy - 16} stroke="#5a3518" strokeWidth={2} />
            <line x1={dx - 6} y1={dy - 11} x2={dx + 6} y2={dy - 11} stroke="#5a3518" strokeWidth={2} />
            <circle cx={dx} cy={dy - 18} r={3} fill="#d9b77a" />
          </g>
        );
      })}
      <Flag x={x + 0.4} y={y + 1.6} z={18 + level * 1.5} color={m.flag} h={14} />
      <Flag x={x + 2.6} y={y + 1.6} z={18 + level * 1.5} color={m.flag} h={14} />
    </g>
  );
}

export function BuildingSprite({ type, x, y, level, size, skin }: { type: BuildingType; x: number; y: number; level: number; size: number; skin?: SkinOpts }) {
  const lvl = Math.max(1, level);
  const m = material(lvl, type, skin);
  return (
    <g>
      <Shadow x={x} y={y} s={size} />
      {lvl === 10 && <Glow x={x} y={y} s={size} />}
      {type === 'headquarters' && <Headquarters x={x} y={y} level={lvl} m={m} />}
      {type === 'archer_tower' && <ArcherTower x={x} y={y} level={lvl} m={m} />}
      {type === 'heavy_tower' && <HeavyTower x={x} y={y} level={lvl} m={m} />}
      {type === 'wall' && <Wall x={x} y={y} level={lvl} m={m} banner={skin?.wallSkin === 'skin_wall_banner'} />}
      {type === 'barracks' && <Barracks x={x} y={y} level={lvl} m={m} />}
      {(type === 'gold_mine' || type === 'lumber_camp' || type === 'stone_quarry' || type === 'storage') && <Producer type={type} x={x} y={y} level={lvl} m={m} />}
    </g>
  );
}

/** Small standalone preview (shop cards, panels). */
export function BuildingIcon({ type, level = 1, size, px = 72 }: { type: BuildingType; level?: number; size: number; px?: number }) {
  const [l] = p(0, size);
  const [r] = p(size, 0);
  const top = p(0, 0, 90)[1];
  const bottom = p(size, size)[1];
  return (
    <svg width={px} height={px} viewBox={`${l - 6} ${top} ${r - l + 12} ${bottom - top + 6}`}>
      <SvgDefs />
      <BuildingSprite type={type} x={0} y={0} level={level} size={size} />
    </svg>
  );
}

export function SvgDefs() {
  return (
    <defs>
      <radialGradient id="legend-glow">
        <stop offset="0%" stopColor="#f2c55c" stopOpacity={0.55} />
        <stop offset="100%" stopColor="#a855f7" stopOpacity={0} />
      </radialGradient>
    </defs>
  );
}
