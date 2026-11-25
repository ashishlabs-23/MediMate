/**
 * Pure TypeScript domain contracts for MediMate dose lifecycle & intervals.
 * Zero React, DOM, or Firebase imports allowed in this module during M2.
 * (M3 Task 3.2 appends DoseLogDocument referencing Timestamp & PillShape.)
 */

export type DoseStatus =
  | 'scheduled'
  | 'due'
  | 'taken'
  | 'snoozed'
  | 'unconfirmed'
  | 'missed';

export type DoseAction = 'tapTaken' | 'tapSnooze' | 'markMissed';

export interface DoseTransitionInput {
  currentStatus: DoseStatus;
  scheduledTime: Date; // Time T
  currentTime: Date;
  snoozeCount: number; // 0 or 1
  snoozeUntil?: Date | null | undefined;
  action?: DoseAction | undefined;
}

export interface DoseTransitionResult {
  nextStatus: DoseStatus;
  snoozeCount: number;
  snoozeUntil?: Date | null | undefined;
  takenAt?: Date | null | undefined;
  escalatedAt?: Date | null | undefined;
  missedAt?: Date | null | undefined;
  sendInitialReminder?: boolean | undefined;
  sendGentleReminder?: boolean | undefined;
  sendEscalationAlert?: boolean | undefined;
}

export interface DoseIntervals {
  dueTime: Date; // T
  gentleReminderTime: Date; // T + 15m
  escalationTime: Date; // T + 30m
}
