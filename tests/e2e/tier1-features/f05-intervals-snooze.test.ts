import { describe, expect, it } from 'vitest';
import { canSnooze, DoseStatus, evaluateDoseState } from '../harness';

const T = new Date('2026-11-25T08:00:00.000Z');

describe('Tier 1 — F05: Operational Intervals & Snooze Limits (10m max 1)', () => {
  it('T1-F05-01: Snooze Interval Exactly 10 Minutes', () => {
    const tapTime = new Date(T.getTime() + 3 * 60 * 1000);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: tapTime,
      snoozeCount: 0,
      action: 'tapSnooze',
    });

    expect(result.snoozeUntil?.getTime()).toBe(tapTime.getTime() + 10 * 60 * 1000);
  });

  it('T1-F05-02: First Snooze Permitted (snoozeCount == 0)', () => {
    expect(canSnooze(0, 'due')).toBe(true);
  });

  it('T1-F05-03: Second Snooze Blocked (snoozeCount == 1)', () => {
    expect(canSnooze(1, 'due')).toBe(false);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: T,
        currentTime: new Date(T.getTime() + 12 * 60 * 1000),
        snoozeCount: 1,
        action: 'tapSnooze',
      })
    ).toThrow(/snooze disallowed/i);
  });

  it('T1-F05-04: Snooze Disallowed for Non-Due States', () => {
    const nonDueStates: DoseStatus[] = ['scheduled', 'taken', 'snoozed', 'unconfirmed', 'missed'];
    for (const status of nonDueStates) {
      expect(canSnooze(0, status)).toBe(false);
    }
  });

  it('T1-F05-05: Snooze Expiration Transitions Back to Due', () => {
    const snoozeUntil = new Date(T.getTime() + 12 * 60 * 1000);
    const result = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: T,
      currentTime: new Date(snoozeUntil.getTime()),
      snoozeCount: 1,
      snoozeUntil,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.snoozeCount).toBe(1);
    expect(result.snoozeUntil).toBeNull();
  });
});
