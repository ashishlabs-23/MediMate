/**
 * generateTodayLogs — Client-side replacement for the generateDailyDoseLogs Cloud Function.
 *
 * Runs idempotently on the patient's browser when TodayView or CaregiverDashboard mounts.
 * Creates today's dose_log documents for all active medications that:
 *   - Are not already created (idempotency check via document ID)
 *   - Have started (startDate <= today)
 *   - Have not ended (endDate is null or >= today)
 *   - Are scheduled for today's day-of-week (specific_days frequency)
 *
 * Document ID format: {patientId}_{medicationId}_{YYYY-MM-DD}_{HHmm}
 * e.g. uid123_med456_2026-11-25_0800
 *
 * Uses Firebase SDK v10 modular API (Spark plan compatible — no Cloud Functions needed).
 */

import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import type { MedicationDocument, DoseLogDocument } from '../types/firestore';

const BATCH_LIMIT = 490; // Keep below Firestore 500-write batch limit

/** Returns today's date string in YYYY-MM-DD (local time). */
export function todayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface GenerateResult {
  created: number;
  skipped: number;
}

interface PendingDoseWrite {
  doseId: string;
  data: Omit<DoseLogDocument, 'id'>;
}

function isMedicationScheduledForDate(
  med: MedicationDocument,
  targetDate: string,
  targetDayOfWeek: number
): boolean {
  if (!med.active) return false;
  if (med.schedule.startDate > targetDate) return false;
  if (med.schedule.endDate && med.schedule.endDate < targetDate) return false;
  if (
    med.schedule.frequency === 'specific_days' &&
    (!med.schedule.daysOfWeek || !med.schedule.daysOfWeek.includes(targetDayOfWeek))
  ) {
    return false;
  }
  return true;
}

async function collectPendingWritesForMedication(
  med: MedicationDocument,
  targetDate: string,
  year: number,
  month: number,
  day: number,
  targetDayOfWeek: number
): Promise<{ pendingWrites: PendingDoseWrite[]; skipped: number }> {
  if (!isMedicationScheduledForDate(med, targetDate, targetDayOfWeek)) {
    return { pendingWrites: [], skipped: 0 };
  }

  const pendingWrites: PendingDoseWrite[] = [];
  let skipped = 0;

  for (const timeStr of med.schedule.times) {
    const colonIdx = timeStr.indexOf(':');
    if (colonIdx <= 0) continue;
    const hh = Number(timeStr.slice(0, colonIdx));
    const mm = Number(timeStr.slice(colonIdx + 1));
    if (Number.isNaN(hh) || Number.isNaN(mm)) continue;

    const timeKey = timeStr.replace(':', '');
    const doseId = `${med.patientId}_${med.id}_${targetDate}_${timeKey}`;

    // Idempotency: skip if document already exists
    const existing = await getDoc(doc(collection(db, 'dose_logs'), doseId));
    if (existing.exists()) {
      skipped++;
      continue;
    }

    const scheduledTime = new Date(year, month - 1, day, hh, mm, 0, 0);

    pendingWrites.push({
      doseId,
      data: {
        patientId: med.patientId,
        medicationId: med.id,
        medicationName: med.name,
        dosage: med.dosage,
        instructions: med.instructions ?? '',
        color: med.color ?? '#0D9488',
        shape: med.shape ?? 'round',
        scheduledDate: targetDate,
        scheduledTime: Timestamp.fromDate(scheduledTime),
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
        createdAt: serverTimestamp() as Timestamp,
        updatedAt: serverTimestamp() as Timestamp,
      },
    });
  }

  return { pendingWrites, skipped };
}

async function commitPendingDoseLogs(pendingWrites: PendingDoseWrite[]): Promise<number> {
  let created = 0;
  for (let i = 0; i < pendingWrites.length; i += BATCH_LIMIT) {
    const chunk = pendingWrites.slice(i, i + BATCH_LIMIT);
    const batch = writeBatch(db);
    for (const { doseId, data } of chunk) {
      batch.set(doc(collection(db, 'dose_logs'), doseId), data);
      created++;
    }
    await batch.commit();
  }
  return created;
}

/**
 * Idempotently generates today's dose log documents for a single medication.
 * Returns the number of newly created dose log documents.
 */
