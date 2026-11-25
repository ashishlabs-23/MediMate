import { describe, expect, it, vi } from 'vitest';
import {
  createDoseService,
  DoseLogDocument,
  MockFirestoreDb,
  renderElderlySimpleMode,
  seedPatientCareCircleScenario,
} from '../harness';

describe('Tier 1 — F08: Single-Tap Taken Confirmation & Real-Time Sync', () => {
  it('T1-F08-01: Single-Tap Click Dispatches confirmDoseTaken', async () => {
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    const confirmSpy = vi.fn(async (id: string) => {
      await service.confirmDoseTaken(id, patient.uid, new Date('2026-11-25T08:02:00.000Z'));
    });

    const container = document.createElement('div');
    const { takenButton } = renderElderlySimpleMode(container, {
      dose: doseLog,
      patientName: patient.displayName,
      onConfirmTaken: confirmSpy,
    });

    takenButton!.click();
    await Promise.resolve();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith(doseLog.id);
  });

  it('T1-F08-02: Firestore Document Updated with takenAt and status', async () => {
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    const tapTime = new Date('2026-11-25T08:04:00.000Z');

    await service.confirmDoseTaken(doseLog.id, patient.uid, tapTime);

    const updated = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(updated?.status).toBe('taken');
    expect(updated?.takenBy).toBe(patient.uid);
    expect(new Date(updated!.takenAt!).getTime()).toBe(tapTime.getTime());
  });

  it('T1-F08-03: Immediate Tactile & Visual Feedback', () => {
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const vibrateSpy = vi.spyOn(navigator, 'vibrate');

    const container = document.createElement('div');
    const { takenButton, snoozeButton, statusRegion } = renderElderlySimpleMode(container, {
      dose: doseLog,
      patientName: patient.displayName,
    });

    takenButton!.click();

    expect(takenButton?.disabled).toBe(true);
    expect(takenButton?.getAttribute('aria-disabled')).toBe('true');
    expect(takenButton?.textContent).toContain('Recorded');
    expect(snoozeButton?.disabled).toBe(true);
    expect(statusRegion?.textContent).toContain('marked as taken');
    expect(vibrateSpy).toHaveBeenCalledWith([40, 60, 40]);
  });

  it('T1-F08-04: Real-Time Snapshot Listener Propagation', async () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });

    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));
    const patientService = createDoseService(db, () => ({
      uid: patient.uid,
      role: 'elderly',
    }));

    const receivedSnapshots: DoseLogDocument[][] = [];
    const unsubscribe = caregiverService.subscribeToDoseLogs(
      patient.uid,
      '2026-11-25',
      (doses) => receivedSnapshots.push(doses)
    );

    expect(receivedSnapshots).toHaveLength(1);
    expect(receivedSnapshots[0][0].status).toBe('due');

    await patientService.confirmDoseTaken(
      doseLog.id,
      patient.uid,
      new Date('2026-11-25T08:05:00.000Z')
    );

    expect(receivedSnapshots).toHaveLength(2);
    expect(receivedSnapshots[1][0].status).toBe('taken');
    unsubscribe();
  });

  it('T1-F08-05: Idempotent Taken Confirmation', async () => {
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));

    const firstTime = new Date('2026-11-25T08:02:00.000Z');
    const secondTime = new Date('2026-11-25T08:09:00.000Z');

    await service.confirmDoseTaken(doseLog.id, patient.uid, firstTime);
    await service.confirmDoseTaken(doseLog.id, patient.uid, secondTime);

    const stored = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(stored?.status).toBe('taken');
    expect(new Date(stored!.takenAt!).getTime()).toBe(firstTime.getTime());
  });
});
