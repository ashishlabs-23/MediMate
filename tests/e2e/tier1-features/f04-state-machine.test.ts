import { describe, expect, it } from 'vitest';
import { evaluateDoseState } from '../harness';

const T = new Date('2026-11-25T08:00:00.000Z');

describe('Tier 1 — F04: Dose State Machine Transitions', () => {
  it('T1-F04-01: Scheduled to Due Transition at Time T', () => {
    const result = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: T,
      currentTime: new Date(T.getTime()),
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.sendInitialReminder).toBe(true);
  });

  it('T1-F04-02: Due to Taken Transition on tapTaken', () => {
    const tapTime = new Date(T.getTime() + 2 * 60 * 1000);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: tapTime,
      snoozeCount: 0,
      action: 'tapTaken',
    });

    expect(result.nextStatus).toBe('taken');
    expect(result.takenAt?.getTime()).toBe(tapTime.getTime());
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('T1-F04-03: Due to Snoozed Transition on tapSnooze', () => {
    const snoozeTime = new Date(T.getTime() + 1 * 60 * 1000);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: snoozeTime,
      snoozeCount: 0,
      action: 'tapSnooze',
    });

    expect(result.nextStatus).toBe('snoozed');
    expect(result.snoozeCount).toBe(1);
    expect(result.snoozeUntil?.getTime()).toBe(snoozeTime.getTime() + 10 * 60 * 1000);
  });

  it('T1-F04-04: Due to Unconfirmed Transition at T+30m Timeout', () => {
    const escalationTime = new Date(T.getTime() + 30 * 60 * 1000);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: escalationTime,
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('unconfirmed');
    expect(result.escalatedAt?.getTime()).toBe(escalationTime.getTime());
    expect(result.sendEscalationAlert).toBe(true);
  });

  it('T1-F04-05: Explicit Transition to Missed on markMissed', () => {
    const missTime = new Date(T.getTime() + 45 * 60 * 1000);
    const fromDue = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: missTime,
      snoozeCount: 0,
      action: 'markMissed',
    });
    const fromUnconfirmed = evaluateDoseState({
      currentStatus: 'unconfirmed',
      scheduledTime: T,
      currentTime: missTime,
      snoozeCount: 0,
      action: 'markMissed',
    });

    expect(fromDue.nextStatus).toBe('missed');
    expect(fromDue.missedAt?.getTime()).toBe(missTime.getTime());
    expect(fromUnconfirmed.nextStatus).toBe('missed');
    expect(fromUnconfirmed.missedAt?.getTime()).toBe(missTime.getTime());
  });
});
