import * as admin from 'firebase-admin';
import {
  computeDateStringInTimezone,
  DEFAULT_TIMEZONE,
  resolveValidTimezone,
} from './dailyDoseLogs';

export const BATCH_LIMIT = 500;
export const NON_TERMINAL_STATUSES = [
  'scheduled',
  'due',
  'snoozed',
  'unconfirmed',
] as const;

export interface CloseMissedDosesOptions {
  targetTimezones?: Set<string>;
}

export interface CloseMissedDosesResult {
  closedCount: number;
  skippedCount: number;
  missedIds: string[];
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
      const nanos =
        typeof maybeTimestamp.nanoseconds === 'number'
          ? maybeTimestamp.nanoseconds
          : 0;
      return Math.floor(maybeTimestamp.seconds * 1000 + nanos / 1e6);
    }
  }
  return null;
}

/**
 * Transitions unresolved non-terminal doses whose scheduled calendar date
 * precedes the patient's local today (`doseDate < patientLocalToday` and
 * `scheduledTimeMs < nowMs`) to `status: 'missed'` with `missedAt`.
 */
export async function closeMissedDoses(
  db: admin.firestore.Firestore,
  now: Date = new Date(),
  options: CloseMissedDosesOptions = {}
): Promise<CloseMissedDosesResult> {
  const nowMs = now.getTime();
  const doseSnap = await db
    .collection('dose_logs')
    .where('status', 'in', [...NON_TERMINAL_STATUSES])
    .get();

  const patientContext = new Map<string, { timezone: string; localToday: string }>();
  const getPatientContext = async (
    patientId: unknown
  ): Promise<{ timezone: string; localToday: string }> => {
    const key = typeof patientId === 'string' && patientId.length > 0 ? patientId : '';
    const cached = patientContext.get(key);
    if (cached) {
      return cached;
    }

    let timezone = DEFAULT_TIMEZONE;
    if (key.length > 0) {
      const userSnap = await db.collection('users').doc(key).get();
      if (userSnap.exists) {
        const userData = userSnap.data() as { timezone?: unknown } | undefined;
        timezone = resolveValidTimezone(userData?.timezone, DEFAULT_TIMEZONE);
      }
    }

    const ctx = {
      timezone,
      localToday: computeDateStringInTimezone(now, timezone),
    };
    patientContext.set(key, ctx);
    return ctx;
  };

  let closedCount = 0;
  let skippedCount = 0;
  const missedIds: string[] = [];
  const pendingUpdates: Array<{
    ref: admin.firestore.DocumentReference;
    patch: Record<string, unknown>;
  }> = [];

  for (const snap of doseSnap.docs) {
    const data = snap.data() as {
      patientId?: unknown;
      scheduledDate?: unknown;
      scheduledTime?: unknown;
    };
    const ctx = await getPatientContext(data.patientId);

    if (options.targetTimezones && !options.targetTimezones.has(ctx.timezone)) {
      skippedCount += 1;
      continue;
    }

    const scheduledTimeMs = toMillis(data.scheduledTime);
    const doseDate =
      typeof data.scheduledDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(data.scheduledDate)
        ? data.scheduledDate
        : scheduledTimeMs !== null
          ? computeDateStringInTimezone(new Date(scheduledTimeMs), ctx.timezone)
          : null;

    if (
      doseDate !== null &&
      scheduledTimeMs !== null &&
      doseDate < ctx.localToday &&
      scheduledTimeMs < nowMs
    ) {
      missedIds.push(snap.id);
      pendingUpdates.push({
        ref: snap.ref,
        patch: {
          status: 'missed',
          missedAt: admin.firestore.FieldValue.serverTimestamp(),
          snoozeUntil: null,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      });
    } else {
      skippedCount += 1;
    }
  }

  for (let i = 0; i < pendingUpdates.length; i += BATCH_LIMIT) {
    const chunk = pendingUpdates.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const { ref, patch } of chunk) {
      batch.update(ref, patch);
      closedCount += 1;
    }
    await batch.commit();
  }

  return { closedCount, skippedCount, missedIds };
}
