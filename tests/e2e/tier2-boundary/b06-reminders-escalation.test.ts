import { describe, expect, it } from 'vitest';
import {
  calculateIntervals,
  createDoseService,
  DoseLogDocument,
  DoseStateMachineSimulator,
  evaluateDoseState,
  MockFirestoreDb,
  renderCaregiverDashboard,
  seedPatientCareCircleScenario,
  SNOOZE_DURATION_MS,
  TimeTravelController,
} from '../harness';

const T = new Date('2026-11-25T08:00:00.000Z');

describe('Tier 2 (Boundary) — F06: Gentle Reminder (T+15m) & Caregiver Escalation (T+30m)', () => {
  it('T2-F06-01: Gentle Reminder Millisecond Boundary (T + 15m - 1ms vs T + 15m)', () => {
    const justBefore15m = new Date(T.getTime() + 15 * 60 * 1000 - 1);
    const exact15m = new Date(T.getTime() + 15 * 60 * 1000);

    const beforeRes = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: justBefore15m,
      snoozeCount: 0,
    });
    expect(beforeRes.nextStatus).toBe('due');
    expect(beforeRes.sendGentleReminder).toBe(false);

    const timeTravel = new TimeTravelController(T);
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_gentle_ms',
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
    timeTravel.advanceTo(exact15m);
    const atRes = sim.tick();

    expect(atRes.nextStatus).toBe('due');
    expect(atRes.sendGentleReminder).toBe(true);
    expect(sim.getDose().followUpSent).toBe(true);
    timeTravel.reset();
  });

  it('T2-F06-02: Snooze Alignment with Gentle Reminder', () => {
    const timeTravel = new TimeTravelController(new Date(T.getTime() + 5 * 60 * 1000));
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_snooze_align',
        patientId: 'patient_1',
        medicationName: 'Amlodipine',
        scheduledTime: T,
        status: 'due',
        snoozeCount: 0,
        escalationAlertSent: false,
        followUpSent: false,
      },
      timeTravel
    );

    expect(sim.tapSnooze()).toBe(true);
    expect(sim.getDose().snoozeUntil?.getTime()).toBe(T.getTime() + 15 * 60 * 1000);

    // 1ms before T+15m (snoozeUntil): still snoozed, gentle reminder not yet triggered
    timeTravel.advanceTo(new Date(T.getTime() + 15 * 60 * 1000 - 1));
    const beforeTick = sim.tick();
    expect(beforeTick.nextStatus).toBe('snoozed');
    expect(beforeTick.sendGentleReminder).toBe(false);

    // At T+15m: snooze expires back to due AND gentle reminder fires cleanly
    timeTravel.advanceByMs(1);
    const atTick = sim.tick();
    expect(atTick.nextStatus).toBe('due');
    expect(atTick.sendGentleReminder).toBe(true);
    expect(sim.getDose().followUpSent).toBe(true);
    timeTravel.reset();
  });

  it('T2-F06-03: Late Confirmation at T+29m59s Suppresses Escalation', () => {
    const timeTravel = new TimeTravelController(T);
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_suppress_esc',
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

    timeTravel.advanceTo(new Date(T.getTime() + 29 * 60 * 1000 + 59 * 1000));
    const takenRes = sim.tapTaken('patient_1');
    expect(takenRes.nextStatus).toBe('taken');
    expect(takenRes.sendEscalationAlert).toBe(false);

    // Advance past T+30m; escalation must NOT trigger
    timeTravel.advanceTo(new Date(T.getTime() + 35 * 60 * 1000));
    const postTick = sim.tick();
    expect(postTick.nextStatus).toBe('taken');
    expect(postTick.sendEscalationAlert).toBe(false);
    expect(sim.getDose().escalationAlertSent).toBe(false);
    timeTravel.reset();
  });

  it('T2-F06-04: Post-Escalation Late Confirmation (T+35m)', async () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'unconfirmed',
    });

    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));
    const patientService = createDoseService(db, () => ({
      uid: patient.uid,
      role: 'elderly',
    }));

    const container = document.createElement('div');
    const unsub = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(container, doses, circle);
    });

    expect(container.querySelector('#unconfirmed-alert-banner')).not.toBeNull();

    const lateTapTime = new Date(T.getTime() + 35 * 60 * 1000);
    await patientService.confirmDoseTaken(doseLog.id, patient.uid, lateTapTime);

    const updated = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(updated?.status).toBe('taken');
    expect(new Date(updated!.takenAt!).getTime()).toBe(lateTapTime.getTime());
    expect(container.querySelector('#unconfirmed-alert-banner')).toBeNull();
    unsub();
  });

  it('T2-F06-05: Timezone & Daylight Saving Time Immunity', () => {
    // 2026-11-01T05:45:00.000Z spans the US Eastern DST fall-back (01:45 EDT -> 01:15 EST)
    const dstFallBackScheduled = new Date('2026-11-01T05:45:00.000Z');
    const intervals = calculateIntervals(dstFallBackScheduled);

    expect(intervals.dueTime.getTime()).toBe(dstFallBackScheduled.getTime());
    expect(intervals.gentleReminderTime.getTime() - dstFallBackScheduled.getTime()).toBe(
      15 * 60 * 1000
    );
    expect(intervals.escalationTime.getTime() - dstFallBackScheduled.getTime()).toBe(
      30 * 60 * 1000
    );

    // 2026-03-08T06:50:00.000Z spans US Eastern DST spring-forward (01:50 EST -> 03:00 EDT)
    const dstSpringForwardScheduled = new Date('2026-03-08T06:50:00.000Z');
    const snoozeResult = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: dstSpringForwardScheduled,
      currentTime: new Date(dstSpringForwardScheduled.getTime() + 5 * 60 * 1000),
      snoozeCount: 0,
      action: 'tapSnooze',
    });

    expect(snoozeResult.snoozeUntil!.getTime() - (dstSpringForwardScheduled.getTime() + 5 * 60 * 1000)).toBe(
      SNOOZE_DURATION_MS
    );
  });
});
