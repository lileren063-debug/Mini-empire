import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  GRID_SIZE, TROOP_TYPES, sameBattleResult, simulateBattle, type BattleInput, type BattleResult, type DefenseBuilding, type DeploySide, type Deployment, type ReplayFrame, type TroopType,
} from '@mini-empire/shared';
import { api } from '../api';
import { useGame } from '../game';
import { BuildingSprite, SvgDefs } from '../render/sprites';
import { p, pts } from '../render/iso';
import { Cost, Modal, Stars, fmt } from './ui';

export interface BattleOutcome {
  battleId: string;
  kind: string;
  result: BattleResult;
  rewards: { gold: number; wood: number; stone: number };
  scorePoints: number;
  notes: string[];
}

export interface BattleTarget {
  title: string;
  subtitle?: string;
  layout: Omit<DefenseBuilding, 'id'>[];
  submit: (deployments: Deployment[]) => Promise<BattleOutcome>;
}

const TROOP_COLOR: Record<TroopType, string> = { infantry: '#d64545', archer: '#3fa34d', cavalry: '#2f6db3', siege: '#8a5a2b' };
const TROOP_GLYPH: Record<TroopType, string> = { infantry: '⚔️', archer: '🏹', cavalry: '🐎', siege: '🪵' };
export { TROOP_GLYPH };

