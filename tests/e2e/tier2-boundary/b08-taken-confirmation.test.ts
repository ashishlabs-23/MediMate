import { describe, expect, it, vi } from 'vitest';
import {
  checkDoseEscalations,
  createDoseService,
  DoseLogDocument,
  MockClock,
  MockFirestoreDb,
  renderElderlySimpleMode,
  seedPatientCareCircleScenario,
} from '../harness';

describe('Tier 2 (Boundary) — F08: Single-Tap Taken Confirmation & Real-Time Sync', () => {
  it('T2-F08-01: Rapid Triple-Tap Network Deduplication', async () => {
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));

    const confirmSpy = vi.fn(async (id: string) => {
      await service.confirmDoseTaken(id, patient.uid, new Date('2026-11-25T08:01:00.000Z'));
    });

    const container = document.createElement('div');
    const { takenButton } = renderElderlySimpleMode(container, {
      dose: doseLog,
      patientName: patient.displayName,
      onConfirmTaken: confirmSpy,
    });

    // Simulate rapid hand-tremor triple-tap
    takenButton!.click();
    takenButton!.click();
    takenButton!.click();
    await Promise.resolve();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(takenButton?.disabled).toBe(true);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)?.status).toBe('taken');
  });

  it('T2-F08-02: Offline Confirmation Queuing & Sync', async () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });
    const patientService = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const caregiverUpdates: DoseLogDocument[][] = [];
    const unsub = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      caregiverUpdates.push(doses);
    });

    let isOnline = false;
    const offlineQueue: Array<{ doseId: string; userId: string; tappedAt: Date }> = [];
    const offlineTapTime = new Date('2026-11-25T08:03:00.000Z');

    const container = document.createElement('div');
    const { takenButton } = renderElderlySimpleMode(container, {
      dose: doseLog,
      patientName: patient.displayName,
      onConfirmTaken: async (doseId) => {
        if (!isOnline) {
          offlineQueue.push({ doseId, userId: patient.uid, tappedAt: offlineTapTime });
          return;
        }
        await patientService.confirmDoseTaken(doseId, patient.uid, offlineTapTime);
      },
    });

    // Tap while offline -> UI shows optimistic confirmation, DB still due, queue holds write
    takenButton!.click();
    await Promise.resolve();
    expect(takenButton?.textContent).toContain('Recorded');
    expect(offlineQueue).toHaveLength(1);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)?.status).toBe('due');

    // Reconnect and flush offline queue
    isOnline = true;
    while (offlineQueue.length > 0) {
      const item = offlineQueue.shift()!;
      await patientService.confirmDoseTaken(item.doseId, item.userId, item.tappedAt);
    }

    const synced = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(synced?.status).toBe('taken');
    expect(new Date(synced!.takenAt!).getTime()).toBe(offlineTapTime.getTime());
    expect(caregiverUpdates.at(-1)?.[0].status).toBe('taken');
    unsub();
  });

  it('T2-F08-03: Client Clock Drift Mitigation', async () => {
    const db = new MockFirestoreDb();
    const scheduled = new Date('2026-11-25T08:00:00.000Z');
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });

    // Server clock is authoritative at T + 30m; client device clock is drifted 10m behind (T + 20m)
    const serverClock = new MockClock(new Date(scheduled.getTime() + 30 * 60 * 1000));
    const clientDriftedTime = new Date(scheduled.getTime() + 20 * 60 * 1000);

    // Server escalation uses authoritative server time, unaffected by client drift
    const esc = checkDoseEscalations(db, serverClock.now());
    expect(esc.escalatedIds).toEqual([doseLog.id]);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)?.status).toBe('unconfirmed');

    // When patient subsequently confirms, service records authoritative server timestamp
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    serverClock.advanceMinutes(1); // T + 31m
    await service.confirmDoseTaken(doseLog.id, patient.uid, serverClock.now());

    const stored = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(stored?.status).toBe('taken');
    expect(new Date(stored!.takenAt!).getTime()).toBe(serverClock.timestamp());
    expect(new Date(stored!.takenAt!).getTime()).not.toBe(clientDriftedTime.getTime());
  });

  it('T2-F08-04: Concurrent Patient & Caregiver Confirmation', async () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });

    const patientService = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const tPatient = new Date('2026-11-25T08:05:00.000Z');
    const tCaregiver = new Date('2026-11-25T08:05:02.000Z');

    await Promise.all([
      patientService.confirmDoseTaken(doseLog.id, patient.uid, tPatient),
      caregiverService.confirmDoseTaken(doseLog.id, caregiver.uid, tCaregiver),
    ]);

    const stored = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(stored?.status).toBe('taken');
    expect(stored?.takenBy).toBe(patient.uid);
    expect(new Date(stored!.takenAt!).getTime()).toBe(tPatient.getTime());
  });

  it('T2-F08-05: Snapshot Listener Teardown on Component Unmount', async () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });
    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));
    const patientService = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));

    const listenerSpy = vi.fn();
    const unsubscribe = caregiverService.subscribeToDoseLogs(
      patient.uid,
      '2026-11-25',
      listenerSpy
    );

    expect(listenerSpy).toHaveBeenCalledTimes(1);

    // Unmount component -> invoke unsubscribe
    unsubscribe();

    // Mutate dose after unmount -> unsubscribed listener must NOT be called again
    await patientService.confirmDoseTaken(
      doseLog.id,
      patient.uid,
      new Date('2026-11-25T08:07:00.000Z')
    );

    expect(listenerSpy).toHaveBeenCalledTimes(1);
  });
});
