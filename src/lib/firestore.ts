/**
 * Typed Firestore helpers for all MediMate collections.
 * Uses Firebase SDK v10 modular imports with FirestoreDataConverter for type safety.
 *
 * Collections:
 *   users        → UserDocument
 *   care_circles → CareCircleDocument
 *   medications  → MedicationDocument
 *   dose_logs    → DoseLogDocument
 */

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type FirestoreDataConverter,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type SnapshotOptions,
  type Unsubscribe,
  type WithFieldValue,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  AccessibilityPreferences,
  CareCircleDocument,
  CareCircleMember,
  DoseLogDocument,
  MedicationDocument,
  UserDocument,
} from '../types/firestore';

// ============================================================================
// Generic converter factories
// ============================================================================

function makeConverter<T extends DocumentData>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: WithFieldValue<T>): DocumentData {
      return data as DocumentData;
    },
    fromFirestore(snap: QueryDocumentSnapshot, options?: SnapshotOptions): T {
      return snap.data(options) as T;
    },
  };
}

function makeIdConverter<T extends DocumentData & { id: string }>(): FirestoreDataConverter<T> {
  return {
    toFirestore(data: WithFieldValue<T>): DocumentData {
      return data as DocumentData;
    },
    fromFirestore(snap: QueryDocumentSnapshot, options?: SnapshotOptions): T {
      return { ...(snap.data(options) as T), id: snap.id };
    },
  };
}

// ============================================================================
// Typed collection references
// ============================================================================

const userConverter = makeConverter<UserDocument>();
const careCircleConverter = makeIdConverter<CareCircleDocument>();
const medicationConverter = makeIdConverter<MedicationDocument>();
const doseLogConverter = makeIdConverter<DoseLogDocument>();

export const usersCol = () => collection(db, 'users').withConverter(userConverter);
export const careCirclesCol = () => collection(db, 'care_circles').withConverter(careCircleConverter);
export const medicationsCol = () => collection(db, 'medications').withConverter(medicationConverter);
export const doseLogsCol = () => collection(db, 'dose_logs').withConverter(doseLogConverter);

// ============================================================================
// User helpers
// ============================================================================

export async function getUserDocument(uid: string): Promise<UserDocument | null> {
  const snap = await getDoc(doc(usersCol(), uid));
  return snap.exists() ? snap.data() : null;
}

