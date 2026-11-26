import fs from 'node:fs';
import path from 'node:path';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  MockFirestoreDb,
  PermissionDeniedError,
  createCareCircleFixture,
  createDoseLogFixture,
  createMedicationFixture,
  createUserFixture,
  seedPatientCareCircleScenario,
} from '@harness/index';
import {
  PROJECT_ROOT,
  createMockFirestoreAdapter,
  hasProjectFile,
  localTodayISO,
  makeAuthValue,
} from '@harness/reactTestHelper';
import { Timestamp } from 'firebase/firestore';
import type { DoseLogDocument } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor: { uid: string; role: 'elderly' | 'caregiver' | 'dual' } | null = {
  uid: 'patient_asha',
  role: 'elderly',
};
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);

const updateDoseLogSpy = vi.fn(
  async (doseId: string, patch: Partial<Omit<DoseLogDocument, 'id' | 'patientId' | 'createdAt'>>) => {
    return bridge.updateDoseLog(doseId, patch);
  }
);
const getDoseLogMock = vi.fn();
const createMedicationSpy = vi.fn(bridge.createMedication);
const updateMedicationSpy = vi.fn(bridge.updateMedication);

vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: {},
  db: {},
  getMessagingInstance: vi.fn(async () => null),
  VAPID_KEY: undefined,
}));

vi.mock('@/lib/firestore', () => ({
  subscribeToDoseLogs: (...args: Parameters<typeof bridge.subscribeToDoseLogs>) =>
    bridge.subscribeToDoseLogs(...args),
  subscribeToCareCircle: (...args: Parameters<typeof bridge.subscribeToCareCircle>) =>
    bridge.subscribeToCareCircle(...args),
  updateDoseLog: (
    doseId: string,
    patch: Partial<Omit<DoseLogDocument, 'id' | 'patientId' | 'createdAt'>>
  ) => updateDoseLogSpy(doseId, patch),
  getDoseLog: (...args: unknown[]) => getDoseLogMock(...args),
  getMedications: (...args: Parameters<typeof bridge.getMedications>) =>
    bridge.getMedications(...args),
  subscribeToMedications: (...args: Parameters<typeof bridge.subscribeToMedications>) =>
    bridge.subscribeToMedications(...args),
  createMedication: (...args: Parameters<typeof bridge.createMedication>) =>
    createMedicationSpy(...args),
  updateMedication: (...args: Parameters<typeof bridge.updateMedication>) =>
    updateMedicationSpy(...args),
  setMedicationActive: (...args: Parameters<typeof bridge.setMedicationActive>) =>
    bridge.setMedicationActive(...args),
  getDoseLogsForDateRange: (...args: Parameters<typeof bridge.getDoseLogsForDateRange>) =>
    bridge.getDoseLogsForDateRange(...args),
  getActiveMedications: vi.fn(async () => []),
  getUserDocument: vi.fn(async () => null),
  upsertUserDocument: vi.fn(async () => {}),
  getCareCircle: vi.fn(async () => null),
  updateUserAccessibilityPreferences: vi.fn(async () => {}),
  inviteCareCircleMember: vi.fn(async () => {}),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: vi.fn(async () => 0),
}));

vi.mock('@/lib/sound', () => ({
  playConfirmationChime: vi.fn(),
}));

import { useReminderScheduler } from '@/hooks/useReminderScheduler';
import { CaregiverDashboard } from '@/pages/CaregiverDashboard';

const rulesSrc = hasProjectFile('firestore.rules')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'firestore.rules'), 'utf-8')
  : '';
const schedulerSrc = hasProjectFile('src/hooks/useReminderScheduler.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/hooks/useReminderScheduler.ts'), 'utf-8')
  : '';
const caregiverDashboardSrc = hasProjectFile('src/pages/CaregiverDashboard.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/CaregiverDashboard.tsx'), 'utf-8')
  : '';

const hasM3RulesHardened =
  rulesSrc.length > 0 && !rulesSrc.includes('isDemoPatient') && rulesSrc.includes('care_invites');
