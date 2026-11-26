/**
 * careCircleService — Care circle multi-tenancy, caregiver queries,
 * dynamic invite code generation, and controlled self-join invite redemption.
 */

import {
  Timestamp,
  arrayUnion,
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
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  CareCircleDocument,
  CareCircleMember,
  CareInviteDocument,
} from '../types/firestore';

/**
 * Generates a unique invite code in format MED-XXXXXX using unconfusable alphanumeric characters.
 * Never returns the legacy demo code MED-7892.
 */
export function generateInviteCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  const code = `MED-${suffix}`;
  return code === 'MED-7892' ? 'MED-934812' : code;
}

/**
 * Looks up a care invite record by code (normalized to uppercase/trimmed).
 * Returns null if not found.
 */
export async function lookupCareInvite(
  inviteCode: string
): Promise<CareInviteDocument | null> {
  const normalized = inviteCode.trim().toUpperCase();
  if (!normalized) return null;
  const ref = doc(collection(db, 'care_invites'), normalized);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as CareInviteDocument) : null;
}

/**
 * Creates or updates an active care_invites record matching the patient's care circle.
 */
export async function createOrSyncCareInvite(input: {
  code: string;
  patientId: string;
  patientName: string;
  createdBy: string;
  active?: boolean;
}): Promise<CareInviteDocument> {
  const normalized = input.code.trim().toUpperCase();
  const ref = doc(collection(db, 'care_invites'), normalized);
  const now = Timestamp.now();
  const payload = {
    id: normalized,
    code: normalized,
    patientId: input.patientId,
    patientName: input.patientName,
    createdBy: input.createdBy,
    active: input.active ?? true,
    updatedAt: serverTimestamp(),
  };

  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, payload);
  } else {
    await setDoc(ref, {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }

  return {
    ...payload,
    createdAt: now,
    updatedAt: now,
  } as CareInviteDocument;
}

/**
 * Subscribes to all care circles where the given caregiver is a member.
 */
export function subscribeToCareCirclesForCaregiver(
  caregiverUid: string,
  callback: (circles: CareCircleDocument[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(
    collection(db, 'care_circles'),
    where('caregiverIds', 'array-contains', caregiverUid)
  );
  return onSnapshot(
    q,
    (snap: QuerySnapshot<DocumentData>) => {
      const circles = snap.docs.map((d) => ({
        ...(d.data() as CareCircleDocument),
        id: d.id,
      }));
      callback(circles);
    },
    onError
  );
}

/**
 * Fetches all care circles where the given caregiver is a member.
 */
export async function getCareCirclesForCaregiver(
  caregiverUid: string
): Promise<CareCircleDocument[]> {
  const q = query(
    collection(db, 'care_circles'),
    where('caregiverIds', 'array-contains', caregiverUid)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    ...(d.data() as CareCircleDocument),
    id: d.id,
  }));
}

/**
 * Redeems an invite code for an authenticated caregiver.
 * Complies with firestore.rules `isValidCaregiverSelfJoin` by modifying ONLY:
 *   - caregiverIds
 *   - members
 *   - lastRedeemedInviteCode
 *   - updatedAt
 */
export async function redeemCareInviteCode(
  rawCode: string,
  caregiver: { uid: string; displayName: string; email: string }
): Promise<CareCircleDocument> {
  const normalized = rawCode.trim().toUpperCase();
  if (!/^MED-[A-Z0-9]{4,10}$/.test(normalized)) {
    throw new Error('Invalid invite code format. Expected MED-XXXXXX.');
  }

  const inviteRef = doc(collection(db, 'care_invites'), normalized);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists() || inviteSnap.data().active !== true) {
    throw new Error('Invite code not found or no longer active.');
  }

  const invite = inviteSnap.data();
  const patientId = String(invite.patientId ?? '');
  if (!patientId || patientId === caregiver.uid) {
    throw new Error('Cannot redeem your own patient invite code.');
  }

  const circleRef = doc(collection(db, 'care_circles'), patientId);
  let circle: CareCircleDocument | null = null;
  try {
    const circleSnap = await getDoc(circleRef);
    if (circleSnap.exists()) {
      circle = circleSnap.data() as CareCircleDocument;
      const existingCaregivers = Array.isArray(circle.caregiverIds)
        ? circle.caregiverIds.map(String)
        : [];
      if (existingCaregivers.includes(caregiver.uid)) {
        return { ...circle, id: circleSnap.id };
      }
    }
  } catch {
    // If getDoc is rejected by security rules because the caregiver is not yet in caregiverIds,
    // proceed directly to updateDoc with atomic arrayUnion which satisfies isValidCaregiverSelfJoin().
  }

  const now = Timestamp.now();
  const newMember: CareCircleMember = {
    userId: caregiver.uid,
    displayName: caregiver.displayName || 'Caregiver',
    email: caregiver.email || '',
    role: circle && Array.isArray(circle.caregiverIds) && circle.caregiverIds.length === 0 ? 'primary' : 'secondary',
    permissions: ['read', 'write_schedule', 'receive_alerts'],
    status: 'active',
    invitedAt: now,
    joinedAt: now,
  };

  if (circle) {
    const existingCaregivers = Array.isArray(circle.caregiverIds) ? circle.caregiverIds.map(String) : [];
    const existingMembers = Array.isArray(circle.members) ? circle.members : [];
    await updateDoc(circleRef, {
      caregiverIds: [...existingCaregivers, caregiver.uid],
      members: [...existingMembers, newMember],
      lastRedeemedInviteCode: normalized,
      updatedAt: serverTimestamp(),
    });
  } else {
    await updateDoc(circleRef, {
      caregiverIds: arrayUnion(caregiver.uid),
      members: arrayUnion(newMember),
      lastRedeemedInviteCode: normalized,
      updatedAt: serverTimestamp(),
    });
  }

  // Once updated, the caregiver is authenticated and officially listed in caregiverIds,
  // granting full read permissions under firestore.rules.
  const finalSnap = await getDoc(circleRef);
  if (!finalSnap.exists()) {
    throw new Error('Patient care circle not found.');
  }

  return {
    ...(finalSnap.data() as CareCircleDocument),
    id: finalSnap.id,
  };
}
