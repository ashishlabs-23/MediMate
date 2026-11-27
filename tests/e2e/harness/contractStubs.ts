import { AuthContext, MockFirestoreDb, Unsubscribe, UserRole } from './mockFirestore';

// ============================================================================
// 1. State Machine & Operational Interval Contracts (PROJECT.md § 1)
// ============================================================================

export type DoseStatus = 'scheduled' | 'due' | 'taken' | 'snoozed' | 'unconfirmed' | 'missed';

export interface DoseTransitionInput {
  currentStatus: DoseStatus;
  scheduledTime: Date; // Time T
  currentTime: Date;
  snoozeCount: number; // 0 or 1
  snoozeUntil?: Date | null | undefined;
  takenAt?: Date | null | undefined;
  action?: 'tapTaken' | 'tapSnooze' | 'markMissed' | undefined;
}

export interface DoseTransitionResult {
  nextStatus: DoseStatus;
  snoozeCount: number;
  snoozeUntil?: Date | null | undefined;
  takenAt?: Date | null | undefined;
  escalatedAt?: Date | null | undefined;
  missedAt?: Date | null | undefined;
  sendInitialReminder?: boolean | undefined;
  sendGentleReminder?: boolean | undefined;
  sendEscalationAlert?: boolean | undefined;
}

export const SNOOZE_DURATION_MS = 10 * 60 * 1000;
export const GENTLE_REMINDER_OFFSET_MS = 15 * 60 * 1000;
export const ESCALATION_OFFSET_MS = 30 * 60 * 1000;
export const MAX_SNOOZE_COUNT = 1;

const VALID_STATUSES: ReadonlySet<DoseStatus> = new Set([
  'scheduled',
  'due',
  'taken',
  'snoozed',
  'unconfirmed',
  'missed',
]);