const hasM3ClientEscalationFix =
  schedulerSrc.includes("status: 'unconfirmed'") &&
  !schedulerSrc.includes('escalationAlertSent: true');
const hasM4CaregiverTrialIsolation = /const\s+isDemoSession\s*=[\s\S]*Boolean\(isDemo\)/.test(
  caregiverDashboardSrc
);

function SchedulerHarness({
  doses,
  patientId,
}: {
  doses: DoseLogDocument[];
  patientId: string;
}) {
  useReminderScheduler(doses, patientId);
  return <div data-testid="scheduler-mounted" />;
}

describe('Tier 2 — B22: Security Rules, R1 Client Scheduler & Trial Isolation Boundaries (R1-FE, R2, R6-rules)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    updateDoseLogSpy.mockClear();
    getDoseLogMock.mockReset();
    createMedicationSpy.mockClear();
    updateMedicationSpy.mockClear();
    currentActor = { uid: 'patient_asha', role: 'elderly' };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.runIf(hasM3RulesHardened)(
    'T2-B22-01: Unauthenticated actor (null) and unlinked user are denied read/write/delete on patient_ramesh across all collections',
    () => {
      const { patient, circle, medication, doseLog } = seedPatientCareCircleScenario(mockDb, {
        patientId: 'patient_ramesh',
        caregiverId: 'caregiver_priya',
        unlinkedId: 'stranger_99',
      });
      const strangerAuth = { uid: 'stranger_99', role: 'caregiver' as const };

      for (const actor of [null, strangerAuth]) {
        expect(() => mockDb.getDoc('users', patient.uid, actor)).toThrow(PermissionDeniedError);
        expect(() => mockDb.getDoc('care_circles', circle.id, actor)).toThrow(
          PermissionDeniedError
        );
        expect(() => mockDb.getDoc('medications', medication.id, actor)).toThrow(
          PermissionDeniedError
        );
        expect(() => mockDb.getDoc('dose_logs', doseLog.id, actor)).toThrow(
          PermissionDeniedError
        );

        expect(() =>
          mockDb.updateDoc('dose_logs', doseLog.id, { status: 'taken' }, actor)
        ).toThrow(PermissionDeniedError);
        expect(() =>
          mockDb.updateDoc('medications', medication.id, { active: false }, actor)
        ).toThrow(PermissionDeniedError);
        expect(() => mockDb.deleteDoc('medications', medication.id, actor)).toThrow(
          PermissionDeniedError
        );
        expect(() => mockDb.deleteDoc('care_circles', circle.id, actor)).toThrow(
          PermissionDeniedError
        );
      }

      // Real firestore.rules must not contain patient_ramesh or isDemoPatient bypass
      expect(rulesSrc).not.toContain('isDemoPatient');
      expect(rulesSrc).not.toContain('patient_ramesh');
    }
  );

  it.runIf(hasM3RulesHardened)(
    'T2-B22-02: care_invites denies list queries, inactive invite redemption, and mismatched patientId spoofing',
    () => {
      const asha = createUserFixture({ uid: 'patient_asha', role: 'elderly' });
      const other = createUserFixture({ uid: 'patient_other', role: 'elderly' });
      const cg = createUserFixture({ uid: 'cg_eve', role: 'caregiver' });
      mockDb.seedDoc('users', asha.uid, asha);
      mockDb.seedDoc('users', other.uid, other);
      mockDb.seedDoc('users', cg.uid, cg);

      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          caregiverIds: [],
          members: [],
          inviteCode: 'MED-ACTIVE1',
        })
      );
      mockDb.seedDoc(
        'care_circles',
        'patient_other',
        createCareCircleFixture({
          id: 'patient_other',
          patientId: 'patient_other',
          caregiverIds: [],
          members: [],
          inviteCode: 'MED-OTHER2',
        })
      );
      mockDb.seedDoc('care_invites', 'MED-INACTIVE', {
        id: 'MED-INACTIVE',
        code: 'MED-INACTIVE',
        patientId: 'patient_asha',
        patientName: 'Asha',
        createdBy: 'patient_asha',
        active: false,
      });
      mockDb.seedDoc('care_invites', 'MED-OTHER2', {
        id: 'MED-OTHER2',
        code: 'MED-OTHER2',
        patientId: 'patient_other',
        patientName: 'Other',
        createdBy: 'patient_other',
        active: true,
      });

      const cgAuth = { uid: 'cg_eve', role: 'caregiver' as const };

      // 1. Listing / subscribing to care_invites is forbidden (allow list: if false)
      expect(() => mockDb.queryDocs('care_invites', () => true, cgAuth)).toThrow(
        PermissionDeniedError
      );
      expect(() =>
        mockDb.subscribe('care_invites', () => true, () => {}, cgAuth)
      ).toThrow(PermissionDeniedError);

      // 2. Unauthenticated getDoc on care_invites is denied
      expect(() => mockDb.getDoc('care_invites', 'MED-OTHER2', null)).toThrow(
        PermissionDeniedError
      );

      // 3. Inactive invite cannot be redeemed for self-join
      expect(() =>
        mockDb.updateDoc(
          'care_circles',
          'patient_asha',
          { caregiverIds: ['cg_eve'], lastRedeemedInviteCode: 'MED-INACTIVE' },
          cgAuth
        )
      ).toThrow(PermissionDeniedError);

      // 4. Invite belonging to patient_other cannot be redeemed to join patient_asha
      expect(() =>
        mockDb.updateDoc(
          'care_circles',
          'patient_asha',
          { caregiverIds: ['cg_eve'], lastRedeemedInviteCode: 'MED-OTHER2' },
          cgAuth
        )
      ).toThrow(PermissionDeniedError);
    }
  );

  it.runIf(hasM3RulesHardened)(
    'T2-B22-03: care_circles self-join rejects removing existing caregivers, adding >1 caregiver, omitting self, or tampering immutable fields',
    () => {
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha',
          caregiverIds: ['cg_existing'],
          inviteCode: 'MED-JOIN88',
        })
      );
      mockDb.seedDoc('care_invites', 'MED-JOIN88', {
        id: 'MED-JOIN88',
        code: 'MED-JOIN88',
        patientId: 'patient_asha',
        patientName: 'Asha',
        createdBy: 'patient_asha',
        active: true,
      });

      const eveAuth = { uid: 'cg_eve', role: 'caregiver' as const };

      // Removing existing caregiver rejected
      expect(() =>
        mockDb.updateDoc(
          'care_circles',
          'patient_asha',
          { caregiverIds: ['cg_eve'], lastRedeemedInviteCode: 'MED-JOIN88' },
          eveAuth
        )
      ).toThrow(PermissionDeniedError);

      // Adding >1 caregiver at once rejected
      expect(() =>
        mockDb.updateDoc(
          'care_circles',
          'patient_asha',
          {
            caregiverIds: ['cg_existing', 'cg_eve', 'cg_accomplice'],
            lastRedeemedInviteCode: 'MED-JOIN88',
          },
          eveAuth
        )
      ).toThrow(PermissionDeniedError);

      // Omitting self (uid) from caregiverIds rejected
      expect(() =>
        mockDb.updateDoc(
          'care_circles',
          'patient_asha',
          {
            caregiverIds: ['cg_existing', 'cg_someone_else'],
            lastRedeemedInviteCode: 'MED-JOIN88',
          },
          eveAuth
        )
      ).toThrow(PermissionDeniedError);

      // Tampering inviteCode or patientName during self-join rejected
      expect(() =>
        mockDb.updateDoc(
          'care_circles',
          'patient_asha',
          {
            caregiverIds: ['cg_existing', 'cg_eve'],
            inviteCode: 'MED-HACKED',
            lastRedeemedInviteCode: 'MED-JOIN88',
          },
          eveAuth
        )
      ).toThrow(PermissionDeniedError);
      expect(() =>
        mockDb.updateDoc(
          'care_circles',
          'patient_asha',
          {
            caregiverIds: ['cg_existing', 'cg_eve'],
            patientName: 'Tampered Name',
            lastRedeemedInviteCode: 'MED-JOIN88',
          },
          eveAuth
        )
      ).toThrow(PermissionDeniedError);
    }
  );

  it.runIf(hasM3ClientEscalationFix)(
    'T2-B22-04: useReminderScheduler skips taken/missed/already-taken doses and handles getDoseLog failure safely without escalating prematurely',
    async () => {
      vi.useFakeTimers();
      const baseNow = new Date('2026-11-26T08:00:00.000Z');
      vi.setSystemTime(baseNow);

      const makeDose = (overrides: Partial<DoseLogDocument>): DoseLogDocument => ({
        id: 'dose_1',
        patientId: 'patient_asha',
        medicationId: 'med_1',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledDate: '2026-11-26',
        scheduledTime: Timestamp.fromDate(new Date(baseNow.getTime() + 1000)),
        status: 'due',
        snoozeCount: 0,
        snoozedAt: null,
        snoozeUntil: null,
        takenAt: null,
        takenBy: null,
        escalatedAt: null,
        missedAt: null,
        followUpSent: false,
        escalationAlertSent: false,
        createdAt: Timestamp.fromDate(baseNow),
        updatedAt: Timestamp.fromDate(baseNow),
        ...overrides,
      });

      const takenDose = makeDose({ id: 'dose_taken', status: 'taken' });
      const missedDose = makeDose({ id: 'dose_missed', status: 'missed' });
      const snoozedDose = makeDose({
        id: 'dose_snoozed',
        status: 'snoozed',
        snoozeCount: 1,
        snoozeUntil: Timestamp.fromDate(new Date(baseNow.getTime() + 20 * 60 * 1000)),
      });
      const failingReadDose = makeDose({ id: 'dose_read_err', status: 'due' });

      getDoseLogMock.mockImplementation(async (id: string) => {
        if (id === 'dose_read_err') {
          throw new Error('Transient network failure');
        }
        return snoozedDose;
      });

      render(
        <SchedulerHarness
          doses={[takenDose, missedDose, snoozedDose, failingReadDose]}
          patientId="patient_asha"
        />
      );

      // Advance past T+15m: active snooze must NOT emit followUpSent, taken/missed untouched, read failure caught safely
      await act(async () => {
        await vi.advanceTimersByTimeAsync(16 * 60 * 1000);
      });

      expect(
        updateDoseLogSpy.mock.calls.filter(([id]) => id === 'dose_taken' || id === 'dose_missed')
      ).toHaveLength(0);
      expect(
        updateDoseLogSpy.mock.calls.filter(
          ([id, patch]) => id === 'dose_snoozed' && patch.followUpSent === true
        )
      ).toHaveLength(0);
      expect(
        updateDoseLogSpy.mock.calls.filter(([id]) => id === 'dose_read_err')
      ).toHaveLength(0);

      // Advance past T+30m: snoozedDose reaches T+30m escalation ceiling and writes { status: 'unconfirmed' } ONLY
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      });

      const snoozeEscCall = updateDoseLogSpy.mock.calls.find(
        ([id, patch]) => id === 'dose_snoozed' && patch.status === 'unconfirmed'
      );
      expect(snoozeEscCall).toBeDefined();
      expect(snoozeEscCall![1]).toEqual({ status: 'unconfirmed' });
    }
  );

  it.runIf(hasM3RulesHardened && hasM4CaregiverTrialIsolation)(
    'T2-B22-05: Trial CaregiverDashboard (isDemo: true) renders sample mockData without issuing live Firestore mutations',
    async () => {
      const demoAuth = makeAuthValue({
        authenticated: true,
        role: 'caregiver',
        uid: 'caregiver_priya',
        displayName: 'Priya Sharma',
        isDemo: true,
      });

      render(
        <MemoryRouter initialEntries={['/app/caregiver']}>
          <AuthProvider value={demoAuth}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      expect(createMedicationSpy).not.toHaveBeenCalled();
      expect(updateMedicationSpy).not.toHaveBeenCalled();
      expect(updateDoseLogSpy).not.toHaveBeenCalled();
      expect(mockDb.inspectCollection('medications')).toHaveLength(0);
    }
  );
});