/** Choose troops and deploy sides, then let the server resolve the battle. */
export function BattlePrep({ target, onClose, onDone }: { target: BattleTarget; onClose: () => void; onDone?: () => void }) {
  const { kingdom, cfg, refreshKingdom, toast } = useGame();
  const [counts, setCounts] = useState<Record<TroopType, number>>(() => ({ ...kingdom!.troops }));
  const [sides, setSides] = useState<Record<TroopType, DeploySide>>({ infantry: 'south', archer: 'south', cavalry: 'east', siege: 'south' });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<BattleOutcome | null>(null);
  const total = TROOP_TYPES.reduce((a, t) => a + counts[t], 0);

  async function attack() {
    setBusy(true);
    try {
      const deployments = TROOP_TYPES.filter((t) => counts[t] > 0).map((t) => ({ troop: t, count: counts[t], side: sides[t] }));
      const r = await target.submit(deployments);
      setOutcome(r);
      refreshKingdom();
      onDone?.();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }

  if (outcome) return <BattleReplay battleId={outcome.battleId} outcome={outcome} onClose={onClose} />;

  return (
    <Modal title={target.title} onClose={onClose} wide>
      {target.subtitle && <p className="muted small" style={{ marginTop: 0 }}>{target.subtitle}</p>}
      <LayoutPreview layout={target.layout} sides={TROOP_TYPES.filter((t) => counts[t] > 0).map((t) => sides[t])} />
      <h3>Choose your army</h3>
      <div className="list">
        {TROOP_TYPES.map((t) => {
          const have = kingdom!.troops[t];
          return (
            <div className="item" key={t} style={{ opacity: have ? 1 : 0.5 }}>
              <span style={{ fontSize: 22 }}>{TROOP_GLYPH[t]}</span>
              <div className="grow">
                <div className="title">{cfg.troops[t].name}</div>
                <div className="muted small">{have} available</div>
              </div>
              <div className="stepper">
                <button onClick={() => setCounts({ ...counts, [t]: Math.max(0, counts[t] - 1) })} disabled={!have} aria-label={`Fewer ${t}`}>−</button>
                <input className="input" type="number" min={0} max={have} value={counts[t]} onChange={(e) => setCounts({ ...counts, [t]: Math.max(0, Math.min(have, Number(e.target.value) || 0)) })} disabled={!have} aria-label={`${t} count`} />
                <button onClick={() => setCounts({ ...counts, [t]: Math.min(have, counts[t] + 1) })} disabled={!have} aria-label={`More ${t}`}>+</button>
              </div>
              <select className="input" style={{ width: 92 }} value={sides[t]} onChange={(e) => setSides({ ...sides, [t]: e.target.value as DeploySide })} disabled={!have} aria-label={`${t} deploy side`}>
                {(['north', 'east', 'south', 'west'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      <p className="muted small">Troops that fall in battle are lost; survivors return home. The server decides the outcome — the replay is shown afterwards.</p>
      <div className="row spread">
        <span className="small"><b>{total}</b> troops selected</span>
        <button className="btn danger" disabled={busy || total === 0} onClick={attack}>{busy ? 'Fighting…' : '⚔ Attack!'}</button>
      </div>
    </Modal>
  );
}

const STATIC_VIEW = `${-GRID_SIZE * 32 - 20} -110 ${GRID_SIZE * 64 + 40} ${GRID_SIZE * 32 + 140}`;

function Ground() {
  return (
    <g>
      <polygon points={pts([p(0, 0), p(GRID_SIZE, 0), p(GRID_SIZE, GRID_SIZE), p(0, GRID_SIZE)])} fill="#5a9a36" stroke="#2f5a1c" strokeWidth={3} />
      <polygon points={pts([p(1, 1), p(GRID_SIZE - 1, 1), p(GRID_SIZE - 1, GRID_SIZE - 1), p(1, GRID_SIZE - 1)])} fill="#62a63a" />
    </g>
  );
}

function LayoutPreview({ layout, sides }: { layout: Omit<DefenseBuilding, 'id'>[]; sides: DeploySide[] }) {
  const { cfg } = useGame();
  const sorted = [...layout].sort((a, b) => a.x + a.y - (b.x + b.y));
  const edge: Record<DeploySide, [[number, number], [number, number]]> = {
    north: [[0, 0], [GRID_SIZE, 0]], south: [[0, GRID_SIZE], [GRID_SIZE, GRID_SIZE]], west: [[0, 0], [0, GRID_SIZE]], east: [[GRID_SIZE, 0], [GRID_SIZE, GRID_SIZE]],
  };
  return (
    <svg viewBox={STATIC_VIEW} style={{ width: '100%', maxHeight: 260, background: '#2f5a1c', borderRadius: 10 }} role="img" aria-label="Enemy base preview">
      <SvgDefs />
      <Ground />
      {[...new Set(sides)].map((s) => {
        const [[a, b], [c, d]] = edge[s];
        return <line key={s} x1={p(a, b)[0]} y1={p(a, b)[1]} x2={p(c, d)[0]} y2={p(c, d)[1]} stroke="#ff5a3c" strokeWidth={8} strokeLinecap="round" opacity={0.8} />;
      })}
      {sorted.map((b, i) => <BuildingSprite key={i} type={b.type} x={b.x} y={b.y} level={b.level} size={cfg.buildings[b.type].size} />)}
    </svg>
  );
}

const BuildingLayer = memo(function BuildingLayer({ layout, destroyed, cfgSizes }: { layout: DefenseBuilding[]; destroyed: string; cfgSizes: Record<string, number> }) {
  const dead = new Set(destroyed.split(',').filter(Boolean).map(Number));
  const order = layout.map((b, i) => ({ b, i })).sort((a, c) => a.b.x + a.b.y - (c.b.x + c.b.y));
  return (
    <g>
      {order.map(({ b, i }) => {
        const s = cfgSizes[b.type];
        if (dead.has(i)) {
          const [cx, cy] = p(b.x + s / 2, b.y + s / 2);
          return <g key={i}><ellipse cx={cx} cy={cy} rx={s * 22} ry={s * 10} fill="#5b4a3a" /><circle cx={cx - 6} cy={cy - 3} r={4} fill="#7c6a58" /><circle cx={cx + 5} cy={cy} r={3} fill="#3e3226" /></g>;
        }
        return <BuildingSprite key={i} type={b.type} x={b.x} y={b.y} level={b.level} size={s} />;
      })}
    </g>
  );
});

/** Re-simulates the stored battle locally (same deterministic engine) to animate it. */
export function BattleReplay({ battleId, outcome, onClose }: { battleId: string; outcome?: BattleOutcome; onClose: () => void }) {
  const { cfg } = useGame();
  const [battle, setBattle] = useState<any>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  useEffect(() => { api('GET', `/battles/${battleId}`).then((r) => setBattle(r.battle)).catch(() => setBattle({ error: true })); }, [battleId]);

  const sim = useMemo(() => {
    if (!battle?.input) return null;
    const input = battle.input as BattleInput;
    const out = simulateBattle(input, cfg, { record: true, frameEvery: 2 });
    const layout = input.defense.filter((d) => d.level >= 1);
    return { frames: out.frames, matches: sameBattleResult(out.result, battle.result), layout, maxHp: layout.map((b) => cfg.buildings[b.type].levels[b.level - 1].hp) };
  }, [battle, cfg]);

  const timer = useRef<number>();
  useEffect(() => {
    if (!sim || !playing) return;
    timer.current = window.setInterval(() => setFrameIdx((i) => (i + 1 >= sim.frames.length ? (setPlaying(false), i) : i + 1)), 200 / speed);
    return () => clearInterval(timer.current);
  }, [sim, playing, speed]);

  const result: BattleResult | undefined = outcome?.result ?? battle?.result;
  const frame: ReplayFrame | undefined = sim?.frames[frameIdx];
  const sizes = useMemo(() => Object.fromEntries(Object.entries(cfg.buildings).map(([k, v]) => [k, v.size])), [cfg]);
  const destroyed = frame ? frame.buildings.filter((b) => b.hp <= 0).map((b) => b.idx).join(',') : '';
  const finished = sim && frameIdx >= sim.frames.length - 1;

  return (
    <Modal title="Battle" onClose={onClose} wide>
      {!sim ? <div className="empty">{battle?.error ? 'Could not load the battle.' : 'Loading replay…'}</div> : (
        <>
          <svg viewBox={STATIC_VIEW} className="battle-canvas" role="img" aria-label="Battle replay">
            <SvgDefs />
            <Ground />
            <BuildingLayer layout={sim.layout} destroyed={destroyed} cfgSizes={sizes} />
            {frame?.buildings.map((b) => {
              const d = sim.layout[b.idx];
              if (b.hp <= 0 || b.hp >= sim.maxHp[b.idx]) return null;
              const s = sizes[d.type];
              const [x, y] = p(d.x + s / 2, d.y + s / 2, s === 1 ? 26 : 60);
              return <g key={b.idx}><rect x={x - 16} y={y} width={32} height={5} fill="#300" /><rect x={x - 16} y={y} width={(32 * b.hp) / sim.maxHp[b.idx]} height={5} fill="#e33" /></g>;
            })}
            {frame?.units.map((u) => {
              const [x, y] = p(u.x, u.y, 6);
              const r = u.troop === 'siege' ? 13 : u.troop === 'cavalry' ? 11 : 9;
              return (
                <g key={u.id}>
                  <ellipse cx={x} cy={y + 6} rx={r} ry={r / 2.2} fill="rgba(0,0,0,.25)" />
                  <circle cx={x} cy={y} r={r} fill={TROOP_COLOR[u.troop]} stroke="#1a1a1a" strokeWidth={1.2} />
                  {u.hp < u.maxHp && <rect x={x - 8} y={y - r - 6} width={(16 * Math.max(0, u.hp)) / u.maxHp} height={3} fill="#7cfc00" />}
                </g>
              );
            })}
            {frame?.shots.map((s, i) => {
              const [a, b] = s.kind === 'unit' ? p(s.fromX, s.fromY, 8) : p(s.fromX, s.fromY, 50);
              const [c, d] = p(s.toX, s.toY, 8);
              return <line key={i} x1={a} y1={b} x2={c} y2={d} stroke={s.kind === 'heavy' ? '#ffb02e' : s.kind === 'tower' ? '#fff3b0' : 'rgba(255,255,255,.5)'} strokeWidth={s.kind === 'heavy' ? 3 : 1.5} />;
            })}
          </svg>
          <div className="row spread" style={{ margin: '8px 0' }}>
            <div className="row">
              <button className="btn secondary small" onClick={() => { if (finished) setFrameIdx(0); setPlaying(!playing || !!finished); }}>{playing && !finished ? 'Pause' : finished ? 'Replay' : 'Play'}</button>
              <button className="btn secondary small" onClick={() => setSpeed(speed === 4 ? 1 : speed * 2)}>{speed}x</button>
              <button className="btn secondary small" onClick={() => { setFrameIdx(sim.frames.length - 1); setPlaying(false); }}>Skip</button>
            </div>
            <span className="muted small">{((frame?.tick ?? 0) / 10).toFixed(0)}s</span>
          </div>
          {!sim.matches && <p className="muted small">Balancing changed since this battle; the replay is approximate. The recorded server result below is authoritative.</p>}
        </>
      )}
      {result && (finished || !sim) && (
        <div className="panel" style={{ marginTop: 8 }}>
          <div className="row spread">
            <div>
              <h2 style={{ marginBottom: 2 }}>{result.victory ? 'Victory!' : 'Defeat'}</h2>
              <Stars n={result.stars} />
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="display" style={{ fontSize: '1.6rem' }}>{result.destructionPercent}%</div>
              <div className="muted small">destruction</div>
            </div>
          </div>
          {outcome && (
            <>
              <div className="row spread small" style={{ marginTop: 6 }}><span>Rewards</span><Cost cost={outcome.rewards} /></div>
              <div className="row spread small"><span>Season points</span><b>{outcome.scorePoints}</b></div>
              {outcome.notes.map((n) => <p key={n} className="small muted" style={{ margin: '4px 0' }}>{n}</p>)}
            </>
          )}
          <div className="small" style={{ marginTop: 6 }}>
            Lost: {TROOP_TYPES.filter((t) => result.casualties[t]).map((t) => `${result.casualties[t]} ${t}`).join(', ') || 'none'} ·
            Returned: {TROOP_TYPES.filter((t) => result.survivors[t]).map((t) => `${result.survivors[t]} ${t}`).join(', ') || 'none'}
          </div>
          <button className="btn block" style={{ marginTop: 10 }} onClick={onClose}>Continue</button>
        </div>
      )}
      {result && sim && !finished && <p className="muted small">Result: {result.victory ? 'Victory' : 'Defeat'} · {fmt(result.destructionPercent)}% — watch the replay or skip.</p>}
    </Modal>
  );
}
