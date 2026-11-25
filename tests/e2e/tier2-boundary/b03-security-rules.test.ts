import { describe, expect, it } from 'vitest';
import {
  createCareCircleFixture,
  createDoseLogFixture,
  createMedicationFixture,
  DoseLogDocument,
  MockFirestoreDb,
  PermissionDeniedError,
  seedPatientCareCircleScenario,
} from '../harness';

describe('Tier 2 (Boundary) — F03: Firestore Security Rules (Patient Isolation)', () => {
  it('T2-F03-01: Empty Caregiver List Boundary', () => {
    const db = new MockFirestoreDb();
    const patientId = 'patient_isolated';
    const circle = createCareCircleFixture({
      id: patientId,
      patientId,
      caregiverIds: [],
      members: [],
    });
    const med = createMedicationFixture({ id: 'med_isolated', patientId });
    const dose = createDoseLogFixture({ id: 'dose_isolated', patientId, medicationId: med.id });

    db.seedDoc('care_circles', circle.id, circle);
    db.seedDoc('medications', med.id, med);
    db.seedDoc('dose_logs', dose.id, dose);

    const patientAuth = { uid: patientId, role: 'elderly' as const };
    const outsiderAuth = { uid: 'caregiver_outsider', role: 'caregiver' as const };

    expect(db.getDoc('dose_logs', dose.id, patientAuth)?.id).toBe(dose.id);
    expect(() => db.getDoc('care_circles', circle.id, outsiderAuth)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('medications', med.id, outsiderAuth)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('dose_logs', dose.id, outsiderAuth)).toThrow(PermissionDeniedError);
    expect(() =>
      db.queryDocs('dose_logs', (d) => d.patientId === patientId, outsiderAuth, patientId)
    ).toThrow(PermissionDeniedError);
  });

  it('T2-F03-02: UID Prefix/Substring Collision Protection', () => {
    const db = new MockFirestoreDb();
    const { patient, circle, medication, doseLog } = seedPatientCareCircleScenario(db, {
      patientId: 'patient_alpha',
      caregiverId: 'user123',
    });

    const authorizedAuth = { uid: 'user123', role: 'caregiver' as const };
    expect(db.getDoc('dose_logs', doseLog.id, authorizedAuth)?.id).toBe(doseLog.id);

    const collidingUids = ['user12', 'user1234', '123', 'user1', 'user123 '];
    for (const badUid of collidingUids) {
      const badAuth = { uid: badUid, role: 'caregiver' as const };
      expect(() => db.getDoc('care_circles', circle.id, badAuth)).toThrow(PermissionDeniedError);
      expect(() => db.getDoc('medications', medication.id, badAuth)).toThrow(PermissionDeniedError);
      expect(() => db.getDoc('dose_logs', doseLog.id, badAuth)).toThrow(PermissionDeniedError);
      expect(() =>
        db.queryDocs('dose_logs', (d) => d.patientId === patient.uid, badAuth, patient.uid)
      ).toThrow(PermissionDeniedError);
    }
  });

  it('T2-F03-03: Malicious Injected Field Rejection', () => {
    const db = new MockFirestoreDb();
    const { patient, medication, doseLog } = seedPatientCareCircleScenario(db);
    const patientAuth = { uid: patient.uid, role: 'elderly' as const };

    expect(() =>
      db.setDoc(
        'users',
        patient.uid,
        { ...patient, isAdmin: true },
        patientAuth
      )
    ).toThrow(PermissionDeniedError);

    expect(() =>
      db.updateDoc('dose_logs', doseLog.id, { bypassRules: true } as Partial<DoseLogDocument>, patientAuth)
    ).toThrow(PermissionDeniedError);

    expect(() =>
      db.updateDoc('medications', medication.id, { patientId: 'other_patient' }, patientAuth)
    ).toThrow(PermissionDeniedError);

    expect(() =>
      db.updateDoc('dose_logs', doseLog.id, { patientId: 'other_patient' }, patientAuth)
    ).toThrow(PermissionDeniedError);

    expect(() =>
      db.updateDoc('dose_logs', doseLog.id, { snoozeCount: 2 }, patientAuth)
    ).toThrow(PermissionDeniedError);
  });

  it('T2-F03-04: Revoked Caregiver Access Immediate Enforcement', () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db);
    const patientAuth = { uid: patient.uid, role: 'elderly' as const };
    const caregiverAuth = { uid: caregiver.uid, role: 'caregiver' as const };

    expect(db.getDoc('dose_logs', doseLog.id, caregiverAuth)?.id).toBe(doseLog.id);

    const subscriptionErrors: Error[] = [];
    const unsubscribe = db.subscribe<DoseLogDocument>(
      'dose_logs',
      (d) => d.patientId === patient.uid,
      () => {},
      caregiverAuth,
      (err) => subscriptionErrors.push(err),
      patient.uid
    );

    // Patient revokes caregiver access
    db.updateDoc('care_circles', circle.id, { caregiverIds: [] }, patientAuth);

    expect(() => db.getDoc('dose_logs', doseLog.id, caregiverAuth)).toThrow(PermissionDeniedError);
    expect(() =>
      db.updateDoc('dose_logs', doseLog.id, { status: 'taken' }, caregiverAuth)
    ).toThrow(PermissionDeniedError);
    expect(subscriptionErrors.some((e) => e instanceof PermissionDeniedError)).toBe(true);
    unsubscribe();
  });

  it('T2-F03-05: Multi-Patient Cross-Isolation Boundary', () => {
    const db = new MockFirestoreDb();
    const scenarioA = seedPatientCareCircleScenario(db, {
      patientId: 'patient_a',
      caregiverId: 'cg_a',
      unlinkedId: 'stranger_1',
    });
    const medB = createMedicationFixture({ id: 'med_b', patientId: 'patient_b' });
    const doseB = createDoseLogFixture({
      id: 'dose_b',
      patientId: 'patient_b',
      medicationId: medB.id,
    });
    const circleB = createCareCircleFixture({
      id: 'patient_b',
      patientId: 'patient_b',
      patientName: 'Patient B',
      caregiverIds: ['cg_b'],
    });
    db.seedDoc('care_circles', circleB.id, circleB);
    db.seedDoc('medications', medB.id, medB);
    db.seedDoc('dose_logs', doseB.id, doseB);

    const cgAAuth = { uid: scenarioA.caregiver.uid, role: 'caregiver' as const };
    const cgBAuth = { uid: 'cg_b', role: 'caregiver' as const };

    expect(db.getDoc('dose_logs', scenarioA.doseLog.id, cgAAuth)?.patientId).toBe('patient_a');
    expect(db.getDoc('dose_logs', doseB.id, cgBAuth)?.patientId).toBe('patient_b');

    // Cross-patient isolation
    expect(() => db.getDoc('dose_logs', doseB.id, cgAAuth)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('medications', medB.id, cgAAuth)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('dose_logs', scenarioA.doseLog.id, cgBAuth)).toThrow(
      PermissionDeniedError
    );
    expect(() =>
      db.queryDocs('dose_logs', (d) => d.patientId === 'patient_b', cgAAuth, 'patient_b')
    ).toThrow(PermissionDeniedError);
  });

  it('T2-F03-06: Users Profile Read Isolation, Care Circle Doc-ID Integrity & Secondary Caregiver Guard', () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, unlinked, circle, doseLog } = seedPatientCareCircleScenario(db);
    const patientAuth = { uid: patient.uid, role: 'elderly' as const };
    const caregiverAuth = { uid: caregiver.uid, role: 'caregiver' as const };
    const unlinkedAuth = { uid: unlinked.uid, role: 'caregiver' as const };

    // 1. Users profile read isolation: owner & linked caregiver permitted; unlinked user denied
    expect(db.getDoc('users', patient.uid, patientAuth)?.uid).toBe(patient.uid);
    expect(db.getDoc('users', patient.uid, caregiverAuth)?.uid).toBe(patient.uid);
    expect(() => db.getDoc('users', patient.uid, unlinkedAuth)).toThrow(PermissionDeniedError);

    // 2. Care circle docId collision privilege escalation blocked
    const victimId = 'patient_victim';
    const victimCircle = createCareCircleFixture({
      id: 'random_auto_id_victim',
      patientId: victimId,
      caregiverIds: [caregiver.uid],
    });
    const victimDose = createDoseLogFixture({
      id: 'dose_victim',
      patientId: victimId,
    });
    db.seedDoc('care_circles', 'random_auto_id_victim', victimCircle);
    db.seedDoc('dose_logs', victimDose.id, victimDose);

    // Attacker cannot create care_circles/{victimId} with patientId = unlinked.uid
    expect(() =>
      db.setDoc(
        'care_circles',
        victimId,
        {
          ...circle,
          id: victimId,
          patientId: unlinked.uid,
          caregiverIds: [unlinked.uid],
        },
        unlinkedAuth
      )
    ).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('dose_logs', victimDose.id, unlinkedAuth)).toThrow(PermissionDeniedError);

    // 3. Secondary caregiver cannot mutate care circle caregiverIds/members
    const secondaryId = 'caregiver_secondary';
    db.updateDoc(
      'care_circles',
      circle.id,
      {
        caregiverIds: [caregiver.uid, secondaryId],
        members: [
          ...circle.members,
          {
            userId: secondaryId,
            displayName: 'Secondary Helper',
            email: 'secondary@medimate.test',
            role: 'secondary',
            permissions: ['read', 'receive_alerts'],
            status: 'active',
            invitedAt: new Date(),
            joinedAt: new Date(),
          },
        ],
      },
      patientAuth
    );

    const secondaryAuth = { uid: secondaryId, role: 'caregiver' as const };
    // Secondary can read patient dose logs, but cannot remove primary caregiver
    expect(db.getDoc('dose_logs', doseLog.id, secondaryAuth)?.id).toBe(doseLog.id);
    expect(() =>
      db.updateDoc('care_circles', circle.id, { caregiverIds: [secondaryId] }, secondaryAuth)
    ).toThrow(PermissionDeniedError);
  });

  it('T2-F03-07: Pre-Auth Query Exfiltration, Nested Field Injection & Prototype Auth Spoofing Defence', () => {
    const db = new MockFirestoreDb();
    const { patient, unlinked, doseLog } = seedPatientCareCircleScenario(db);
    const patientAuth = { uid: patient.uid, role: 'elderly' as const };
    const unlinkedAuth = { uid: unlinked.uid, role: 'caregiver' as const };

    // 1. queryDocs without targetPatientId must never invoke predicate on unauthorized documents
    const exfiltrated: DoseLogDocument[] = [];
    const results = db.queryDocs<DoseLogDocument>(
      'dose_logs',
      (doc) => {
        exfiltrated.push(doc);
        return false;
      },
      unlinkedAuth
    );
    expect(results).toEqual([]);
    expect(exfiltrated).toEqual([]);

    // 2. Nested disallowed fields (__proto__, isAdmin, bypassRules) are rejected recursively
    const nestedMalicious = JSON.parse(
      '{"metadata":{"__proto__":{"pollutedAdmin":true},"isAdmin":true,"bypassRules":true}}'
    ) as Partial<DoseLogDocument>;
    expect(() => db.updateDoc('dose_logs', doseLog.id, nestedMalicious, patientAuth)).toThrow(
      PermissionDeniedError
    );

    // 3. Prototype-inherited auth.uid spoofing is rejected
    const spoofedAuth = Object.create({ uid: patient.uid, role: 'elderly' }) as {
      uid: string;
      role: 'elderly';
    };
    expect(() => db.getDoc('dose_logs', doseLog.id, spoofedAuth)).toThrow(PermissionDeniedError);
  });
});
