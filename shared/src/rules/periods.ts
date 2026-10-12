/** Mission reset periods. All in UTC (the server timezone). */
export function dailyKey(now: number): string {
  return 'D' + new Date(now).toISOString().slice(0, 10);
}

/** ISO-8601 week key, e.g. W2026-42. Weeks start Monday 00:00 UTC. */
export function weeklyKey(now: number): string {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `W${thursday.getUTCFullYear()}-${String(week).padStart(2, '0')}`;
}

export function periodKey(period: 'daily' | 'weekly', now: number): string {
  return period === 'daily' ? dailyKey(now) : weeklyKey(now);
}

export function nextDailyReset(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

export function nextWeeklyReset(now: number): number {
  const d = new Date(now);
  const day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 7);
}