export async function generateTodayLogsForMedication(
  medication: MedicationDocument
): Promise<number> {
  if (!medication.active) return 0;

  const targetDate = todayDateString();
  const [year, month, day] = targetDate.split('-').map(Number);
  const targetDayOfWeek = new Date(year, month - 1, day).getDay();

  const { pendingWrites } = await collectPendingWritesForMedication(
    medication,
    targetDate,
    year,
    month,
    day,
    targetDayOfWeek
  );

  return commitPendingDoseLogs(pendingWrites);
}

/**
 * Idempotently generates today's dose log documents for the given patient.
 * Safe to call multiple times — existing documents are never overwritten.
 */
export async function generateTodayLogs(patientId: string): Promise<GenerateResult> {
  const targetDate = todayDateString();
  const [year, month, day] = targetDate.split('-').map(Number);
  // JS Date month is 0-indexed; compute day-of-week in local time
  const targetDayOfWeek = new Date(year, month - 1, day).getDay();

  // Check if ANY medication exists for this patient (regardless of active status)
  // so pausing all medications does not re-seed default sample medications.
  const existingAnyMedSnap = await getDocs(
    query(
      collection(db, 'medications'),
      where('patientId', '==', patientId),
      limit(1)
    )
  );

  // If no medications exist at all for this patient, seed default sample medications
  if (existingAnyMedSnap.empty) {
    const defaultMeds = [
      {
        id: `${patientId}_med_metformin`,
        patientId,
        name: 'Metformin',
        dosage: '500 mg',
        instructions: 'Take with a full glass of water after breakfast',
        schedule: {
          times: ['08:00'],
          frequency: 'daily' as const,
          startDate: '2026-01-01',
          endDate: null,
        },
        color: '#2563EB',
        shape: 'capsule' as const,
        active: true,
        createdBy: patientId,
      },
      {
        id: `${patientId}_med_amlodipine`,
        patientId,
        name: 'Amlodipine',
        dosage: '5 mg',
        instructions: 'Take with water after lunch',
        schedule: {
          times: ['14:00'],
          frequency: 'daily' as const,
          startDate: '2026-01-01',
          endDate: null,
        },
        color: '#059669',
        shape: 'round' as const,
        active: true,
        createdBy: patientId,
      },
      {
        id: `${patientId}_med_atorvastatin`,
        patientId,
        name: 'Atorvastatin',
        dosage: '20 mg',
        instructions: 'Take at bedtime with water',
        schedule: {
          times: ['20:00'],
          frequency: 'daily' as const,
          startDate: '2026-01-01',
          endDate: null,
        },
        color: '#D97706',
        shape: 'oval' as const,
        active: true,
        createdBy: patientId,
      },
    ];

    const seedBatch = writeBatch(db);
    for (const med of defaultMeds) {
      seedBatch.set(doc(collection(db, 'medications'), med.id), {
        ...med,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await seedBatch.commit().catch(() => null);

    // Also seed care circle for caregiver visibility
    const circleDoc = doc(collection(db, 'care_circles'), patientId);
    await setDoc(circleDoc, {
      id: patientId,
      patientId,
      patientName: patientId === 'patient_ramesh' ? 'Ramesh Sharma' : 'Patient',
      caregiverIds: ['caregiver_priya'],
      members: [
        {
          userId: 'caregiver_priya',
          displayName: 'Priya Sharma',
          email: 'priya@medimate.local',
          role: 'primary',
          permissions: ['read', 'write_schedule', 'receive_alerts'],
          status: 'active',
          invitedAt: Timestamp.now(),
        },
      ],
      inviteCode: 'MED-7892',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch(() => null);
  }

  // Load all active medications for this patient
  const medsSnap = await getDocs(
    query(
      collection(db, 'medications'),
      where('patientId', '==', patientId),
      where('active', '==', true)
    )
  );

  if (medsSnap.empty) {
    return { created: 0, skipped: 0 };
  }

  const medications = medsSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<MedicationDocument, 'id'>),
  }));

  let skipped = 0;
  const pendingWrites: PendingDoseWrite[] = [];

  for (const med of medications) {
    const res = await collectPendingWritesForMedication(
      med,
      targetDate,
      year,
      month,
      day,
      targetDayOfWeek
    );
    pendingWrites.push(...res.pendingWrites);
    skipped += res.skipped;
  }

  const created = await commitPendingDoseLogs(pendingWrites);
  return { created, skipped };
}
