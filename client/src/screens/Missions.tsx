import { useEffect, useState } from 'react';
import { api } from '../api';
import { useGame } from '../game';
import { Cost, Countdown, Loading } from '../components/ui';

export function MissionsPanel() {
  const { run, setKingdom, refreshKingdom } = useGame();
  const [data, setData] = useState<any>(null);
  const load = () => api('GET', '/missions').then(setData).catch(() => setData({ missions: [], clanMissions: [] }));
  useEffect(() => { load(); }, []);
  if (!data) return <Loading />;
  async function claim(id: string, clan = false) {
    const r = await run(() => api('POST', `/${clan ? 'clan-missions' : 'missions'}/${id}/claim`), 'Reward claimed!');
    if (r) { await refreshKingdom(); load(); }
  }
  void setKingdom;
  const groups = [
    { title: 'Daily', items: data.missions.filter((m: any) => m.period === 'daily') },
    { title: 'Weekly', items: data.missions.filter((m: any) => m.period === 'weekly') },
  ];
  return (
    <div>
      {groups.map((g) => (
        <div key={g.title}>
          <h3>{g.title} {g.items[0] && <span className="muted small">· resets in <Countdown until={g.items[0].resetsAt} /></span>}</h3>
          <div className="list">
            {g.items.map((m: any) => (
              <MissionRow key={m.id} title={m.title} progress={m.progress} target={m.target} reward={m.reward} claimed={m.claimed} onClaim={() => claim(m.id)} />
            ))}
          </div>
        </div>
      ))}
      <h3>Clan missions</h3>
      {data.clanMissions.length === 0 ? <p className="muted small">Join a clan to take part in weekly clan missions.</p> : (
        <div className="list">
          {data.clanMissions.map((m: any) => (
            <MissionRow key={m.id} title={m.title} progress={m.progress} target={m.target} reward={m.memberReward} claimed={m.claimed} note={`Your contribution: ${m.myContribution}`} canClaim={m.completed && m.myContribution > 0} onClaim={() => claim(m.id, true)} />
          ))}
        </div>
      )}
      <p className="muted small">Mission progress is tracked by the server from your real actions. Each reward can be claimed once per period (UTC).</p>
    </div>
  );
}

function MissionRow({ title, progress, target, reward, claimed, onClaim, note, canClaim }: { title: string; progress: number; target: number; reward: any; claimed: boolean; onClaim: () => void; note?: string; canClaim?: boolean }) {
  const done = canClaim ?? progress >= target;
  return (
    <div className="item">
      <div className="grow">
        <div className="title small">{title}</div>
        <div className="bar" style={{ margin: '4px 0' }}><i style={{ width: `${Math.min(100, (progress / target) * 100)}%` }} /></div>
        <div className="row spread small"><span className="muted">{Math.min(progress, target)} / {target}{note ? ` · ${note}` : ''}</span><Cost cost={reward} /></div>
      </div>
      <button className="btn small" disabled={!done || claimed} onClick={onClaim}>{claimed ? 'Claimed' : 'Claim'}</button>
    </div>
  );
}
