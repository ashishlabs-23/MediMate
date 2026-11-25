/**
 * Firestore document TypeScript interfaces for MediMate.
 * Uses Firebase SDK v10 Timestamp type for Firestore timestamps.
 * All collections: users, care_circles, medications, dose_logs
 */

import type { Timestamp } from 'firebase/firestore';
import type { DoseStatus } from './dose';

// ============================================================================
// Shared sub-types
// ============================================================================

export interface AccessibilityPreferences {
  highContrast: boolean;
  largeText: boolean;
  hapticFeedback: boolean;
  soundEnabled: boolean;
}

export type PillShape = 'round' | 'capsule' | 'oval' | 'square';

export type UserRole = 'elderly' | 'caregiver' | 'dual';

export type CareCircleMemberRole = 'primary' | 'secondary';
export type CareCircleMemberStatus = 'active' | 'invited' | 'declined';
export type CareCirclePermission = 'read' | 'write_schedule' | 'receive_alerts';

// ============================================================================
// /users/{uid}
// ============================================================================

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  phoneNumber?: string;
  timezone: string;
  fcmTokens: string[];
  accessibilityPreferences: AccessibilityPreferences;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// /care_circles/{patientId}
// ============================================================================

export interface CareCircleMember {
  userId: string;
  displayName: string;
  email: string;
  role: CareCircleMemberRole;
  permissions: CareCirclePermission[];
  status: CareCircleMemberStatus;
  invitedAt: Timestamp;
  joinedAt?: Timestamp;
}

export interface CareCircleDocument {
  id: string;
  patientId: string;
  patientName: string;
  caregiverIds: string[];
  members: CareCircleMember[];
  inviteCode?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// /medications/{medicationId}
// ============================================================================

export interface MedicationSchedule {
  times: string[]; // HH:mm format
  frequency: 'daily' | 'specific_days';
  daysOfWeek?: number[]; // 0=Sunday … 6=Saturday
  startDate: string; // YYYY-MM-DD
  endDate?: string | null;
}

export interface MedicationDocument {
  id: string;
  patientId: string;
  name: string;
  dosage: string;
  instructions: string;
  schedule: MedicationSchedule;
  color: string; // hex color string
  shape: PillShape;
  active: boolean;
  createdBy: string; // uid of caregiver or patient who created
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ============================================================================
// /dose_logs/{doseLogId}
// ============================================================================

export interface DoseLogDocument {
  id: string;
  patientId: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  instructions?: string;
  color?: string;
  shape?: PillShape;
  scheduledDate: string; // YYYY-MM-DD
  scheduledTime: Timestamp;
  status: DoseStatus;
  snoozeCount: number; // 0 or 1 (MAX_SNOOZE_COUNT = 1)
  snoozedAt?: Timestamp | null;
  snoozeUntil?: Timestamp | null;
  takenAt?: Timestamp | null;
  takenBy?: string | null; // uid
  escalatedAt?: Timestamp | null;
  missedAt?: Timestamp | null;
  followUpSent: boolean;
  escalationAlertSent: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
