import { useEffect, useState } from 'react';
import { api } from '../api';
import { useGame } from '../game';
import { Loading } from '../components/ui';

type Tab = 'overview' | 'players' | 'clans' | 'config' | 'season' | 'rewards' | 'review' | 'audit';

export function AdminScreen({ onExit }: { onExit: () => void }) {
  const { me } = useGame();
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="scroll">
      <div className="scroll-inner">
        <div className="row spread">
          <h2 style={{ color: 'var(--gold)' }}>Operations · {me.role}</h2>
          <button className="btn secondary small" onClick={onExit}>Back to game</button>
        </div>
        <div className="tabs">
          {(['overview', 'players', 'clans', 'config', 'season', 'rewards', 'review', 'audit'] as Tab[]).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t}</button>)}
        </div>
        {tab === 'overview' && <Overview />}
        {tab === 'players' && <Players />}
        {tab === 'clans' && <Clans />}
        {tab === 'config' && <Config />}
        {tab === 'season' && <SeasonAdmin />}
        {tab === 'rewards' && <Rewards />}
        {tab === 'review' && <Review />}
        {tab === 'audit' && <Audit />}
      </div>
    </div>
  );
}

function useLoad<T = any>(path: string, deps: unknown[] = []): [T | null, () => void, string] {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const load = () => { setErr(''); api<T>('GET', path).then(setData).catch((e) => setErr(e.message)); };
  useEffect(load, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return [data, load, err];
}

function Overview() {
  const [d, , err] = useLoad('/admin/overview');
  if (err) return <div className="panel error-text">{err}</div>;
  if (!d) return <Loading />;
  return (
    <>
      <div className="grid2">
        {Object.entries(d.counts).map(([k, v]) => <div key={k} className="stat">{k.replace('_', ' ')}<b>{String(v)}</b></div>)}
        <div className="stat">season<b>#{d.season.number} {d.season.state}</b></div>
        <div className="stat">uptime<b>{Math.round(d.health.uptimeSec / 60)} min</b></div>
        <div className="stat">memory<b>{d.health.memoryMb} MB</b></div>
        <div className="stat">config<b>{d.health.configVersion}</b></div>
      </div>
      <div className="panel" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Recent errors</h3>
        {d.recentErrors.length === 0 ? <p className="muted small">No errors logged.</p> : d.recentErrors.map((e: any, i: number) => <div key={i} className="small"><span className="muted">{new Date(e.created_at).toLocaleString()}</span> {e.message}</div>)}
      </div>
    </>
  );
}

function Players() {
  const { run, me } = useGame();
  const [q, setQ] = useState('');
  const [list] = useLoad(`/admin/players?q=${encodeURIComponent(q)}`, [q]);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [note, setNote] = useState('');
  useEffect(() => { setDetail(null); if (sel) api('GET', `/admin/players/${sel}`).then(setDetail).catch(() => undefined); }, [sel]);
  async function post(path: string, body: unknown) {
    if (note.trim().length < 3) return run(async () => { throw new Error('Add a short note explaining the decision.'); });
    const r = await run(() => api('POST', path, { ...(body as object), note }), 'Saved & audited');
    if (r) { setNote(''); api('GET', `/admin/players/${sel}`).then(setDetail); }
  }
  return (
    <>
      <input className="input" placeholder="Search username or id" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list" style={{ marginTop: 8 }}>
        {(list?.players ?? []).map((p: any) => (
          <button key={p.id} className="item" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => setSel(p.id)}>
            <div className="grow"><b>{p.username}</b> <span className="muted small">HQ {p.hq_level} · {p.role}</span></div>
            {p.under_review && <span className="badge warn">review</span>}{p.suspended && <span className="badge bad">suspended</span>}
          </button>
        ))}
      </div>
      {detail && (
        <div className="panel" style={{ marginTop: 10 }}>
          <h3 style={{ marginTop: 0 }}>{detail.user.username}</h3>
          <div className="grid2">
            <div className="stat">Gold / Wood / Stone<b>{detail.kingdom.gold} / {detail.kingdom.wood} / {detail.kingdom.stone}</b></div>
            <div className="stat">HQ · power<b>{detail.kingdom.hq_level} · {detail.kingdom.power}</b></div>
            <div className="stat">Test tokens (units)<b>{detail.tokenUnits}</b></div>
            <div className="stat">Same-IP accounts<b>{detail.sameIpAccounts.map((a: any) => a.username).join(', ') || 'none'}</b></div>
          </div>
          <h3>Scores</h3>
          {detail.scores.map((s: any) => <div key={s.category + s.source} className="small">{s.category}/{s.source}: {s.points} pts from {s.events} events</div>)}
          <h3>Recent transactions</h3>
          <table className="t"><tbody>{detail.transactions.slice(0, 15).map((t: any, i: number) => <tr key={i}><td>{t.reason}</td><td>{t.delta_gold}/{t.delta_wood}/{t.delta_stone}</td><td className="muted">{new Date(t.created_at).toLocaleString()}</td></tr>)}</tbody></table>
          <h3>Flags</h3>
          {detail.flags.length === 0 ? <p className="muted small">None</p> : detail.flags.map((f: any) => <div key={f.id} className="small">{f.kind} ({f.severity}) · {f.status}</div>)}
          <h3>Actions</h3>
          <input className="input" placeholder="Reason / note (required, audited)" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="row wrap" style={{ marginTop: 8 }}>
            <button className="btn secondary small" onClick={() => post(`/admin/players/${sel}/review`, { underReview: !detail.user.under_review })}>{detail.user.under_review ? 'Clear review flag' : 'Flag for review'}</button>
            {me.role !== 'moderator' && <button className="btn danger small" onClick={() => post(`/admin/players/${sel}/suspend`, { suspended: !detail.user.suspended })}>{detail.user.suspended ? 'Unsuspend' : 'Suspend'}</button>}
          </div>
        </div>
      )}
    </>
  );
}

