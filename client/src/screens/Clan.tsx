import { useEffect, useRef, useState } from 'react';
import { CLAN_EMBLEM_COLORS, CLAN_EMBLEM_ICONS } from '@mini-empire/shared';
import { api } from '../api';
import { useGame } from '../game';
import { BattlePrep, type BattleTarget } from '../components/Battle';
import { AVATAR_GLYPH, Cost, Emblem, Loading, Stars } from '../components/ui';
import { STATE_LABEL } from '../components/TopBar';

export function ClanScreen() {
  const [mine, setMine] = useState<any>(undefined);
  const load = () => api('GET', '/clans/mine').then(setMine).catch(() => setMine({ clan: null }));
  useEffect(() => { load(); }, []);
  return (
    <div className="scroll">
      <div className="scroll-inner">
        {mine === undefined ? <Loading /> : mine.clan ? <MyClan data={mine} reload={load} /> : <NoClan reload={load} />}
      </div>
    </div>
  );
}

const EVENT_LABEL: Record<string, string> = {
  founded: 'founded the clan', joined: 'joined', left: 'left', kicked: 'was removed', promoted: 'was promoted to officer', demoted: 'was demoted',
  leadership_transferred: 'became leader', settings_changed: 'changed clan settings', roster_updated: 'updated the war roster', mission_completed: 'Clan mission completed',
  war_matched: 'War opponent assigned', war_finished: 'War finished', territory_captured: 'captured a territory', territory_lost: 'Territory lost',
  roster_removed_ineligible: 'was removed from the roster (ineligible)', war_not_entered: 'Clan did not enter the war', season_champion: 'Season champions!', disbanded: 'Clan disbanded',
};

function NoClan({ reload }: { reload: () => void }) {
  const { cfg, kingdom, run, refreshKingdom } = useGame();
  const [clans, setClans] = useState<any[] | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ name: '', tag: '', description: '', icon: 'lion', color: CLAN_EMBLEM_COLORS[0] as string, joinPolicy: 'open' });
  useEffect(() => {
    const id = setTimeout(() => api('GET', `/clans${search ? `?search=${encodeURIComponent(search)}` : ''}`).then((r) => setClans(r.clans)).catch(() => setClans([])), 250);
    return () => clearTimeout(id);
  }, [search]);
  async function join(id: string) {
    const r = await run(() => api('POST', `/clans/${id}/join`), (x: any) => (x.status === 'joined' ? 'Welcome to the clan!' : 'Join request sent'));
    if (r) reload();
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => api('POST', '/clans', { name: form.name, tag: form.tag, description: form.description, emblem: { icon: form.icon, color: form.color }, joinPolicy: form.joinPolicy }), 'Clan founded!');
    if (r) { refreshKingdom(); reload(); }
  }
  return (
    <>
      <div className="panel">
        <h2>Find a clan</h2>
        <input className="input" placeholder="Search by name or tag" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search clans" />
        <div className="list" style={{ marginTop: 10 }}>
          {!clans ? <Loading /> : clans.length === 0 ? <p className="muted small">No clans found. Found the first one!</p> : clans.map((c) => (
            <div className="item" key={c.id}>
              <Emblem icon={c.emblem.icon} color={c.emblem.color} />
              <div className="grow">
                <div className="title">{c.name} <span className="badge">{c.tag}</span></div>
                <div className="muted small">{c.members}/30 members · {c.score} pts · {c.join_policy === 'open' ? 'open' : 'request to join'}</div>
              </div>
              <button className="btn small" onClick={() => join(c.id)} disabled={c.members >= 30}>{c.join_policy === 'open' ? 'Join' : 'Request'}</button>
            </div>
          ))}
        </div>
      </div>
      <form className="panel" onSubmit={create}>
        <h2>Found a clan</h2>
        <label className="field">Name<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={3} maxLength={24} required /></label>
        <label className="field">Tag (2–5 letters)<input className="input" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value.toUpperCase() })} minLength={2} maxLength={5} pattern="[A-Za-z0-9]+" required /></label>
        <label className="field">Description<textarea className="input" rows={2} maxLength={300} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="field">Emblem
          <div className="row wrap" style={{ marginTop: 4 }}>
            {CLAN_EMBLEM_ICONS.map((i) => <button type="button" key={i} onClick={() => setForm({ ...form, icon: i })} style={{ border: form.icon === i ? '2px solid var(--gold-deep)' : '2px solid transparent', background: 'none', borderRadius: 8, cursor: 'pointer', padding: 2 }} aria-label={i}><Emblem icon={i} color={form.color} s={30} /></button>)}
          </div>
          <div className="row wrap" style={{ marginTop: 6 }}>
            {CLAN_EMBLEM_COLORS.map((c) => <button type="button" key={c} onClick={() => setForm({ ...form, color: c })} aria-label={`colour ${c}`} style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: form.color === c ? '3px solid #2a1c10' : '2px solid #fff', cursor: 'pointer' }} />)}
          </div>
        </div>
        <label className="field">Joining
          <select className="input" value={form.joinPolicy} onChange={(e) => setForm({ ...form, joinPolicy: e.target.value })}>
            <option value="open">Anyone can join</option>
            <option value="closed">Approval required</option>
          </select>
        </label>
        <div className="row spread">
          <span className="small">Cost: <Cost cost={cfg.economy.clanCreationCost} have={kingdom?.resources} /></span>
          <button className="btn">Found clan</button>
        </div>
      </form>
    </>
  );
}