export async function upsertUserDocument(
  uid: string,
  data: Omit<UserDocument, 'createdAt' | 'updatedAt'>
): Promise<void> {
  const ref = doc(usersCol(), uid);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(ref, {
      ...data,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(ref, {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    } as WithFieldValue<UserDocument>);
  }
}

export async function updateUserAccessibilityPreferences(
  uid: string,
  accessibilityPreferences: AccessibilityPreferences
): Promise<void> {
  const ref = doc(usersCol(), uid);
  await updateDoc(ref, {
    accessibilityPreferences,
    updatedAt: serverTimestamp(),
  });
}

// ============================================================================
// Care circle helpers
// ============================================================================

export async function getCareCircle(patientId: string): Promise<CareCircleDocument | null> {
  const snap = await getDoc(doc(careCirclesCol(), patientId));
  return snap.exists() ? snap.data() : null;
}

export function subscribeToCareCircle(
  patientId: string,
  callback: (circle: CareCircleDocument | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  return onSnapshot(
    doc(careCirclesCol(), patientId),
    (snap) => callback(snap.exists() ? snap.data() : null),
    onError
  );
}

// ============================================================================
// Medication helpers
// ============================================================================

function sortMedications(meds: MedicationDocument[]): MedicationDocument[] {
  return [...meds].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function getActiveMedications(patientId: string): Promise<MedicationDocument[]> {
  const q = query(medicationsCol(), where('patientId', '==', patientId), where('active', '==', true));
  const snap: QuerySnapshot<MedicationDocument> = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

/**
 * Fetch all medications (active and paused) for a patient.
 */
export async function getMedications(patientId: string): Promise<MedicationDocument[]> {
  const q = query(medicationsCol(), where('patientId', '==', patientId));
  const snap: QuerySnapshot<MedicationDocument> = await getDocs(q);
  return sortMedications(snap.docs.map((d) => d.data()));
}

/**
 * Subscribe to real-time medication updates (active and paused) for a patient.
 */
export function subscribeToMedications(
  patientId: string,
  callback: (meds: MedicationDocument[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(medicationsCol(), where('patientId', '==', patientId));
  return onSnapshot(
    q,
    (snap: QuerySnapshot<MedicationDocument>) => {
      callback(sortMedications(snap.docs.map((d) => d.data())));
    },
    onError
  );
}

/**
 * Create a new medication document in Firestore and return the hydrated document.
 */
export async function createMedication(
  data: Omit<MedicationDocument, 'id' | 'createdAt' | 'updatedAt'>
): Promise<MedicationDocument> {
  const ref = doc(medicationsCol());
  const now = Timestamp.now();
  await setDoc(ref, {
    ...data,
    id: ref.id,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as WithFieldValue<MedicationDocument>);

  return {
    ...data,
    id: ref.id,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Update an existing medication document.
 */
export async function updateMedication(
  medicationId: string,
  patch: Partial<Omit<MedicationDocument, 'id' | 'patientId' | 'createdBy' | 'createdAt'>>
): Promise<void> {
  const ref = doc(medicationsCol(), medicationId);
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Soft-delete / pause or resume a medication by toggling its `active` flag.
 * Preserves historical dose_logs.
 */
export async function setMedicationActive(
  medicationId: string,
  active: boolean
): Promise<void> {
  const ref = doc(medicationsCol(), medicationId);
  await updateDoc(ref, {
    active,
    updatedAt: serverTimestamp(),
  });
}

// ============================================================================
// Dose log helpers
// ============================================================================

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function enumerateDateRange(startDate: string, endDate: string): string[] {
  if (!startDate || !endDate || startDate > endDate) return [];
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const [ey, em, ed] = endDate.split('-').map(Number);
  if (
    Number.isNaN(sy) ||
    Number.isNaN(sm) ||
    Number.isNaN(sd) ||
    Number.isNaN(ey) ||
    Number.isNaN(em) ||
    Number.isNaN(ed)
  ) {
    return [];
  }

  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const dates: string[] = [];

  while (cursor.getTime() <= end.getTime() && dates.length < 62) {
    dates.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

/**
 * Fetch dose logs for a patient across an inclusive YYYY-MM-DD date range.
 * Uses per-date equality queries in parallel so zero composite indexes are required.
 */
export async function getDoseLogsForDateRange(
  patientId: string,
  startDate: string,
  endDate: string
): Promise<DoseLogDocument[]> {
  const dates = enumerateDateRange(startDate, endDate);
  if (dates.length === 0) return [];

  const snapshots = await Promise.all(
    dates.map((date) =>
      getDocs(
        query(
          doseLogsCol(),
          where('patientId', '==', patientId),
          where('scheduledDate', '==', date)
        )
      )
    )
  );

  const logs = snapshots.flatMap((snap) => snap.docs.map((d) => d.data()));
  return logs.sort((a, b) => a.scheduledTime.toMillis() - b.scheduledTime.toMillis());
}

/**
 * Subscribe to real-time dose log updates for a patient on a given date (YYYY-MM-DD).
 * Returns sorted by scheduledTime ascending.
 */
export function subscribeToDoseLogs(
  patientId: string,
  date: string,
  callback: (doses: DoseLogDocument[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(
    doseLogsCol(),
    where('patientId', '==', patientId),
    where('scheduledDate', '==', date)
  );
  return onSnapshot(
    q,
    (snap: QuerySnapshot<DoseLogDocument>) => {
      const doses = snap.docs
        .map((d) => d.data())
        .sort((a, b) => a.scheduledTime.toMillis() - b.scheduledTime.toMillis());
      callback(doses);
    },
    onError
  );
}

/**
 * Update a dose log document with a partial patch.
 * Always stamps updatedAt = serverTimestamp().
 */
export async function updateDoseLog(
  doseLogId: string,
  patch: Partial<Omit<DoseLogDocument, 'id' | 'patientId' | 'createdAt'>>
): Promise<void> {
  const ref = doc(doseLogsCol(), doseLogId);
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Retrieve a single dose log by ID.
 */
export async function getDoseLog(doseLogId: string): Promise<DoseLogDocument | null> {
  const snap = await getDoc(doc(doseLogsCol(), doseLogId));
  return snap.exists() ? snap.data() : null;
}

/**
 * Invite a new member to a patient's care circle.
 * Checks if care_circles/{patientId} exists:
 *   - If it exists, deduplicates existing members case-insensitively by email and updates members + updatedAt.
 *   - If missing, initializes the CareCircleDocument via setDoc.
 */
export async function inviteCareCircleMember(
  patientId: string,
  member: CareCircleMember
): Promise<void> {
  const ref = doc(careCirclesCol(), patientId);
  const snap = await getDoc(ref);
  const normalizedEmail = member.email.trim().toLowerCase();

  if (snap.exists()) {
    const existing = snap.data();
    const existingMembers = Array.isArray(existing.members) ? existing.members : [];
    const filtered = existingMembers.filter(
      (m) => (m.email ?? '').trim().toLowerCase() !== normalizedEmail
    );
    await updateDoc(ref, {
      members: [...filtered, member],
      updatedAt: serverTimestamp(),
    });
    return;
  }

  await setDoc(ref, {
    id: patientId,
    patientId,
    patientName: patientId === 'patient_ramesh' ? 'Ramesh Sharma' : 'Patient',
    caregiverIds: [],
    members: [member],
    inviteCode: 'MED-7892',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as WithFieldValue<CareCircleDocument>);
}
