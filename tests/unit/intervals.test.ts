import { describe, expect, it } from 'vitest';
import {
  ESCALATION_OFFSET_MS,
  GENTLE_REMINDER_OFFSET_MS,
  MAX_SNOOZE_COUNT,
  SNOOZE_DURATION_MS,
  calculateIntervals,
  calculateSnoozeUntil,
  canSnooze,
  isDueTimeReached,
  isEscalationDue,
  isGentleReminderDue,
  isSnoozeExpired,
} from '@/domain/intervals';
import type { DoseStatus } from '@/types/dose';

describe('domain/intervals', () => {
  it('INT-01: exported constants match PRD and TECH_RULES specifications', () => {
    expect(SNOOZE_DURATION_MS).toBe(600_000);
    expect(GENTLE_REMINDER_OFFSET_MS).toBe(900_000);
    expect(ESCALATION_OFFSET_MS).toBe(1_800_000);
    expect(MAX_SNOOZE_COUNT).toBe(1);
  });

  it('INT-02: calculateIntervals computes exact T, T+15m, and T+30m offsets', () => {
    const scheduled = new Date('2026-11-25T08:00:00.000Z');
    const intervals = calculateIntervals(scheduled);

    expect(intervals.dueTime.getTime()).toBe(scheduled.getTime());
    expect(intervals.gentleReminderTime.getTime()).toBe(scheduled.getTime() + 900_000);
    expect(intervals.escalationTime.getTime()).toBe(scheduled.getTime() + 1_800_000);
    expect(intervals.dueTime.toISOString()).toBe('2026-11-25T08:00:00.000Z');
    expect(intervals.gentleReminderTime.toISOString()).toBe('2026-11-25T08:15:00.000Z');
    expect(intervals.escalationTime.toISOString()).toBe('2026-11-25T08:30:00.000Z');
  });

  it('INT-03: calculateIntervals handles midnight rollover boundaries accurately', () => {
    const scheduled = new Date('2026-11-25T23:50:00.000Z');
    const intervals = calculateIntervals(scheduled);

    expect(intervals.dueTime.toISOString()).toBe('2026-11-25T23:50:00.000Z');
    expect(intervals.gentleReminderTime.toISOString()).toBe('2026-11-26T00:05:00.000Z');
    expect(intervals.escalationTime.toISOString()).toBe('2026-11-26T00:20:00.000Z');
  });

  it('INT-04: calculateIntervals is immune to DST spring-forward and fall-back transitions', () => {
    const springForward = new Date('2026-03-08T06:50:00.000Z');
    const springIntervals = calculateIntervals(springForward);
    expect(springIntervals.gentleReminderTime.getTime() - springForward.getTime()).toBe(900_000);
    expect(springIntervals.escalationTime.getTime() - springForward.getTime()).toBe(1_800_000);

    const fallBack = new Date('2026-11-01T05:45:00.000Z');
    const fallIntervals = calculateIntervals(fallBack);
    expect(fallIntervals.gentleReminderTime.getTime() - fallBack.getTime()).toBe(900_000);
    expect(fallIntervals.escalationTime.getTime() - fallBack.getTime()).toBe(1_800_000);
  });

  it('INT-05: calculateIntervals returns defensive Date clones without input aliasing', () => {
    const scheduled = new Date('2026-11-25T08:00:00.000Z');
    const originalMs = scheduled.getTime();
    const intervals = calculateIntervals(scheduled);

    scheduled.setTime(originalMs + 3_600_000);

    expect(intervals.dueTime.getTime()).toBe(originalMs);
    expect(intervals.gentleReminderTime.getTime()).toBe(originalMs + 900_000);
    expect(intervals.escalationTime.getTime()).toBe(originalMs + 1_800_000);
  });

  it('INT-06: calculateIntervals rejects invalid Date values', () => {
    expect(() => calculateIntervals(new Date('invalid'))).toThrow(/Invalid scheduledTime/);
  });

  it('INT-07: calculateSnoozeUntil computes exact +10m across midnight and rejects invalid Date', () => {
    const fromTime = new Date('2026-11-25T23:55:00.000Z');
    const snoozeUntil = calculateSnoozeUntil(fromTime);

    expect(snoozeUntil.getTime() - fromTime.getTime()).toBe(600_000);
    expect(snoozeUntil.toISOString()).toBe('2026-11-26T00:05:00.000Z');
    expect(() => calculateSnoozeUntil(new Date(Number.NaN))).toThrow(/Invalid currentTime/);
  });

  it('INT-08: canSnooze enforces full 6-state x snoozeCount matrix (only due with count 0 is true)', () => {
    const statuses: readonly DoseStatus[] = [
      'scheduled',
      'due',
      'taken',
      'snoozed',
      'unconfirmed',
      'missed',
    ];
    const counts = [-1, 0, 0.5, 1, 2, Number.NaN];

    for (const status of statuses) {
      for (const count of counts) {
        const expected = status === 'due' && count === 0;
        expect(canSnooze(count, status)).toBe(expected);
      }
    }
  });

  it('INT-09: boundary predicate helpers evaluate -1ms, exact, and +1ms accurately', () => {
    const scheduled = new Date('2026-11-25T08:00:00.000Z');
    const baseMs = scheduled.getTime();

    expect(isDueTimeReached(scheduled, new Date(baseMs - 1))).toBe(false);
    expect(isDueTimeReached(scheduled, new Date(baseMs))).toBe(true);
    expect(isDueTimeReached(scheduled, new Date(baseMs + 1))).toBe(true);

    expect(isGentleReminderDue(scheduled, new Date(baseMs + 900_000 - 1))).toBe(false);
    expect(isGentleReminderDue(scheduled, new Date(baseMs + 900_000))).toBe(true);
    expect(isGentleReminderDue(scheduled, new Date(baseMs + 900_000 + 1))).toBe(true);

    expect(isEscalationDue(scheduled, new Date(baseMs + 1_800_000 - 1))).toBe(false);
    expect(isEscalationDue(scheduled, new Date(baseMs + 1_800_000))).toBe(true);
    expect(isEscalationDue(scheduled, new Date(baseMs + 1_800_000 + 1))).toBe(true);

    const snoozeUntil = new Date(baseMs + 600_000);
    expect(isSnoozeExpired(snoozeUntil, new Date(snoozeUntil.getTime() - 1))).toBe(false);
    expect(isSnoozeExpired(snoozeUntil, new Date(snoozeUntil.getTime()))).toBe(true);
    expect(isSnoozeExpired(snoozeUntil, new Date(snoozeUntil.getTime() + 1))).toBe(true);
  });
});
