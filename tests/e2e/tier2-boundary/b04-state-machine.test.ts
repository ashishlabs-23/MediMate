import { describe, expect, it } from 'vitest';
import {
  DoseStateMachineSimulator,
  DoseStatus,
  evaluateDoseState,
  TimeTravelController,
} from '../harness';

const T = new Date('2026-11-25T08:00:00.000Z');

describe('Tier 2 (Boundary) — F04: Dose State Machine Transitions', () => {
  it('T2-F04-01: Millisecond Boundary at Time T (T - 1ms vs T)', () => {
    const beforeT = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: T,
      currentTime: new Date(T.getTime() - 1),
      snoozeCount: 0,
    });
    expect(beforeT.nextStatus).toBe('scheduled');
    expect(beforeT.sendInitialReminder).toBe(false);

    const exactT = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: T,
      currentTime: new Date(T.getTime()),
      snoozeCount: 0,
    });
    expect(exactT.nextStatus).toBe('due');
    expect(exactT.sendInitialReminder).toBe(true);
  });

  it('T2-F04-02: Millisecond Boundary at Escalation (T + 30m - 1ms vs T + 30m)', () => {
    const justBefore30m = new Date(T.getTime() + 30 * 60 * 1000 - 1);
    const exact30m = new Date(T.getTime() + 30 * 60 * 1000);

    const dueBefore = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: justBefore30m,
      snoozeCount: 0,
    });
    expect(dueBefore.nextStatus).toBe('due');
    expect(dueBefore.sendEscalationAlert).toBe(false);

    const snoozedBefore = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: T,
      currentTime: justBefore30m,
      snoozeCount: 1,
      snoozeUntil: new Date(T.getTime() + 32 * 60 * 1000),
    });
    expect(snoozedBefore.nextStatus).toBe('snoozed');
    expect(snoozedBefore.sendEscalationAlert).toBe(false);

    const dueAt30m = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: exact30m,
      snoozeCount: 0,
    });
    expect(dueAt30m.nextStatus).toBe('unconfirmed');
    expect(dueAt30m.escalatedAt?.getTime()).toBe(exact30m.getTime());
    expect(dueAt30m.sendEscalationAlert).toBe(true);
  });

  it('T2-F04-03: Illegal State Transition Rejection', () => {
    expect(() =>
      evaluateDoseState({
        currentStatus: 'taken',
        scheduledTime: T,
        currentTime: new Date(T.getTime() + 5 * 60 * 1000),
        snoozeCount: 0,
        action: 'markMissed',
      })
    ).toThrow(/Illegal transition/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'missed',
        scheduledTime: T,
        currentTime: new Date(T.getTime() + 5 * 60 * 1000),
        snoozeCount: 0,
        action: 'tapTaken',
      })
    ).toThrow(/Illegal transition/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'missed',
        scheduledTime: T,
        currentTime: new Date(T.getTime() + 5 * 60 * 1000),
        snoozeCount: 0,
        action: 'tapSnooze',
      })
    ).toThrow(/Illegal transition/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'scheduled',
        scheduledTime: T,
        currentTime: new Date(T.getTime() - 60 * 1000),
        snoozeCount: 0,
        action: 'tapTaken',
      })
    ).toThrow(/Illegal transition/);

    // Terminal taken state remains immutable under passive time progression
    const passiveTaken = evaluateDoseState({
      currentStatus: 'taken',
      scheduledTime: T,
      currentTime: new Date(T.getTime() + 60 * 60 * 1000),
      snoozeCount: 0,
    });
    expect(passiveTaken.nextStatus).toBe('taken');
  });

  it('T2-F04-04: Malformed State Input Handling', () => {
    expect(() =>
      evaluateDoseState({
        currentStatus: 'unknown_state' as DoseStatus,
        scheduledTime: T,
        currentTime: T,
        snoozeCount: 0,
      })
    ).toThrow(/Invalid currentStatus/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: new Date('not-a-date'),
        currentTime: T,
        snoozeCount: 0,
      })
    ).toThrow(/Invalid scheduledTime/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: T,
        currentTime: new Date('invalid'),
        snoozeCount: 0,
      })
    ).toThrow(/Invalid currentTime/);

    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: T,
        currentTime: T,
        snoozeCount: -1,
      })
    ).toThrow(/Invalid snoozeCount/);
  });

  it('T2-F04-05: Simultaneous Action Conflict Resolution', () => {
    const exactEscalation = new Date(T.getTime() + 30 * 60 * 1000);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: exactEscalation,
      snoozeCount: 0,
      action: 'tapTaken',
    });

    expect(result.nextStatus).toBe('taken');
    expect(result.takenAt?.getTime()).toBe(exactEscalation.getTime());
    expect(result.sendEscalationAlert).toBe(false);

    const timeTravel = new TimeTravelController(T);
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_race',
        patientId: 'patient_1',
        medicationName: 'Metformin',
        scheduledTime: T,
        status: 'due',
        snoozeCount: 0,
        escalationAlertSent: false,
        followUpSent: false,
      },
      timeTravel
    );
    timeTravel.advanceToEscalation(T);
    const simResult = sim.tapTaken('patient_1');
    expect(simResult.nextStatus).toBe('taken');
    expect(sim.getDose().status).toBe('taken');
    expect(sim.getDose().escalationAlertSent).toBe(false);
    timeTravel.reset();
  });
});
