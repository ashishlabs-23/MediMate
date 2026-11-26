import * as admin from 'firebase-admin';

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';
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

export interface GenerateDailyDoseLogsOptions {
  targetTimezones?: Set<string>;
}

export interface GenerateDailyDoseLogsResult {
  targetDate: string;
  createdCount: number;
  skippedCount: number;
}

export interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
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
 * Validates an IANA timezone string using Intl.DateTimeFormat and returns
 * the trimmed valid timezone or `fallback` ('Asia/Kolkata') if missing/invalid.
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
 * Computes the current calendar date string (YYYY-MM-DD) in `timeZone`.
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
 * into the corresponding UTC Date instant using two-pass Intl offset resolution.
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
 * Computes the current calendar date string (YYYY-MM-DD) in IST (Asia/Kolkata).
 */
export function computeISTDateString(now: Date = new Date()): string {
  return computeDateStringInTimezone(now, DEFAULT_TIMEZONE);
}

/**
 * Converts an IST wall-clock date (YYYY-MM-DD) and time (HH:mm) into the
 * corresponding UTC Date instant (UTC = IST - 05:30).
 */
export function computeISTScheduledTimestamp(dateStr: string, hhmm: string): Date {
  return computeScheduledTimestampInTimezone(dateStr, hhmm, DEFAULT_TIMEZONE);
}

/**
 * Collects distinct valid IANA timezones across `users` documents, always
 * including `DEFAULT_TIMEZONE` if `users` is empty or any user lacks a valid timezone.
 */
export async function getActivePatientTimezones(
  db: admin.firestore.Firestore
): Promise<string[]> {
  const usersSnap = await db.collection('users').get();
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
 * Idempotently generates dose_logs documents for all active medications
 * scheduled on targetDate using each patient's configured IANA timezone
 * (defaulting to 'Asia/Kolkata'). Writes are committed in chunks <= 500.
 */
export async function generateForDate(
  db: admin.firestore.Firestore,
  targetDate: string,
  options: GenerateDailyDoseLogsOptions = {}
): Promise<GenerateDailyDoseLogsResult> {
  const { year, month, day } = parseValidatedDateString(targetDate);
  const targetDayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  const medsSnap = await db
    .collection('medications')
    .where('active', '==', true)
    .get();

  const medications: MedicationDoc[] = medsSnap.docs.map(
    (docSnap: admin.firestore.QueryDocumentSnapshot) => ({
      id: docSnap.id,
      ...(docSnap.data() as Omit<MedicationDoc, 'id'>),
    })
  );

  const patientTimezones = new Map<string, string>();
  const resolvePatientTimezone = async (patientId: string): Promise<string> => {
    const cached = patientTimezones.get(patientId);
    if (cached !== undefined) {
      return cached;
    }
    let resolved = DEFAULT_TIMEZONE;
    if (typeof patientId === 'string' && patientId.length > 0) {
      const userSnap = await db.collection('users').doc(patientId).get();
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