function assertValidDate(d: Date, label: string): void {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${label}: expected valid Date`);
  }
}

export function canSnooze(snoozeCount: number, currentStatus: DoseStatus): boolean {
  if (!Number.isInteger(snoozeCount) || snoozeCount < 0) {
    return false;
  }
  return currentStatus === 'due' && snoozeCount < MAX_SNOOZE_COUNT;
}

export function calculateIntervals(scheduledTime: Date): {
  dueTime: Date;
  gentleReminderTime: Date;
  escalationTime: Date;
} {
  assertValidDate(scheduledTime, 'scheduledTime');
  const t = scheduledTime.getTime();
  const dueTime = new Date(t);
  const gentleReminderTime = new Date(t + GENTLE_REMINDER_OFFSET_MS);
  const escalationTime = new Date(t + ESCALATION_OFFSET_MS);
  assertValidDate(gentleReminderTime, 'gentleReminderTime');
  assertValidDate(escalationTime, 'escalationTime');
  return {
    dueTime,
    gentleReminderTime,
    escalationTime,
  };
}

export function evaluateDoseState(input: DoseTransitionInput): DoseTransitionResult {
  if (!VALID_STATUSES.has(input.currentStatus)) {
    throw new Error(`Invalid currentStatus: ${String(input.currentStatus)}`);
  }
  assertValidDate(input.scheduledTime, 'scheduledTime');
  assertValidDate(input.currentTime, 'currentTime');
  if (
    typeof input.snoozeCount !== 'number' ||
    !Number.isInteger(input.snoozeCount) ||
    input.snoozeCount < 0
  ) {
    throw new Error(`Invalid snoozeCount: ${input.snoozeCount}`);
  }

  const nowMs = input.currentTime.getTime();
  const { dueTime, gentleReminderTime, escalationTime } = calculateIntervals(input.scheduledTime);
  const dueMs = dueTime.getTime();
  const gentleMs = gentleReminderTime.getTime();
  const escalationMs = escalationTime.getTime();

  // Explicit confirmation / missed actions take priority when valid
  if (input.action === 'tapTaken') {
    if (input.currentStatus === 'missed') {
      throw new Error('Illegal transition: cannot mark missed dose as taken');
    }
    if (input.currentStatus === 'scheduled' && nowMs < dueMs) {
      throw new Error('Illegal transition: cannot mark scheduled dose as taken before scheduled time T');
    }
    // Idempotent guard: preserve original takenAt when already taken
    if (input.currentStatus === 'taken') {
      return {
        nextStatus: 'taken',
        snoozeCount: input.snoozeCount,
        snoozeUntil: null,
        takenAt: input.takenAt ? new Date(input.takenAt.getTime()) : null,
        escalatedAt: null,
        missedAt: null,
        sendInitialReminder: false,
        sendGentleReminder: false,
        sendEscalationAlert: false,
      };
    }
    return {
      nextStatus: 'taken',
      snoozeCount: input.snoozeCount,
      snoozeUntil: null,
      takenAt: new Date(nowMs),
      escalatedAt: null,
      missedAt: null,
      sendInitialReminder: false,
      sendGentleReminder: false,
      sendEscalationAlert: false,
    };
  }

  if (input.action === 'markMissed') {
    if (input.currentStatus === 'taken') {
      throw new Error('Illegal transition: cannot mark taken dose as missed');
    }
    if (input.currentStatus === 'scheduled' && nowMs < dueMs) {
      throw new Error('Illegal transition: cannot mark scheduled dose as missed before scheduled time T');
    }
    return {
      nextStatus: 'missed',
      snoozeCount: input.snoozeCount,
      snoozeUntil: null,
      takenAt: null,
      escalatedAt: null,
      missedAt: new Date(nowMs),
      sendInitialReminder: false,
      sendGentleReminder: false,
      sendEscalationAlert: false,
    };
  }

  // Terminal states remain immutable under passive time progression or tapSnooze
  if (input.currentStatus === 'taken' || input.currentStatus === 'missed') {
    if (input.action === 'tapSnooze') {
      throw new Error(
        `Illegal transition: snooze disallowed for status "${input.currentStatus}" with snoozeCount=${input.snoozeCount}`
      );
    }
    return {
      nextStatus: input.currentStatus,
      snoozeCount: input.snoozeCount,
      snoozeUntil: null,
      takenAt:
        input.currentStatus === 'taken' && input.takenAt
          ? new Date(input.takenAt.getTime())
          : undefined,
      sendInitialReminder: false,
      sendGentleReminder: false,
      sendEscalationAlert: false,
    };
  }

  // Already escalated
  if (input.currentStatus === 'unconfirmed') {
    if (input.action === 'tapSnooze') {
      throw new Error(
        `Illegal transition: snooze disallowed for status "${input.currentStatus}" with snoozeCount=${input.snoozeCount}`
      );
    }
    return {
      nextStatus: 'unconfirmed',
      snoozeCount: input.snoozeCount,
      snoozeUntil: null,
      sendInitialReminder: false,
      sendGentleReminder: false,
      sendEscalationAlert: false,
    };
  }

  // Clinical safety escalation precedence: T+30m ceiling overrides tapSnooze and active snooze
  if (nowMs >= escalationMs) {
    return {
      nextStatus: 'unconfirmed',
      snoozeCount: input.snoozeCount,
      snoozeUntil: null,
      escalatedAt: new Date(nowMs),
      sendInitialReminder: false,
      sendGentleReminder: false,
      sendEscalationAlert: true,
    };
  }

  if (input.action === 'tapSnooze') {
    const effectiveStatus: DoseStatus =
      input.currentStatus === 'scheduled' && nowMs >= dueMs ? 'due' : input.currentStatus;
    if (!canSnooze(input.snoozeCount, effectiveStatus)) {
      throw new Error(
        `Illegal transition: snooze disallowed for status "${input.currentStatus}" with snoozeCount=${input.snoozeCount}`
      );
    }
    const snoozeUntilMs = nowMs + SNOOZE_DURATION_MS;
    if (snoozeUntilMs < nowMs) {
      throw new Error('Clock skew error: snoozeUntil cannot precede currentTime');
    }
    return {
      nextStatus: 'snoozed',
      snoozeCount: input.snoozeCount + 1,
      snoozeUntil: new Date(snoozeUntilMs),
      takenAt: null,
      escalatedAt: null,
      missedAt: null,
      sendInitialReminder: false,
      sendGentleReminder: false,
      sendEscalationAlert: false,
    };
  }

  // Scheduled -> check if T has arrived
  if (input.currentStatus === 'scheduled') {
    if (nowMs < dueMs) {
      return {
        nextStatus: 'scheduled',
        snoozeCount: input.snoozeCount,
        snoozeUntil: null,
        sendInitialReminder: false,
        sendGentleReminder: false,
        sendEscalationAlert: false,
      };
    }
    return {
      nextStatus: 'due',
      snoozeCount: input.snoozeCount,
      snoozeUntil: null,
      sendInitialReminder: true,
      sendGentleReminder: nowMs >= gentleMs,
      sendEscalationAlert: false,
    };
  }

  // Snoozed -> check snooze expiry (escalation already handled above)
  if (input.currentStatus === 'snoozed') {
    const snoozeUntilMs = input.snoozeUntil instanceof Date ? input.snoozeUntil.getTime() : null;
    if (snoozeUntilMs !== null && nowMs >= snoozeUntilMs) {
      return {
        nextStatus: 'due',
        snoozeCount: input.snoozeCount,
        snoozeUntil: null,
        sendInitialReminder: true,
        sendGentleReminder: nowMs >= gentleMs,
        sendEscalationAlert: false,
      };
    }
    return {
      nextStatus: 'snoozed',
      snoozeCount: input.snoozeCount,
      snoozeUntil: input.snoozeUntil ?? null,
      sendInitialReminder: false,
      sendGentleReminder: nowMs >= gentleMs,
      sendEscalationAlert: false,
    };
  }

  // Due -> gentle reminder at T+15m
  return {
    nextStatus: 'due',
    snoozeCount: input.snoozeCount,
    snoozeUntil: null,
    sendInitialReminder: nowMs >= dueMs,
    sendGentleReminder: nowMs >= gentleMs,
    sendEscalationAlert: false,
  };
}

// ============================================================================
// 2. Firestore Document Schema Contracts (PROJECT.md § 2 & TECH_RULES.md § 5)
// ============================================================================

export interface AccessibilityPreferences {
  highContrast: boolean;
  largeText: boolean;
  hapticFeedback: boolean;
  soundEnabled: boolean;
}

export interface UserDocument {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  phoneNumber?: string;
  timezone: string;
  fcmTokens: string[];
  accessibilityPreferences: AccessibilityPreferences;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

export interface CareCircleMember {
  userId: string;
  displayName: string;
  email: string;
  role: 'primary' | 'secondary';
  permissions: Array<'read' | 'write_schedule' | 'receive_alerts'>;
  status: 'active' | 'invited' | 'declined';
  invitedAt: Date;
  joinedAt?: Date;
}

export interface CareCircleDocument {
  id: string;
  patientId: string;
  patientName: string;
  patientPhone?: string;
  caregiverIds: string[];
  members: CareCircleMember[];
  inviteCode?: string;
  lastRedeemedInviteCode?: string;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

export interface MedicationSchedule {
  times: string[];
  frequency: 'daily' | 'specific_days';
  daysOfWeek?: number[];
  startDate: string;
  endDate?: string | null;
}

export interface MedicationDocument {
  id: string;
  patientId: string;
  name: string;
  dosage: string;
  instructions: string;
  schedule: MedicationSchedule;
  color: string;
  shape: 'round' | 'capsule' | 'oval' | 'square';
  active: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

export interface DoseLogDocument {
  id: string;
  patientId: string;
  medicationId: string;
  medicationName: string;
  dosage: string;
  instructions?: string;
  color?: string;
  shape?: 'round' | 'capsule' | 'oval' | 'square';
  scheduledDate: string;
  scheduledTime: Date;
  status: DoseStatus;
  snoozeCount: number;
  snoozedAt?: Date | null;
  snoozeUntil?: Date | null;
  takenAt?: Date | null;
  takenBy?: string | null;
  escalatedAt?: Date | null;
  missedAt?: Date | null;
  followUpSent: boolean;
  escalationAlertSent: boolean;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

// ============================================================================
// 3. Authentication & Multi-Role Profile Contracts (F02)
// ============================================================================

export const VALID_USER_ROLES: ReadonlySet<UserRole> = new Set(['elderly', 'caregiver', 'dual']);

export interface CreateUserProfileInput {
  uid: string;
  email: string;
  displayName: string;
  role: unknown;
  timezone?: string;
  phoneNumber?: string;
  accessibilityPreferences?: Partial<AccessibilityPreferences>;
}

export function createUserProfile(
  input: CreateUserProfileInput,
  now: Date = new Date()
): UserDocument {
  if (!input.uid || input.uid.trim() === '') {
    throw new Error('Invalid uid: uid must be non-empty');
  }
  if (!input.displayName || input.displayName.trim() === '') {
    throw new Error('Invalid displayName: displayName must be non-empty');
  }
  if (input.displayName.length > 256) {
    throw new Error('Invalid displayName: exceeds 256 characters');
  }
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new Error(`Invalid email format: ${String(input.email)}`);
  }
  if (typeof input.role !== 'string' || !VALID_USER_ROLES.has(input.role as UserRole)) {
    throw new Error(`Invalid role "${String(input.role)}": must be elderly, caregiver, or dual`);
  }

  return {
    uid: input.uid.trim(),
    email: input.email.trim(),
    displayName: input.displayName.trim(),
    role: input.role as UserRole,
    ...(input.phoneNumber !== undefined ? { phoneNumber: input.phoneNumber } : {}),
    timezone: input.timezone?.trim() || 'UTC',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: input.accessibilityPreferences?.highContrast ?? false,
      largeText: input.accessibilityPreferences?.largeText ?? true,
      hapticFeedback: input.accessibilityPreferences?.hapticFeedback ?? true,
      soundEnabled: input.accessibilityPreferences?.soundEnabled ?? true,
    },
    createdAt: new Date(now.getTime()),
    updatedAt: new Date(now.getTime()),
  };
}

export type AppViewRoute = 'ElderlySimpleView' | 'CaregiverDashboardView' | 'DualViewSwitcher';

export function resolveViewForRole(role: unknown): AppViewRoute {
  switch (role) {
    case 'elderly':
      return 'ElderlySimpleView';
    case 'caregiver':
      return 'CaregiverDashboardView';
    case 'dual':
      return 'DualViewSwitcher';
    default:
      throw new Error(`Cannot resolve view route for invalid role: ${String(role)}`);
  }
}

// ============================================================================
// 4. Client UI & Real-Time Firestore Service Contracts (PROJECT.md § 3)
// ============================================================================

export interface DoseServiceContract {
  subscribeToDoseLogs: (
    patientId: string,
    date: string,
    callback: (doses: DoseLogDocument[]) => void,
    onError?: (err: Error) => void
  ) => Unsubscribe;
  confirmDoseTaken: (doseLogId: string, userId: string, now?: Date) => Promise<void>;
  snoozeDose: (doseLogId: string, now?: Date) => Promise<void>;
  subscribeToCareCircle: (
    patientId: string,
    callback: (circle: CareCircleDocument | null) => void,
    onError?: (err: Error) => void
  ) => Unsubscribe;
}

export function createDoseService(
  db: MockFirestoreDb,
  getAuth: () => AuthContext | null
): DoseServiceContract {
  return {
    subscribeToDoseLogs(
      patientId: string,
      date: string,
      callback: (doses: DoseLogDocument[]) => void,
      onError?: (err: Error) => void
    ): Unsubscribe {
      return db.subscribe<DoseLogDocument>(
        'dose_logs',
        (doc) => doc.patientId === patientId && doc.scheduledDate === date,
        (docs) => {
          const sorted = [...docs].sort(
            (a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
          );
          callback(sorted);
        },
        getAuth(),
        onError,
        patientId
      );
    },

    async confirmDoseTaken(doseLogId: string, userId: string, now: Date = new Date()): Promise<void> {
      const auth = getAuth();
      const existing = db.getDoc<DoseLogDocument>('dose_logs', doseLogId, auth);
      if (!existing) {
        throw new Error(`Dose log "${doseLogId}" not found`);
      }
      // Idempotent guard: preserve original takenAt & takenBy if already taken
      if (existing.status === 'taken') {
        return;
      }

      const result = evaluateDoseState({
        currentStatus: existing.status,
        scheduledTime: new Date(existing.scheduledTime),
        currentTime: now,
        snoozeCount: existing.snoozeCount,
        snoozeUntil: existing.snoozeUntil ? new Date(existing.snoozeUntil) : null,
        action: 'tapTaken',
      });

      db.updateDoc<DoseLogDocument>(
        'dose_logs',
        doseLogId,
        {
          status: result.nextStatus,
          takenAt: result.takenAt ?? now,
          takenBy: userId,
          snoozeUntil: null,
          updatedAt: now,
        },
        auth
      );
    },

    async snoozeDose(doseLogId: string, now: Date = new Date()): Promise<void> {
      const auth = getAuth();
      const existing = db.getDoc<DoseLogDocument>('dose_logs', doseLogId, auth);
      if (!existing) {
        throw new Error(`Dose log "${doseLogId}" not found`);
      }

      const result = evaluateDoseState({
        currentStatus: existing.status,
        scheduledTime: new Date(existing.scheduledTime),
        currentTime: now,
        snoozeCount: existing.snoozeCount,
        snoozeUntil: existing.snoozeUntil ? new Date(existing.snoozeUntil) : null,
        action: 'tapSnooze',
      });

      if (result.nextStatus === 'unconfirmed') {
        // R1 client-side fix: at T+30m client writes status: 'unconfirmed' & snoozeUntil: null ONLY;
        // backend/Functions escalation sends caregiver FCM and sets escalationAlertSent: true / escalatedAt.
        db.updateDoc<DoseLogDocument>(
          'dose_logs',
          doseLogId,
          {
            status: 'unconfirmed',
            snoozeUntil: null,
            updatedAt: now,
          },
          auth
        );
        throw new Error('Illegal transition: snooze disallowed past T+30m escalation deadline');
      }

      db.updateDoc<DoseLogDocument>(
        'dose_logs',
        doseLogId,
        {
          status: result.nextStatus,
          snoozeCount: result.snoozeCount,
          snoozedAt: now,
          snoozeUntil: result.snoozeUntil ?? new Date(now.getTime() + SNOOZE_DURATION_MS),
          updatedAt: now,
        },
        auth
      );
    },

    subscribeToCareCircle(
      patientId: string,
      callback: (circle: CareCircleDocument | null) => void,
      onError?: (err: Error) => void
    ): Unsubscribe {
      return db.subscribe<CareCircleDocument>(
        'care_circles',
        (doc) => doc.patientId === patientId,
        (docs) => callback(docs[0] ?? null),
        getAuth(),
        onError
      );
    },
  };
}

// ============================================================================
// 5. Cloud Functions Contracts (F10)
// ============================================================================

export function generateDailyDoseLogs(
  db: MockFirestoreDb,
  targetDate: string,
  now: Date = new Date()
): { createdCount: number; skippedCount: number; createdIds: string[]; batchCount: number } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(targetDate);
  if (!dateMatch) {
    throw new Error(`Invalid targetDate "${targetDate}": expected YYYY-MM-DD`);
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const checkDate = new Date(Date.UTC(year, month - 1, day));
  if (
    checkDate.getUTCFullYear() !== year ||
    checkDate.getUTCMonth() !== month - 1 ||
    checkDate.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date "${targetDate}"`);
  }

  const medications = db.inspectCollection<MedicationDocument>('medications');
  const targetDayOfWeek = checkDate.getUTCDay();

  const pendingWrites: DoseLogDocument[] = [];
  let skippedCount = 0;

  for (const med of medications) {
    if (!med.active) continue;
    if (med.schedule.startDate > targetDate) continue;
    if (med.schedule.endDate && med.schedule.endDate < targetDate) continue;
    if (
      med.schedule.frequency === 'specific_days' &&
      (!med.schedule.daysOfWeek || !med.schedule.daysOfWeek.includes(targetDayOfWeek))
    ) {
      continue;
    }

    for (const timeStr of med.schedule.times) {
      const [hh, mm] = timeStr.split(':').map(Number);
      const doseId = `${med.patientId}_${med.id}_${targetDate}_${timeStr.replace(':', '')}`;
      const existing = db.inspectDoc<DoseLogDocument>('dose_logs', doseId);
      if (existing) {
        skippedCount += 1;
        continue;
      }

      const scheduledTime = new Date(Date.UTC(year, month - 1, day, hh, mm, 0, 0));
      pendingWrites.push({
        id: doseId,
        patientId: med.patientId,
        medicationId: med.id,
        medicationName: med.name,
        dosage: med.dosage,
        instructions: med.instructions,
        color: med.color,
        shape: med.shape,
        scheduledDate: targetDate,
        scheduledTime,
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
        createdAt: new Date(now.getTime()),
        updatedAt: new Date(now.getTime()),
      });
    }
  }

  // Batch chunking <= 500 operations per Firestore batch limit
  const BATCH_LIMIT = 500;
  let batchCount = 0;
  for (let i = 0; i < pendingWrites.length; i += BATCH_LIMIT) {
    const chunk = pendingWrites.slice(i, i + BATCH_LIMIT);
    batchCount += 1;
    for (const doc of chunk) {
      db.seedDoc('dose_logs', doc.id, doc);
    }
  }

  return {
    createdCount: pendingWrites.length,
    skippedCount,
    createdIds: pendingWrites.map((d) => d.id),
    batchCount,
  };
}

