import { useEffect, useState } from 'react';
import { api } from '../api';
import { useGame } from '../game';
import { BattlePrep, type BattleTarget } from '../components/Battle';
import { Countdown, Emblem, Loading, Modal } from '../components/ui';
import { STATE_LABEL } from '../components/TopBar';

const KIND_COLOR: Record<string, string> = { neutral: '#9ca3af', resource: '#d39a2c', strategic: '#7e22ce', event: '#c2410c' };

export function WorldScreen() {
  const { season } = useGame();
  const [world, setWorld] = useState<any>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [history, setHistory] = useState<any>(null);
  const [target, setTarget] = useState<BattleTarget | null>(null);
  const load = () => api('GET', '/world').then(setWorld).catch(() => setWorld({ error: true }));
  useEffect(() => { load(); }, []);
  useEffect(() => {
    setHistory(null);
    if (sel) api('GET', `/world/territories/${sel}/history`).then(setHistory).catch(() => undefined);
  }, [sel]);
  if (!world) return <div className="scroll"><Loading /></div>;
  if (world.error) return <div className="scroll"><div className="panel empty">Could not load the world map.</div></div>;
  const t = world.territories.find((x: any) => x.id === sel);
  const warPhase = season?.timeline.find((p) => p.state === 'WAR_ACTIVE');
  return (
    <div className="scroll">
      <div className="scroll-inner">
        <div className="panel dark">
          <div className="row spread wrap">
            <div>
              <h2 style={{ color: 'var(--gold)' }}>The Realm</h2>
              <div className="small">{world.territories.length} territories · phase: {STATE_LABEL[world.season.state]}</div>
            </div>
            <span className={`badge ${world.attacksOpen ? 'ok' : 'warn'}`}>{world.attacksOpen ? 'Territory battles OPEN' : 'Battles closed'}</span>
          </div>
          {!world.attacksOpen && warPhase && <p className="small" style={{ marginBottom: 0 }}>Clans can fight for territories during the war phase (days {warPhase.days[0]}–{warPhase.days[1]}), starting in <Countdown until={warPhase.startsAt} />. Capturing needs {world.rules.starsToCapture} stars; held territories earn clan points every hour.</p>}
        </div>
        <div className="world">
          <svg viewBox="0 0 100 100" role="img" aria-label="World map">
            <defs>
              <pattern id="waves" width="6" height="3" patternUnits="userSpaceOnUse"><path d="M0 2 q1.5 -1.5 3 0 t3 0" stroke="#6aa0d8" strokeWidth=".3" fill="none" /></pattern>
            </defs>
            <rect width="100" height="100" fill="url(#waves)" opacity={0.25} />
            <path d="M8 30 Q30 5 60 8 T95 25 Q98 60 88 92 Q50 98 15 92 Q2 60 8 30z" fill="#7fb35a" opacity={0.35} />
            {world.territories.flatMap((a: any) => a.adjacent.filter((b: string) => b > a.id).map((b: string) => {
              const o = world.territories.find((x: any) => x.id === b);
              return <line key={`${a.id}-${b}`} x1={a.mapX} y1={a.mapY} x2={o.mapX} y2={o.mapY} stroke="#5a3d24" strokeWidth={0.5} strokeDasharray="1.2 1" opacity={0.7} />;
            }))}
            {world.territories.map((x: any) => {
              const mine = x.ownerClanId && x.ownerClanId === world.myClanId;
              const color = x.owner?.emblem?.color ?? KIND_COLOR[x.kind];
              return (
                <g key={x.id} onClick={() => setSel(x.id)} style={{ cursor: 'pointer' }} role="button" aria-label={x.name}>
                  <circle cx={x.mapX} cy={x.mapY} r={3.2 + x.value * 0.6} fill={color} stroke={mine ? '#ffe27a' : sel === x.id ? '#fff' : '#2a1c10'} strokeWidth={mine || sel === x.id ? 0.9 : 0.5} />
                  <path d={`M${x.mapX - 1.6} ${x.mapY + 1} v-2 l.8 .6 v-1.4 l.8 .8 l.8 -.8 v1.4 l.8 -.6 v2z`} fill="#f4e6c8" />
                  <text x={x.mapX} y={x.mapY + 6.5 + x.value * 0.4} textAnchor="middle" fontSize="2.6" fontWeight={800} fill="#1e140c" stroke="#f4e6c8" strokeWidth={0.5} paintOrder="stroke">{x.name}</text>
                </g>
              );
            })}
          </svg>
        </div>
        <div className="row wrap small legend" style={{ margin: '8px 0', gap: 12 }}>
          {Object.entries(KIND_COLOR).map(([k, c]) => <span key={k} className="row" style={{ gap: 4 }}><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill={c} /></svg>{k}</span>)}
          <span className="muted">Owned territories show their clan colour.</span>
        </div>
      </div>
      {t && (
        <Modal title={t.name} onClose={() => setSel(null)}>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="badge">{t.kind}</span>
            <span className="badge">value ×{t.value}</span>
            <span className="badge">garrison {t.effectiveGarrison}</span>
            <span className={`badge ${t.status === 'protected' ? 'warn' : ''}`}>{t.status}</span>
          </div>
          <div className="item" style={{ marginTop: 10 }}>
            {t.owner ? <Emblem icon={t.owner.emblem.icon} color={t.owner.emblem.color} /> : <span style={{ fontSize: 24 }}>🏳️</span>}
            <div className="grow">
              <div className="title">{t.owner ? `${t.owner.name} [${t.owner.tag}]` : 'Unclaimed'}</div>
              {t.cooldownUntil && new Date(t.cooldownUntil).getTime() > Date.now() && <div className="small muted">Protected for <Countdown until={new Date(t.cooldownUntil).getTime()} /></div>}
            </div>
          </div>
          <p className="small muted">Attempts left today: {t.myAttemptsLeft}. Capture with {world.rules.starsToCapture}+ stars. Requires a clan and HQ {world.rules.minHq}.</p>
          <button
            className="btn block danger"
            disabled={!world.attacksOpen || !world.myClanId || t.ownerClanId === world.myClanId || t.status === 'protected' || t.myAttemptsLeft <= 0}
            onClick={() => setTarget({ title: `Attack ${t.name}`, subtitle: `Garrison level ${t.effectiveGarrison}`, layout: t.layout, submit: (deployments) => api('POST', `/world/territories/${t.id}/attack`, { deployments }) })}
          >
            {!world.attacksOpen ? 'Opens during the war phase' : !world.myClanId ? 'Join a clan first' : t.ownerClanId === world.myClanId ? 'Held by your clan' : 'Attack territory'}
          </button>
          <h3>History</h3>
          {!history ? <Loading /> : history.ownership.length === 0 && history.battles.length === 0 ? <p className="muted small">No battles here yet.</p> : (
            <div className="list">
              {history.ownership.map((h: any) => <div className="item small" key={h.id}>🏰 <span className="grow">{h.name} [{h.tag}] captured</span><span className="muted">{new Date(h.started_at).toLocaleString()}</span></div>)}
              {history.battles.map((b: any) => <div className="item small" key={b.id}>⚔️ <span className="grow">{b.username}: {b.stars}★ {b.destruction}%</span><span className="muted">{new Date(b.created_at).toLocaleString()}</span></div>)}
            </div>
          )}
        </Modal>
      )}
      {target && <BattlePrep target={target} onClose={() => { setTarget(null); load(); }} />}
    </div>
  );
}