function Clans() {
  const [q, setQ] = useState('');
  const [list] = useLoad(`/admin/clans?q=${encodeURIComponent(q)}`, [q]);
  const [detail, setDetail] = useState<any>(null);
  return (
    <>
      <input className="input" placeholder="Search clans" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="list" style={{ marginTop: 8 }}>
        {(list?.clans ?? []).map((c: any) => (
          <button key={c.id} className="item" style={{ textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => api('GET', `/admin/clans/${c.id}`).then(setDetail)}>
            <div className="grow"><b>{c.name}</b> [{c.tag}] <span className="muted small">{c.members} members{c.disbanded_at ? ' · disbanded' : ''}</span></div>
          </button>
        ))}
      </div>
      {detail && (
        <div className="panel" style={{ marginTop: 10 }}>
          <h3 style={{ marginTop: 0 }}>{detail.clan.name}</h3>
          {detail.members.map((m: any) => <div key={m.user_id} className="small">{m.username} · {m.role} · contribution {m.contribution}</div>)}
          <h3>Rosters</h3>
          {detail.rosters.map((r: any) => <div key={r.season_id + r.user_id} className="small">S{r.season_id}: {r.username} {r.locked ? '(locked)' : ''}</div>)}
          <h3>Events</h3>
          {detail.events.slice(0, 30).map((e: any) => <div key={e.id} className="small">{new Date(e.created_at).toLocaleString()} · {e.type}</div>)}
        </div>
      )}
    </>
  );
}

function Config() {
  const { run } = useGame();
  const [d, load] = useLoad('/admin/config');
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => { if (d) setText(JSON.stringify(d.tunables, null, 2)); }, [d]);
  if (!d) return <Loading />;
  async function save() {
    let tunables;
    try { tunables = JSON.parse(text); } catch { return run(async () => { throw new Error('Tunables must be valid JSON'); }); }
    const r = await run(() => api('PUT', '/admin/config', { tunables, note }), (x: any) => `Config ${x.version} active`);
    if (r) { setNote(''); load(); }
  }
  return (
    <div className="panel">
      <p className="small">Active version <b>{d.version}</b>. Tunables are validated multipliers and limits on top of the code tables (see docs/ECONOMY.md). Example: <code>{'{"productionMultiplier":1.2,"battle":{"defenderShieldHours":6},"clanWar":{"minRosterSize":5}}'}</code></p>
      <textarea className="input" rows={10} style={{ fontFamily: 'monospace', fontSize: '.8rem' }} value={text} onChange={(e) => setText(e.target.value)} aria-label="Tunables JSON" />
      <input className="input" style={{ marginTop: 8 }} placeholder="Change note (required, audited)" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn" style={{ marginTop: 8 }} onClick={save} disabled={note.length < 3}>Apply</button>
      <h3>History</h3>
      {d.history.map((h: any) => <div key={h.id} className="small">v{h.id} · {h.username ?? 'system'} · {h.note} · {new Date(h.created_at).toLocaleString()}</div>)}
      <h3>Effective building table (headquarters)</h3>
      <table className="t"><thead><tr><th>Lvl</th><th>Gold</th><th>Wood</th><th>Stone</th><th>Time</th><th>HP</th></tr></thead>
        <tbody>{d.effective.buildings.headquarters.levels.map((l: any) => <tr key={l.level}><td>{l.level}</td><td>{l.cost.gold}</td><td>{l.cost.wood}</td><td>{l.cost.stone}</td><td>{Math.round(l.durationSec / 60)}m</td><td>{l.hp}</td></tr>)}</tbody></table>
    </div>
  );
}