export function checkDoseEscalations(
  db: MockFirestoreDb,
  currentTime: Date
): { escalatedIds: string[]; gentleReminderIds: string[] } {
  const allDoses = db.inspectCollection<DoseLogDocument>('dose_logs');
  const escalatedIds: string[] = [];
  const gentleReminderIds: string[] = [];

  for (const dose of allDoses) {
    if (dose.status === 'taken' || dose.status === 'missed') {
      continue;
    }

    const result = evaluateDoseState({
      currentStatus: dose.status,
      scheduledTime: new Date(dose.scheduledTime),
      currentTime,
      snoozeCount: dose.snoozeCount,
      snoozeUntil: dose.snoozeUntil ? new Date(dose.snoozeUntil) : null,
    });

    const patch: Partial<DoseLogDocument> = {
      status: result.nextStatus,
      updatedAt: new Date(currentTime.getTime()),
    };

    let changed = result.nextStatus !== dose.status;

    if (result.nextStatus === 'unconfirmed' && !dose.escalationAlertSent) {
      patch.escalatedAt = result.escalatedAt ?? new Date(currentTime.getTime());
      patch.escalationAlertSent = true;
      escalatedIds.push(dose.id);
      changed = true;
    } else if (result.sendGentleReminder && !dose.followUpSent) {
      patch.followUpSent = true;
      gentleReminderIds.push(dose.id);
      changed = true;
    }

    if (changed) {
      db.adminUpdateDoc('dose_logs', dose.id, patch);
    }
  }

  return { escalatedIds, gentleReminderIds };
}

