/**
 * checkDueDosesAndEscalate — Cloud Function (Pub/Sub scheduled cron).
 *
 * Runs every 5 minutes. Evaluates all non-terminal dose_logs using the domain
 * state machine logic. Sends FCM alerts when T, T+15m, or T+30m thresholds pass.
 *
 * Uses Firebase Admin SDK — bypasses Firestore security rules.
 * Never fabricates push notification delivery success.
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

// Local state machine constants (mirror src/domain/intervals.ts for Cloud Functions isolation).
const GENTLE_REMINDER_OFFSET_MS = 15 * 60 * 1000; // 15 min
const ESCALATION_OFFSET_MS = 30 * 60 * 1000;       // 30 min

type DoseStatus = 'scheduled' | 'due' | 'taken' | 'snoozed' | 'unconfirmed' | 'missed';

interface DoseLogData {
  status: DoseStatus;
  patientId: string;
  medicationName: string;
  dosage: string;
  scheduledTime: admin.firestore.Timestamp;
  snoozeCount: number;
  snoozeUntil?: admin.firestore.Timestamp | null;
  escalationAlertSent: boolean;
  followUpSent: boolean;
  takenAt?: admin.firestore.Timestamp | null;
}

interface FCMSendResult {
  doseId: string;
  type: 'initial' | 'gentle' | 'escalation';
  success: boolean;
  error?: string;
}

export const checkDueDosesAndEscalate = onSchedule(
  { schedule: '*/5 * * * *', timeZone: 'UTC' }, // every 5 minutes
  async (): Promise<void> => {
    const firestore = admin.firestore();
    const now = new Date();
    const results = await processDueDoses(firestore, now);
    logger.info('checkDueDosesAndEscalate completed', { results });
  }
);

/**
 * Core logic — extracted for testability.
 */
