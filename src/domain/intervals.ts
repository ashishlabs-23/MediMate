import type { DoseIntervals, DoseStatus } from '../types/dose';

export const SNOOZE_DURATION_MS = 10 * 60 * 1000; // 600,000 ms (10 minutes)
export const GENTLE_REMINDER_OFFSET_MS = 15 * 60 * 1000; // 900,000 ms (15 minutes)
export const ESCALATION_OFFSET_MS = 30 * 60 * 1000; // 1,800,000 ms (30 minutes)
export const MAX_SNOOZE_COUNT = 1;

export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

export function assertValidDate(value: unknown, label: string): Date {
  if (!isValidDate(value)) {
    throw new Error(`Invalid ${label}: expected valid Date`);
  }
  return value;
}

/**
 * Determines whether a dose in the given status with the current snoozeCount
 * is eligible for a 10-minute snooze (max 1 snooze, only while 'due').
 */
export function canSnooze(snoozeCount: number, currentStatus: DoseStatus): boolean {
  if (!Number.isInteger(snoozeCount) || snoozeCount < 0) {
    return false;
  }
  return currentStatus === 'due' && snoozeCount < MAX_SNOOZE_COUNT;
}

/**
 * Calculates operational reminder milestones relative to scheduledTime (T)
 * using epoch millisecond offsets (immune to DST and timezone shifts).
 */
export function calculateIntervals(scheduledTime: Date): DoseIntervals {
  const validScheduled = assertValidDate(scheduledTime, 'scheduledTime');
  const baseMs = validScheduled.getTime();

  return {
    dueTime: new Date(baseMs),
    gentleReminderTime: new Date(baseMs + GENTLE_REMINDER_OFFSET_MS),
    escalationTime: new Date(baseMs + ESCALATION_OFFSET_MS),
  };
}

/**
 * Computes the exact snooze expiration timestamp (fromTime + 10 minutes).
 */
export function calculateSnoozeUntil(fromTime: Date): Date {
  const validFrom = assertValidDate(fromTime, 'currentTime');
  return new Date(validFrom.getTime() + SNOOZE_DURATION_MS);
}

export function isDueTimeReached(scheduledTime: Date, currentTime: Date): boolean {
  const scheduled = assertValidDate(scheduledTime, 'scheduledTime');
  const current = assertValidDate(currentTime, 'currentTime');
  return current.getTime() >= scheduled.getTime();
}

export function isGentleReminderDue(scheduledTime: Date, currentTime: Date): boolean {
  const { gentleReminderTime } = calculateIntervals(scheduledTime);
  const current = assertValidDate(currentTime, 'currentTime');
  return current.getTime() >= gentleReminderTime.getTime();
}

export function isEscalationDue(scheduledTime: Date, currentTime: Date): boolean {
  const { escalationTime } = calculateIntervals(scheduledTime);
  const current = assertValidDate(currentTime, 'currentTime');
  return current.getTime() >= escalationTime.getTime();
}

export function isSnoozeExpired(snoozeUntil: Date, currentTime: Date): boolean {
  const until = assertValidDate(snoozeUntil, 'snoozeUntil');
  const current = assertValidDate(currentTime, 'currentTime');
  return current.getTime() >= until.getTime();
}