// ============================================================================
// 6. UI Component Contract Renderers (F07, F08, F09 Opaque-Box DOM Contracts)
// ============================================================================

export const MEDIMATE_COLOR_TOKENS = {
  canvasBg: '#F8FAFC',
  cardBg: '#FFFFFF',
  textPrimary: '#0F172A',
  textSecondary: '#334155',
  textMuted: '#475569',
  primaryTeal: '#115E59',
  takenBtnBg: '#166534',
  takenBtnText: '#FFFFFF',
  snoozeBtnBg: '#FFFFFF',
  snoozeBtnText: '#B45309',
  snoozeBtnBorder: '#B45309',
  alertBannerBg: '#FEF2F2',
  alertBannerText: '#991B1B',
  overdueWarningBg: '#FEF2F2',
  overdueWarningText: '#991B1B',
  focusRing: '#0284C7',
} as const;

export interface SimpleModeRenderOptions {
  dose: DoseLogDocument | null;
  patientName?: string;
  onConfirmTaken?: (doseId: string) => Promise<void> | void;
  onSnooze?: (doseId: string) => Promise<void> | void;
}

export function renderElderlySimpleMode(
  container: HTMLElement,
  options: SimpleModeRenderOptions
): {
  takenButton: HTMLButtonElement | null;
  snoozeButton: HTMLButtonElement | null;
  statusRegion: HTMLElement | null;
  doseCard: HTMLElement | null;
} {
  container.innerHTML = '';
  const main = document.createElement('main');
  main.setAttribute('role', 'main');
  main.style.backgroundColor = MEDIMATE_COLOR_TOKENS.canvasBg;
  main.style.color = MEDIMATE_COLOR_TOKENS.textPrimary;

  const header = document.createElement('header');
  const h1 = document.createElement('h1');
  h1.textContent = options.patientName ? `Hello, ${options.patientName}` : 'Your Next Medication';
  header.appendChild(h1);
  main.appendChild(header);

  const liveRegion = document.createElement('div');
  liveRegion.id = 'dose-live-region';
  liveRegion.setAttribute('aria-live', 'polite');
  main.appendChild(liveRegion);

  if (!options.dose) {
    const empty = document.createElement('p');
    empty.textContent = 'No doses scheduled right now.';
    main.appendChild(empty);
    container.appendChild(main);
    return { takenButton: null, snoozeButton: null, statusRegion: liveRegion, doseCard: null };
  }

  const dose = options.dose;
  const card = document.createElement('article');
  card.id = 'next-dose-card';
  card.style.backgroundColor = MEDIMATE_COLOR_TOKENS.cardBg;

  const medHeading = document.createElement('h2');
  medHeading.id = 'dose-medication-name';
  medHeading.textContent = dose.medicationName;
  medHeading.style.color = MEDIMATE_COLOR_TOKENS.textPrimary;

  const dosageEl = document.createElement('p');
  dosageEl.id = 'dose-dosage';
  dosageEl.textContent = dose.dosage;

  const timeEl = document.createElement('p');
  timeEl.id = 'dose-scheduled-time';
  timeEl.textContent = new Date(dose.scheduledTime).toISOString();

  const instrEl = document.createElement('p');
  instrEl.id = 'dose-instructions';
  instrEl.textContent = dose.instructions ?? 'Take as prescribed';

  card.appendChild(medHeading);
  card.appendChild(dosageEl);
  card.appendChild(timeEl);
  card.appendChild(instrEl);

  const isTaken = dose.status === 'taken';
  const snoozeAllowed = canSnooze(dose.snoozeCount, dose.status);

  const takenBtn = document.createElement('button') as HTMLButtonElement;
  takenBtn.id = 'taken-button';
  takenBtn.setAttribute('role', 'button');
  takenBtn.setAttribute('aria-label', `Mark ${dose.medicationName} as Taken`);
  takenBtn.className = 'w-full min-w-[44px] min-h-[44px] h-[68px]';
  takenBtn.style.minWidth = '220px';
  takenBtn.style.minHeight = '68px';
  takenBtn.style.height = '68px';
  takenBtn.style.backgroundColor = MEDIMATE_COLOR_TOKENS.takenBtnBg;
  takenBtn.style.color = MEDIMATE_COLOR_TOKENS.takenBtnText;
  takenBtn.style.marginBottom = '12px';
  takenBtn.textContent = isTaken ? 'Taken ✓ Recorded' : 'Taken ✓';
  if (isTaken) {
    takenBtn.disabled = true;
    takenBtn.setAttribute('aria-disabled', 'true');
  }

  const snoozeBtn = document.createElement('button') as HTMLButtonElement;
  snoozeBtn.id = 'snooze-button';
  snoozeBtn.setAttribute('role', 'button');
  snoozeBtn.setAttribute('aria-label', 'Remind Me Later (10 min)');
  snoozeBtn.className = 'w-full min-w-[44px] min-h-[44px] h-[52px]';
  snoozeBtn.style.minWidth = '220px';
  snoozeBtn.style.minHeight = '52px';
  snoozeBtn.style.height = '52px';
  snoozeBtn.style.backgroundColor = MEDIMATE_COLOR_TOKENS.snoozeBtnBg;
  snoozeBtn.style.color = MEDIMATE_COLOR_TOKENS.snoozeBtnText;
  snoozeBtn.style.borderColor = MEDIMATE_COLOR_TOKENS.snoozeBtnBorder;
  snoozeBtn.style.marginTop = '12px';
  snoozeBtn.textContent = !snoozeAllowed
    ? dose.snoozeCount >= 1
      ? 'Snooze limit reached'
      : 'Remind Me Later'
    : 'Remind Me Later (10 min)';
  if (!snoozeAllowed || isTaken) {
    snoozeBtn.disabled = true;
    snoozeBtn.setAttribute('aria-disabled', 'true');
  }

  let submitted = isTaken;
  takenBtn.addEventListener('click', () => {
    if (submitted || takenBtn.disabled) return;
    submitted = true;
    takenBtn.disabled = true;
    takenBtn.setAttribute('aria-disabled', 'true');
    takenBtn.textContent = 'Taken ✓ Recorded';
    snoozeBtn.disabled = true;
    snoozeBtn.setAttribute('aria-disabled', 'true');
    liveRegion.textContent = `${dose.medicationName} marked as taken.`;
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate([40, 60, 40]);
    }
    if (options.onConfirmTaken) {
      void options.onConfirmTaken(dose.id);
    }
  });

  snoozeBtn.addEventListener('click', () => {
    if (snoozeBtn.disabled || !canSnooze(dose.snoozeCount, dose.status)) return;
    snoozeBtn.disabled = true;
    snoozeBtn.setAttribute('aria-disabled', 'true');
    snoozeBtn.textContent = 'Snooze limit reached';
    liveRegion.textContent = `${dose.medicationName} snoozed for 10 minutes.`;
    if (options.onSnooze) {
      void options.onSnooze(dose.id);
    }
  });

  card.appendChild(takenBtn);
  card.appendChild(snoozeBtn);
  main.appendChild(card);
  container.appendChild(main);

  return { takenButton: takenBtn, snoozeButton: snoozeBtn, statusRegion: liveRegion, doseCard: card };
}

