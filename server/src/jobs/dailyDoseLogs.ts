import * as admin from 'firebase-admin';

export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const BATCH_LIMIT = 500;

export interface MedicationSchedule {
  times: string[];
  frequency: 'daily' | 'specific_days';
  daysOfWeek?: number[];
  startDate: string;
  endDate?: string | null;
}

export interface MedicationDoc {
  id: string;
  patientId: string;
  name: string;
  dosage: string;
  instructions?: string;
  schedule: MedicationSchedule;
  color?: string;
  shape?: string;
  active: boolean;
}

export interface GenerateDailyDoseLogsResult {
  targetDate: string;
  createdCount: number;
  skippedCount: number;
}

/**
 * Validates YYYY-MM-DD syntax and rejects calendar rollovers (e.g. 2026-02-30).
 */
export function parseValidatedDateString(dateStr: string): {
  year: number;
  month: number;
  day: number;
} {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!dateMatch) {
    throw new Error(`Invalid targetDate "${dateStr}": expected YYYY-MM-DD`);
  }

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);

  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() !== month - 1 ||
    utcDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid targetDate "${dateStr}": non-existent calendar date`);
  }

  return { year, month, day };
}

/**
 * Computes the current calendar date string (YYYY-MM-DD) in IST (UTC+05:30).
 */
export function computeISTDateString(now: Date = new Date()): string {
  const nowIST = new Date(now.getTime() + IST_OFFSET_MS);
  const year = nowIST.getUTCFullYear();
  const month = String(nowIST.getUTCMonth() + 1).padStart(2, '0');
  const day = String(nowIST.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Converts an IST wall-clock date (YYYY-MM-DD) and time (HH:mm) into the
 * corresponding UTC Date instant (UTC = IST - 05:30).
 */
export function computeISTScheduledTimestamp(dateStr: string, hhmm: string): Date {
  const { year, month, day } = parseValidatedDateString(dateStr);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!timeMatch) {
    throw new Error(`Invalid time "${hhmm}": expected HH:mm`);
  }

  const hh = Number(timeMatch[1]);
  const mm = Number(timeMatch[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    throw new Error(`Invalid time "${hhmm}": hours must be 00-23 and minutes 00-59`);
  }

  return new Date(Date.UTC(year, month - 1, day, hh, mm, 0, 0) - IST_OFFSET_MS);
}

/**
 * Idempotently generates dose_logs documents for all active medications
 * scheduled on targetDate (IST). Writes are committed in chunks <= 500.
 */
export async function generateForDate(
  db: admin.firestore.Firestore,
  targetDate: string
): Promise<GenerateDailyDoseLogsResult> {
  const { year, month, day } = parseValidatedDateString(targetDate);
  const targetDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const medsSnap = await db
    .collection('medications')
    .where('active', '==', true)
    .get();

  const medications: MedicationDoc[] = medsSnap.docs.map((docSnap: admin.firestore.QueryDocumentSnapshot) => ({
    id: docSnap.id,
    ...(docSnap.data() as Omit<MedicationDoc, 'id'>),
  }));

  let createdCount = 0;
  let skippedCount = 0;
  const seenDoseIds = new Set<string>();
  const pendingWrites: Array<{
    docId: string;
    data: admin.firestore.DocumentData;
  }> = [];

  for (const med of medications) {
    if (!med.schedule || !Array.isArray(med.schedule.times)) {
      continue;
    }
    if (med.schedule.startDate > targetDate) continue;
    if (med.schedule.endDate && med.schedule.endDate < targetDate) continue;
    if (
      med.schedule.frequency === 'specific_days' &&
      (!Array.isArray(med.schedule.daysOfWeek) ||
        !med.schedule.daysOfWeek.includes(targetDayOfWeek))
    ) {
      continue;
    }

    for (const timeStr of med.schedule.times) {
      const scheduledTime = computeISTScheduledTimestamp(targetDate, timeStr);
      const timeKey = timeStr.replace(':', '');
      const doseId = `${med.patientId}_${med.id}_${targetDate}_${timeKey}`;

      if (seenDoseIds.has(doseId)) {
        skippedCount += 1;
        continue;
      }
      seenDoseIds.add(doseId);

      const existing = await db.collection('dose_logs').doc(doseId).get();
      if (existing.exists) {
        skippedCount += 1;
        continue;
      }

      pendingWrites.push({
        docId: doseId,
        data: {
          patientId: med.patientId,
          medicationId: med.id,
          medicationName: med.name,
          dosage: med.dosage,
          instructions: med.instructions ?? '',
          color: med.color ?? '#0D9488',
          shape: med.shape ?? 'round',
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

  for (let i = 0; i < pendingWrites.length; i += BATCH_LIMIT) {
    const chunk = pendingWrites.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const { docId, data } of chunk) {
      batch.set(db.collection('dose_logs').doc(docId), data);
      createdCount += 1;
    }
    await batch.commit();
  }

  return { targetDate, createdCount, skippedCount };
}