function MyClan({ data, reload }: { data: any; reload: () => void }) {
  const { me, run } = useGame();
  const clan = data.clan;
  const role: string = data.myRole;
  const [tab, setTab] = useState<'members' | 'chat' | 'war' | 'history' | 'settings'>('members');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const isStaff = role === 'leader' || role === 'officer';
  async function act(path: string, body?: unknown, msg?: string) {
    const r = await run(() => api('POST', path, body), msg);
    if (r) reload();
  }
  return (
    <>
      <div className="panel dark">
        <div className="row">
          <Emblem icon={clan.emblem.icon} color={clan.emblem.color} s={52} />
          <div className="grow">
            <h2 style={{ color: 'var(--gold)', marginBottom: 2 }}>{clan.name} <span className="badge">{clan.tag}</span></h2>
            <div className="small">{clan.members.length}/30 members · season score {clan.seasonScore} · you are {role}</div>
          </div>
        </div>
        {clan.description && <p className="small" style={{ marginBottom: 0 }}>{clan.description}</p>}
      </div>
      <div className="tabs">
        {(['members', 'chat', 'war', 'history', ...(isStaff ? ['settings'] : [])] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t as typeof tab)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'members' && (
        <div className="panel">
          {isStaff && clan.requests.length > 0 && (
            <>
              <h3 style={{ marginTop: 0 }}>Join requests</h3>
              <div className="list">
                {clan.requests.map((r: any) => (
                  <div className="item" key={r.user_id}>
                    <div className="grow"><b>{r.username}</b> <span className="muted small">HQ {r.hq_level}</span></div>
                    <button className="btn small" onClick={() => act(`/clans/requests/${r.user_id}/approve`, undefined, 'Approved')}>Accept</button>
                    <button className="btn secondary small" onClick={() => act(`/clans/requests/${r.user_id}/reject`, undefined, 'Rejected')}>Decline</button>
                  </div>
                ))}
              </div>
              <h3>Members</h3>
            </>
          )}
          <div className="list">
            {clan.members.map((m: any) => (
              <MemberRow key={m.user_id} m={m} me={me.id} myRole={role} act={act} />
            ))}
          </div>
          <div style={{ marginTop: 12 }}>
            {!confirmLeave ? <button className="btn danger small" onClick={() => setConfirmLeave(true)}>Leave clan</button> : (
              <div className="row wrap"><span className="small">{role === 'leader' && clan.members.length === 1 ? 'You are the last member — the clan will be disbanded.' : 'Leave this clan?'}</span>
                <button className="btn danger small" onClick={() => act('/clans/leave', undefined, 'You left the clan')}>Confirm</button>
                <button className="btn secondary small" onClick={() => setConfirmLeave(false)}>Cancel</button></div>
            )}
          </div>
        </div>
      )}
      {tab === 'chat' && <Chat />}
      {tab === 'war' && <War />}
      {tab === 'history' && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Previous seasons</h3>
          {clan.seasonHistory.length === 0 ? <p className="muted small">No completed seasons yet.</p> : clan.seasonHistory.map((h: any) => <div key={h.season} className="item small">Season {h.season}: rank #{h.rank} with {h.score} pts</div>)}
          <h3>Wars</h3>
          {clan.wars.length === 0 ? <p className="muted small">No wars yet.</p> : clan.wars.map((w: any) => <div key={w.id} className="item small">S{w.season}: {w.name_a} {w.points_a} – {w.points_b} {w.name_b ?? '(bye)'} · {w.outcome ?? 'in progress'}</div>)}
          <h3>Activity</h3>
          <div className="list">
            {clan.events.map((e: any, i: number) => <div key={i} className="item small"><span className="grow">{e.username && !['mission_completed', 'war_matched', 'war_finished', 'territory_lost', 'war_not_entered', 'season_champion'].includes(e.type) ? <b>{e.username} </b> : null}{EVENT_LABEL[e.type] ?? e.type}{e.details?.territory ? `: ${e.details.territory}` : ''}</span><span className="muted">{new Date(e.created_at).toLocaleDateString()}</span></div>)}
          </div>
        </div>
      )}
      {tab === 'settings' && <Settings clan={clan} reload={reload} />}
    </>
  );
}

function MemberRow({ m, me, myRole, act }: { m: any; me: string; myRole: string; act: (p: string, b?: unknown, msg?: string) => void }) {
  const [confirm, setConfirm] = useState<'kick' | 'transfer' | null>(null);
  const canKick = m.user_id !== me && (myRole === 'leader' || (myRole === 'officer' && m.role === 'member'));
  const isLeader = myRole === 'leader' && m.user_id !== me;
  return (
    <div className="item">
      <span style={{ fontSize: 22 }}>{AVATAR_GLYPH[m.avatar] ?? '🛡️'}</span>
      <div className="grow">
        <div className="title">{m.username} {m.role !== 'member' && <span className="badge">{m.role}</span>}</div>
        <div className="muted small">HQ {m.hq_level} · contribution {m.contribution}</div>
        {confirm && (
          <div className="row" style={{ marginTop: 4 }}>
            <span className="small">{confirm === 'kick' ? 'Remove this member?' : 'Make them leader?'}</span>
            <button className="btn danger small" onClick={() => { act(confirm === 'kick' ? `/clans/members/${m.user_id}/kick` : '/clans/transfer', confirm === 'kick' ? undefined : { userId: m.user_id }, 'Done'); setConfirm(null); }}>Yes</button>
            <button className="btn secondary small" onClick={() => setConfirm(null)}>No</button>
          </div>
        )}
      </div>
      {isLeader && m.role !== 'leader' && <button className="btn secondary small" onClick={() => act(`/clans/members/${m.user_id}/role`, { role: m.role === 'officer' ? 'member' : 'officer' }, 'Role updated')}>{m.role === 'officer' ? 'Demote' : 'Promote'}</button>}
      {isLeader && <button className="btn secondary small" onClick={() => setConfirm('transfer')} aria-label="Transfer leadership">👑</button>}
      {canKick && <button className="btn danger small" onClick={() => setConfirm('kick')} aria-label="Kick">✕</button>}
    </div>
  );
}

function Chat() {
  const { me, toast } = useGame();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const last = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const r = await api('GET', `/clans/chat?after=${last.current}`);
        if (alive && r.messages.length) {
          last.current = r.messages[r.messages.length - 1].id;
          setMsgs((m) => [...m, ...r.messages].slice(-200));
          setTimeout(() => box.current?.scrollTo(0, 1e6), 30);
        }
      } catch { /* retry next tick */ }
    };
    poll();
    const id = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      await api('POST', '/clans/chat', { body: text.trim() });
      setText('');
      const r = await api('GET', `/clans/chat?after=${last.current}`);
      if (r.messages.length) { last.current = r.messages[r.messages.length - 1].id; setMsgs((m) => [...m, ...r.messages]); setTimeout(() => box.current?.scrollTo(0, 1e6), 30); }
    } catch (err) { toast((err as Error).message, true); }
  }
  return (
    <div className="panel">
      <div className="chat" ref={box}>
        {msgs.length === 0 ? <p className="muted small">No messages yet. Say hello!</p> : msgs.map((m) => (
          <div key={m.id} className={`msg ${m.user_id === me.id ? 'me' : ''}`}><b>{m.username} · {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</b>{m.body}</div>
        ))}
      </div>
      <form className="row" style={{ marginTop: 8 }} onSubmit={send}>
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="Message your clan" aria-label="Chat message" />
        <button className="btn">Send</button>
      </form>
    </div>
  );
}

