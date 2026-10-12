import { useCallback, useEffect, useState } from 'react';
import type { GameConfig } from '@mini-empire/shared';
import { api, getToken, setToken, setUnauthorizedHandler } from './api';
import { GameProvider, useGame, type Me } from './game';
import { telegramInitData } from './telegram';
import { NavIcon } from './components/NavIcons';
import { TopBar } from './components/TopBar';
import { Onboarding } from './components/Onboarding';
import { KingdomScreen } from './screens/Kingdom';
import { ArmyScreen } from './screens/Army';
import { WorldScreen } from './screens/World';
import { ClanScreen } from './screens/Clan';
import { SeasonScreen } from './screens/Season';
import { ProfileModal } from './screens/Profile';
import { AdminScreen } from './screens/Admin';
import { Loading } from './components/ui';

type Tab = 'kingdom' | 'army' | 'world' | 'clan' | 'season' | 'admin';

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [cfg, setCfg] = useState<GameConfig | null>(null);
  const [booting, setBooting] = useState(true);

  const logout = useCallback(() => {
    api('POST', '/auth/logout').catch(() => undefined);
    setToken(null);
    setMe(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { setToken(null); setMe(null); });
    (async () => {
      try {
        const tg = await telegramInitData();
        if (tg && !getToken()) {
          const r = await api('POST', '/auth/telegram', { initData: tg });
          setToken(r.token);
        }
        if (getToken()) setMe((await api('GET', '/auth/me')).user);
      } catch {
        setToken(null);
      } finally {
        setBooting(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (me && !cfg) api<GameConfig>('GET', '/config').then(setCfg).catch(() => undefined);
  }, [me, cfg]);

  if (booting) return <div className="auth"><div className="logo">Mini Empire</div></div>;
  if (!me) return <AuthScreen onAuthed={(u) => setMe(u)} />;
  if (!cfg) return <div className="auth"><Loading label="Preparing your kingdom…" /></div>;
  return (
    <GameProvider me={me} cfg={cfg} onLogout={logout}>
      <Shell />
    </GameProvider>
  );
}

function Shell() {
  const { me, profile } = useGame();
  const [tab, setTab] = useState<Tab>('kingdom');
  const [showProfile, setShowProfile] = useState(false);
  const nav: { id: Tab; label: string; icon: 'kingdom' | 'army' | 'world' | 'clan' | 'season' }[] = [
    { id: 'kingdom', label: 'Kingdom', icon: 'kingdom' },
    { id: 'army', label: 'Army', icon: 'army' },
    { id: 'world', label: 'World Map', icon: 'world' },
    { id: 'clan', label: 'Clan', icon: 'clan' },
    { id: 'season', label: 'Season', icon: 'season' },
  ];
  return (
    <div className="app">
      <TopBar onProfile={() => setShowProfile(true)} onSeason={() => setTab('season')} />
      <main className="screen">
        {tab === 'kingdom' && <KingdomScreen />}
        {tab === 'army' && <ArmyScreen />}
        {tab === 'world' && <WorldScreen />}
        {tab === 'clan' && <ClanScreen />}
        {tab === 'season' && <SeasonScreen />}
        {tab === 'admin' && me.role !== 'player' && <AdminScreen onExit={() => setTab('kingdom')} />}
      </main>
      <nav className="nav">
        {nav.map((n) => (
          <button key={n.id} className={tab === n.id ? 'active' : ''} onClick={() => setTab(n.id)} aria-current={tab === n.id}>
            <NavIcon name={n.icon} />
            {n.label}
          </button>
        ))}
      </nav>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} onAdmin={me.role !== 'player' ? () => { setShowProfile(false); setTab('admin'); } : undefined} />}
      {profile && !profile.onboardingDone && <Onboarding />}
    </div>
  );
}

function AuthScreen({ onAuthed }: { onAuthed: (u: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('POST', `/auth/${mode}`, { username, password });
      setToken(r.token);
      onAuthed(r.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth">
      <div style={{ width: '100%', maxWidth: 400 }}>
        <div className="logo">Mini Empire</div>
        <form className="panel" onSubmit={submit}>
          <div className="tabs">
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>New kingdom</button>
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Log in</button>
          </div>
          <label className="field">Username
            <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" minLength={3} maxLength={20} required pattern="[A-Za-z0-9_]+" title="Letters, digits and _" />
          </label>
          <label className="field">Password
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={8} required />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn block" disabled={busy}>{busy ? 'Please wait…' : mode === 'register' ? 'Found my kingdom' : 'Enter the kingdom'}</button>
          <p className="muted small" style={{ marginTop: 10 }}>Your progress is saved on the server. Passwords are stored as salted scrypt hashes.</p>
        </form>
      </div>
    </div>
  );
}
