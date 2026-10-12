import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, dueTransitions, scheduledPhase, seasonDay, validateSchedule, DEFAULT_SEASON_SCHEDULE, SEASON_STATES } from '../src/index.js';

const DAY = 86_400_000;
const start = Date.UTC(2026, 0, 1);
const atDay = (d: number) => start + (d - 1) * DAY + 1000;

describe('season state machine', () => {
  it('follows the 100-day schedule', () => {
    expect(validateSchedule(DEFAULT_SEASON_SCHEDULE)).toBeNull();
    expect(seasonDay(start, start)).toBe(1);
    expect(scheduledPhase(start, atDay(1))).toBe('DEVELOPMENT');
    expect(scheduledPhase(start, atDay(90))).toBe('DEVELOPMENT');
    expect(scheduledPhase(start, atDay(91))).toBe('WAR_PREPARATION');
    expect(scheduledPhase(start, atDay(93))).toBe('WAR_PREPARATION');
    expect(scheduledPhase(start, atDay(94))).toBe('WAR_ACTIVE');
    expect(scheduledPhase(start, atDay(98))).toBe('WAR_ACTIVE');
    expect(scheduledPhase(start, atDay(99))).toBe('RESULT_VERIFICATION');
    expect(scheduledPhase(start, atDay(150))).toBe('RESULT_VERIFICATION');
  });
  it('only allows forward, single-step transitions', () => {
    for (let i = 0; i < SEASON_STATES.length; i++) {
      for (let j = 0; j < SEASON_STATES.length; j++) {
        expect(canTransition(SEASON_STATES[i], SEASON_STATES[j])).toBe(j === i + 1);
      }
    }
    expect(() => assertTransition('DEVELOPMENT', 'WAR_ACTIVE')).toThrow();
    expect(() => assertTransition('COMPLETED', 'DEVELOPMENT')).toThrow();
  });
  it('due transitions never skip a state and never enter approval-gated states', () => {
    expect(dueTransitions('DEVELOPMENT', start, atDay(95))).toEqual(['WAR_PREPARATION', 'WAR_ACTIVE']);
    expect(dueTransitions('WAR_ACTIVE', start, atDay(100))).toEqual(['RESULT_VERIFICATION']);
    expect(dueTransitions('RESULT_VERIFICATION', start, atDay(400))).toEqual([]);
    expect(dueTransitions('REWARD_DISTRIBUTION', start, atDay(10))).toEqual([]);
  });
  it('rejects malformed schedules', () => {
    expect(validateSchedule({ ...DEFAULT_SEASON_SCHEDULE, warActiveDays: [95, 98] })).not.toBeNull();
    expect(validateSchedule({ ...DEFAULT_SEASON_SCHEDULE, lengthDays: 101 })).not.toBeNull();
  });
});
