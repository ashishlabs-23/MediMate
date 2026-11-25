import { describe, expect, it } from 'vitest';
import {
  canSnooze,
  createDoseService,
  DoseLogDocument,
  DoseStateMachineSimulator,
  evaluateDoseState,
  MockClock,
  MockFirestoreDb,
  PermissionDeniedError,
  seedPatientCareCircleScenario,
  SNOOZE_DURATION_MS,
  TimeTravelController,
} from '../harness';

const T = new Date('2026-11-25T08:00:00.000Z');

describe('Tier 2 (Boundary) — F05: Operational Intervals & Snooze Limits (10m max 1)', () => {
  it('T2-F05-01: Snooze Expiration Boundary (snoozeUntil - 1ms vs snoozeUntil)', () => {
    const snoozeTapTime = new Date(T.getTime() + 2 * 60 * 1000);
    const snoozeUntil = new Date(snoozeTapTime.getTime() + SNOOZE_DURATION_MS); // T + 12m

    const beforeExpiry = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: T,
      currentTime: new Date(snoozeUntil.getTime() - 1),
      snoozeCount: 1,
      snoozeUntil,
    });
    expect(beforeExpiry.nextStatus).toBe('snoozed');
    expect(beforeExpiry.snoozeUntil?.getTime()).toBe(snoozeUntil.getTime());

    const atExpiry = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: T,
      currentTime: new Date(snoozeUntil.getTime()),
      snoozeCount: 1,
      snoozeUntil,
    });
    expect(atExpiry.nextStatus).toBe('due');
    expect(atExpiry.snoozeCount).toBe(1);
    expect(atExpiry.snoozeUntil).toBeNull();
  });

  it('T2-F05-02: Rapid Double-Tap Snooze Protection', async () => {
    const timeTravel = new TimeTravelController(T);
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_double_snooze',
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

    const firstAccepted = sim.tapSnooze();
    const firstSnoozeUntil = sim.getDose().snoozeUntil!.getTime();
    timeTravel.advanceByMs(50);
    const secondAccepted = sim.tapSnooze();

    expect(firstAccepted).toBe(true);
    expect(secondAccepted).toBe(false);
    expect(sim.getDose().snoozeCount).toBe(1);
    expect(sim.getDose().snoozeUntil?.getTime()).toBe(firstSnoozeUntil);
    timeTravel.reset();

    // Also verify via Firestore DoseService
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));

    await service.snoozeDose(doseLog.id, new Date(T.getTime() + 1000));
    await expect(
      service.snoozeDose(doseLog.id, new Date(T.getTime() + 1050))
    ).rejects.toThrow(/snooze disallowed/i);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)?.snoozeCount).toBe(1);
  });

  it('T2-F05-03: Tampered Snooze Counter Defence (snoozeCount >= 1)', () => {
    expect(canSnooze(1, 'due')).toBe(false);
    expect(canSnooze(2, 'due')).toBe(false);
    expect(canSnooze(99, 'due')).toBe(false);
    expect(canSnooze(-1, 'due')).toBe(false);

    for (const count of [1, 2, 5]) {
      expect(() =>
        evaluateDoseState({
          currentStatus: 'due',
          scheduledTime: T,
          currentTime: new Date(T.getTime() + 15 * 60 * 1000),
          snoozeCount: count,
          action: 'tapSnooze',
        })
      ).toThrow(/snooze disallowed/i);
    }

    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    expect(() =>
      db.updateDoc(
        'dose_logs',
        doseLog.id,
        { snoozeCount: 2 },
        { uid: patient.uid, role: 'elderly' }
      )
    ).toThrow(PermissionDeniedError);
  });

  it('T2-F05-04: Late Snooze at T+25m Interaction', () => {
    const lateTap = new Date(T.getTime() + 25 * 60 * 1000);
    const snoozed = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: lateTap,
      snoozeCount: 0,
      action: 'tapSnooze',
    });

    expect(snoozed.nextStatus).toBe('snoozed');
    expect(snoozed.snoozeCount).toBe(1);
    expect(snoozed.snoozeUntil?.getTime()).toBe(T.getTime() + 35 * 60 * 1000);

    // At T + 29m59s (before T + 30m escalation ceiling), dose stays snoozed without premature escalation
    const beforeCeiling = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: T,
      currentTime: new Date(T.getTime() + 29 * 60 * 1000 + 59 * 1000),
      snoozeCount: 1,
      snoozeUntil: snoozed.snoozeUntil,
    });
    expect(beforeCeiling.nextStatus).toBe('snoozed');
    expect(beforeCeiling.sendEscalationAlert).toBe(false);

    // At T + 30m, safety escalation deadline triggers unconfirmed alert so caregiver oversight is never bypassed
    const atCeiling = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: T,
      currentTime: new Date(T.getTime() + 30 * 60 * 1000),
      snoozeCount: 1,
      snoozeUntil: snoozed.snoozeUntil,
    });
    expect(atCeiling.nextStatus).toBe('unconfirmed');
    expect(atCeiling.sendEscalationAlert).toBe(true);
  });

  it('T2-F05-05: Clock Skew & Negative Interval Protection', () => {
    const clock = new MockClock(T);
    expect(() => clock.advanceMs(-100)).toThrow(/negative ms/);

    const timeTravel = new TimeTravelController(T);
    expect(() => timeTravel.advanceByMs(-1)).toThrow(/backward in time/);
    expect(() => timeTravel.advanceTo(new Date(T.getTime() - 5000))).toThrow(/backward in time/);
    timeTravel.reset();

    // If snoozeUntil is in the past relative to currentTime (skew), snooze expires cleanly back to due
    const skewedSnoozeUntil = new Date(T.getTime() + 1000);
    const recovered = evaluateDoseState({
      currentStatus: 'snoozed',
      scheduledTime: T,
      currentTime: new Date(T.getTime() + 5000),
      snoozeCount: 1,
      snoozeUntil: skewedSnoozeUntil,
    });
    expect(recovered.nextStatus).toBe('due');
    expect(recovered.snoozeUntil).toBeNull();
  });

  it('T2-F05-06: Snooze Past T+30m Escalation Ceiling & Monotonic setDoc / Idempotent tapTaken Guards', async () => {
    // 1. tapSnooze at T+35m or T+45m must escalate to unconfirmed and never extend snoozeUntil
    const pastEscalation = new Date(T.getTime() + 35 * 60 * 1000);
    const escalated = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: T,
      currentTime: pastEscalation,
      snoozeCount: 0,
      action: 'tapSnooze',
    });
    expect(escalated.nextStatus).toBe('unconfirmed');
    expect(escalated.snoozeCount).toBe(0);
    expect(escalated.snoozeUntil).toBeNull();
    expect(escalated.sendEscalationAlert).toBe(true);

    // 2. DoseService.snoozeDose past T+30m rejects and persists unconfirmed (never snoozed)
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    await expect(
      service.snoozeDose(doseLog.id, new Date(T.getTime() + 45 * 60 * 1000))
    ).rejects.toThrow(/escalation deadline/i);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)?.status).toBe('unconfirmed');

    // 3. setDoc cannot reset snoozeCount (1 -> 0) or revert taken dose back to due
    const patientAuth = { uid: patient.uid, role: 'elderly' as const };
    const freshDb = new MockFirestoreDb();
    const freshScenario = seedPatientCareCircleScenario(freshDb, { doseStatus: 'due' });
    const freshService = createDoseService(freshDb, () => patientAuth);

    await freshService.snoozeDose(freshScenario.doseLog.id, new Date(T.getTime() + 2 * 60 * 1000));
    const snoozedStored = freshDb.inspectDoc<DoseLogDocument>(
      'dose_logs',
      freshScenario.doseLog.id
    )!;
    expect(() =>
      freshDb.setDoc(
        'dose_logs',
        snoozedStored.id,
        { ...snoozedStored, snoozeCount: 0 },
        patientAuth
      )
    ).toThrow(PermissionDeniedError);

    const originalTakenTime = new Date(T.getTime() + 5 * 60 * 1000);
    await freshService.confirmDoseTaken(freshScenario.doseLog.id, patient.uid, originalTakenTime);
    const takenStored = freshDb.inspectDoc<DoseLogDocument>(
      'dose_logs',
      freshScenario.doseLog.id
    )!;

    expect(() =>
      freshDb.setDoc(
        'dose_logs',
        takenStored.id,
        { ...takenStored, status: 'due', snoozeCount: 0 },
        patientAuth
      )
    ).toThrow(PermissionDeniedError);

    // 4. evaluateDoseState tapTaken on already-taken dose preserves original takenAt
    const idempotentTaken = evaluateDoseState({
      currentStatus: 'taken',
      scheduledTime: T,
      currentTime: new Date(T.getTime() + 15 * 60 * 1000),
      snoozeCount: 1,
      takenAt: originalTakenTime,
      action: 'tapTaken',
    });
    expect(idempotentTaken.nextStatus).toBe('taken');
    expect(idempotentTaken.takenAt?.getTime()).toBe(originalTakenTime.getTime());
  });
});
