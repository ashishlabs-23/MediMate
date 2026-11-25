import { describe, expect, it } from 'vitest';
import {
  checkDoseEscalations,
  createDoseLogFixture,
  createMedicationFixture,
  DoseLogDocument,
  generateDailyDoseLogs,
  MockFirestoreDb,
} from '../harness';

describe('Tier 1 — F10: Cloud Functions Escalation & Daily Logs', () => {
  it('T1-F10-01: Daily Dose Log Generation from Schedules', () => {
    const db = new MockFirestoreDb();
    const med = createMedicationFixture({
      id: 'med_twice_daily',
      patientId: 'patient_1',
      name: 'Metformin',
      dosage: '500 mg',
      active: true,
      schedule: {
        times: ['08:00', '20:00'],
        frequency: 'daily',
        startDate: '2026-11-01',
        endDate: null,
      },
    });
    db.seedDoc('medications', med.id, med);

    const res = generateDailyDoseLogs(db, '2026-11-25');

    expect(res.createdCount).toBe(2);
    expect(res.skippedCount).toBe(0);
    const logs = db.inspectCollection<DoseLogDocument>('dose_logs');
    expect(logs).toHaveLength(2);
    expect(logs.every((l) => l.status === 'scheduled' && l.scheduledDate === '2026-11-25')).toBe(
      true
    );
  });

  it('T1-F10-02: Daily Dose Log Generator Idempotency', () => {
    const db = new MockFirestoreDb();
    const med = createMedicationFixture({
      id: 'med_1',
      patientId: 'patient_1',
      active: true,
      schedule: {
        times: ['08:00'],
        frequency: 'daily',
        startDate: '2026-11-01',
        endDate: null,
      },
    });
    db.seedDoc('medications', med.id, med);

    const firstRun = generateDailyDoseLogs(db, '2026-11-25');
    const secondRun = generateDailyDoseLogs(db, '2026-11-25');

    expect(firstRun.createdCount).toBe(1);
    expect(secondRun.createdCount).toBe(0);
    expect(secondRun.skippedCount).toBe(1);
    expect(db.inspectCollection('dose_logs')).toHaveLength(1);
  });

  it('T1-F10-03: Dose Escalation Check Detects Overdue Doses', () => {
    const db = new MockFirestoreDb();
    const overdue = createDoseLogFixture({
      id: 'dose_overdue',
      scheduledTime: new Date('2026-11-25T08:00:00.000Z'),
      status: 'due',
      escalationAlertSent: false,
    });
    const recent = createDoseLogFixture({
      id: 'dose_recent',
      scheduledTime: new Date('2026-11-25T08:20:00.000Z'),
      status: 'due',
      escalationAlertSent: false,
    });
    db.seedDoc('dose_logs', overdue.id, overdue);
    db.seedDoc('dose_logs', recent.id, recent);

    const res = checkDoseEscalations(db, new Date('2026-11-25T08:35:00.000Z'));

    expect(res.escalatedIds).toEqual(['dose_overdue']);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', 'dose_overdue')?.status).toBe('unconfirmed');
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', 'dose_recent')?.status).toBe('due');
  });

  it('T1-F10-04: Escalation Flag Recorded on Document', () => {
    const db = new MockFirestoreDb();
    const overdue = createDoseLogFixture({
      id: 'dose_overdue',
      scheduledTime: new Date('2026-11-25T08:00:00.000Z'),
      status: 'due',
      escalationAlertSent: false,
    });
    db.seedDoc('dose_logs', overdue.id, overdue);

    const sweep1 = checkDoseEscalations(db, new Date('2026-11-25T08:30:00.000Z'));
    const sweep2 = checkDoseEscalations(db, new Date('2026-11-25T08:35:00.000Z'));

    const doc = db.inspectDoc<DoseLogDocument>('dose_logs', 'dose_overdue');
    expect(doc?.escalationAlertSent).toBe(true);
    expect(doc?.escalatedAt).toBeInstanceOf(Date);
    expect(sweep1.escalatedIds).toEqual(['dose_overdue']);
    expect(sweep2.escalatedIds).toEqual([]);
  });

  it('T1-F10-05: Inactive Medications Excluded from Log Generation', () => {
    const db = new MockFirestoreDb();
    const inactiveMed = createMedicationFixture({
      id: 'med_discontinued',
      patientId: 'patient_1',
      active: false,
    });
    const activeMed = createMedicationFixture({
      id: 'med_active',
      patientId: 'patient_1',
      active: true,
    });
    db.seedDoc('medications', inactiveMed.id, inactiveMed);
    db.seedDoc('medications', activeMed.id, activeMed);

    const res = generateDailyDoseLogs(db, '2026-11-25');

    expect(res.createdCount).toBe(1);
    const logs = db.inspectCollection<DoseLogDocument>('dose_logs');
    expect(logs.map((l) => l.medicationId)).toEqual(['med_active']);
  });
});
