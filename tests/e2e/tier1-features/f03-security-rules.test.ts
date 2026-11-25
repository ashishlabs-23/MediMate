import { describe, expect, it } from 'vitest';
import {
  createDoseLogFixture,
  createMedicationFixture,
  MockFirestoreDb,
  PermissionDeniedError,
  seedPatientCareCircleScenario,
} from '../harness';

describe('Tier 1 — F03: Firestore Security Rules (Patient Isolation)', () => {
  it('T1-F03-01: Elderly Patient Self-Access Granted', () => {
    const db = new MockFirestoreDb();
    const { patient, medication, doseLog } = seedPatientCareCircleScenario(db);
    const patientAuth = { uid: patient.uid, role: 'elderly' as const };

    expect(db.getDoc('users', patient.uid, patientAuth)?.uid).toBe(patient.uid);
    expect(db.getDoc('medications', medication.id, patientAuth)?.id).toBe(medication.id);
    expect(db.getDoc('dose_logs', doseLog.id, patientAuth)?.id).toBe(doseLog.id);

    const updatedDose = db.updateDoc(
      'dose_logs',
      doseLog.id,
      { status: 'taken', takenAt: new Date() },
      patientAuth
    );
    expect(updatedDose.status).toBe('taken');
  });

  it('T1-F03-02: Unlinked Caregiver Read Denied', () => {
    const db = new MockFirestoreDb();
    const { patient, unlinked, medication, doseLog } = seedPatientCareCircleScenario(db);
    const unlinkedAuth = { uid: unlinked.uid, role: 'caregiver' as const };

    expect(() => db.getDoc('medications', medication.id, unlinkedAuth)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('dose_logs', doseLog.id, unlinkedAuth)).toThrow(PermissionDeniedError);
    expect(() =>
      db.queryDocs('dose_logs', (d) => d.patientId === patient.uid, unlinkedAuth, patient.uid)
    ).toThrow(PermissionDeniedError);
  });

  it('T1-F03-03: Linked Caregiver Authorized Read Granted', () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, medication, doseLog } = seedPatientCareCircleScenario(db);
    const caregiverAuth = { uid: caregiver.uid, role: 'caregiver' as const };

    const med = db.getDoc('medications', medication.id, caregiverAuth);
    const dose = db.getDoc('dose_logs', doseLog.id, caregiverAuth);
    const logs = db.queryDocs(
      'dose_logs',
      (d) => d.patientId === patient.uid,
      caregiverAuth,
      patient.uid
    );

    expect(med?.id).toBe(medication.id);
    expect(dose?.id).toBe(doseLog.id);
    expect(logs).toHaveLength(1);
  });

  it('T1-F03-04: Unlinked Caregiver Write Denied', () => {
    const db = new MockFirestoreDb();
    const { patient, unlinked, doseLog } = seedPatientCareCircleScenario(db);
    const unlinkedAuth = { uid: unlinked.uid, role: 'caregiver' as const };

    const injectedMed = createMedicationFixture({
      id: 'med_injected',
      patientId: patient.uid,
      createdBy: unlinked.uid,
    });
    const injectedDose = createDoseLogFixture({
      id: 'dose_injected',
      patientId: patient.uid,
    });

    expect(() => db.setDoc('medications', injectedMed.id, injectedMed, unlinkedAuth)).toThrow(
      PermissionDeniedError
    );
    expect(() => db.setDoc('dose_logs', injectedDose.id, injectedDose, unlinkedAuth)).toThrow(
      PermissionDeniedError
    );
    expect(() =>
      db.updateDoc('dose_logs', doseLog.id, { status: 'missed' }, unlinkedAuth)
    ).toThrow(PermissionDeniedError);
  });

  it('T1-F03-05: Unauthenticated Access Blocked', () => {
    const db = new MockFirestoreDb();
    const { patient, medication, doseLog } = seedPatientCareCircleScenario(db);

    expect(() => db.getDoc('users', patient.uid, null)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('medications', medication.id, null)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('dose_logs', doseLog.id, null)).toThrow(PermissionDeniedError);
    expect(() => db.updateDoc('dose_logs', doseLog.id, { status: 'taken' }, null)).toThrow(
      PermissionDeniedError
    );
  });
});
