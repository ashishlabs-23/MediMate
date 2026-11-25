import '@testing-library/jest-dom/vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanup } from '@testing-library/react';
import type { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { afterEach, vi } from 'vitest';
import type { AuthContextValue } from '@/contexts/AuthContext';
import type {
  CareCircleDocument,
  DoseLogDocument,
  MedicationDocument,
  UserDocument,
  UserRole,
} from '@/types/firestore';
import type { AuthContext as MockAuthContext } from './mockFirestore';
import { MockFirestoreDb } from './mockFirestore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '../../..');

/**
 * Vite-compiled optional module map for M1–M4 files that may still be in flight
 * during parallel track development. When a target file exists on disk, Vite
 * transforms its TypeScript, JSX, and `@/` aliases normally through `@vitejs/plugin-react`.
 * When a file does not exist yet, `import.meta.glob` cleanly omits it without crashing.
 */
const OPTIONAL_MODULES = import.meta.glob([
  '../../../src/pages/LandingPage.tsx',
  '../../../src/domain/meals.ts',
  '../../../src/lib/sound.ts',
  '../../../src/components/dose/MealBadge.tsx',
  '../../../src/components/caregiver/AddMedicationModal.tsx',
  '../../../src/components/caregiver/AdherenceHistory.tsx',
  '../../../src/components/pwa/InstallPromptBanner.tsx',
  '../../../server/src/index.ts',
  '../../../server/src/firebaseAdmin.ts',
  '../../../server/src/jobs/dailyDoseLogs.ts',
  '../../../server/src/jobs/dueDosesEscalation.ts',
]);

const RELATIVE_KEY_MAP: Record<string, string> = {
  'src/pages/LandingPage.tsx': '../../../src/pages/LandingPage.tsx',
  'src/domain/meals.ts': '../../../src/domain/meals.ts',
  'src/lib/sound.ts': '../../../src/lib/sound.ts',
  'src/components/dose/MealBadge.tsx': '../../../src/components/dose/MealBadge.tsx',
  'src/components/caregiver/AddMedicationModal.tsx':
    '../../../src/components/caregiver/AddMedicationModal.tsx',
  'src/components/caregiver/AdherenceHistory.tsx':
    '../../../src/components/caregiver/AdherenceHistory.tsx',
  'src/components/pwa/InstallPromptBanner.tsx':
    '../../../src/components/pwa/InstallPromptBanner.tsx',
  'server/src/index.ts': '../../../server/src/index.ts',
  'server/src/firebaseAdmin.ts': '../../../server/src/firebaseAdmin.ts',
  'server/src/jobs/dailyDoseLogs.ts': '../../../server/src/jobs/dailyDoseLogs.ts',
  'server/src/jobs/dueDosesEscalation.ts': '../../../server/src/jobs/dueDosesEscalation.ts',
};

export function hasProjectFile(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  return fs.existsSync(path.resolve(PROJECT_ROOT, normalized));
}

export function hasServerRuntimeReady(): boolean {
  return (
    hasProjectFile('server/src/index.ts') &&
    hasProjectFile('server/node_modules')
  );
}

export async function loadOptionalModule<T = Record<string, unknown>>(
  relPath: string
): Promise<T> {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const globKey = RELATIVE_KEY_MAP[normalized] ?? `../../../${normalized}`;
  const loader = OPTIONAL_MODULES[globKey];
  if (!loader) {
    throw new Error(`Optional module not found in workspace: ${normalized}`);
  }
  return (await loader()) as T;
}

export function registerReactE2ECleanup(): void {
  afterEach(() => {
    cleanup();
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      window.history.replaceState({}, '', '/');
    }
  });
}

// Automatically clean up mounted RTL trees and reset URL history after each test
// in files that import this React test helper.
registerReactE2ECleanup();

