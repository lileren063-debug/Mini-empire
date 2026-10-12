import { useEffect, useMemo, useRef, useState, type PointerEvent as RPE } from 'react';
import {
  BUILDING_TYPES, GRID_SIZE, DEPLOY_MARGIN, POND_TILES, ROCK_TILES, hasResources, validatePlacement, visualTier,
  type BuildingType,
} from '@mini-empire/shared';
import { api } from '../api';
import { useGame, type KingdomView } from '../game';
import { BuildingIcon, BuildingSprite, SvgDefs } from '../render/sprites';
import { p, pts, unproject } from '../render/iso';
import { Cost, Countdown, Modal, Progress, RES_ICON, fmt, fmtDuration } from '../components/ui';
import { MissionsPanel } from './Missions';

type Mode = { kind: 'view' } | { kind: 'place'; type: BuildingType } | { kind: 'move'; id: string };
type KB = KingdomView['buildings'][number];

const MAP_W = GRID_SIZE * 64;
const MAP_H = GRID_SIZE * 32;
/** Zoom/pan pivot: the centre of the map. */
const CENTER = p(GRID_SIZE / 2, GRID_SIZE / 2);

function defaultView(el: SVGSVGElement | null) {
  if (!el) return { x: 0, y: 0, s: 1 };
  const ratio = el.clientHeight / Math.max(1, el.clientWidth);
  // Portrait phones: zoom in so buildings are touch-sized.
  return { x: 0, y: 0, s: ratio > 1 ? Math.min(2.4, 1 + ratio * 0.7) : 1.1 };
}