export async function processDueDoses(
  firestore: admin.firestore.Firestore,
  now: Date
): Promise<{
  escalatedIds: string[];
  gentleReminderIds: string[];
  initialReminderIds: string[];
  fcmResults: FCMSendResult[];
}> {
  const nowMs = now.getTime();
  const escalatedIds: string[] = [];
  const gentleReminderIds: string[] = [];
  const initialReminderIds: string[] = [];
  const fcmResults: FCMSendResult[] = [];

  // Query only non-terminal doses to limit read load.
  const doseSnap = await firestore
    .collection('dose_logs')
    .where('status', 'not-in', ['taken', 'missed'])
    .get();

  const batch = firestore.batch();
  let batchCount = 0;

  for (const snap of doseSnap.docs) {
    const doseId = snap.id;
    const data = snap.data() as DoseLogData;
    const scheduledMs = data.scheduledTime.toMillis();
    const gentleMs = scheduledMs + GENTLE_REMINDER_OFFSET_MS;
    const escalationMs = scheduledMs + ESCALATION_OFFSET_MS;

    // Determine status transitions
    if (nowMs < scheduledMs) {
      // Not yet due — no action
      continue;
    }

    const patch: Partial<DoseLogData> & { updatedAt: admin.firestore.FieldValue } = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // --- T+30m escalation ---
    if (nowMs >= escalationMs && data.status !== 'unconfirmed') {
      patch.status = 'unconfirmed';
      if (!data.escalationAlertSent) {
        patch.escalationAlertSent = true;
        (patch as Record<string, unknown>).escalatedAt = admin.firestore.FieldValue.serverTimestamp();
        escalatedIds.push(doseId);

        // Send escalation FCM alert
        const fcmResult = await sendFCMAlert(firestore, data, 'escalation');
        fcmResults.push({ doseId, type: 'escalation', ...fcmResult });
      }
      batch.update(snap.ref, patch as Record<string, unknown>);
      batchCount++;
      continue;
    }

    // --- T (due) transition ---
    if (data.status === 'scheduled') {
      patch.status = 'due';
      initialReminderIds.push(doseId);
      const fcmResult = await sendFCMAlert(firestore, data, 'initial');
      fcmResults.push({ doseId, type: 'initial', ...fcmResult });
      batch.update(snap.ref, patch as Record<string, unknown>);
      batchCount++;
      continue;
    }

    // --- T+15m gentle reminder (for due / snoozed-expired) ---
    if (nowMs >= gentleMs && !data.followUpSent) {
      // Check snooze status
      const snoozeUntilMs = data.snoozeUntil ? data.snoozeUntil.toMillis() : 0;
      if (data.status === 'snoozed' && nowMs < snoozeUntilMs) {
        // Still actively snoozed — wait for snooze to expire
        continue;
      }
      patch.followUpSent = true;
      gentleReminderIds.push(doseId);
      const fcmResult = await sendFCMAlert(firestore, data, 'gentle');
      fcmResults.push({ doseId, type: 'gentle', ...fcmResult });
      batch.update(snap.ref, patch as Record<string, unknown>);
      batchCount++;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }

  return { escalatedIds, gentleReminderIds, initialReminderIds, fcmResults };
}

/**
 * Looks up the patient's FCM tokens and sends a push notification.
 * Returns success/error — NEVER fabricates delivery confirmation.
 */
async function sendFCMAlert(
  firestore: admin.firestore.Firestore,
  dose: DoseLogData,
  type: 'initial' | 'gentle' | 'escalation'
): Promise<{ success: boolean; error?: string }> {
  try {
    const userSnap = await firestore.collection('users').doc(dose.patientId).get();
    if (!userSnap.exists) {
      return { success: false, error: 'Patient user document not found' };
    }

    const userData = userSnap.data() as { fcmTokens?: string[] };
    const tokens: string[] = [...(userData.fcmTokens ?? [])];

    // On escalation, also gather FCM tokens from linked caregivers in care_circles
    if (type === 'escalation') {
      const circleSnap = await firestore.collection('care_circles').doc(dose.patientId).get();
      if (circleSnap.exists) {
        const circleData = circleSnap.data() as { caregiverIds?: string[] };
        const caregiverIds = circleData.caregiverIds ?? [];
        for (const cgId of caregiverIds) {
          const cgSnap = await firestore.collection('users').doc(cgId).get();
          if (cgSnap.exists) {
            const cgData = cgSnap.data() as { fcmTokens?: string[] };
            if (cgData.fcmTokens) {
              tokens.push(...cgData.fcmTokens);
            }
          }
        }
      }
    }

    const uniqueTokens = Array.from(new Set(tokens));
    if (uniqueTokens.length === 0) {
      return { success: false, error: 'No FCM tokens registered for patient or caregivers' };
    }

    const titleMap: Record<string, string> = {
      initial: `💊 Time for ${dose.medicationName}`,
      gentle: `⏰ Reminder: ${dose.medicationName} is overdue`,
      escalation: `🚨 URGENT: ${dose.medicationName} not taken`,
    };
    const bodyMap: Record<string, string> = {
      initial: `${dose.dosage} — please take now.`,
      gentle: `You haven't confirmed ${dose.dosage} yet. Please take or snooze.`,
      escalation: `${dose.dosage} has not been confirmed. Your caregiver has been notified.`,
    };

    const message: admin.messaging.MulticastMessage = {
      tokens: uniqueTokens,
      notification: {
        title: titleMap[type] ?? `MediMate: ${dose.medicationName}`,
        body: bodyMap[type] ?? 'Please check your medications.',
      },
      data: {
        type,
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

    const response = await admin.messaging().sendEachForMulticast(message);
    const failedCount = response.responses.filter((r) => !r.success).length;

    if (failedCount > 0) {
      logger.warn(`FCM: ${failedCount}/${tokens.length} tokens failed for dose ${dose.medicationName}`);
    }

    return { success: response.successCount > 0 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`FCM send failed: ${message}`);
    return { success: false, error: message };
  }
}
