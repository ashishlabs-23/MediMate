import { describe, expect, it } from 'vitest';
import {
  createCareCircleFixture,
  createDoseLogFixture,
  createDoseService,
  createMedicationFixture,
  createUserProfile,
  DoseLogDocument,
  MockFirestoreDb,
  PermissionDeniedError,
} from '../harness/index.ts';

describe('Tier 4 — Scenario 6: Unlinked Caregiver Snooping Attempt (F3)', () => {
  it('Authenticated unlinked Caregiver Eve is denied reads, queries, subscriptions, and writes on Alice records', async () => {
    const db = new MockFirestoreDb();

    const alice = createUserProfile({
      uid: 'alice_1',
      email: 'alice@medimate.test',
      displayName: 'Alice Sterling',
      role: 'elderly',
    });
    const bob = createUserProfile({
      uid: 'bob_2',
      email: 'bob@medimate.test',
      displayName: 'Bob Sterling',
      role: 'caregiver',
    });
    const eve = createUserProfile({
      uid: 'eve_3',
      email: 'eve@medimate.test',
      displayName: 'Eve Intruder',
      role: 'caregiver',
    });

    const aliceCircle = createCareCircleFixture({
      id: 'alice_1',
      patientId: alice.uid,
      patientName: alice.displayName,
      caregiverIds: [bob.uid],
      members: [
        {
          userId: bob.uid,
          displayName: bob.displayName,
          email: bob.email,
          role: 'primary',
          permissions: ['read', 'write_schedule', 'receive_alerts'],
          status: 'active',
          invitedAt: new Date('2026-11-25T07:00:00.000Z'),
          joinedAt: new Date('2026-11-25T07:00:00.000Z'),
        },
      ],
    });
    const aliceMed = createMedicationFixture({
      id: 'alice_med_1',
      patientId: alice.uid,
      name: 'Warfarin',
      dosage: '2 mg',
      createdBy: bob.uid,
    });
    const aliceDose = createDoseLogFixture({
      id: 'alice_dose_1',
      patientId: alice.uid,
      medicationId: aliceMed.id,
      medicationName: 'Warfarin',
      dosage: '2 mg',
      status: 'due',
    });

    db.seedDoc('users', alice.uid, alice);
    db.seedDoc('users', bob.uid, bob);
    db.seedDoc('users', eve.uid, eve);
    db.seedDoc('care_circles', aliceCircle.id, aliceCircle);
    db.seedDoc('medications', aliceMed.id, aliceMed);
    db.seedDoc('dose_logs', aliceDose.id, aliceDose);

    const aliceAuth = { uid: alice.uid, role: 'elderly' as const };
    const bobAuth = { uid: bob.uid, role: 'caregiver' as const };
    const eveAuth = { uid: eve.uid, role: 'caregiver' as const };

    // 1. Alice (patient) reads & queries own dose logs -> Success
    expect(db.getDoc<DoseLogDocument>('dose_logs', aliceDose.id, aliceAuth)?.medicationName).toBe(
      'Warfarin'
    );
    expect(
      db.queryDocs<DoseLogDocument>('dose_logs', (d) => d.patientId === alice.uid, aliceAuth, alice.uid)
    ).toHaveLength(1);

    // 2. Bob (authorized caregiver in care circle) reads & subscribes -> Success
    expect(db.getDoc<DoseLogDocument>('dose_logs', aliceDose.id, bobAuth)?.id).toBe(aliceDose.id);
    const bobService = createDoseService(db, () => bobAuth);
    const bobReceived: DoseLogDocument[][] = [];
    const bobUnsub = bobService.subscribeToDoseLogs(alice.uid, '2026-11-25', (doses) => {
      bobReceived.push(doses);
    });
    expect(bobReceived).toHaveLength(1);
    expect(bobReceived[0][0].medicationName).toBe('Warfarin');
    bobUnsub();

    // 3. Eve (authenticated caregiver, unlinked) attempts snooping & tampering -> All DENIED
    let err: unknown;
    try {
      db.getDoc('dose_logs', aliceDose.id, eveAuth);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect((err as PermissionDeniedError).code).toBe('permission-denied');

    expect(() =>
      db.queryDocs('dose_logs', (d) => d.patientId === alice.uid, eveAuth, alice.uid)
    ).toThrow(PermissionDeniedError);

    expect(() => db.getDoc('medications', aliceMed.id, eveAuth)).toThrow(PermissionDeniedError);
    expect(() => db.getDoc('care_circles', aliceCircle.id, eveAuth)).toThrow(PermissionDeniedError);

    expect(() =>
      db.updateDoc('dose_logs', aliceDose.id, { status: 'missed' }, eveAuth)
    ).toThrow(PermissionDeniedError);

    const eveService = createDoseService(db, () => eveAuth);
    const eveDocs: DoseLogDocument[][] = [];
    let eveStreamError: Error | null = null;
    const eveUnsub = eveService.subscribeToDoseLogs(
      alice.uid,
      '2026-11-25',
      (doses) => eveDocs.push(doses),
      (error) => {
        eveStreamError = error;
      }
    );
    expect(eveDocs).toHaveLength(0);
    expect(eveStreamError).toBeInstanceOf(PermissionDeniedError);
    eveUnsub();

    await expect(eveService.confirmDoseTaken(aliceDose.id, eve.uid)).rejects.toThrow(
      PermissionDeniedError
    );
  });
});