export interface CaregiverComplianceSummary {
  scheduled: number;
  taken: number;
  pending: number;
  unconfirmed: number;
}

export function computeComplianceSummary(doses: DoseLogDocument[]): CaregiverComplianceSummary {
  let taken = 0;
  let pending = 0;
  let unconfirmed = 0;
  for (const dose of doses) {
    if (dose.status === 'taken') taken += 1;
    else if (dose.status === 'unconfirmed') unconfirmed += 1;
    else if (dose.status === 'scheduled' || dose.status === 'due' || dose.status === 'snoozed') {
      pending += 1;
    }
  }
  return {
    scheduled: doses.length,
    taken,
    pending,
    unconfirmed,
  };
}

export function renderCaregiverDashboard(
  container: HTMLElement,
  doses: DoseLogDocument[],
  careCircle: CareCircleDocument | null,
  patientName = careCircle?.patientName ?? 'Patient'
): {
  summary: CaregiverComplianceSummary;
  alertBanner: HTMLElement | null;
  timelineItems: HTMLElement[];
  memberItems: HTMLElement[];
} {
  container.innerHTML = '';
  const root = document.createElement('main');
  root.setAttribute('role', 'main');

  const sortedDoses = [...doses].sort(
    (a, b) => new Date(a.scheduledTime).getTime() - new Date(b.scheduledTime).getTime()
  );
  const summary = computeComplianceSummary(sortedDoses);
  const unconfirmedDoses = sortedDoses.filter((d) => d.status === 'unconfirmed');

  let alertBanner: HTMLElement | null = null;
  if (unconfirmedDoses.length > 0) {
    alertBanner = document.createElement('div');
    alertBanner.id = 'unconfirmed-alert-banner';
    alertBanner.setAttribute('role', 'alert');
    alertBanner.setAttribute('aria-live', 'assertive');
    alertBanner.style.backgroundColor = MEDIMATE_COLOR_TOKENS.alertBannerBg;
    alertBanner.style.color = MEDIMATE_COLOR_TOKENS.alertBannerText;
    alertBanner.textContent = unconfirmedDoses
      .map((d) => `URGENT: ${patientName} has not confirmed ${d.medicationName} (${d.dosage})`)
      .join(' | ');
    root.appendChild(alertBanner);
  }

  const badgesSection = document.createElement('section');
  badgesSection.id = 'compliance-summary-badges';
  const badgePairs: Array<[string, number]> = [
    ['scheduled', summary.scheduled],
    ['taken', summary.taken],
    ['pending', summary.pending],
    ['unconfirmed', summary.unconfirmed],
  ];
  for (const [key, count] of badgePairs) {
    const badge = document.createElement('div');
    badge.id = `badge-${key}`;
    badge.setAttribute('data-count', String(count));
    badge.textContent = `${key}: ${count}`;
    badgesSection.appendChild(badge);
  }
  root.appendChild(badgesSection);

  const timelineSection = document.createElement('section');
  timelineSection.id = 'dose-timeline';
  timelineSection.setAttribute('aria-live', 'polite');
  const timelineItems: HTMLElement[] = [];

  for (const dose of sortedDoses) {
    const item = document.createElement('article');
    item.setAttribute('data-dose-id', dose.id);
    item.setAttribute('data-status', dose.status);
    item.textContent = `${new Date(dose.scheduledTime).toISOString()} - ${dose.medicationName} (${dose.dosage}) [${dose.status}]`;
    timelineSection.appendChild(item);
    timelineItems.push(item);
  }
  root.appendChild(timelineSection);

  const circleSection = document.createElement('section');
  circleSection.id = 'care-circle-members';
  const memberItems: HTMLElement[] = [];
  if (careCircle) {
    for (const member of careCircle.members) {
      const mEl = document.createElement('div');
      mEl.setAttribute('data-member-id', member.userId);
      mEl.textContent = `${member.displayName} (${member.role})`;
      circleSection.appendChild(mEl);
      memberItems.push(mEl);
    }
  }
  root.appendChild(circleSection);

  container.appendChild(root);
  return { summary, alertBanner, timelineItems, memberItems };
}