function SeasonAdmin() {
  const { run, me } = useGame();
  const [d, load] = useLoad('/admin/season');
  const [lb] = useLoad('/admin/leaderboards');
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  if (!d) return <Loading />;
  const next: Record<string, string> = { DEVELOPMENT: 'WAR_PREPARATION', WAR_PREPARATION: 'WAR_ACTIVE', WAR_ACTIVE: 'RESULT_VERIFICATION' };
  const superadmin = me.role === 'superadmin';
  async function advance() {
    const r = await run(() => api('POST', '/admin/season/transition', { to: next[d.season.state], reason }), 'Season advanced');
    if (r) { setReason(''); load(); }
  }
  async function reset() {
    const r = await run(() => api('POST', '/admin/season/reset', { confirm }), (x: any) => (x.alreadyReset ? 'Already reset' : `Reset done: ${x.kingdomsReset} kingdoms`));
    if (r) { setConfirm(''); load(); }
  }
  return (
    <>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Season #{d.season.number} · {d.season.state}</h3>
        <div className="small">Starts {new Date(d.season.starts_at).toLocaleString()} · schedule {JSON.stringify(d.season.schedule)}</div>
        <h3>Transitions</h3>
        {d.transitions.map((t: any) => <div key={t.id} className="small">{new Date(t.created_at).toLocaleString()} · {t.from_state} → {t.to_state} · {t.username ?? 'scheduler'} · {t.reason}</div>)}
        {superadmin && next[d.season.state] && (
          <div style={{ marginTop: 10 }}>
            <p className="small">Force the next transition early (runs roster lock / finalization side effects). Normally the server advances on schedule.</p>
            <input className="input" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn danger small" style={{ marginTop: 6 }} disabled={reason.length < 5} onClick={advance}>Advance to {next[d.season.state]}</button>
          </div>
        )}
        {superadmin && d.season.state === 'REWARD_DISTRIBUTION' && (
          <div style={{ marginTop: 10 }}>
            <p className="small">Season reset archives every kingdom, resets seasonal progress and opens the next season. Type <b>RESET SEASON {d.season.number}</b>:</p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            <button className="btn danger small" style={{ marginTop: 6 }} onClick={reset} disabled={confirm !== `RESET SEASON ${d.season.number}`}>Reset season</button>
          </div>
        )}
      </div>
      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Wars</h3>
        {d.wars.length === 0 ? <p className="muted small">No wars this season yet.</p> : d.wars.map((w: any) => <div key={w.id} className="small">{w.name_a} {w.points_a} – {w.points_b} {w.name_b ?? '(bye)'} · {w.status} {w.outcome ?? ''}</div>)}
        <h3>Leaderboards</h3>
        {lb && (['clan', 'individual', 'participation'] as const).map((b) => <div key={b} className="small"><b>{b}:</b> {lb[b].slice(0, 5).map((e: any) => `#${e.rank} ${e.name} (${e.score})`).join(', ') || '—'}</div>)}
      </div>
    </>
  );
}

