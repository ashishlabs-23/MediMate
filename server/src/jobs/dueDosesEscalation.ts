import * as admin from 'firebase-admin';

export const GENTLE_REMINDER_OFFSET_MS = 15 * 60 * 1000;
export const ESCALATION_OFFSET_MS = 30 * 60 * 1000;
export const BATCH_LIMIT = 500;
export const FCM_MULTICAST_LIMIT = 500;

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export type DoseStatus = 'scheduled' | 'due' | 'taken' | 'snoozed' | 'unconfirmed' | 'missed';

export interface DoseLogData {
  status: DoseStatus;
  patientId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: admin.firestore.Timestamp | Date | { seconds: number; nanoseconds?: number };
  snoozeCount: number;
  snoozeUntil?: admin.firestore.Timestamp | Date | { seconds: number; nanoseconds?: number } | null;
  escalationAlertSent: boolean;
  followUpSent: boolean;
  takenAt?: admin.firestore.Timestamp | Date | { seconds: number; nanoseconds?: number } | null;
}

export interface FCMSendResult {
  doseId: string;
  type: 'initial' | 'gentle' | 'escalation';
  success: boolean;
  error?: string;
}

export interface ProcessDueDosesResult {
  escalatedIds: string[];
  gentleReminderIds: string[];
  initialReminderIds: string[];
  fcmResults: FCMSendResult[];
}

function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === 'object') {
    const maybeTimestamp = value as {
      toMillis?: unknown;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof maybeTimestamp.toMillis === 'function') {
      const ms = (maybeTimestamp as { toMillis: () => number }).toMillis();
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof maybeTimestamp.seconds === 'number') {
      const nanos = typeof maybeTimestamp.nanoseconds === 'number' ? maybeTimestamp.nanoseconds : 0;
      return Math.floor(maybeTimestamp.seconds * 1000 + nanos / 1e6);
    }
  }
  return null;
}

function addTokensForOwner(
  tokenOwners: Map<string, Set<string>>,
  uid: string,
  tokens: unknown
): void {
  if (!Array.isArray(tokens)) return;
  for (const token of tokens) {
    if (typeof token !== 'string' || token.length === 0) continue;
    let owners = tokenOwners.get(token);
    if (!owners) {
      owners = new Set<string>();
      tokenOwners.set(token, owners);
    }
    owners.add(uid);
  }
}

/**
 * Evaluates all non-terminal dose_logs at `now` and commits updates in
 * chunks <= 500, dispatching FCM notifications and cleaning stale tokens.
 */
