/**
 * generateDailyDoseLogs — Cloud Function (Pub/Sub scheduled cron).
 *
 * Runs every 30 minutes (0,30 * * * * UTC) to support all whole-hour and
 * half-hour IANA timezones. For each active patient timezone currently in
 * local hour 00, closes past-midnight unresolved doses to 'missed' and
 * idempotently pre-populates today's dose_logs for active medications.
 *
 * Document ID format: {patientId}_{medicationId}_{YYYY-MM-DD}_{HHmm}
 * e.g. patient_ramesh_med_metformin_2026-11-25_0800
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { processMissedDoses } from './closeMissedDoses';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
export const BATCH_LIMIT = 500;

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
  instructions?: string;
  schedule: MedicationSchedule;
  color?: string;
  shape?: string;
  active: boolean;
}

export interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface GenerateDailyDoseLogsOptions {
  targetTimezones?: Set<string>;
}

export interface GenerateDailyDoseLogsResult {
  targetDate: string;
  createdCount: number;
  skippedCount: number;
}

export interface MidnightTimezoneCycleResult {
  midnightTimezones: string[];
  closedCount: number;
  skippedCloseCount: number;
  createdCount: number;
  skippedLogCount: number;
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
 * Validates an IANA timezone string via Intl.DateTimeFormat, returning
 * `fallback` ('Asia/Kolkata') if missing or invalid.
 */
export function resolveValidTimezone(
  timezone?: unknown,
  fallback: string = DEFAULT_TIMEZONE
): string {
  if (typeof timezone !== 'string') {
    return fallback;
  }
  const trimmed = timezone.trim();
  if (!trimmed) {
    return fallback;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
    return trimmed;
  } catch {
    return fallback;
  }
}

/**
 * Extracts wall-clock date/time components for `date` in `timeZone`.
 */
export function getLocalDateTimeParts(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE
): LocalDateTimeParts {
  const validTz = resolveValidTimezone(timeZone);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: validTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour) % 24,
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

/**
 * Returns true if `date` falls within the midnight hour (00:00–00:59) in `timeZone`.
 */
export function isMidnightHourInTimezone(
  date: Date,
  timeZone: string = DEFAULT_TIMEZONE
): boolean {
  return getLocalDateTimeParts(date, timeZone).hour === 0;
}

/**
 * Computes the calendar date string (YYYY-MM-DD) for `now` in `timeZone`.
 */
export function computeDateStringInTimezone(
  now: Date = new Date(),
  timeZone: string = DEFAULT_TIMEZONE
): string {
  const { year, month, day } = getLocalDateTimeParts(now, timeZone);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function getTimezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getLocalDateTimeParts(date, timeZone);
  const asUtcMs = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    0
  );
  const dateSecMs = Math.floor(date.getTime() / 1000) * 1000;
  return asUtcMs - dateSecMs;
}

/**
 * Converts a local wall-clock date (YYYY-MM-DD) and time (HH:mm) in `timeZone`
 * into the corresponding UTC Date instant via two-pass Intl offset resolution.
 */
export function computeScheduledTimestampInTimezone(
  dateStr: string,
  hhmm: string,
  timeZone: string = DEFAULT_TIMEZONE
): Date {
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

  const validTz = resolveValidTimezone(timeZone);
  const utcGuessMs = Date.UTC(year, month - 1, day, hh, mm, 0, 0);
  const offset1 = getTimezoneOffsetMs(new Date(utcGuessMs), validTz);
  const candidate1 = new Date(utcGuessMs - offset1);
  const offset2 = getTimezoneOffsetMs(candidate1, validTz);

  return offset2 !== offset1 ? new Date(utcGuessMs - offset2) : candidate1;
}

/**
 * Backwards-compatible IST calendar date helper.
 */
export function computeISTDateString(now: Date = new Date()): string {
  return computeDateStringInTimezone(now, DEFAULT_TIMEZONE);
}

/**
 * Backwards-compatible IST scheduled timestamp helper.
 */
export function computeISTScheduledTimestamp(dateStr: string, hhmm: string): Date {
  return computeScheduledTimestampInTimezone(dateStr, hhmm, DEFAULT_TIMEZONE);
}

/**
 * Collects distinct valid IANA timezones from `users` documents, always
 * ensuring `DEFAULT_TIMEZONE` is included when `users` is empty or lacks timezone.
 */
export async function getActivePatientTimezones(
  firestore: admin.firestore.Firestore
): Promise<string[]> {
  const usersSnap = await firestore.collection('users').get();
  const timezones = new Set<string>();

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data() as { timezone?: unknown } | undefined;
    timezones.add(resolveValidTimezone(userData?.timezone, DEFAULT_TIMEZONE));
  }

  if (timezones.size === 0) {
    timezones.add(DEFAULT_TIMEZONE);
  }

  return Array.from(timezones);
}

