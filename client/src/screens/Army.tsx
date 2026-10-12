import { useEffect, useState } from 'react';
import { TROOP_TYPES, troopStatMultiplier, type TroopType } from '@mini-empire/shared';
import { api } from '../api';
import { useGame, type KingdomView } from '../game';
import { BattlePrep, BattleReplay, TROOP_GLYPH, type BattleTarget } from '../components/Battle';
import { AVATAR_GLYPH, Cost, Countdown, Loading, Progress, Stars, fmtDuration, useTick } from '../components/ui';

type Tab = 'train' | 'campaign' | 'players' | 'reports';

export function ArmyScreen() {
  const [tab, setTab] = useState<Tab>('train');
  return (
    <div className="scroll">
      <div className="scroll-inner">
        <div className="tabs" role="tablist">
          {([['train', 'Barracks'], ['campaign', 'Campaign'], ['players', 'Attack players'], ['reports', 'Battle log']] as const).map(([id, label]) => (
            <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)} role="tab" aria-selected={tab === id}>{label}</button>
          ))}
        </div>
        {tab === 'train' && <Barracks />}
        {tab === 'campaign' && <Campaign />}
        {tab === 'players' && <Players />}
        {tab === 'reports' && <Reports />}
      </div>
    </div>
  );
}

function Barracks() {
  const { kingdom, cfg, run, setKingdom } = useGame();
  const [amount, setAmount] = useState<Record<TroopType, number>>({ infantry: 5, archer: 5, cavalry: 2, siege: 1 });
  const now = useTick();
  if (!kingdom) return <Loading />;
  const barracks = kingdom.buildings.find((b) => b.type === 'barracks' && b.level >= 1);
  if (!barracks) {
    return (
      <div className="panel">
        <h2>No Barracks yet</h2>
        <p>Build a Barracks in your kingdom (Build → Barracks) to train troops. Until then your kingdom is defended only by its towers and walls.</p>
      </div>
    );
  }
  const free = kingdom.armyCapacity - kingdom.housingUsed;
  async function train(t: TroopType) {
    const r = await run(() => api<KingdomView>('POST', '/army/train', { troop: t, count: amount[t] }), `Training ${amount[t]} ${cfg.troops[t].name}`);
    if (r) setKingdom(r);
  }
  async function cancel(id: string) {
    const r = await run(() => api<KingdomView>('POST', `/army/train/${id}/cancel`), 'Training cancelled and refunded');
    if (r) setKingdom(r);
  }
  return (
    <>
      <div className="panel dark">
        <div className="row spread">
          <div>
            <h2 style={{ color: 'var(--gold)' }}>Barracks · level {barracks.level}</h2>
            <div className="small">Troop strength bonus: +{Math.round((troopStatMultiplier(barracks.level) - 1) * 100)}%</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="display" style={{ fontSize: '1.3rem' }}>{kingdom.housingUsed}/{kingdom.armyCapacity}</div>
            <div className="small">army capacity</div>
          </div>
        </div>
        <div className="row wrap" style={{ marginTop: 8, gap: 12 }}>
          {TROOP_TYPES.map((t) => <span key={t}>{TROOP_GLYPH[t]} <b>{kingdom.troops[t]}</b> {cfg.troops[t].name}</span>)}
        </div>
      </div>

      {kingdom.trainingQueue.length > 0 && (
        <div className="panel">
          <h2>Training queue</h2>
          <div className="list">
            {kingdom.trainingQueue.map((q, i) => {
              const running = i === 0 && now >= q.startsAt;
              const nextAt = q.startsAt + q.perUnitMs;
              return (
                <div className="item" key={q.id}>
                  <span style={{ fontSize: 20 }}>{TROOP_GLYPH[q.troop]}</span>
                  <div className="grow">
                    <div className="title small">{q.remaining} × {cfg.troops[q.troop].name}</div>
                    {running ? <><Progress from={q.startsAt} to={nextAt} /><div className="muted small">next in <Countdown until={nextAt} /> · all done in <Countdown until={q.startsAt + q.remaining * q.perUnitMs} /></div></> : <div className="muted small">waiting · starts in {fmtDuration(q.startsAt - now)}</div>}
                  </div>
                  <button className="btn danger small" onClick={() => cancel(q.id)} title="Unstarted units are fully refunded, the unit in training at 50%">Cancel</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="list">
        {TROOP_TYPES.map((t) => {
          const d = cfg.troops[t];
          const locked = barracks.level < d.barracksLevel;
          const n = amount[t];
          const cost = { gold: d.cost.gold * n, wood: d.cost.wood * n, stone: d.cost.stone * n };
          const fits = n * d.housing <= free;
          return (
            <div className="panel" key={t} style={{ marginBottom: 0, opacity: locked ? 0.6 : 1 }}>
              <div className="row spread">
                <div className="row">
                  <span style={{ fontSize: 28 }}>{TROOP_GLYPH[t]}</span>
                  <div><b className="display">{d.name}</b><div className="muted small">{d.description}</div></div>
                </div>
                {locked && <span className="badge">Barracks {d.barracksLevel}</span>}
              </div>
              <div className="grid2" style={{ marginTop: 8 }}>
                <div className="stat">Health<b>{Math.round(d.hp * kingdom.troopMultiplier)}</b></div>
                <div className="stat">Damage<b>{Math.round(d.damage * kingdom.troopMultiplier)} / {d.attackInterval}s</b></div>
                <div className="stat">Speed · Range<b>{d.moveSpeed} · {d.range}</b></div>
                <div className="stat">Housing · Time<b>{d.housing} · {fmtDuration(d.trainSec * 1000)}</b></div>
                <div className="stat">Targets<b>{d.targetPriority === 'defense' ? 'Towers first' : 'Nearest'}</b></div>
                <div className="stat">vs Walls<b>×{d.damageModifiers.wall}</b></div>
              </div>
              {!locked && (
                <div className="row spread wrap" style={{ marginTop: 8 }}>
                  <div className="stepper">
                    <button onClick={() => setAmount({ ...amount, [t]: Math.max(1, n - 1) })} aria-label="Fewer">−</button>
                    <input className="input" type="number" min={1} max={100} value={n} onChange={(e) => setAmount({ ...amount, [t]: Math.max(1, Math.min(100, Number(e.target.value) || 1)) })} aria-label={`${d.name} amount`} />
                    <button onClick={() => setAmount({ ...amount, [t]: Math.min(100, n + 1) })} aria-label="More">+</button>
                  </div>
                  <Cost cost={cost} have={kingdom.resources} />
                  <button className="btn small" disabled={!fits} onClick={() => train(t)} title={fits ? '' : 'Not enough army capacity'}>Train</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Campaign() {
  const [stages, setStages] = useState<any[] | null>(null);
  const [target, setTarget] = useState<BattleTarget | null>(null);
  const load = () => api('GET', '/battles/pve').then((r) => setStages(r.stages)).catch(() => setStages([]));
  useEffect(() => { load(); }, []);
  if (!stages) return <Loading />;
  return (
    <>
      <p className="muted small">Campaign battles reward resources and season points. Each stage pays out up to 3 times per day; the first clear gives a bonus.</p>
      <div className="list">
        {stages.map((s) => (
          <div className="item" key={s.id} style={{ opacity: s.unlocked ? 1 : 0.55 }}>
            <div className="display" style={{ width: 28, textAlign: 'center', fontWeight: 800 }}>{s.id}</div>
            <div className="grow">
              <div className="title">{s.name}</div>
              <div className="small"><Stars n={s.bestStars} /> <span className="muted">· rewards left today: {s.rewardedAttemptsLeft}</span></div>
              <Cost cost={s.reward} />
            </div>
            <button className="btn small" disabled={!s.unlocked} onClick={() => setTarget({ title: `Stage ${s.id}: ${s.name}`, subtitle: 'Destroy 50% for one star, the Headquarters for another, everything for three.', layout: s.layout, submit: (deployments) => api('POST', '/battles/pve', { stage: s.id, deployments }) })}>
              {s.unlocked ? 'Attack' : `HQ ${s.hqRequired}`}
            </button>
          </div>
        ))}
      </div>
      {target && <BattlePrep target={target} onClose={() => { setTarget(null); load(); }} />}
    </>
  );
}

function Players() {
  const [opps, setOpps] = useState<any[] | null>(null);
  const [target, setTarget] = useState<BattleTarget | null>(null);
  const load = () => api('GET', '/battles/opponents').then((r) => setOpps(r.opponents)).catch(() => setOpps([]));
  useEffect(() => { load(); }, []);
  async function scout(o: any) {
    const { layout } = await api('GET', `/battles/opponents/${o.id}/layout`);
    setTarget({
      title: `Attack ${o.username}`,
      subtitle: 'Loot is a share of their stored resources (capped). They get a protective shield afterwards.',
      layout,
      submit: (deployments) => api('POST', '/battles/pvp', { defenderId: o.id, deployments }),
    });
  }
  if (!opps) return <Loading />;
  return (
    <>
      <div className="row spread"><p className="muted small">Opponents near your Headquarters level. Repeated attacks on the same player give fewer points.</p><button className="btn secondary small" onClick={load}>Refresh</button></div>
      {opps.length === 0 ? <div className="panel empty">No opponents available right now. Shielded players and clan mates cannot be attacked.</div> : (
        <div className="list">
          {opps.map((o) => (
            <div className="item" key={o.id}>
              <span style={{ fontSize: 24 }}>{AVATAR_GLYPH[o.avatar] ?? '🛡️'}</span>
              <div className="grow">
                <div className="title">{o.username} {o.clanTag && <span className="badge">{o.clanTag}</span>}</div>
                <div className="muted small">HQ {o.hqLevel} · power {o.power}{o.scoreMultiplier < 1 ? ` · points ×${o.scoreMultiplier}` : ''}</div>
              </div>
              <button className="btn small" onClick={() => scout(o)}>Scout</button>
            </div>
          ))}
        </div>
      )}
      {target && <BattlePrep target={target} onClose={() => { setTarget(null); load(); }} />}
    </>
  );
}

function Reports() {
  const [reports, setReports] = useState<any[] | null>(null);
  const [replay, setReplay] = useState<string | null>(null);
  useEffect(() => { api('GET', '/battles').then((r) => setReports(r.reports)).catch(() => setReports([])); }, []);
  if (!reports) return <Loading />;
  if (!reports.length) return <div className="panel empty">No battles yet. Try the campaign!</div>;
  return (
    <>
      <div className="list">
        {reports.map((r) => (
          <div className="item" key={r.battle_id}>
            <span className={`badge ${r.summary.victory === (r.role === 'attacker') ? 'ok' : 'bad'}`}>{r.role === 'attacker' ? (r.summary.victory ? 'WIN' : 'LOSS') : r.summary.victory ? 'DEFENSE LOST' : 'DEFENDED'}</span>
            <div className="grow">
              <div className="title small">{r.kind.toUpperCase()} · {r.role === 'attacker' ? (r.defender ? `vs ${r.defender}` : r.summary.pveStage ? `Stage ${r.summary.pveStage}` : r.summary.territoryId ?? '') : `by ${r.attacker}`}</div>
              <div className="small"><Stars n={r.summary.stars} /> <span className="muted">{r.summary.destruction}% · {new Date(r.created_at).toLocaleString()}</span></div>
              {r.role === 'defender' && r.summary.lost && <div className="small muted">Lost: <Cost cost={r.summary.lost} /></div>}
            </div>
            <button className="btn secondary small" onClick={() => setReplay(r.battle_id)}>Replay</button>
          </div>
        ))}
      </div>
      {replay && <BattleReplay battleId={replay} onClose={() => setReplay(null)} />}
    </>
  );
}