export async function processDueDoses(
  db: admin.firestore.Firestore,
  now: Date = new Date(),
  messaging: admin.messaging.Messaging | null = null
): Promise<ProcessDueDosesResult> {
  const nowMs = now.getTime();
  const escalatedIds: string[] = [];
  const gentleReminderIds: string[] = [];
  const initialReminderIds: string[] = [];
  const fcmResults: FCMSendResult[] = [];

  const doseSnap = await db
    .collection('dose_logs')
    .where('status', 'not-in', ['taken', 'missed'])
    .get();

  const pendingUpdates: Array<{
    ref: admin.firestore.DocumentReference;
    patch: Record<string, unknown>;
  }> = [];

  for (const snap of doseSnap.docs) {
    const doseId = snap.id;
    const data = snap.data() as DoseLogData;
    const scheduledMs = toMillis(data.scheduledTime);
    if (scheduledMs === null || nowMs < scheduledMs) {
      continue;
    }

    const gentleMs = scheduledMs + GENTLE_REMINDER_OFFSET_MS;
    const escalationMs = scheduledMs + ESCALATION_OFFSET_MS;

    // 1. T+30m escalation ceiling overrides scheduled, due, and active snoozed doses
    if (nowMs >= escalationMs) {
      if (data.status !== 'unconfirmed' || !data.escalationAlertSent) {
        const patch: Record<string, unknown> = {
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };
        if (data.status !== 'unconfirmed') {
          patch.status = 'unconfirmed';
          patch.snoozeUntil = null;
        }
        if (!data.escalationAlertSent) {
          patch.escalationAlertSent = true;
          patch.escalatedAt = admin.firestore.FieldValue.serverTimestamp();
          escalatedIds.push(doseId);

          const fcmResult = await sendFCMAlert(db, messaging, doseId, data, 'escalation');
          fcmResults.push({ doseId, type: 'escalation', ...fcmResult });
        }
        pendingUpdates.push({ ref: snap.ref, patch });
      }
      continue;
    }

    // 2. Initial transition: scheduled -> due (also handles missed T+15m tick)
    if (data.status === 'scheduled') {
      const patch: Record<string, unknown> = {
        status: 'due',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (nowMs >= gentleMs && !data.followUpSent) {
        patch.followUpSent = true;
        gentleReminderIds.push(doseId);
        const fcmResult = await sendFCMAlert(db, messaging, doseId, data, 'gentle');
        fcmResults.push({ doseId, type: 'gentle', ...fcmResult });
      } else {
        initialReminderIds.push(doseId);
        const fcmResult = await sendFCMAlert(db, messaging, doseId, data, 'initial');
        fcmResults.push({ doseId, type: 'initial', ...fcmResult });
      }
      pendingUpdates.push({ ref: snap.ref, patch });
      continue;
    }

    // 3. Snoozed doses before T+30m: suppress while active, revert to due on expiry
    if (data.status === 'snoozed') {
      const snoozeUntilMs = toMillis(data.snoozeUntil);
      if (snoozeUntilMs === null || nowMs < snoozeUntilMs) {
        continue;
      }

      const patch: Record<string, unknown> = {
        status: 'due',
        snoozeUntil: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };

      if (nowMs >= gentleMs && !data.followUpSent) {
        patch.followUpSent = true;
        gentleReminderIds.push(doseId);
        const fcmResult = await sendFCMAlert(db, messaging, doseId, data, 'gentle');
        fcmResults.push({ doseId, type: 'gentle', ...fcmResult });
      } else {
        initialReminderIds.push(doseId);
        const fcmResult = await sendFCMAlert(db, messaging, doseId, data, 'initial');
        fcmResults.push({ doseId, type: 'initial', ...fcmResult });
      }
      pendingUpdates.push({ ref: snap.ref, patch });
      continue;
    }

    // 4. Due doses reaching T+15m gentle reminder
    if (data.status === 'due' && nowMs >= gentleMs && !data.followUpSent) {
      const patch: Record<string, unknown> = {
        followUpSent: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      gentleReminderIds.push(doseId);
      const fcmResult = await sendFCMAlert(db, messaging, doseId, data, 'gentle');
      fcmResults.push({ doseId, type: 'gentle', ...fcmResult });
      pendingUpdates.push({ ref: snap.ref, patch });
    }
  }

  for (let i = 0; i < pendingUpdates.length; i += BATCH_LIMIT) {
    const chunk = pendingUpdates.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const { ref, patch } of chunk) {
      batch.update(ref, patch);
    }
    await batch.commit();
  }

  return {
    escalatedIds,
    gentleReminderIds,
    initialReminderIds,
    fcmResults,
  };
}

/**
 * Looks up patient (and caregiver on escalation) FCM tokens, dispatches multicast push,
 * and cleans up unregistered/invalid tokens from users/{uid}.fcmTokens.
 */
async function sendFCMAlert(
  db: admin.firestore.Firestore,
  messaging: admin.messaging.Messaging | null,
  doseId: string,
  dose: DoseLogData,
  type: 'initial' | 'gentle' | 'escalation'
): Promise<{ success: boolean; error?: string }> {
  try {
    const tokenOwners = new Map<string, Set<string>>();

    const userSnap = await db.collection('users').doc(dose.patientId).get();
    if (userSnap.exists) {
      const userData = userSnap.data() as { fcmTokens?: unknown };
      addTokensForOwner(tokenOwners, dose.patientId, userData?.fcmTokens);
    }

    if (type === 'escalation') {
      const circleSnap = await db.collection('care_circles').doc(dose.patientId).get();
      if (circleSnap.exists) {
        const circleData = circleSnap.data() as { caregiverIds?: unknown };
        const caregiverIds = Array.isArray(circleData?.caregiverIds)
          ? circleData.caregiverIds.filter((id): id is string => typeof id === 'string')
          : [];
        for (const cgId of caregiverIds) {
          const cgSnap = await db.collection('users').doc(cgId).get();
          if (cgSnap.exists) {
            const cgData = cgSnap.data() as { fcmTokens?: unknown };
            addTokensForOwner(tokenOwners, cgId, cgData?.fcmTokens);
          }
        }
      }
    }

    if (!userSnap.exists && tokenOwners.size === 0) {
      return { success: false, error: 'Patient user document not found' };
    }

    const uniqueTokens = Array.from(tokenOwners.keys());
    if (uniqueTokens.length === 0) {
      return { success: false, error: 'No FCM tokens registered for patient or caregivers' };
    }

    if (!messaging) {
      return { success: false, error: 'FCM messaging not initialized' };
    }

    const titleMap: Record<'initial' | 'gentle' | 'escalation', string> = {
      initial: `Time for ${dose.medicationName}`,
      gentle: `Reminder: ${dose.medicationName} is overdue`,
      escalation: `URGENT: ${dose.medicationName} not taken`,
    };
    const bodyMap: Record<'initial' | 'gentle' | 'escalation', string> = {
      initial: `${dose.dosage} — please take now.`,
      gentle: `You haven't confirmed ${dose.dosage} yet. Please take or snooze.`,
      escalation: `${dose.dosage} has not been confirmed. Your caregiver has been notified.`,
    };

    let totalSuccessCount = 0;
    let totalFailedCount = 0;
    const badTokensByUid = new Map<string, Set<string>>();

    for (let i = 0; i < uniqueTokens.length; i += FCM_MULTICAST_LIMIT) {
      const tokenChunk = uniqueTokens.slice(i, i + FCM_MULTICAST_LIMIT);
      const message: admin.messaging.MulticastMessage = {
        tokens: tokenChunk,
        notification: {
          title: titleMap[type],
          body: bodyMap[type],
        },
        data: {
          type,
          doseId,
          medicationName: dose.medicationName,
          dosage: dose.dosage,
        },
        android: {
          priority: type === 'escalation' ? 'high' : 'normal',
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1,
            },
          },
        },
      };

      const response = await messaging.sendEachForMulticast(message);
      totalSuccessCount += response.successCount;

      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          totalFailedCount += 1;
          const errorCode = resp.error?.code;
          if (errorCode && INVALID_TOKEN_CODES.has(errorCode)) {
            const badToken = tokenChunk[idx];
            const owners = tokenOwners.get(badToken);
            if (owners) {
              for (const uid of owners) {
                let badSet = badTokensByUid.get(uid);
                if (!badSet) {
                  badSet = new Set<string>();
                  badTokensByUid.set(uid, badSet);
                }
                badSet.add(badToken);
              }
            }
          }
        }
      });
    }

    if (totalFailedCount > 0) {
      console.warn(
        `[dueDosesEscalation] FCM: ${totalFailedCount}/${uniqueTokens.length} tokens failed for dose ${doseId}`
      );
    }

    for (const [uid, badTokensSet] of badTokensByUid.entries()) {
      const badTokens = Array.from(badTokensSet);
      try {
        await db
          .collection('users')
          .doc(uid)
          .update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...badTokens),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      } catch (cleanupErr) {
        const cleanupMsg =
          cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        console.warn(
          `[dueDosesEscalation] Failed to clean stale FCM tokens for user ${uid}: ${cleanupMsg}`
        );
      }
    }

    return {
      success: totalSuccessCount > 0,
      ...(totalFailedCount > 0 && totalSuccessCount === 0
        ? { error: 'All FCM token deliveries failed' }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[dueDosesEscalation] FCM send failed: ${message}`);
    return { success: false, error: message };
  }
}