export function KingdomScreen() {
  const { kingdom, cfg, setKingdom, run, profile } = useGame();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, s: 1 });
  const [shop, setShop] = useState(false);
  const [missions, setMissions] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const contentRef = useRef<SVGGElement>(null);
  const drag = useRef<{ id: number; sx: number; sy: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; s: number } | null>(null);
  useEffect(() => { setView(defaultView(svgRef.current)); }, [kingdom === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const skin = { hqSkin: profile?.equipped?.hq_skin, wallSkin: profile?.equipped?.wall_skin, towerSkin: profile?.equipped?.tower_skin };
  const sel = kingdom?.buildings.find((b) => b.id === selected) ?? null;
  const sorted = useMemo(
    () => [...(kingdom?.buildings ?? [])].sort((a, b) => a.x + a.y + cfg.buildings[a.type].size - (b.x + b.y + cfg.buildings[b.type].size) || a.x - b.x),
    [kingdom, cfg],
  );

  if (!kingdom) return <div className="kingdom-wrap" />;

  const ghostType: BuildingType | null = mode.kind === 'place' ? mode.type : mode.kind === 'move' ? kingdom.buildings.find((b) => b.id === mode.id)?.type ?? null : null;
  const ghostValid = ghost && ghostType ? validatePlacement(kingdom.buildings, ghostType, ghost.x, ghost.y, cfg, mode.kind === 'move' ? mode.id : undefined) : null;

  function tileAt(clientX: number, clientY: number): [number, number] | null {
    const g = contentRef.current;
    const svg = svgRef.current;
    if (!g || !svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = g.getScreenCTM();
    if (!ctm) return null;
    const loc = pt.matrixTransform(ctm.inverse());
    return unproject(loc.x, loc.y);
  }

  function onPointerDown(e: RPE) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: view.s };
      drag.current = null;
      return;
    }
    drag.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false };
  }
  function onPointerMove(e: RPE) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const s = Math.max(0.6, Math.min(4, (pinch.current.s * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.d));
      setView((v) => ({ ...v, s }));
      return;
    }
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved && Math.hypot(dx, dy) > 7) d.moved = true;
    if (d.moved) {
      const ctm = svgRef.current!.getScreenCTM();
      const unitsPerPx = ctm ? 1 / ctm.a : 1;
      setView((v) => ({ ...v, x: d.vx + dx * unitsPerPx, y: d.vy + dy * unitsPerPx }));
    }
  }
  function onPointerUp(e: RPE) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved || d.id !== e.pointerId) return;
    // A tap.
    const t = tileAt(e.clientX, e.clientY);
    if (!t) return;
    if (mode.kind !== 'view' && ghostType) {
      const size = cfg.buildings[ghostType].size;
      setGhost({ x: Math.floor(t[0] - size / 2 + 0.5), y: Math.floor(t[1] - size / 2 + 0.5) });
      return;
    }
    const tx = Math.floor(t[0]), ty = Math.floor(t[1]);
    const hit = kingdom!.buildings.find((b) => {
      const s = cfg.buildings[b.type].size;
      return tx >= b.x && tx < b.x + s && ty >= b.y && ty < b.y + s;
    });
    setSelected(hit?.id ?? null);
    if (hit) focusBuilding(hit);
  }

  /** Pan so the selected building sits in the upper part of the screen, above the info panel. */
  function focusBuilding(b: KB) {
    const svg = svgRef.current, g = contentRef.current;
    if (!svg || !g) return;
    const ctm = g.getScreenCTM();
    const sctm = svg.getScreenCTM();
    if (!ctm || !sctm) return;
    const s = cfg.buildings[b.type].size;
    const [bx, by] = p(b.x + s / 2, b.y + s / 2, 20);
    const screenY = ctm.b * bx + ctm.d * by + ctm.f;
    const rect = svg.getBoundingClientRect();
    const targetY = rect.top + rect.height * 0.28;
    if (screenY > rect.top + rect.height * 0.4) setView((v) => ({ ...v, y: v.y - (screenY - targetY) / sctm.d }));
  }
  function onWheel(e: React.WheelEvent) {
    setView((v) => ({ ...v, s: Math.max(0.6, Math.min(4, v.s * (e.deltaY < 0 ? 1.1 : 0.9))) }));
  }

  async function confirmGhost() {
    if (!ghost || !ghostType) return;
    if (mode.kind === 'place') {
      const r = await run(() => api<KingdomView & { building: KB }>('POST', '/kingdom/buildings', { type: ghostType, x: ghost.x, y: ghost.y }), `${cfg.buildings[ghostType].name} construction started`);
      if (r) { setKingdom(r); setSelected(r.building.id); }
    } else if (mode.kind === 'move') {
      const r = await run(() => api<KingdomView>('POST', `/kingdom/buildings/${mode.id}/move`, { x: ghost.x, y: ghost.y }), 'Building moved');
      if (r) setKingdom(r);
    }
    setMode({ kind: 'view' });
    setGhost(null);
  }

  async function collect(id?: string) {
    const r = await run(() => api<KingdomView>('POST', '/kingdom/collect', id ? { buildingId: id } : {}), (k) => {
      const c = k.collected!;
      const total = c.gold + c.wood + c.stone;
      return total ? `Collected ${[c.gold && `${fmt(c.gold)} gold`, c.wood && `${fmt(c.wood)} wood`, c.stone && `${fmt(c.stone)} stone`].filter(Boolean).join(', ')}` : 'Nothing to collect (or storage is full)';
    });
    if (r) setKingdom(r);
  }

  const ground = [p(0, 0), p(GRID_SIZE, 0), p(GRID_SIZE, GRID_SIZE), p(0, GRID_SIZE)];
  const inner = [p(DEPLOY_MARGIN, DEPLOY_MARGIN), p(GRID_SIZE - DEPLOY_MARGIN, DEPLOY_MARGIN), p(GRID_SIZE - DEPLOY_MARGIN, GRID_SIZE - DEPLOY_MARGIN), p(DEPLOY_MARGIN, GRID_SIZE - DEPLOY_MARGIN)];
  const showGrid = mode.kind !== 'view';
  const collectable = kingdom.buildings.some((b) => b.produced >= 1);

  return (
    <div className="kingdom-wrap">
      <svg
        ref={svgRef}
        viewBox={`${-MAP_W / 2 - 40} ${-140} ${MAP_W + 80} ${MAP_H + 200}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        role="img"
        aria-label="Your kingdom"
      >
        <SvgDefs />
        <g ref={contentRef} transform={`translate(${view.x} ${view.y}) translate(${CENTER[0]} ${CENTER[1]}) scale(${view.s}) translate(${-CENTER[0]} ${-CENTER[1]})`}>
          {/* terrain */}
          <polygon points={pts([[ground[0][0], ground[0][1] + 18], [ground[1][0], ground[1][1] + 18], [ground[2][0], ground[2][1] + 18], [ground[3][0], ground[3][1] + 18]])} fill="#3d2a1a" />
          <polygon points={pts(ground)} fill="#4f8f2e" stroke="#2f5a1c" strokeWidth={3} />
          <polygon points={pts(inner)} fill="#62a63a" />
          {Array.from({ length: 40 }, (_, i) => {
            const tx = (i * 7.3) % GRID_SIZE, ty = (i * 11.7) % GRID_SIZE;
            const [cx, cy] = p(tx, ty);
            return <ellipse key={i} cx={cx} cy={cy} rx={6} ry={2.5} fill="#78b94c" opacity={0.6} />;
          })}
          {showGrid && Array.from({ length: GRID_SIZE + 1 }, (_, i) => (
            <g key={i} stroke="rgba(255,255,255,.18)" strokeWidth={1}>
              <line x1={p(i, 0)[0]} y1={p(i, 0)[1]} x2={p(i, GRID_SIZE)[0]} y2={p(i, GRID_SIZE)[1]} />
              <line x1={p(0, i)[0]} y1={p(0, i)[1]} x2={p(GRID_SIZE, i)[0]} y2={p(GRID_SIZE, i)[1]} />
            </g>
          ))}
          {POND_TILES.map(([x, y]) => <polygon key={`p${x},${y}`} points={pts([p(x, y), p(x + 1, y), p(x + 1, y + 1), p(x, y + 1)])} fill="#3b82c4" stroke="#2c6aa3" strokeWidth={0.5} />)}
          {ROCK_TILES.map(([x, y]) => {
            const [cx, cy] = p(x + 0.5, y + 0.5);
            return <path key={`r${x},${y}`} d={`M${cx - 18} ${cy + 4} l8 -16 l14 -4 l12 14 l-6 8 z`} fill="#8f8a82" stroke="#4f4b45" strokeWidth={1.2} />;
          })}
          {/* selection footprint */}
          {sel && (() => {
            const s = cfg.buildings[sel.type].size;
            return <polygon points={pts([p(sel.x, sel.y), p(sel.x + s, sel.y), p(sel.x + s, sel.y + s), p(sel.x, sel.y + s)])} fill="rgba(255,230,120,.25)" stroke="#ffe27a" strokeWidth={2.5} />;
          })()}
          {/* buildings */}
          {sorted.map((b) => {
            if (mode.kind === 'move' && mode.id === b.id) return null;
            const size = cfg.buildings[b.type].size;
            const top = p(b.x + size / 2, b.y + size / 2, size === 1 ? 34 : size === 2 ? 78 : 104);
            const lvl = cfg.buildings[b.type].levels[Math.max(0, b.level - 1)];
            const bubble = b.produced >= Math.max(10, (lvl.bufferCap ?? 0) * 0.05);
            const res = cfg.buildings[b.type].produces;
            const ResIcon = res ? RES_ICON[res] : null;
            return (
              <g key={b.id} className="building-hit" opacity={b.level === 0 ? 0.55 : 1}>
                <BuildingSprite type={b.type} x={b.x} y={b.y} level={b.level || 1} size={size} skin={skin} />
                {b.upgrade && <Scaffold x={b.x} y={b.y} s={size} />}
                {b.type !== 'wall' && (
                  <g transform={`translate(${top[0] + (size === 1 ? 0 : 18)} ${top[1]})`}>
                    <circle r={9} fill="#2b1d12" stroke="#e8b84a" strokeWidth={1.6} />
                    <text textAnchor="middle" y={3.5} fontSize={10} fontWeight={800} fill="#f4e6c8">{b.level}</text>
                  </g>
                )}
                {b.upgrade && <TimerBar b={b} at={p(b.x + size / 2, b.y + size / 2, size === 1 ? 30 : 60)} />}
                {bubble && ResIcon && !b.upgrade && (
                  <g transform={`translate(${top[0] - 14} ${top[1] - 14})`} onPointerUp={(e) => { e.stopPropagation(); const moved = drag.current?.moved; drag.current = null; pointers.current.delete(e.pointerId); if (!moved) collect(b.id); }}>
                    <circle r={13} fill="#fff8e6" stroke="#b8862a" strokeWidth={2} />
                    <g transform="translate(-9 -9)"><ResIcon s={18} /></g>
                  </g>
                )}
              </g>
            );
          })}
          {/* placement ghost */}
          {ghost && ghostType && (() => {
            const s = cfg.buildings[ghostType].size;
            const ok = ghostValid?.ok;
            return (
              <g pointerEvents="none">
                <polygon points={pts([p(ghost.x, ghost.y), p(ghost.x + s, ghost.y), p(ghost.x + s, ghost.y + s), p(ghost.x, ghost.y + s)])} fill={ok ? 'rgba(80,220,80,.35)' : 'rgba(230,60,40,.4)'} stroke={ok ? '#3fdc3f' : '#ff4a2e'} strokeWidth={2.5} />
                <g opacity={0.7}><BuildingSprite type={ghostType} x={ghost.x} y={ghost.y} level={1} size={s} skin={skin} /></g>
              </g>
            );
          })()}
        </g>
      </svg>

      {mode.kind !== 'view' && (
        <div className="k-hint">
          {!ghost ? 'Tap a spot to place' : ghostValid?.ok ? 'Valid spot — confirm below' : (ghostValid as { reason: string })?.reason}
        </div>
      )}

      {mode.kind !== 'view' ? (
        <div className="info-panel">
          <div className="row spread">
            <b>{mode.kind === 'place' ? `Place ${cfg.buildings[mode.type].name}` : 'Move building'}</b>
            <div className="row">
              <button className="btn secondary small" onClick={() => { setMode({ kind: 'view' }); setGhost(null); }}>Cancel</button>
              <button className="btn small" disabled={!ghostValid?.ok} onClick={confirmGhost}>Confirm</button>
            </div>
          </div>
          {mode.kind === 'place' && <div className="muted small" style={{ marginTop: 6 }}>Cost: <Cost cost={cfg.buildings[mode.type].levels[0].cost} have={kingdom.resources} /></div>}
        </div>
      ) : sel ? (
        <BuildingPanel b={sel} onClose={() => setSelected(null)} onMove={() => { setMode({ kind: 'move', id: sel.id }); setGhost({ x: sel.x, y: sel.y }); }} onCollect={() => collect(sel.id)} />
      ) : (
        <>
          <div className="k-left">
            <button className="k-fab" onClick={() => setMissions(true)} aria-label="Missions">📜<span>Missions</span></button>
          </div>
          <div className="k-toolbar">
            <button className="k-fab" onClick={() => collect()} disabled={!collectable} aria-label="Collect all resources" style={{ opacity: collectable ? 1 : 0.6 }}>💰<span>Collect</span></button>
            <button className="k-fab" onClick={() => setShop(true)} aria-label="Build">🔨<span>Build</span></button>
            <button className="k-fab" onClick={() => setView(defaultView(svgRef.current))} aria-label="Reset view">🎯<span>Center</span></button>
          </div>
        </>
      )}

      {shop && <ShopModal onClose={() => setShop(false)} onPick={(t) => { setShop(false); setSelected(null); setMode({ kind: 'place', type: t }); setGhost(null); }} />}
      {missions && <Modal title="Missions" onClose={() => setMissions(false)}><MissionsPanel /></Modal>}
    </div>
  );
}

function Scaffold({ x, y, s }: { x: number; y: number; s: number }) {
  const h = s === 1 ? 20 : 46;
  const poles = [p(x + 0.1, y + s - 0.1), p(x + s - 0.1, y + s - 0.1), p(x + s - 0.1, y + 0.1)];
  return (
    <g stroke="#c89b5a" strokeWidth={2} opacity={0.9}>
      {poles.map(([a, b], i) => <line key={i} x1={a} y1={b} x2={a} y2={b - h} />)}
      <line x1={poles[0][0]} y1={poles[0][1] - h * 0.5} x2={poles[1][0]} y2={poles[1][1] - h * 0.5} />
      <line x1={poles[1][0]} y1={poles[1][1] - h * 0.5} x2={poles[2][0]} y2={poles[2][1] - h * 0.5} />
      <line x1={poles[0][0]} y1={poles[0][1]} x2={poles[1][0]} y2={poles[1][1] - h} />
    </g>
  );
}

function TimerBar({ b, at }: { b: KB; at: [number, number] }) {
  const up = b.upgrade!;
  return (
    <foreignObject x={at[0] - 40} y={at[1] - 4} width={80} height={26} pointerEvents="none">
      <div style={{ background: 'rgba(30,20,12,.85)', borderRadius: 6, padding: '2px 4px', color: '#f4e6c8', fontSize: 9, fontWeight: 800, textAlign: 'center' }}>
        <Progress from={up.startedAt} to={up.endsAt} gold />
        <Countdown until={up.endsAt} />
      </div>
    </foreignObject>
  );
}

function BuildingPanel({ b, onClose, onMove, onCollect }: { b: KB; onClose: () => void; onMove: () => void; onCollect: () => void }) {
  const { cfg, kingdom, setKingdom, run } = useGame();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const def = cfg.buildings[b.type];
  const cur = b.level >= 1 ? def.levels[b.level - 1] : null;
  const next = def.levels[b.level] ?? null;
  const hq = kingdom!.hqLevel;
  const busy = kingdom!.buildings.filter((x) => x.upgrade).length;
  const reqs = next ? [
    ...(next.hqRequired > 1 || b.type === 'headquarters' ? [{ ok: hq >= next.hqRequired, label: `Headquarters level ${next.hqRequired}` }] : []),
    ...(next.requires ?? []).map((r) => ({ ok: kingdom!.buildings.some((x) => x.type === r.type && x.level >= r.level), label: `${cfg.buildings[r.type].name} level ${r.level}` })),
  ] : [];
  const reason = !next ? 'Maximum level reached' : b.upgrade ? 'Upgrade in progress' : reqs.find((r) => !r.ok) ? `Requires ${reqs.find((r) => !r.ok)!.label}` : busy >= kingdom!.builders ? `All ${kingdom!.builders} builder(s) busy` : !hasResources(kingdom!.resources, next.cost) ? 'Not enough resources' : null;

  async function upgrade() {
    const r = await run(() => api<KingdomView>('POST', `/kingdom/buildings/${b.id}/upgrade`), `Upgrading ${def.name} to level ${b.level + 1}`);
    if (r) setKingdom(r);
  }
  async function cancel() {
    const r = await run(() => api<KingdomView>('POST', `/kingdom/buildings/${b.id}/cancel`), 'Construction cancelled — 50% refunded');
    if (r) { setKingdom(r); if (b.level === 0) onClose(); }
    setConfirmCancel(false);
  }

  const stats: [string, string][] = [];
  if (cur) {
    stats.push(['Health', fmt(cur.hp)]);
    if (cur.productionPerHour) stats.push(['Production', `${fmt(cur.productionPerHour)}/h`], ['Holds', `${fmt(b.produced)} / ${fmt(cur.bufferCap ?? 0)}`]);
    if (cur.storageCap) stats.push(['Storage', `+${fmt(cur.storageCap)} each`]);
    if (cur.armyCapacity) stats.push(['Army capacity', String(cur.armyCapacity)]);
    if (cur.damage) stats.push(['Damage', String(cur.damage)], ['Range', `${cur.range} tiles`], ['Attack speed', `${cur.attackInterval}s`]);
    if (cur.splashRadius) stats.push(['Splash', `${cur.splashRadius} tiles`]);
    if (cur.builders) stats.push(['Builders', String(cur.builders)]);
    if (def.targeting) stats.push(['Targets', def.targeting === 'nearest' ? 'Nearest enemy' : 'Toughest enemy']);
  }
  return (
    <div className="info-panel">
      <div className="row spread">
        <div className="row">
          <BuildingIcon type={b.type} level={b.level || 1} size={def.size} px={56} />
          <div>
            <b className="display">{def.name}</b>
            <div className="muted small">{b.level === 0 ? 'Under construction' : `Level ${b.level} · ${visualTier(b.level)}`}</div>
          </div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="muted small" style={{ margin: '6px 0' }}>{def.description}</p>
      {stats.length > 0 && <div className="grid2">{stats.map(([k, v]) => <div key={k} className="stat">{k}<b>{v}</b></div>)}</div>}
      {b.upgrade && (
        <div style={{ marginTop: 10 }}>
          <div className="row spread small"><b>{b.level === 0 ? 'Building' : `Upgrading to level ${b.upgrade.toLevel}`}</b><span><Countdown until={b.upgrade.endsAt} /></span></div>
          <Progress from={b.upgrade.startedAt} to={b.upgrade.endsAt} gold />
        </div>
      )}
      {next && !b.upgrade && (
        <div style={{ marginTop: 10 }}>
          <div className="row spread"><b>Next: level {next.level}</b><span className="muted small">⏱ {fmtDuration(next.durationSec * 1000)}</span></div>
          <div style={{ margin: '4px 0' }}><Cost cost={next.cost} have={kingdom!.resources} /></div>
          {reqs.map((r) => <div key={r.label} className="small" style={{ color: r.ok ? 'var(--ok)' : 'var(--danger)' }}>{r.ok ? '✔' : '✖'} {r.label}</div>)}
          {next.unlocks && <div className="small muted">Unlocks: {next.unlocks.join(', ')}</div>}
        </div>
      )}
      <div className="row wrap" style={{ marginTop: 10 }}>
        {!b.upgrade && next && <button className="btn" disabled={!!reason} onClick={upgrade} title={reason ?? ''}>Upgrade</button>}
        {b.upgrade && !confirmCancel && <button className="btn danger small" onClick={() => setConfirmCancel(true)}>Cancel</button>}
        {confirmCancel && <><span className="small">Cancel and get 50% back?</span><button className="btn danger small" onClick={cancel}>Yes, cancel</button><button className="btn secondary small" onClick={() => setConfirmCancel(false)}>No</button></>}
        {def.produces && b.level >= 1 && <button className="btn blue small" onClick={onCollect} disabled={b.produced < 1}>Collect {fmt(b.produced)}</button>}
        <button className="btn secondary small" onClick={onMove}>Move</button>
      </div>
      {reason && !b.upgrade && next && <p className="muted small" style={{ marginBottom: 0 }}>{reason}</p>}
    </div>
  );
}

function ShopModal({ onClose, onPick }: { onClose: () => void; onPick: (t: BuildingType) => void }) {
  const { cfg, kingdom } = useGame();
  const hq = kingdom!.hqLevel;
  const busy = kingdom!.buildings.filter((x) => x.upgrade).length;
  return (
    <Modal title="Build" onClose={onClose}>
      <p className="muted small">Builders busy: {busy} / {kingdom!.builders}. Walls are built instantly.</p>
      <div className="shop-grid">
        {BUILDING_TYPES.filter((t) => t !== 'headquarters').map((t) => {
          const def = cfg.buildings[t];
          const count = kingdom!.buildings.filter((b) => b.type === t).length;
          const max = def.maxCountByHq[hq - 1] ?? 0;
          const l1 = def.levels[0];
          const nextMax = def.maxCountByHq.findIndex((m) => m > count);
          const reason = count >= max ? (nextMax >= 0 ? `More at HQ ${nextMax + 1}` : 'Limit reached') : !hasResources(kingdom!.resources, l1.cost) ? 'Not enough resources' : l1.durationSec > 0 && busy >= kingdom!.builders ? 'Builders busy' : null;
          return (
            <button key={t} className="shop-card" disabled={!!reason} onClick={() => onPick(t)}>
              <BuildingIcon type={t} size={def.size} px={64} />
              <b>{def.name}</b>
              <span className="small muted">{count}/{max} built · {l1.durationSec ? fmtDuration(l1.durationSec * 1000) : 'instant'}</span>
              <Cost cost={l1.cost} have={kingdom!.resources} />
              {reason && <span className="small" style={{ color: 'var(--danger)' }}>{reason}</span>}
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