export function localTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function makeUserProfile(
  role: UserRole = 'elderly',
  overrides: Partial<UserDocument> = {}
): UserDocument {
  const defaultUid = role === 'caregiver' ? 'caregiver_priya' : 'patient_ramesh';
  const defaultName = role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma';
  return {
    uid: overrides.uid ?? defaultUid,
    email: overrides.email ?? `${defaultUid}@medimate.local`,
    displayName: overrides.displayName ?? defaultName,
    role,
    timezone: overrides.timezone ?? 'Asia/Kolkata',
    fcmTokens: overrides.fcmTokens ?? [],
    accessibilityPreferences: overrides.accessibilityPreferences ?? {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: overrides.createdAt ?? Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: overrides.updatedAt ?? Timestamp.fromMillis(1_700_000_000_000),
    ...overrides,
  };
}

export function makeAuthValue(options: {
  isLoading?: boolean;
  authenticated?: boolean;
  role?: UserRole;
  uid?: string;
  displayName?: string;
  nullProfile?: boolean;
  signOut?: () => Promise<void>;
  loginAsDemo?: (role: UserRole) => void;
} = {}): AuthContextValue {
  const isLoading = options.isLoading ?? false;
  const authenticated = options.authenticated ?? false;
  const role = options.role ?? 'elderly';
  const uid = options.uid ?? (role === 'caregiver' ? 'caregiver_priya' : 'patient_ramesh');
  const displayName =
    options.displayName ?? (role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma');

  const firebaseUser: User | null | undefined = isLoading
    ? undefined
    : authenticated
      ? ({
          uid,
          email: `${uid}@medimate.local`,
          displayName,
        } as unknown as User)
      : null;

  const userProfile =
    authenticated && !options.nullProfile
      ? makeUserProfile(role, { uid, displayName })
      : null;

  return {
    firebaseUser,
    userProfile,
    isLoading,
    signOut: options.signOut ?? vi.fn(async () => {}),
    loginAsDemo: options.loginAsDemo ?? vi.fn(),
  };
}

export interface RecordedOscillator {
  type: OscillatorType;
  frequencies: Array<{ value: number; startTime: number }>;
  startedAt: number | null;
  stoppedAt: number | null;
  connected: boolean;
}

export interface AudioStubHandle {
  constructCount: number;
  resumeCount: number;
  closeCount: number;
  oscillators: RecordedOscillator[];
  restore: () => void;
}

export function stubAudioContext(options: {
  initialState?: 'running' | 'suspended';
  throwOnConstruct?: boolean;
  failResume?: boolean;
  omitAudioContext?: boolean;
} = {}): AudioStubHandle {
  const win = window as unknown as Record<string, unknown>;
  const origAudio = win.AudioContext;
  const origWebkit = win.webkitAudioContext;

  const handle: AudioStubHandle = {
    constructCount: 0,
    resumeCount: 0,
    closeCount: 0,
    oscillators: [],
    restore: () => {
      if (origAudio === undefined) {
        delete win.AudioContext;
      } else {
        win.AudioContext = origAudio;
      }
      if (origWebkit === undefined) {
        delete win.webkitAudioContext;
      } else {
        win.webkitAudioContext = origWebkit;
      }
    },
  };

  if (options.omitAudioContext) {
    delete win.AudioContext;
    delete win.webkitAudioContext;
    return handle;
  }

  class MockAudioContext {
    state: AudioContextState = options.initialState ?? 'running';
    currentTime = 0;
    destination = {};

    constructor() {
      handle.constructCount += 1;
      if (options.throwOnConstruct) {
        throw new Error('AudioContext blocked by autoplay policy');
      }
    }

    resume(): Promise<void> {
      handle.resumeCount += 1;
      if (options.failResume) {
        return Promise.reject(new Error('AudioContext resume rejected'));
      }
      this.state = 'running';
      return Promise.resolve();
    }

    close(): Promise<void> {
      handle.closeCount += 1;
      this.state = 'closed';
      return Promise.resolve();
    }

    createOscillator() {
      const record: RecordedOscillator = {
        type: 'sine',
        frequencies: [],
        startedAt: null,
        stoppedAt: null,
        connected: false,
      };
      handle.oscillators.push(record);
      return {
        get type() {
          return record.type;
        },
        set type(val: OscillatorType) {
          record.type = val;
        },
        frequency: {
          setValueAtTime: (value: number, startTime: number) => {
            record.frequencies.push({ value, startTime });
          },
          exponentialRampToValueAtTime: (value: number, startTime: number) => {
            record.frequencies.push({ value, startTime });
          },
          linearRampToValueAtTime: (value: number, startTime: number) => {
            record.frequencies.push({ value, startTime });
          },
        },
        connect: () => {
          record.connected = true;
        },
        start: (when = 0) => {
          record.startedAt = when;
        },
        stop: (when = 0) => {
          record.stoppedAt = when;
        },
        onended: null as (() => void) | null,
      };
    }

    createGain() {
      return {
        gain: {
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      };
    }
  }

  win.AudioContext = MockAudioContext;
  delete win.webkitAudioContext;
  return handle;
}

export function stubMatchMedia(standalone = false): () => void {
  const win = window as unknown as Record<string, unknown>;
  const orig = win.matchMedia;
  win.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('standalone') ? standalone : false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
  return () => {
    if (orig === undefined) {
      delete win.matchMedia;
    } else {
      win.matchMedia = orig;
    }
  };
}

export interface BeforeInstallPromptStub {
  event: Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  promptSpy: ReturnType<typeof vi.fn>;
}

export function createBeforeInstallPromptEvent(
  outcome: 'accepted' | 'dismissed' = 'accepted'
): BeforeInstallPromptStub {
  const promptSpy = vi.fn(async () => {});
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = promptSpy;
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  return { event, promptSpy };
}

function toTimestamp(value: unknown): Timestamp {
  if (value instanceof Timestamp) {
    return value;
  }
  if (value instanceof Date) {
    return Timestamp.fromDate(value);
  }
  if (value && typeof value === 'object' && 'toDate' in value && typeof (value as { toDate: unknown }).toDate === 'function') {
    return Timestamp.fromDate((value as { toDate: () => Date }).toDate());
  }
  return Timestamp.now();
}

function toNullableTimestamp(value: unknown): Timestamp | null {
  if (value === null || value === undefined) {
    return null;
  }
  return toTimestamp(value);
}

/**
 * Converts a MockFirestoreDb record into a typed DoseLogDocument with real Firebase Timestamps.
 */
export function toDoseLogDocument(raw: Record<string, unknown>): DoseLogDocument {
  return {
    id: String(raw.id ?? ''),
    patientId: String(raw.patientId ?? ''),
    medicationId: String(raw.medicationId ?? ''),
    medicationName: String(raw.medicationName ?? ''),
    dosage: String(raw.dosage ?? ''),
    instructions: raw.instructions ? String(raw.instructions) : undefined,
    color: raw.color ? String(raw.color) : undefined,
    shape: (raw.shape as DoseLogDocument['shape']) ?? undefined,
    scheduledDate: String(raw.scheduledDate ?? ''),
    scheduledTime: toTimestamp(raw.scheduledTime),
    status: (raw.status as DoseLogDocument['status']) ?? 'scheduled',
    snoozeCount: Number(raw.snoozeCount ?? 0),
    snoozedAt: toNullableTimestamp(raw.snoozedAt),
    snoozeUntil: toNullableTimestamp(raw.snoozeUntil),
    takenAt: toNullableTimestamp(raw.takenAt),
    takenBy: raw.takenBy ? String(raw.takenBy) : null,
    escalatedAt: toNullableTimestamp(raw.escalatedAt),
    missedAt: toNullableTimestamp(raw.missedAt),
    followUpSent: Boolean(raw.followUpSent),
    escalationAlertSent: Boolean(raw.escalationAlertSent),
    createdAt: toTimestamp(raw.createdAt),
    updatedAt: toTimestamp(raw.updatedAt),
  };
}

/**
 * Converts a MockFirestoreDb record into a typed MedicationDocument with real Firebase Timestamps.
 */
export function toMedicationDocument(raw: Record<string, unknown>): MedicationDocument {
  return {
    id: String(raw.id ?? ''),
    patientId: String(raw.patientId ?? ''),
    name: String(raw.name ?? ''),
    dosage: String(raw.dosage ?? ''),
    instructions: String(raw.instructions ?? ''),
    schedule: raw.schedule as MedicationDocument['schedule'],
    color: String(raw.color ?? '#0D9488'),
    shape: (raw.shape as MedicationDocument['shape']) ?? 'round',
    active: Boolean(raw.active ?? true),
    createdBy: String(raw.createdBy ?? ''),
    createdAt: toTimestamp(raw.createdAt),
    updatedAt: toTimestamp(raw.updatedAt),
  };
}

/**
 * Converts a MockFirestoreDb record into a typed CareCircleDocument with real Firebase Timestamps.
 */
export function toCareCircleDocument(raw: Record<string, unknown>): CareCircleDocument {
  const membersRaw = Array.isArray(raw.members) ? raw.members : [];
  return {
    id: String(raw.id ?? ''),
    patientId: String(raw.patientId ?? ''),
    patientName: String(raw.patientName ?? 'Patient'),
    caregiverIds: Array.isArray(raw.caregiverIds) ? raw.caregiverIds.map(String) : [],
    members: membersRaw.map((m) => {
      const rec = m as Record<string, unknown>;
      return {
        userId: String(rec.userId ?? ''),
        displayName: String(rec.displayName ?? ''),
        email: String(rec.email ?? ''),
        role: (rec.role as 'primary' | 'secondary') ?? 'primary',
        permissions: (Array.isArray(rec.permissions) ? rec.permissions : []) as CareCircleDocument['members'][number]['permissions'],
        status: (rec.status as 'active' | 'invited' | 'declined') ?? 'active',
        invitedAt: toTimestamp(rec.invitedAt),
        joinedAt: rec.joinedAt ? toTimestamp(rec.joinedAt) : undefined,
      };
    }),
    inviteCode: raw.inviteCode ? String(raw.inviteCode) : undefined,
    createdAt: toTimestamp(raw.createdAt),
    updatedAt: toTimestamp(raw.updatedAt),
  };
}

/**
 * Creates a live Firestore adapter backed by MockFirestoreDb so React components
 * (TodayView, CaregiverDashboard) execute against real security rules and real-time snapshots.
 */
export function createMockFirestoreAdapter(
  db: MockFirestoreDb,
  getAuth: () => MockAuthContext | null
) {
  let medCounter = 0;

  return {
    subscribeToDoseLogs(
      patientId: string,
      date: string,
      callback: (doses: DoseLogDocument[]) => void,
      onError?: (err: Error) => void
    ) {
      return db.subscribe(
        'dose_logs',
        (doc) => doc.patientId === patientId && doc.scheduledDate === date,
        (docs) => {
          const converted = docs
            .map((d) => toDoseLogDocument(d))
            .sort((a, b) => a.scheduledTime.toMillis() - b.scheduledTime.toMillis());
          callback(converted);
        },
        getAuth(),
        onError,
        patientId
      );
    },

    subscribeToCareCircle(
      patientId: string,
      callback: (circle: CareCircleDocument | null) => void,
      onError?: (err: Error) => void
    ) {
      return db.subscribe(
        'care_circles',
        (doc) => doc.patientId === patientId,
        (docs) => {
          callback(docs.length > 0 ? toCareCircleDocument(docs[0]) : null);
        },
        getAuth(),
        onError
      );
    },

    async updateDoseLog(
      doseLogId: string,
      patch: Partial<Omit<DoseLogDocument, 'id' | 'patientId' | 'createdAt'>>
    ): Promise<void> {
      const normalizedPatch: Record<string, unknown> = { ...patch, updatedAt: new Date() };
      for (const field of ['takenAt', 'snoozedAt', 'snoozeUntil', 'escalatedAt', 'missedAt'] as const) {
        const val = normalizedPatch[field];
        if (val && typeof val === 'object' && 'toDate' in val) {
          normalizedPatch[field] = (val as Timestamp).toDate();
        }
      }
      db.updateDoc('dose_logs', doseLogId, normalizedPatch, getAuth());
    },

    async getMedications(patientId: string): Promise<MedicationDocument[]> {
      const docs = db.queryDocs(
        'medications',
        (doc) => doc.patientId === patientId,
        getAuth(),
        patientId
      );
      return docs.map((d) => toMedicationDocument(d));
    },

    subscribeToMedications(
      patientId: string,
      callback: (meds: MedicationDocument[]) => void,
      onError?: (err: Error) => void
    ) {
      return db.subscribe(
        'medications',
        (doc) => doc.patientId === patientId,
        (docs) => callback(docs.map((d) => toMedicationDocument(d))),
        getAuth(),
        onError,
        patientId
      );
    },

    async createMedication(
      data: Omit<MedicationDocument, 'id' | 'createdAt' | 'updatedAt'>
    ): Promise<MedicationDocument> {
      medCounter += 1;
      const id = `${data.patientId}_med_${medCounter}`;
      const now = new Date();
      db.setDoc(
        'medications',
        id,
        {
          ...data,
          id,
          createdAt: now,
          updatedAt: now,
        },
        getAuth()
      );
      return toMedicationDocument({
        ...data,
        id,
        createdAt: now,
        updatedAt: now,
      });
    },

    async updateMedication(
      medicationId: string,
      patch: Partial<Omit<MedicationDocument, 'id' | 'patientId' | 'createdAt'>>
    ): Promise<void> {
      db.updateDoc(
        'medications',
        medicationId,
        { ...patch, updatedAt: new Date() },
        getAuth()
      );
    },

    async setMedicationActive(medicationId: string, active: boolean): Promise<void> {
      db.updateDoc(
        'medications',
        medicationId,
        { active, updatedAt: new Date() },
        getAuth()
      );
    },

    async getDoseLogsForDateRange(
      patientId: string,
      startDate: string,
      endDate: string
    ): Promise<DoseLogDocument[]> {
      const docs = db.queryDocs(
        'dose_logs',
        (doc) =>
          doc.patientId === patientId &&
          String(doc.scheduledDate ?? '') >= startDate &&
          String(doc.scheduledDate ?? '') <= endDate,
        getAuth(),
        patientId
      );
      return docs.map((d) => toDoseLogDocument(d));
    },

    async generateTodayLogsForMedication(med: MedicationDocument): Promise<number> {
      if (!med.active) return 0;
      const today = localTodayISO();
      if (med.schedule.startDate > today) return 0;
      if (med.schedule.endDate && med.schedule.endDate < today) return 0;
      const [y, m, day] = today.split('-').map(Number);
      const dow = new Date(y, m - 1, day).getDay();
      if (
        med.schedule.frequency === 'specific_days' &&
        (!med.schedule.daysOfWeek || !med.schedule.daysOfWeek.includes(dow))
      ) {
        return 0;
      }

      let count = 0;
      for (const hhmm of med.schedule.times) {
        const [hh, mm] = hhmm.split(':').map(Number);
        const timeKey = hhmm.replace(':', '');
        const doseId = `${med.patientId}_${med.id}_${today}_${timeKey}`;
        if (db.inspectDoc('dose_logs', doseId)) continue;
        const scheduledDateObj = new Date(y, m - 1, day, hh, mm, 0, 0);
        db.setDoc(
          'dose_logs',
          doseId,
          {
            id: doseId,
            patientId: med.patientId,
            medicationId: med.id,
            medicationName: med.name,
            dosage: med.dosage,
            instructions: med.instructions ?? '',
            color: med.color ?? '#0D9488',
            shape: med.shape ?? 'round',
            scheduledDate: today,
            scheduledTime: scheduledDateObj,
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
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          getAuth()
        );
        count += 1;
      }
      return count;
    },
  };
}
