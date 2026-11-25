/**
 * generateDailyDoseLogs — Cloud Function (Pub/Sub scheduled cron).
 *
 * Runs daily at midnight IST (UTC+5:30 → 18:30 UTC previous day).
 * Idempotently pre-populates today's dose_logs for all active medications.
 *
 * Document ID format: {patientId}_{medicationId}_{YYYY-MM-DD}_{HHmm}
 * e.g. patient_ramesh_med_metformin_2026-11-25_0800
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

interface MedicationSchedule {
  times: string[];
  frequency: 'daily' | 'specific_days';
  daysOfWeek?: number[];
  startDate: string;
  endDate?: string | null;
}

interface MedicationDoc {
  id: string;
  patientId: string;
  name: string;
  dosage: string;
  instructions: string;
  schedule: MedicationSchedule;
  color: string;
  shape: string;
  active: boolean;
}

const BATCH_LIMIT = 500;

export const generateDailyDoseLogs = onSchedule(
  { schedule: '30 18 * * *', timeZone: 'UTC' }, // 18:30 UTC = 00:00 IST
  async (): Promise<void> => {
    const firestore = admin.firestore();

    // Target date is tomorrow IST (= today UTC+5:30)
    const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const year = nowIST.getUTCFullYear();
    const month = String(nowIST.getUTCMonth() + 1).padStart(2, '0');
    const day = String(nowIST.getUTCDate()).padStart(2, '0');
    const targetDate = `${year}-${month}-${day}`;

    await generateForDate(firestore, targetDate);
    logger.info(`generateDailyDoseLogs: completed for ${targetDate}`);
  }
);

/**
 * Core logic — extracted for testability.
 */
export async function generateForDate(
  firestore: admin.firestore.Firestore,
  targetDate: string
): Promise<{ createdCount: number; skippedCount: number }> {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!dateMatch) {
    throw new Error(`Invalid targetDate "${targetDate}": expected YYYY-MM-DD`);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const targetDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const medsSnap = await firestore
    .collection('medications')
    .where('active', '==', true)
    .get();

  const medications = medsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<MedicationDoc, 'id'>),
  }));

  let createdCount = 0;
  let skippedCount = 0;
  const pendingWrites: Array<{
    docId: string;
    data: admin.firestore.DocumentData;
  }> = [];

  for (const med of medications) {
    if (med.schedule.startDate > targetDate) continue;
    if (med.schedule.endDate && med.schedule.endDate < targetDate) continue;
    if (
      med.schedule.frequency === 'specific_days' &&
      (!med.schedule.daysOfWeek || !med.schedule.daysOfWeek.includes(targetDayOfWeek))
    ) {
      continue;
    }

    for (const timeStr of med.schedule.times) {
      const colonIdx = timeStr.indexOf(':');
      const hh = Number(timeStr.slice(0, colonIdx));
      const mm = Number(timeStr.slice(colonIdx + 1));
      const timeKey = timeStr.replace(':', '');
      const doseId = `${med.patientId}_${med.id}_${targetDate}_${timeKey}`;

      // Idempotency check
      const existing = await firestore.collection('dose_logs').doc(doseId).get();
      if (existing.exists) {
        skippedCount += 1;
        continue;
      }

      const scheduledTime = new Date(Date.UTC(year, month - 1, day, hh, mm, 0, 0));

      pendingWrites.push({
        docId: doseId,
        data: {
          patientId: med.patientId,
          medicationId: med.id,
          medicationName: med.name,
          dosage: med.dosage,
          instructions: med.instructions,
          color: med.color,
          shape: med.shape,
          scheduledDate: targetDate,
          scheduledTime: admin.firestore.Timestamp.fromDate(scheduledTime),
          status: 'scheduled',
          snoozeCount: 0,
          snoozedAt: null,
          snoozeUntil: null,
          takenAt: null,
          takenBy: null,
          escalatedAt: null,
          missedAt: null,
          followUpSent: false,
          escalationAlertSent: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    }
  }

  // Commit in batches of ≤ 500 (Firestore limit)
  for (let i = 0; i < pendingWrites.length; i += BATCH_LIMIT) {
    const chunk = pendingWrites.slice(i, i + BATCH_LIMIT);
    const batch = firestore.batch();
    for (const { docId, data } of chunk) {
      batch.set(firestore.collection('dose_logs').doc(docId), data);
      createdCount += 1;
    }
    await batch.commit();
  }

  return { createdCount, skippedCount };
}
