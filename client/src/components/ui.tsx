import { useEffect, useState, type ReactNode } from 'react';
import type { Resources } from '@mini-empire/shared';
import { serverNow } from '../api';

export function GoldIcon({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" aria-label="Gold">
      <circle cx="10" cy="10" r="8" fill="#f2c55c" stroke="#8a5a12" strokeWidth="1.6" />
      <circle cx="10" cy="10" r="4.5" fill="none" stroke="#b8862a" strokeWidth="1.4" />
    </svg>
  );
}
export function WoodIcon({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" aria-label="Wood">
      <rect x="2" y="6" width="16" height="8" rx="4" fill="#a8743f" stroke="#5a3518" strokeWidth="1.5" />
      <ellipse cx="16" cy="10" rx="2.2" ry="3.6" fill="#e2b77c" stroke="#5a3518" strokeWidth="1.2" />
    </svg>
  );
}
export function StoneIcon({ s = 18 }: { s?: number }) {
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" aria-label="Stone">
      <path d="M3 13 6 5l7-2 5 6-3 8H6z" fill="#a9a49b" stroke="#4f4b45" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6 5l4 5 8-1M10 10l-4 7" stroke="#6f6a62" strokeWidth="1" fill="none" />
    </svg>
  );
}
export const RES_ICON = { gold: GoldIcon, wood: WoodIcon, stone: StoneIcon };

export function fmt(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return Math.floor(n).toLocaleString('en-US');
}

export function fmtDuration(ms: number): string {
  if (ms <= 0) return 'now';
  const s = Math.ceil(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function Cost({ cost, have }: { cost: Resources; have?: Resources }) {
  return (
    <span className="cost">
      {(['gold', 'wood', 'stone'] as const).filter((r) => cost[r] > 0).map((r) => {
        const I = RES_ICON[r];
        return (
          <span key={r} className={have && have[r] < cost[r] ? 'lack' : ''}>
            <I s={15} /> {fmt(cost[r])}
          </span>
        );
      })}
      {cost.gold + cost.wood + cost.stone === 0 && <span>Free</span>}
    </span>
  );
}

/** Re-render every second; returns server time. */
export function useTick(ms = 1000): number {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return serverNow();
}

export function Countdown({ until }: { until: number }) {
  const now = useTick();
  return <>{fmtDuration(until - now)}</>;
}

export function Progress({ from, to, gold }: { from: number; to: number; gold?: boolean }) {
  const now = useTick();
  const pct = Math.max(0, Math.min(100, ((now - from) / Math.max(1, to - from)) * 100));
  return <div className={`bar ${gold ? 'gold' : ''}`}><i style={{ width: `${pct}%` }} /></div>;
}

export function Modal({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Stars({ n }: { n: number }) {
  return (
    <span className="stars" aria-label={`${n} stars`}>
      {[0, 1, 2].map((i) => <span key={i} className={i < n ? '' : 'off'}>★</span>)}
    </span>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="empty">{label}</div>;
}

export function Emblem({ icon, color, s = 34 }: { icon: string; color: string; s?: number }) {
  const glyph: Record<string, string> = { lion: '🦁', eagle: '🦅', wolf: '🐺', dragon: '🐉', tower: '🏰', sword: '⚔️', crown: '👑', shield: '🛡️' };
  return (
    <svg width={s} height={s} viewBox="0 0 40 44" aria-label={`${icon} emblem`}>
      <path d="M20 2 37 8v14c0 11-8 17-17 20C11 39 3 33 3 22V8z" fill={color} stroke="#2a1c10" strokeWidth="2" />
      <text x="20" y="27" textAnchor="middle" fontSize="16">{glyph[icon] ?? '⚑'}</text>
    </svg>
  );
}

export const AVATAR_GLYPH: Record<string, string> = { knight: '🛡️', archer: '🏹', queen: '👸', king: '🤴', wizard: '🧙', ranger: '🧝', smith: '⚒️', monk: '📿' };
