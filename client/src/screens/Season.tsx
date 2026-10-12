import { useEffect, useState } from 'react';
import { api } from '../api';
import { Countdown, Loading, useTick } from '../components/ui';
import { STATE_LABEL } from '../components/TopBar';
import { MissionsPanel } from './Missions';

export function SeasonScreen() {
  const [data, setData] = useState<any>(null);
  const [tab, setTab] = useState<'boards' | 'missions' | 'rules' | 'history'>('boards');
  const now = useTick(5000);
  useEffect(() => { api('GET', '/season').then(setData).catch(() => setData({ error: true })); }, []);
  if (!data) return <div className="scroll"><Loading /></div>;
  if (data.error) return <div className="scroll"><div className="panel empty">Could not load the season.</div></div>;
  const s = data.season;
  return (
    <div className="scroll">
      <div className="scroll-inner">
        <div className="panel dark">
          <div className="row spread wrap">
            <div>
              <h2 style={{ color: 'var(--gold)' }}>Season {s.number}</h2>
              <div className="small">Day {s.day} of {s.lengthDays} · {STATE_LABEL[s.state]}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="small">Season ends in</div>
              <div className="display" style={{ fontSize: '1.2rem' }}><Countdown until={s.endsAt} /></div>
            </div>
          </div>
          <div className="timeline">
            {data.timeline.map((p: any) => (
              <div key={p.state} className={now >= p.endsAt ? 'done' : now >= p.startsAt ? 'now' : ''} style={{ flex: p.days[1] - p.days[0] + 1 > 10 ? 3 : 1 }}>
                {p.label}<br /><span style={{ fontWeight: 600 }}>days {p.days[0]}–{p.days[1]}</span>
              </div>
            ))}
          </div>
          <div className="row wrap small" style={{ gap: 14 }}>
            <span>⚔️ Battle score: <b>{data.myScores.battle}</b></span>
            <span>🌿 Participation: <b>{data.myScores.participation}</b></span>
            <span>🪙 Test tokens: <b>{data.rewards.myTestBalance}</b></span>
          </div>
        </div>
        <div className="tabs">
          {([['boards', 'Leaderboards'], ['missions', 'Missions'], ['rules', 'Scoring & rewards'], ['history', 'Past seasons']] as const).map(([id, l]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{l}</button>)}
        </div>
        {tab === 'boards' && <Boards />}
        {tab === 'missions' && <div className="panel"><MissionsPanel /></div>}
        {tab === 'rules' && (
          <div className="panel">
            <h3 style={{ marginTop: 0 }}>How scores are calculated</h3>
            <ul className="small" style={{ paddingLeft: 18 }}>{data.scoring.map((l: string) => <li key={l}>{l}</li>)}</ul>
            <h3>Season rewards (simulated)</h3>
            <p className="small">{data.rewards.disclaimer}</p>
            <div className="grid2">
              <div className="stat">Clan rankings<b>{data.rewards.allocation.clan * 100}%</b></div>
              <div className="stat">Individual performance<b>{data.rewards.allocation.individual * 100}%</b></div>
              <div className="stat">Participation<b>{data.rewards.allocation.participation * 100}%</b></div>
              <div className="stat">Achievements & fair play<b>{data.rewards.allocation.special * 100}%</b></div>
            </div>
            <h3>What resets?</h3>
            <p className="small">At the end of the season buildings, resources, troops and territory ownership reset. Your account, achievements, titles, cosmetics, clan history, past rankings and test-token balance are kept forever.</p>
          </div>
        )}
        {tab === 'history' && <History />}
      </div>
    </div>
  );
}

function Boards() {
  const [board, setBoard] = useState<'clan' | 'individual' | 'participation'>('individual');
  const [data, setData] = useState<any>(null);
  useEffect(() => { setData(null); api('GET', `/leaderboards/${board}`).then(setData).catch(() => setData({ entries: [], me: null })); }, [board]);
  return (
    <div className="panel">
      <div className="tabs">
        {([['individual', 'Battle'], ['clan', 'Clans'], ['participation', 'Participation']] as const).map(([id, l]) => <button key={id} className={board === id ? 'active' : ''} onClick={() => setBoard(id)}>{l}</button>)}
      </div>
      {!data ? <Loading /> : data.entries.length === 0 ? <p className="muted small">No scores yet this season. Be the first!</p> : (
        <table className="t">
          <thead><tr><th>#</th><th>{board === 'clan' ? 'Clan' : 'Player'}</th><th style={{ textAlign: 'right' }}>Score</th></tr></thead>
          <tbody>
            {data.entries.map((e: any) => (
              <tr key={e.id} style={data.me?.id === e.id ? { background: '#f2dca5', fontWeight: 800 } : undefined}>
                <td>{e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}</td><td>{e.name}</td><td style={{ textAlign: 'right' }}>{e.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.me && data.me.rank > 100 && <p className="small">Your position: #{data.me.rank} with {data.me.score} pts</p>}
    </div>
  );
}

function History() {
  const [data, setData] = useState<any>(null);
  useEffect(() => { api('GET', '/season/history').then(setData).catch(() => setData({ seasons: [] })); }, []);
  if (!data) return <Loading />;
  const done = data.seasons.filter((s: any) => s.top && Object.keys(s.top).length);
  if (!done.length) return <div className="panel empty">No finished seasons yet. Final rankings appear here after day 98.</div>;
  return (
    <>
      {done.map((s: any) => (
        <div className="panel" key={s.id}>
          <h3 style={{ marginTop: 0 }}>Season {s.number}</h3>
          <div className="grid2">
            {(['clan', 'individual', 'participation'] as const).map((b) => (
              <div key={b} className="stat"><b style={{ textTransform: 'capitalize' }}>{b}</b>{(s.top[b] ?? []).slice(0, 3).map((e: any) => <div key={e.id}>#{e.rank} {e.name} · {e.score}</div>)}</div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
