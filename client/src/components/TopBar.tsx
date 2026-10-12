import { useGame } from '../game';
import { AVATAR_GLYPH, RES_ICON, fmt, fmtDuration, useTick } from './ui';

export const STATE_LABEL: Record<string, string> = {
  DEVELOPMENT: 'Development',
  WAR_PREPARATION: 'War prep',
  WAR_ACTIVE: 'Clan wars',
  RESULT_VERIFICATION: 'Verification',
  REWARD_DISTRIBUTION: 'Rewards',
  SEASON_RESET: 'Resetting',
  COMPLETED: 'Completed',
};

export function TopBar({ onProfile, onSeason }: { onProfile: () => void; onSeason: () => void }) {
  const { kingdom, season, profile, me } = useGame();
  const now = useTick();
  const phase = season?.timeline.find((t) => now >= t.startsAt && now < t.endsAt);
  return (
    <header className="topbar">
      <button className="avatar-btn" onClick={onProfile} aria-label={`Profile of ${me.username}`}>
        <span style={{ fontSize: 22 }}>{AVATAR_GLYPH[profile?.avatar ?? 'knight']}</span>
      </button>
      <div className="res-row">
        {(['gold', 'wood', 'stone'] as const).map((r) => {
          const I = RES_ICON[r];
          const v = kingdom?.resources[r] ?? 0;
          const full = kingdom ? v >= kingdom.storageCapacity : false;
          return (
            <div key={r} className={`res ${full ? 'full' : ''}`} title={`${r}: ${v} / ${kingdom?.storageCapacity ?? 0}`}>
              <I s={18} />
              {kingdom ? fmt(v) : '–'}
              <span className="fill"><i style={{ width: `${kingdom ? Math.min(100, (v / Math.max(1, kingdom.storageCapacity)) * 100) : 0}%` }} /></span>
            </div>
          );
        })}
      </div>
      <button className="season-chip" onClick={onSeason} aria-label="Season details">
        {season ? (
          <>
            <b>S{season.season.number} · Day {season.season.day}/{season.season.lengthDays}</b>
            {STATE_LABEL[season.season.state]}{phase ? ` · ${fmtDuration(phase.endsAt - now)}` : ''}
          </>
        ) : '…'}
      </button>
    </header>
  );
}