/**
 * Runs the per-timezone midnight cycle: closes past-midnight unresolved doses
 * to 'missed' and generates today's dose logs for timezones in local hour 00.
 */
export async function runMidnightTimezoneCycle(
  firestore: admin.firestore.Firestore,
  now: Date = new Date()
): Promise<MidnightTimezoneCycleResult> {
  const distinctTimezones = await getActivePatientTimezones(firestore);
  const midnightTimezones = distinctTimezones.filter((tz) =>
    isMidnightHourInTimezone(now, tz)
  );

  if (midnightTimezones.length === 0) {
    return {
      midnightTimezones: [],
      closedCount: 0,
      skippedCloseCount: 0,
      createdCount: 0,
      skippedLogCount: 0,
    };
  }

  const closeResult = await processMissedDoses(firestore, now, {
    targetTimezones: new Set(midnightTimezones),
  });

  const timezonesByDate = new Map<string, Set<string>>();
  for (const tz of midnightTimezones) {
    const localDate = computeDateStringInTimezone(now, tz);
    let tzSet = timezonesByDate.get(localDate);
    if (!tzSet) {
      tzSet = new Set<string>();
      timezonesByDate.set(localDate, tzSet);
    }
    tzSet.add(tz);
  }

  let createdCount = 0;
  let skippedLogCount = 0;
  for (const [localDate, tzSet] of timezonesByDate.entries()) {
    const genResult = await generateForDate(firestore, localDate, {
      targetTimezones: tzSet,
    });
    createdCount += genResult.createdCount;
    skippedLogCount += genResult.skippedCount;
  }

  return {
    midnightTimezones,
    closedCount: closeResult.closedCount,
    skippedCloseCount: closeResult.skippedCount,
    createdCount,
    skippedLogCount,
  };
}

export const generateDailyDoseLogs = onSchedule(
  { schedule: '0,30 * * * *', timeZone: 'UTC' },
  async (): Promise<void> => {
    const firestore = admin.firestore();
    const result = await runMidnightTimezoneCycle(firestore, new Date());
    if (result.midnightTimezones.length > 0) {
      logger.info('generateDailyDoseLogs midnight cycle completed', result);
    }
  }
);

/**
 * Core logic — extracted for testability.
 */
export async function generateForDate(
  firestore: admin.firestore.Firestore,
  targetDate: string,
  options: GenerateDailyDoseLogsOptions = {}
): Promise<GenerateDailyDoseLogsResult> {
  const { year, month, day } = parseValidatedDateString(targetDate);
  const targetDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const medsSnap = await firestore
    .collection('medications')
    .where('active', '==', true)
    .get();

  const medications: MedicationDoc[] = medsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<MedicationDoc, 'id'>),
  }));

  const patientTimezones = new Map<string, string>();
  const resolvePatientTimezone = async (patientId: string): Promise<string> => {
    const cached = patientTimezones.get(patientId);
    if (cached !== undefined) {
      return cached;
    }
    let resolved = DEFAULT_TIMEZONE;
    if (typeof patientId === 'string' && patientId.length > 0) {
      const userSnap = await firestore.collection('users').doc(patientId).get();
      if (userSnap.exists) {
        const userData = userSnap.data() as { timezone?: unknown } | undefined;
        resolved = resolveValidTimezone(userData?.timezone, DEFAULT_TIMEZONE);
      }
    }
    patientTimezones.set(patientId, resolved);
    return resolved;
  };

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

    const patientTz = await resolvePatientTimezone(med.patientId);
    if (options.targetTimezones && !options.targetTimezones.has(patientTz)) {
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
      const scheduledTime = computeScheduledTimestampInTimezone(
        targetDate,
        timeStr,
        patientTz
      );
      const timeKey = timeStr.replace(':', '');
      const doseId = `${med.patientId}_${med.id}_${targetDate}_${timeKey}`;

      if (seenDoseIds.has(doseId)) {
        skippedCount += 1;
        continue;
      }
      seenDoseIds.add(doseId);

      // Idempotency check
      const existing = await firestore.collection('dose_logs').doc(doseId).get();
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

  // Commit in batches of <= 500 (Firestore limit)
  for (let i = 0; i < pendingWrites.length; i += BATCH_LIMIT) {
    const chunk = pendingWrites.slice(i, i + BATCH_LIMIT);
    const batch = firestore.batch();
    for (const { docId, data } of chunk) {
      batch.set(firestore.collection('dose_logs').doc(docId), data);
      createdCount += 1;
    }
    await batch.commit();
  }

  return { targetDate, createdCount, skippedCount };
}
