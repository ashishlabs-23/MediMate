import type {
  DoseAction,
  DoseStatus,
  DoseTransitionInput,
  DoseTransitionResult,
} from '../types/dose';
import {
  assertValidDate,
  calculateIntervals,
  calculateSnoozeUntil,
  canSnooze,
} from './intervals';

export { canSnooze };

const VALID_STATUSES: ReadonlySet<DoseStatus> = new Set([
  'scheduled',
  'due',
  'taken',
  'snoozed',
  'unconfirmed',
  'missed',
]);

const VALID_ACTIONS: ReadonlySet<DoseAction> = new Set([
  'tapTaken',
  'tapSnooze',
  'markMissed',
]);

function buildResult(
  nextStatus: DoseStatus,
  snoozeCount: number,
  overrides: Partial<Omit<DoseTransitionResult, 'nextStatus' | 'snoozeCount'>> = {}
): DoseTransitionResult {
  return {
    nextStatus,
    snoozeCount,
    snoozeUntil: overrides.snoozeUntil ?? null,
    takenAt: overrides.takenAt ?? null,
    escalatedAt: overrides.escalatedAt ?? null,
    missedAt: overrides.missedAt ?? null,
    sendInitialReminder: overrides.sendInitialReminder ?? false,
    sendGentleReminder: overrides.sendGentleReminder ?? false,
    sendEscalationAlert: overrides.sendEscalationAlert ?? false,
  };
}

export function evaluateDoseState(input: DoseTransitionInput): DoseTransitionResult {
  if (!VALID_STATUSES.has(input.currentStatus)) {
    throw new Error(`Invalid currentStatus: ${String(input.currentStatus)}`);
  }

  const scheduledTime = assertValidDate(input.scheduledTime, 'scheduledTime');
  const currentTime = assertValidDate(input.currentTime, 'currentTime');

  if (
    typeof input.snoozeCount !== 'number' ||
    !Number.isInteger(input.snoozeCount) ||
    input.snoozeCount < 0
  ) {
    throw new Error(`Invalid snoozeCount: ${String(input.snoozeCount)}`);
  }

  const snoozeUntil =
    input.snoozeUntil !== undefined && input.snoozeUntil !== null
      ? assertValidDate(input.snoozeUntil, 'snoozeUntil')
      : null;

  if (input.action !== undefined && !VALID_ACTIONS.has(input.action)) {
    throw new Error(`Invalid action: ${String(input.action)}`);
  }

  const nowMs = currentTime.getTime();
  const { dueTime, gentleReminderTime, escalationTime } = calculateIntervals(scheduledTime);
  const dueMs = dueTime.getTime();
  const gentleMs = gentleReminderTime.getTime();
  const escalationMs = escalationTime.getTime();

  // 1. Explicit actions
  if (input.action === 'tapTaken') {
    if (input.currentStatus === 'taken') {
      // Idempotent double-tap guard: remain 'taken', do not throw or fabricate new takenAt
      return buildResult('taken', input.snoozeCount);
    }
    if (input.currentStatus === 'missed') {
      throw new Error('Illegal transition: cannot mark missed dose as taken');
    }
    if (input.currentStatus === 'scheduled' && nowMs < dueMs) {
      throw new Error(
        'Illegal transition: cannot mark scheduled dose as taken before scheduled time T'
      );
    }
    return buildResult('taken', input.snoozeCount, {
      takenAt: new Date(nowMs),
    });
  }

  if (input.action === 'tapSnooze') {
    if (!canSnooze(input.snoozeCount, input.currentStatus)) {
      throw new Error(
        `Illegal transition: snooze disallowed for status "${input.currentStatus}" with snoozeCount=${input.snoozeCount}`
      );
    }
    if (nowMs >= escalationMs) {
      throw new Error(
        'Illegal transition: snooze disallowed at or after T+30m escalation boundary'
      );
    }
    return buildResult('snoozed', input.snoozeCount + 1, {
      snoozeUntil: calculateSnoozeUntil(currentTime),
    });
  }

  if (input.action === 'markMissed') {
    if (input.currentStatus === 'taken') {
      throw new Error('Illegal transition: cannot mark taken dose as missed');
    }
    if (input.currentStatus === 'missed') {
      throw new Error('Illegal transition: dose is already missed');
    }
    if (input.currentStatus === 'scheduled' && nowMs < dueMs) {
      throw new Error(
        'Illegal transition: cannot mark scheduled dose as missed before scheduled time T'
      );
    }
    return buildResult('missed', input.snoozeCount, {
      missedAt: new Date(nowMs),
    });
  }

  // 2. Passive clock evaluation (action === undefined)
  switch (input.currentStatus) {
    case 'taken':
      return buildResult('taken', input.snoozeCount);

    case 'missed':
      return buildResult('missed', input.snoozeCount);

    case 'unconfirmed':
      return buildResult('unconfirmed', input.snoozeCount);

    case 'scheduled': {
      if (nowMs < dueMs) {
        return buildResult('scheduled', input.snoozeCount);
      }
      if (nowMs >= escalationMs) {
        return buildResult('unconfirmed', input.snoozeCount, {
          escalatedAt: new Date(nowMs),
          sendEscalationAlert: true,
        });
      }
      return buildResult('due', input.snoozeCount, {
        sendInitialReminder: true,
        sendGentleReminder: nowMs >= gentleMs,
      });
    }

    case 'snoozed': {
      // Safety ceiling T+30m takes precedence over active snoozeUntil
      if (nowMs >= escalationMs) {
        return buildResult('unconfirmed', input.snoozeCount, {
          escalatedAt: new Date(nowMs),
          sendEscalationAlert: true,
        });
      }
      if (snoozeUntil !== null && nowMs >= snoozeUntil.getTime()) {
        return buildResult('due', input.snoozeCount, {
          sendInitialReminder: true,
          sendGentleReminder: nowMs >= gentleMs,
        });
      }
      // Active snooze suppresses gentle reminder until snoozeUntil expires
      return buildResult('snoozed', input.snoozeCount, {
        snoozeUntil: snoozeUntil ? new Date(snoozeUntil.getTime()) : null,
      });
    }

    case 'due': {
      if (nowMs >= escalationMs) {
        return buildResult('unconfirmed', input.snoozeCount, {
          escalatedAt: new Date(nowMs),
          sendEscalationAlert: true,
        });
      }
      return buildResult('due', input.snoozeCount, {
        sendGentleReminder: nowMs >= gentleMs,
      });
    }
  }
}
