import {
  CareCircleDocument,
  DoseLogDocument,
  MedicationDocument,
  UserDocument,
} from './contractStubs';
import { MockFirestoreDb } from './mockFirestore';

const BASE_NOW = new Date('2026-11-25T07:00:00.000Z');
const BASE_SCHEDULED = new Date('2026-11-25T08:00:00.000Z');

export function createUserFixture(overrides: Partial<UserDocument> = {}): UserDocument {
  const uid = overrides.uid ?? 'patient_ramesh';
  return {
    uid,
    email: overrides.email ?? `${uid}@medimate.test`,
    displayName: overrides.displayName ?? 'Ramesh Sharma',
    role: overrides.role ?? 'elderly',
    timezone: overrides.timezone ?? 'UTC',
    fcmTokens: overrides.fcmTokens ?? ['fcm_token_default'],
    accessibilityPreferences: overrides.accessibilityPreferences ?? {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: overrides.createdAt ?? new Date(BASE_NOW.getTime()),
    updatedAt: overrides.updatedAt ?? new Date(BASE_NOW.getTime()),
    ...overrides,
  };
}

export function createCareCircleFixture(
  overrides: Partial<CareCircleDocument> = {}
): CareCircleDocument {
  const patientId = overrides.patientId ?? 'patient_ramesh';
  return {
    ...overrides,
    id: overrides.id ?? patientId,
    patientId,
    patientName: overrides.patientName ?? 'Ramesh Sharma',
    caregiverIds: overrides.caregiverIds ?? ['caregiver_priya'],
    members: overrides.members ?? [
      {
        userId: 'caregiver_priya',
        displayName: 'Priya Sharma',
        email: 'priya@medimate.test',
        role: 'primary',
        permissions: ['read', 'write_schedule', 'receive_alerts'],
        status: 'active',
        invitedAt: new Date(BASE_NOW.getTime()),
        joinedAt: new Date(BASE_NOW.getTime()),
      },
    ],
    inviteCode: overrides.inviteCode ?? 'MED123',
    createdAt: overrides.createdAt ?? new Date(BASE_NOW.getTime()),
    updatedAt: overrides.updatedAt ?? new Date(BASE_NOW.getTime()),
  };
}

export function createMedicationFixture(
  overrides: Partial<MedicationDocument> = {}
): MedicationDocument {
  const id = overrides.id ?? 'med_metformin';
  const patientId = overrides.patientId ?? 'patient_ramesh';
  return {
    id,
    patientId,
    name: overrides.name ?? 'Metformin',
    dosage: overrides.dosage ?? '500 mg',
    instructions: overrides.instructions ?? 'Take with water after breakfast',
    schedule: overrides.schedule ?? {
      times: ['08:00'],
      frequency: 'daily',
      startDate: '2026-11-01',
      endDate: null,
    },
    color: overrides.color ?? '#3B82F6',
    shape: overrides.shape ?? 'capsule',
    active: overrides.active ?? true,
    createdBy: overrides.createdBy ?? 'caregiver_priya',
    createdAt: overrides.createdAt ?? new Date(BASE_NOW.getTime()),
    updatedAt: overrides.updatedAt ?? new Date(BASE_NOW.getTime()),
  };
}

export function createDoseLogFixture(overrides: Partial<DoseLogDocument> = {}): DoseLogDocument {
  const patientId = overrides.patientId ?? 'patient_ramesh';
  const medicationId = overrides.medicationId ?? 'med_metformin';
  const scheduledDate = overrides.scheduledDate ?? '2026-11-25';
  return {
    id: overrides.id ?? `${patientId}_${medicationId}_${scheduledDate}_0800`,
    patientId,
    medicationId,
    medicationName: overrides.medicationName ?? 'Metformin',
    dosage: overrides.dosage ?? '500 mg',
    instructions: overrides.instructions ?? 'Take with water after breakfast',
    color: overrides.color ?? '#3B82F6',
    shape: overrides.shape ?? 'capsule',
    scheduledDate,
    scheduledTime: overrides.scheduledTime ?? new Date(BASE_SCHEDULED.getTime()),
    status: overrides.status ?? 'scheduled',
    snoozeCount: overrides.snoozeCount ?? 0,
    snoozedAt: overrides.snoozedAt ?? null,
    snoozeUntil: overrides.snoozeUntil ?? null,
    takenAt: overrides.takenAt ?? null,
    takenBy: overrides.takenBy ?? null,
    escalatedAt: overrides.escalatedAt ?? null,
    missedAt: overrides.missedAt ?? null,
    followUpSent: overrides.followUpSent ?? false,
    escalationAlertSent: overrides.escalationAlertSent ?? false,
    createdAt: overrides.createdAt ?? new Date(BASE_NOW.getTime()),
    updatedAt: overrides.updatedAt ?? new Date(BASE_NOW.getTime()),
  };
}

export function seedPatientCareCircleScenario(
  db: MockFirestoreDb,
  options: {
    patientId?: string;
    caregiverId?: string;
    unlinkedId?: string;
    doseStatus?: DoseLogDocument['status'];
  } = {}
): {
  patient: UserDocument;
  caregiver: UserDocument;
  unlinked: UserDocument;
  circle: CareCircleDocument;
  medication: MedicationDocument;
  doseLog: DoseLogDocument;
} {
  const patientId = options.patientId ?? 'patient_ramesh';
  const caregiverId = options.caregiverId ?? 'caregiver_priya';
  const unlinkedId = options.unlinkedId ?? 'caregiver_stranger';

  const patient = createUserFixture({
    uid: patientId,
    displayName: 'Ramesh Sharma',
    role: 'elderly',
  });
  const caregiver = createUserFixture({
    uid: caregiverId,
    displayName: 'Priya Sharma',
    role: 'caregiver',
  });
  const unlinked = createUserFixture({
    uid: unlinkedId,
    displayName: 'Unlinked User',
    role: 'caregiver',
  });
  const circle = createCareCircleFixture({
    id: patientId,
    patientId,
    patientName: patient.displayName,
    caregiverIds: [caregiverId],
    members: [
      {
        userId: caregiverId,
        displayName: caregiver.displayName,
        email: caregiver.email,
        role: 'primary',
        permissions: ['read', 'write_schedule', 'receive_alerts'],
        status: 'active',
        invitedAt: new Date(BASE_NOW.getTime()),
        joinedAt: new Date(BASE_NOW.getTime()),
      },
    ],
  });
  const medication = createMedicationFixture({
    id: 'med_metformin',
    patientId,
    createdBy: caregiverId,
  });
  const doseLog = createDoseLogFixture({
    id: `${patientId}_med_metformin_2026-11-25_0800`,
    patientId,
    medicationId: medication.id,
    status: options.doseStatus ?? 'due',
  });

  db.seedDoc('users', patient.uid, patient);
  db.seedDoc('users', caregiver.uid, caregiver);
  db.seedDoc('users', unlinked.uid, unlinked);
  db.seedDoc('care_circles', circle.id, circle);
  db.seedDoc('medications', medication.id, medication);
  db.seedDoc('dose_logs', doseLog.id, doseLog);

  return { patient, caregiver, unlinked, circle, medication, doseLog };
}