function Rewards() {
  const { run, me } = useGame();
  const [d, load] = useLoad('/admin/rewards');
  const [pool, setPool] = useState(100000);
  if (!d) return <Loading />;
  async function preview() { if (await run(() => api('POST', '/admin/rewards/preview', { poolTokens: pool }), 'Preview generated')) load(); }
  async function approve() { if (await run(() => api('POST', '/admin/rewards/approve'), (x: any) => `Distributed ${x.completed}, failed ${x.failed}`)) load(); }
  async function retry() { if (await run(() => api('POST', '/admin/rewards/retry'), (x: any) => `Retried: ${x.completed} ok, ${x.failed} failed`)) load(); }
  return (
    <div className="panel">
      <p className="small"><b>Simulated ledger.</b> No blockchain or real value. Flow: verification phase → preview → superadmin approval → distribution (idempotent, retryable).</p>
      <div className="small">Season state: {d.season.state} · pool: {d.pool ? `${d.pool.status}, ${BigInt(d.pool.total_units) / 1000000n} tokens` : 'none'}</div>
      <div className="row wrap" style={{ marginTop: 8 }}>
        <input className="input" type="number" style={{ width: 140 }} value={pool} onChange={(e) => setPool(Number(e.target.value))} aria-label="Pool tokens" />
        <button className="btn small" disabled={d.season.state !== 'RESULT_VERIFICATION'} onClick={preview}>Preview</button>
        {me.role === 'superadmin' && <button className="btn danger small" disabled={d.pool?.status !== 'previewed'} onClick={approve}>Approve & distribute</button>}
        <button className="btn secondary small" disabled={d.pool?.status !== 'partially_failed'} onClick={retry}>Retry failed</button>
      </div>
      <table className="t" style={{ marginTop: 10 }}>
        <thead><tr><th>Player</th><th>Category</th><th>Tokens</th><th>Status</th></tr></thead>
        <tbody>{d.allocations.map((a: any) => <tr key={a.id}><td>{a.username}</td><td>{a.category}</td><td>{(Number(a.units) / 1e6).toFixed(2)}</td><td>{a.status}{a.error ? ` (${a.error})` : ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

function Review() {
  const { run } = useGame();
  const [status, setStatus] = useState<'open' | 'dismissed' | 'actioned'>('open');
  const [d, load] = useLoad(`/admin/suspicious?status=${status}`, [status]);
  const [notes, setNotes] = useState<Record<number, string>>({});
  async function decide(id: number, s: 'dismissed' | 'actioned') {
    if (await run(() => api('POST', `/admin/suspicious/${id}/review`, { status: s, note: notes[id] ?? '' }), 'Decision recorded')) load();
  }
  return (
    <div className="panel">
      <p className="small">Risk signals are never acted on automatically. Review each one and record a decision.</p>
      <div className="tabs">{(['open', 'dismissed', 'actioned'] as const).map((s) => <button key={s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>{s}</button>)}</div>
      {!d ? <Loading /> : d.events.length === 0 ? <p className="muted small">Nothing here.</p> : d.events.map((e: any) => (
        <div key={e.id} className="item" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <div className="row spread"><b>{e.kind}</b><span className={`badge ${e.severity === 'high' ? 'bad' : e.severity === 'medium' ? 'warn' : ''}`}>{e.severity}</span></div>
          <div className="small">{e.username ?? 'unknown'} · {new Date(e.created_at).toLocaleString()} · {JSON.stringify(e.details)}</div>
          {status === 'open' ? (
            <div className="row wrap" style={{ marginTop: 6 }}>
              <input className="input" style={{ flex: 1 }} placeholder="Decision note" value={notes[e.id] ?? ''} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} />
              <button className="btn secondary small" onClick={() => decide(e.id, 'dismissed')}>Dismiss</button>
              <button className="btn danger small" onClick={() => decide(e.id, 'actioned')}>Action</button>
            </div>
          ) : <div className="small muted">Decision: {e.decision_note}</div>}
        </div>
      ))}
    </div>
  );
}

function Audit() {
  const [d, , err] = useLoad('/admin/audit');
  if (err) return <div className="panel error-text">{err}</div>;
  if (!d) return <Loading />;
  return (
    <div className="panel">
      <table className="t"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead>
        <tbody>{d.logs.map((l: any) => <tr key={l.id}><td className="small">{new Date(l.created_at).toLocaleString()}</td><td>{l.username ?? 'system'}</td><td>{l.action}</td><td className="small">{l.target_type}:{String(l.target_id ?? '').slice(0, 8)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
