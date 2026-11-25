/**
 * mockData.ts — Default demonstration data for offline/demo evaluation.
 * Guarantees zero "permission-denied" errors when exploring the application.
 */

import { Timestamp } from 'firebase/firestore';
import type {
  CareCircleDocument,
  DoseLogDocument,
  MedicationDocument,
} from '../types/firestore';
import type { DoseStatus } from '../types/dose';

export function getMockCareCircle(patientId = 'patient_ramesh'): CareCircleDocument {
  return {
    id: patientId,
    patientId,
    patientName: 'Ramesh Sharma',
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
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

export function getMockMedications(patientId = 'patient_ramesh'): MedicationDocument[] {
  const now = Timestamp.now();
  return [
    {
      id: `${patientId}_med_metformin`,
      patientId,
      name: 'Metformin',
      dosage: '500 mg',
      instructions: 'Take with a full glass of water after breakfast',
      schedule: {
        times: ['08:00'],
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: null,
      },
      color: '#2563EB',
      shape: 'capsule',
      active: true,
      createdBy: patientId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${patientId}_med_amlodipine`,
      patientId,
      name: 'Amlodipine',
      dosage: '5 mg',
      instructions: 'Take with water after lunch',
      schedule: {
        times: ['14:00'],
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: null,
      },
      color: '#059669',
      shape: 'round',
      active: true,
      createdBy: patientId,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: `${patientId}_med_atorvastatin`,
      patientId,
      name: 'Atorvastatin',
      dosage: '20 mg',
      instructions: 'Take at bedtime with water',
      schedule: {
        times: ['20:00'],
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: null,
      },
      color: '#D97706',
      shape: 'oval',
      active: true,
      createdBy: patientId,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export function getMockDoses(date: string, isCaregiver = false): DoseLogDocument[] {
  const [y, m, d] = date.split('-').map(Number);

  return [
    {
      id: `dose_metformin_${date}_0800`,
      patientId: 'patient_ramesh',
      medicationId: 'med_metformin',
      medicationName: 'Metformin',
      dosage: '500 mg',
      instructions: 'Take with a full glass of water after breakfast',
      color: '#2563EB',
      shape: 'capsule',
      scheduledDate: date,
      scheduledTime: Timestamp.fromDate(new Date(y, m - 1, d, 8, 0, 0)),
      // For caregiver demo: mark unconfirmed so the urgent alert banner is active!
      // For elderly demo: mark due so they can test the giant Taken/Snooze buttons!
      status: isCaregiver ? 'unconfirmed' : 'due',
      snoozeCount: 0,
      snoozedAt: null,
      snoozeUntil: null,
      takenAt: null,
      takenBy: null,
      escalatedAt: isCaregiver ? Timestamp.fromDate(new Date(y, m - 1, d, 8, 30, 0)) : null,
      missedAt: null,
      followUpSent: true,
      escalationAlertSent: isCaregiver,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    {
      id: `dose_amlodipine_${date}_1400`,
      patientId: 'patient_ramesh',
      medicationName: 'Amlodipine',
      medicationId: 'med_amlodipine',
      dosage: '5 mg',
      instructions: 'Take with water after lunch',
      color: '#059669',
      shape: 'round',
      scheduledDate: date,
      scheduledTime: Timestamp.fromDate(new Date(y, m - 1, d, 14, 0, 0)),
      status: isCaregiver ? 'taken' : 'scheduled',
      snoozeCount: 0,
      snoozedAt: null,
      snoozeUntil: null,
      takenAt: isCaregiver ? Timestamp.fromDate(new Date(y, m - 1, d, 14, 2, 0)) : null,
      takenBy: isCaregiver ? 'patient_ramesh' : null,
      escalatedAt: null,
      missedAt: null,
      followUpSent: false,
      escalationAlertSent: false,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    {
      id: `dose_atorvastatin_${date}_2000`,
      patientId: 'patient_ramesh',
      medicationId: 'med_atorvastatin',
      medicationName: 'Atorvastatin',
      dosage: '20 mg',
      instructions: 'Take at bedtime with water',
      color: '#D97706',
      shape: 'oval',
      scheduledDate: date,
      scheduledTime: Timestamp.fromDate(new Date(y, m - 1, d, 20, 0, 0)),
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
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
  ];
}

export function getMockDoseLogsForRange(
  patientId = 'patient_ramesh',
  dates: string[]
): DoseLogDocument[] {
  if (dates.length === 0) return [];

  const meds = getMockMedications(patientId);
  const now = Timestamp.now();
  const logs: DoseLogDocument[] = [];

  dates.forEach((date, dayIdx) => {
    const isLastDay = dayIdx === dates.length - 1;
    if (isLastDay) {
      logs.push(
        ...getMockDoses(date, true).map((d) => ({
          ...d,
          patientId,
        }))
      );
      return;
    }

    const [y, m, d] = date.split('-').map(Number);

    meds.forEach((med, medIdx) => {
      const timeStr = med.schedule.times[0] ?? '08:00';
      const [hh, mm] = timeStr.split(':').map(Number);
      const scheduledDateObj = new Date(y, m - 1, d, hh, mm, 0, 0);

      let status: DoseStatus = 'taken';
      if (dayIdx === 1 && medIdx === 2) {
        status = 'missed';
      } else if (dayIdx === 3 && medIdx === 1) {
        status = 'unconfirmed';
      } else if (dayIdx === 4 && medIdx === 2) {
        status = 'missed';
      }

      logs.push({
        id: `${patientId}_${med.id}_${date}_${timeStr.replace(':', '')}`,
        patientId,
        medicationId: med.id,
        medicationName: med.name,
        dosage: med.dosage,
        instructions: med.instructions,
        color: med.color,
        shape: med.shape,
        scheduledDate: date,
        scheduledTime: Timestamp.fromDate(scheduledDateObj),
        status,
        snoozeCount: 0,
        snoozedAt: null,
        snoozeUntil: null,
        takenAt:
          status === 'taken'
            ? Timestamp.fromDate(new Date(scheduledDateObj.getTime() + 4 * 60000))
            : null,
        takenBy: status === 'taken' ? patientId : null,
        escalatedAt:
          status === 'unconfirmed'
            ? Timestamp.fromDate(new Date(scheduledDateObj.getTime() + 30 * 60000))
            : null,
        missedAt:
          status === 'missed'
            ? Timestamp.fromDate(new Date(scheduledDateObj.getTime() + 120 * 60000))
            : null,
        followUpSent: status !== 'taken',
        escalationAlertSent: status === 'unconfirmed' || status === 'missed',
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  return logs.sort((a, b) => a.scheduledTime.toMillis() - b.scheduledTime.toMillis());
}
