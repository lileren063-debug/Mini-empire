import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Building, GameConfig, Resources, TrainingItem, TroopCounts } from '@mini-empire/shared';
import { api, ApiError, syncServerTime } from './api';

export interface KingdomView {
  serverTime: number;
  configVersion: string;
  resources: Resources;
  storageCapacity: number;
  hqLevel: number;
  builders: number;
  buildings: (Building & { produced: number })[];
  troops: TroopCounts;
  trainingQueue: TrainingItem[];
  armyCapacity: number;
  housingUsed: number;
  troopMultiplier: number;
  shieldUntil?: number;
  collected?: Resources;
  refund?: Resources;
}

export interface Me {
  id: string;
  username: string;
  role: 'player' | 'moderator' | 'admin' | 'superadmin';
}

export interface SeasonSummary {
  season: { id: number; number: number; state: string; startsAt: number; endsAt: number; day: number; lengthDays: number };
  timeline: { state: string; label: string; startsAt: number; endsAt: number; days: [number, number] }[];
}

interface Toast { id: number; text: string; error?: boolean }

interface GameCtx {
  me: Me;
  cfg: GameConfig;
  kingdom: KingdomView | null;
  season: SeasonSummary | null;
  profile: any;
  setKingdom: (k: KingdomView) => void;
  refreshKingdom: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  refreshSeason: () => Promise<void>;
  toast: (text: string, error?: boolean) => void;
  /** Run an action, toast its error. Returns undefined on failure. */
  run: <T>(fn: () => Promise<T>, success?: string | ((r: T) => string | undefined)) => Promise<T | undefined>;
  logout: () => void;
}

const Ctx = createContext<GameCtx | null>(null);
export const useGame = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useGame outside provider');
  return c;
};

export function GameProvider({ me, cfg, children, onLogout }: { me: Me; cfg: GameConfig; children: ReactNode; onLogout: () => void }) {
  const [kingdom, setKingdomState] = useState<KingdomView | null>(null);
  const [season, setSeason] = useState<SeasonSummary | null>(null);
  const [profile, setProfile] = useState<any>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, error?: boolean) => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-2), { id, text, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 4200 : 2600);
  }, []);

  const setKingdom = useCallback((k: KingdomView) => {
    syncServerTime(k.serverTime);
    setKingdomState(k);
  }, []);

  const refreshKingdom = useCallback(async () => {
    try {
      setKingdom(await api<KingdomView>('GET', '/kingdom'));
    } catch (e) {
      if (e instanceof ApiError && e.status !== 401) toast(e.message, true);
    }
  }, [setKingdom, toast]);

  const refreshProfile = useCallback(async () => {
    try { setProfile(await api('GET', '/profile/me')); } catch { /* shown elsewhere */ }
  }, []);
  const refreshSeason = useCallback(async () => {
    try { setSeason(await api('GET', '/season')); } catch { /* shown elsewhere */ }
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<T>, success?: string | ((r: T) => string | undefined)) => {
    try {
      const r = await fn();
      const msg = typeof success === 'function' ? success(r) : success;
      if (msg) toast(msg);
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong', true);
      return undefined;
    }
  }, [toast]);

  useEffect(() => {
    refreshKingdom();
    refreshProfile();
    refreshSeason();
    const id = setInterval(refreshKingdom, 20_000);
    const id2 = setInterval(refreshSeason, 120_000);
    return () => { clearInterval(id); clearInterval(id2); };
  }, [refreshKingdom, refreshProfile, refreshSeason]);

  // Refresh right after the next timer (construction / training) completes.
  useEffect(() => {
    if (!kingdom) return;
    const ends = [
      ...kingdom.buildings.filter((b) => b.upgrade).map((b) => b.upgrade!.endsAt),
      ...kingdom.trainingQueue.slice(0, 1).map((q) => q.startsAt + q.perUnitMs),
    ];
    if (!ends.length) return;
    const wait = Math.min(...ends) - kingdom.serverTime + 400;
    const id = setTimeout(refreshKingdom, Math.max(500, Math.min(wait, 60_000)));
    return () => clearTimeout(id);
  }, [kingdom, refreshKingdom]);

  return (
    <Ctx.Provider value={{ me, cfg, kingdom, season, profile, setKingdom, refreshKingdom, refreshProfile, refreshSeason, toast, run, logout: onLogout }}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.error ? 'error' : ''}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}