function War() {
  const { run } = useGame();
  const [w, setW] = useState<any>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState<BattleTarget | null>(null);
  const load = () => api('GET', '/clans/war').then((r) => { setW(r); setPicked(new Set(r.eligibility?.filter((e: any) => e.onRoster).map((e: any) => e.userId))); }).catch(() => setW({ error: true }));
  useEffect(() => { load(); }, []);
  if (!w) return <Loading />;
  if (w.error) return <div className="panel empty">Could not load war information.</div>;
  const staff = w.clan.role !== 'member';
  const editable = ['DEVELOPMENT', 'WAR_PREPARATION'].includes(w.season.state);
  async function save() {
    const r = await run(() => api('PUT', '/clans/war/roster', { userIds: [...picked] }), 'Roster saved');
    if (r) load();
  }
  async function attack(d: any) {
    const { layout } = await api('GET', `/battles/opponents/${d.user_id}/layout`);
    setTarget({ title: `War attack: ${d.username}`, subtitle: 'Your best result against each enemy counts for your clan. No resources are looted in wars.', layout, submit: (deployments) => api('POST', '/clans/war/attack', { defenderId: d.user_id, deployments }) });
  }
  return (
    <>
      <div className="panel">
        <h2>Clan war · {STATE_LABEL[w.season.state]}</h2>
        <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Leaders and officers pick the roster before the war phase; it locks automatically when the war starts.</li>
          <li>Eligible: HQ {w.rules.minHqLevel}+, in the clan at least {w.rules.minMembershipHours}h before lock. Clans need {w.rules.minRosterSize}–{w.rules.maxRosterSize} eligible players.</li>
          <li>Each roster member gets {w.rules.attacksPerMember} attacks. Only the best result against each enemy counts ({w.rules.pointsPerStar} pts per star). Ties go to higher total destruction, then a draw.</li>
          <li>Inactive roster members simply score nothing; rosters cannot be changed after lock. A clan with an odd opponent count may get a bye.</li>
        </ul>
      </div>
      {w.war ? (
        <div className="panel">
          {w.war.status === 'bye' ? <p>Your clan received a bye this season (no opponent).</p> : (
            <>
              <div className="row spread">
                <div style={{ textAlign: 'center' }}><div className="small muted">Your clan</div><div className="display" style={{ fontSize: '1.6rem' }}>{w.war.myScore.points}</div><div className="small">{w.war.myScore.stars}★ · {w.war.myScore.destruction}%</div></div>
                <div className="display">VS</div>
                <div style={{ textAlign: 'center' }}><div className="small muted">{w.war.opponent?.name}</div><div className="display" style={{ fontSize: '1.6rem' }}>{w.war.enemyScore.points}</div><div className="small">{w.war.enemyScore.stars}★ · {w.war.enemyScore.destruction}%</div></div>
              </div>
              {w.war.outcome && <p className="badge ok">Result: {w.war.outcome}</p>}
              <h3>Enemy roster {w.war.onRoster ? `· ${w.war.attacksLeft} attacks left` : '· you are not on the roster'}</h3>
              <div className="list">
                {w.war.enemyRoster.map((d: any) => (
                  <div className="item" key={d.user_id}>
                    <div className="grow"><div className="title">{d.username}</div><div className="small muted">HQ {d.hq_level} · power {d.power}</div><Stars n={d.bestStarsAgainst} /></div>
                    <button className="btn danger small" disabled={!w.war.onRoster || w.war.attacksLeft <= 0 || w.war.status !== 'active' || w.season.state !== 'WAR_ACTIVE'} onClick={() => attack(d)}>Attack</button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>War roster {editable ? '' : '(locked)'}</h3>
          <div className="list">
            {w.eligibility.map((e: any) => (
              <label className="item" key={e.userId} style={{ cursor: staff && editable ? 'pointer' : 'default' }}>
                <input type="checkbox" disabled={!staff || !editable || !e.hqOk} checked={picked.has(e.userId)} onChange={(ev) => { const n = new Set(picked); ev.target.checked ? n.add(e.userId) : n.delete(e.userId); setPicked(n); }} />
                <div className="grow"><b>{e.username}</b> <span className="muted small">HQ {e.hqLevel}</span></div>
                {!e.hqOk ? <span className="badge bad">HQ too low</span> : !e.tenureOk ? <span className="badge warn">joined too late</span> : <span className="badge ok">eligible</span>}
              </label>
            ))}
          </div>
          {staff && editable && <div className="row spread" style={{ marginTop: 8 }}><span className="small">{picked.size} selected</span><button className="btn" onClick={save}>Save roster</button></div>}
          {!editable && <p className="muted small">Your clan was not matched for a war this season.</p>}
        </div>
      )}
      {target && <BattlePrep target={target} onClose={() => { setTarget(null); load(); }} />}
    </>
  );
}

function Settings({ clan, reload }: { clan: any; reload: () => void }) {
  const { run } = useGame();
  const [desc, setDesc] = useState(clan.description);
  const [policy, setPolicy] = useState(clan.join_policy);
  const [icon, setIcon] = useState(clan.emblem.icon);
  const [color, setColor] = useState(clan.emblem.color);
  async function save() {
    const r = await run(() => api('PUT', '/clans/settings', { description: desc, joinPolicy: policy, emblem: { icon, color } }), 'Settings saved');
    if (r) reload();
  }
  return (
    <div className="panel">
      <label className="field">Description<textarea className="input" rows={3} maxLength={300} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
      <label className="field">Joining<select className="input" value={policy} onChange={(e) => setPolicy(e.target.value)}><option value="open">Anyone can join</option><option value="closed">Approval required</option></select></label>
      <div className="row wrap">{CLAN_EMBLEM_ICONS.map((i) => <button type="button" key={i} onClick={() => setIcon(i)} style={{ border: icon === i ? '2px solid var(--gold-deep)' : '2px solid transparent', background: 'none', borderRadius: 8, padding: 2, cursor: 'pointer' }} aria-label={i}><Emblem icon={i} color={color} s={30} /></button>)}</div>
      <div className="row wrap" style={{ margin: '6px 0 10px' }}>{CLAN_EMBLEM_COLORS.map((c) => <button key={c} onClick={() => setColor(c)} aria-label={`colour ${c}`} style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: color === c ? '3px solid #2a1c10' : '2px solid #fff', cursor: 'pointer' }} />)}</div>
      <button className="btn" onClick={save}>Save</button>
    </div>
  );
}
