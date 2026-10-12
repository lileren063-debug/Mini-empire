import { useEffect, useState } from 'react';
import { ACHIEVEMENTS, COSMETICS } from '@mini-empire/shared';
import { api } from '../api';
import { useGame } from '../game';
import { AVATAR_GLYPH, Loading, Modal } from '../components/ui';

export function ProfileModal({ onClose, onAdmin }: { onClose: () => void; onAdmin?: () => void }) {
  const { profile, refreshProfile, run, logout } = useGame();
  const [tab, setTab] = useState<'profile' | 'achievements' | 'store'>('profile');
  const [store, setStore] = useState<any>(null);
  useEffect(() => { refreshProfile(); }, [refreshProfile]);
  useEffect(() => { if (tab === 'store' && !store) api('GET', '/store').then(setStore).catch(() => setStore({ items: [] })); }, [tab, store]);
  if (!profile) return <Modal title="Profile" onClose={onClose}><Loading /></Modal>;
  async function update(body: unknown) {
    const r = await run(() => api('PUT', '/profile', body), 'Profile updated');
    if (r) refreshProfile();
  }
  const owned = new Set(profile.cosmetics.map((c: any) => c.id));
  return (
    <Modal title={profile.username} onClose={onClose}>
      <div className="tabs">
        {(['profile', 'achievements', 'store'] as const).map((t) => <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
      </div>
      {tab === 'profile' && (
        <>
          <div className="row">
            <div style={{ fontSize: 44, width: 64, height: 64, borderRadius: '50%', background: 'var(--wood-600)', display: 'grid', placeItems: 'center', border: `3px solid ${profile.equipped?.profile_frame === 'frame_champion' ? '#a855f7' : profile.equipped?.profile_frame ? '#e8b84a' : '#7a5532'}` }}>{AVATAR_GLYPH[profile.avatar]}</div>
            <div>
              <b className="display">{profile.title ? `${profile.title} ` : ''}{profile.username}</b>
              <div className="muted small">Joined {new Date(profile.createdAt).toLocaleDateString()} · Season {profile.currentSeason} · HQ {profile.hqLevel}</div>
              <div className="small">{profile.clan ? `${profile.clan.name} [${profile.clan.tag}] · ${profile.clan.role}` : 'No clan'}</div>
            </div>
          </div>
          <div className="grid2" style={{ marginTop: 10 }}>
            <div className="stat">Attacks won / lost<b>{profile.record.battlesWon} / {profile.record.battlesLost}</b></div>
            <div className="stat">Defenses won / lost<b>{profile.record.defensesWon} / {profile.record.defensesLost}</b></div>
            <div className="stat">Power<b>{profile.power}</b></div>
            <div className="stat">Test tokens (simulated)<b>{profile.testTokenBalance}</b></div>
          </div>
          <h3>Avatar</h3>
          <div className="row wrap">{Object.entries(AVATAR_GLYPH).map(([k, g]) => <button key={k} className="btn secondary small" style={{ fontSize: 20, outline: profile.avatar === k ? '3px solid var(--gold-deep)' : undefined }} onClick={() => update({ avatar: k })} aria-label={k}>{g}</button>)}</div>
          <h3>Title</h3>
          {profile.titles.length === 0 ? <p className="muted small">Earn achievements to unlock titles.</p> : (
            <select className="input" value={profile.title ?? ''} onChange={(e) => update({ title: e.target.value || null })}>
              <option value="">No title</option>
              {profile.titles.map((t: string) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <h3>Season history</h3>
          {profile.seasonHistory.length === 0 ? <p className="muted small">Your first season is in progress.</p> : profile.seasonHistory.map((h: any) => <div key={h.number} className="item small">Season {h.number}: HQ {h.hq_level} · battle rank {h.battle_rank ?? '–'} · clan rank {h.clan_rank ?? '–'}</div>)}
          <div className="row wrap" style={{ marginTop: 14 }}>
            {onAdmin && <button className="btn blue" onClick={onAdmin}>Admin panel</button>}
            <button className="btn secondary" onClick={logout}>Log out</button>
          </div>
        </>
      )}
      {tab === 'achievements' && (
        <div className="list">
          {ACHIEVEMENTS.map((a) => {
            const got = profile.achievements.find((x: any) => x.id === a.id);
            return (
              <div className="item" key={a.id} style={{ opacity: got ? 1 : 0.55 }}>
                <span style={{ fontSize: 22 }}>{got ? '🏆' : '🔒'}</span>
                <div className="grow"><div className="title">{a.name}</div><div className="muted small">{a.description}{a.title ? ` · Title: ${a.title}` : ''}{a.cosmetic ? ` · Unlocks ${COSMETICS.find((c) => c.id === a.cosmetic)?.name}` : ''}</div></div>
                {got && <span className="small muted">{new Date(got.earnedAt).toLocaleDateString()}</span>}
              </div>
            );
          })}
        </div>
      )}
      {tab === 'store' && (
        !store ? <Loading /> : (
          <>
            <p className="small muted">Cosmetics never change gameplay stats. Real-money purchases are not enabled yet — items are earned through achievements and seasons.</p>
            <div className="list">
              {store.items.map((c: any) => (
                <div className="item" key={c.id}>
                  <div className="grow"><div className="title">{c.name} <span className="badge">{c.slot.replace('_', ' ')}</span></div><div className="muted small">{c.description}</div></div>
                  {owned.has(c.id) ? (
                    <button className="btn small" onClick={() => update({ equipped: { ...profile.equipped, [c.slot]: c.id } })} disabled={profile.equipped?.[c.slot] === c.id}>{profile.equipped?.[c.slot] === c.id ? 'Equipped' : 'Equip'}</button>
                  ) : c.source === 'store' ? (
                    <button className="btn secondary small" disabled title="Payments are not enabled">Not available</button>
                  ) : <span className="small muted">{c.source === 'achievement' ? 'Achievement' : 'Season reward'}</span>}
                </div>
              ))}
            </div>
          </>
        )
      )}
    </Modal>
  );
}
