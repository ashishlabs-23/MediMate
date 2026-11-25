import { describe, expect, it } from 'vitest';
import {
  calculateIntervals,
  checkDoseEscalations,
  createDoseLogFixture,
  createMedicationFixture,
  createProductionAdapter,
  createStubAdapter,
  DoseLogDocument,
  generateDailyDoseLogs,
  getTargetMode,
  MockFirestoreDb,
  ProductionBindingError,
} from '../harness';

describe('Tier 2 (Boundary) — F10: Cloud Functions Escalation & Daily Logs', () => {
  it('T2-F10-01: Daily Generator Date Boundary (23:59:59 UTC vs 00:00:00 UTC)', () => {
    const db = new MockFirestoreDb();
    const boundedMed = createMedicationFixture({
      id: 'med_single_day',
      patientId: 'patient_1',
      active: true,
      schedule: {
        times: ['00:00', '23:59'],
        frequency: 'daily',
        startDate: '2026-11-25',
        endDate: '2026-11-25',
      },
    });
    db.seedDoc('medications', boundedMed.id, boundedMed);

    const beforeStart = generateDailyDoseLogs(db, '2026-11-24');
    expect(beforeStart.createdCount).toBe(0);

    const onBoundaryDay = generateDailyDoseLogs(db, '2026-11-25');
    expect(onBoundaryDay.createdCount).toBe(2);

    const afterEnd = generateDailyDoseLogs(db, '2026-11-26');
    expect(afterEnd.createdCount).toBe(0);

    const logs = db.inspectCollection<DoseLogDocument>('dose_logs');
    expect(logs).toHaveLength(2);
    expect(logs.map((l) => new Date(l.scheduledTime).toISOString()).sort()).toEqual([
      '2026-11-25T00:00:00.000Z',
      '2026-11-25T23:59:00.000Z',
    ]);
  });

  it('T2-F10-02: Complex Schedule Frequencies (Every 8h, Alternate Days)', () => {
    const db = new MockFirestoreDb();
    const every8hMed = createMedicationFixture({
      id: 'med_q8h',
      patientId: 'patient_1',
      active: true,
      schedule: {
        times: ['06:00', '14:00', '22:00'],
        frequency: 'daily',
        startDate: '2026-11-01',
        endDate: null,
      },
    });
    // Mon (1), Wed (3), Fri (5); 2026-11-25 is Wednesday (3), 2026-11-26 is Thursday (4)
    const alternateDaysMed = createMedicationFixture({
      id: 'med_mwf',
      patientId: 'patient_1',
      active: true,
      schedule: {
        times: ['09:00'],
        frequency: 'specific_days',
        daysOfWeek: [1, 3, 5],
        startDate: '2026-11-01',
        endDate: null,
      },
    });
    db.seedDoc('medications', every8hMed.id, every8hMed);
    db.seedDoc('medications', alternateDaysMed.id, alternateDaysMed);

    const wedRes = generateDailyDoseLogs(db, '2026-11-25');
    expect(wedRes.createdCount).toBe(4);

    const thuRes = generateDailyDoseLogs(db, '2026-11-26');
    expect(thuRes.createdCount).toBe(3);
  });

  it('T2-F10-03: Firestore 500-Operation Batch Chunking', () => {
    const db = new MockFirestoreDb();
    // 275 active meds x 2 times/day = 550 dose logs -> requires 2 Firestore batches (500 + 50)
    for (let i = 0; i < 275; i += 1) {
      const med = createMedicationFixture({
        id: `med_batch_${i}`,
        patientId: `patient_${i % 50}`,
        active: true,
        schedule: {
          times: ['08:00', '20:00'],
          frequency: 'daily',
          startDate: '2026-11-01',
          endDate: null,
        },
      });
      db.seedDoc('medications', med.id, med);
    }

    const res = generateDailyDoseLogs(db, '2026-11-25');

    expect(res.createdCount).toBe(550);
    expect(res.batchCount).toBe(2);
    expect(db.inspectCollection('dose_logs')).toHaveLength(550);
  });

  it('T2-F10-04: Escalation Function Execution Timeout Resilience', () => {
    const db = new MockFirestoreDb();
    const scheduled = new Date('2026-11-25T08:00:00.000Z');
    const now = new Date('2026-11-25T08:40:00.000Z');

    for (let i = 0; i < 150; i += 1) {
      db.seedDoc(
        'dose_logs',
        `overdue_${i}`,
        createDoseLogFixture({
          id: `overdue_${i}`,
          patientId: `patient_${i}`,
          scheduledTime: scheduled,
          status: 'due',
          escalationAlertSent: false,
        })
      );
    }
    for (let i = 0; i < 50; i += 1) {
      db.seedDoc(
        'dose_logs',
        `ontime_${i}`,
        createDoseLogFixture({
          id: `ontime_${i}`,
          patientId: `patient_${i}`,
          scheduledTime: new Date('2026-11-25T08:25:00.000Z'),
          status: 'due',
          escalationAlertSent: false,
        })
      );
    }

    const startMs = performance.now();
    const res = checkDoseEscalations(db, now);
    const elapsedMs = performance.now() - startMs;

    expect(res.escalatedIds).toHaveLength(150);
    expect(elapsedMs).toBeLessThan(1000);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', 'overdue_0')?.status).toBe('unconfirmed');
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', 'ontime_0')?.status).toBe('due');
  });

  it('T2-F10-05: Concurrent Execution Race Protection', async () => {
    const db = new MockFirestoreDb();
    const dose = createDoseLogFixture({
      id: 'dose_race_esc',
      scheduledTime: new Date('2026-11-25T08:00:00.000Z'),
      status: 'due',
      escalationAlertSent: false,
    });
    db.seedDoc('dose_logs', dose.id, dose);

    const runTime = new Date('2026-11-25T08:30:00.000Z');
    const [run1, run2] = await Promise.all([
      Promise.resolve().then(() => checkDoseEscalations(db, runTime)),
      Promise.resolve().then(() => checkDoseEscalations(db, runTime)),
    ]);

    const totalEscalations = run1.escalatedIds.length + run2.escalatedIds.length;
    expect(totalEscalations).toBe(1);
    expect([...run1.escalatedIds, ...run2.escalatedIds]).toEqual([dose.id]);

    const stored = db.inspectDoc<DoseLogDocument>('dose_logs', dose.id);
    expect(stored?.status).toBe('unconfirmed');
    expect(stored?.escalationAlertSent).toBe(true);
    expect(new Date(stored!.escalatedAt!).getTime()).toBe(runTime.getTime());
  });

  it('T2-F10-06: Date Overflow / Invalid Calendar Validation & Production Adapter Resolution', async () => {
    const db = new MockFirestoreDb();
    expect(() => generateDailyDoseLogs(db, '2026-02-30')).toThrow(/Invalid calendar date/);
    expect(() => calculateIntervals(new Date(8640000000000000))).toThrow(/Invalid gentleReminderTime/);

    // Adapter defaults cleanly to stub mode and exposes full contract surface
    expect(getTargetMode({})).toBe('stub');
    expect(getTargetMode({ MEDIMATE_TARGET: 'production' })).toBe('production');

    const stubAdapter = createStubAdapter();
    expect(stubAdapter.mode).toBe('stub');
    expect(typeof stubAdapter.stateMachine.evaluateDoseState).toBe('function');
    expect(typeof stubAdapter.cloudFunctions.checkDoseEscalations).toBe('function');

    // Production adapter explicitly fails with ProductionBindingError when src/ or functions/ are absent
    await expect(createProductionAdapter()).rejects.toThrow(ProductionBindingError);
  });
});
