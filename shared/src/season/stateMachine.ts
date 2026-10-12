import { DEFAULT_SEASON_SCHEDULE, SEASON_STATES, type SeasonSchedule, type SeasonState } from '../config/season.js';

const DAY_MS = 86_400_000;

/** The only legal transitions. Everything else is rejected. */
export const SEASON_TRANSITIONS: Record<SeasonState, SeasonState[]> = {
  DEVELOPMENT: ['WAR_PREPARATION'],
  WAR_PREPARATION: ['WAR_ACTIVE'],
  WAR_ACTIVE: ['RESULT_VERIFICATION'],
  RESULT_VERIFICATION: ['REWARD_DISTRIBUTION'],
  REWARD_DISTRIBUTION: ['SEASON_RESET'],
  SEASON_RESET: ['COMPLETED'],
  COMPLETED: [],
};

export function canTransition(from: SeasonState, to: SeasonState): boolean {
  return SEASON_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SeasonState, to: SeasonState): void {
  if (!canTransition(from, to)) throw new Error(`Invalid season transition ${from} -> ${to}`);
}

export function validateSchedule(s: SeasonSchedule): string | null {
  const ranges = [s.developmentDays, s.warPreparationDays, s.warActiveDays, s.verificationDays];
  if (ranges[0][0] !== 1) return 'Development must start on day 1';
  for (let i = 0; i < ranges.length; i++) {
    const [a, b] = ranges[i];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a > b) return `Invalid day range ${a}-${b}`;
    if (i > 0 && a !== ranges[i - 1][1] + 1) return 'Phases must be contiguous';
  }
  if (ranges[3][1] !== s.lengthDays) return 'Verification must end on the last day';
  return null;
}

/** 1-based season day for a server time (day 1 starts at startAt). */
export function seasonDay(startAt: number, now: number): number {
  return Math.floor((now - startAt) / DAY_MS) + 1;
}

export function phaseStartAt(startAt: number, day: number): number {
  return startAt + (day - 1) * DAY_MS;
}

export function seasonEndAt(startAt: number, schedule: SeasonSchedule = DEFAULT_SEASON_SCHEDULE): number {
  return startAt + schedule.lengthDays * DAY_MS;
}

/**
 * The phase the calendar says we are in. Only the four time-driven phases are returned; the
 * reward/reset phases require explicit operator approval and are never entered on time alone.
 */
export function scheduledPhase(startAt: number, now: number, s: SeasonSchedule = DEFAULT_SEASON_SCHEDULE): SeasonState {
  const day = seasonDay(startAt, now);
  if (day <= s.developmentDays[1]) return 'DEVELOPMENT';
  if (day <= s.warPreparationDays[1]) return 'WAR_PREPARATION';
  if (day <= s.warActiveDays[1]) return 'WAR_ACTIVE';
  return 'RESULT_VERIFICATION';
}

/**
 * Compute the automatic transitions due from `current` given the time. Returns the ordered list of
 * states to enter (possibly empty). Never skips a state, never moves backwards, never enters the
 * approval-gated states.
 */
export function dueTransitions(current: SeasonState, startAt: number, now: number, s: SeasonSchedule = DEFAULT_SEASON_SCHEDULE): SeasonState[] {
  const target = scheduledPhase(startAt, now, s);
  const order = SEASON_STATES;
  const ci = order.indexOf(current), ti = order.indexOf(target);
  if (ti <= ci) return [];
  return order.slice(ci + 1, ti + 1) as SeasonState[];
}

export function phaseTimeline(startAt: number, s: SeasonSchedule = DEFAULT_SEASON_SCHEDULE) {
  return [
    { state: 'DEVELOPMENT' as const, label: 'Kingdom development', startsAt: phaseStartAt(startAt, s.developmentDays[0]), endsAt: phaseStartAt(startAt, s.developmentDays[1] + 1), days: s.developmentDays },
    { state: 'WAR_PREPARATION' as const, label: 'War preparation & roster lock', startsAt: phaseStartAt(startAt, s.warPreparationDays[0]), endsAt: phaseStartAt(startAt, s.warPreparationDays[1] + 1), days: s.warPreparationDays },
    { state: 'WAR_ACTIVE' as const, label: 'Clan wars & territories', startsAt: phaseStartAt(startAt, s.warActiveDays[0]), endsAt: phaseStartAt(startAt, s.warActiveDays[1] + 1), days: s.warActiveDays },
    { state: 'RESULT_VERIFICATION' as const, label: 'Verification & rewards', startsAt: phaseStartAt(startAt, s.verificationDays[0]), endsAt: phaseStartAt(startAt, s.verificationDays[1] + 1), days: s.verificationDays },
  ];
}
