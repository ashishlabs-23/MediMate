import { describe, expect, it } from 'vitest';
import {
  calculateIntervals,
  DoseStateMachineSimulator,
  evaluateDoseState,
  TimeTravelController,
} from '../harness';

const T = new Date('2026-11-25T08:00:00.000Z');

describe('Tier 1 — F06: Gentle Reminder (T+15m) & Caregiver Escalation (T+30m)', () => {
  it('T1-F06-01: Interval Calculation Helper Verification', () => {
    const intervals = calculateIntervals(T);

    expect(intervals.dueTime.getTime()).toBe(T.getTime());
    expect(intervals.gentleReminderTime.getTime()).toBe(T.getTime() + 15 * 60 * 1000);
    expect(intervals.escalationTime.getTime()).toBe(T.getTime() + 30 * 60 * 1000);
  });

  it('T1-F06-02: Initial Reminder Triggered at Time T', () => {
    const result = evaluateDoseState({
      currentStatus: 'scheduled',
      scheduledTime: T,
      currentTime: new Date(T.getTime()),
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.sendInitialReminder).toBe(true);
    expect(result.sendGentleReminder).toBe(false);
    expect(result.sendEscalationAlert).toBe(false);
  });

  it('T1-F06-03: No Gentle Reminder Before T+15m', () => {
    const justBefore15m = new Date(T.getTime() + 14 * 60 * 1000 + 59 * 1000);
    const result = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: justBefore15m,
      snoozeCount: 0,
    });

    expect(result.nextStatus).toBe('due');
    expect(result.sendGentleReminder).toBe(false);
  });

  it('T1-F06-04: Gentle Reminder Triggered at T+15m', () => {
    const timeTravel = new TimeTravelController(T);
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_1',
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

    timeTravel.advanceToGentleReminder(T);
    const result = sim.tick();

    expect(result.nextStatus).toBe('due');
    expect(result.sendGentleReminder).toBe(true);
    expect(sim.getDose().followUpSent).toBe(true);
    timeTravel.reset();
  });

  it('T1-F06-05: Caregiver Escalation Triggered at T+30m', () => {
    const timeTravel = new TimeTravelController(T);
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_1',
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
    const result = sim.tick();

    expect(result.nextStatus).toBe('unconfirmed');
    expect(result.sendEscalationAlert).toBe(true);
    expect(sim.getDose().status).toBe('unconfirmed');
    expect(sim.getDose().escalationAlertSent).toBe(true);
    expect(sim.getDose().escalatedAt?.getTime()).toBe(T.getTime() + 30 * 60 * 1000);
    timeTravel.reset();
  });
});
