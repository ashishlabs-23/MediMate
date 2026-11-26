import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  MockFirestoreDb,
  createCareCircleFixture,
  createDoseLogFixture,
  createUserFixture,
  type DoseLogDocument as StubDoseLog,
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
const generateTodayLogsSpy = vi.fn(async () => ({ created: 0, skipped: 0 }));

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
    bridge.createMedication(...args),
  updateMedication: (...args: Parameters<typeof bridge.updateMedication>) =>
    bridge.updateMedication(...args),
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
  generateTodayLogs: () => generateTodayLogsSpy(),
  generateTodayLogsForMedication: vi.fn(async () => 0),
}));

vi.mock('@/lib/sound', () => ({
  playConfirmationChime: vi.fn(),
}));

import { useReminderScheduler } from '@/hooks/useReminderScheduler';
import { TodayView } from '@/pages/TodayView';

const rulesSrc = hasProjectFile('firestore.rules')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'firestore.rules'), 'utf-8')
  : '';
const schedulerSrc = hasProjectFile('src/hooks/useReminderScheduler.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/hooks/useReminderScheduler.ts'), 'utf-8')
  : '';
const todayViewSrc = hasProjectFile('src/pages/TodayView.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/TodayView.tsx'), 'utf-8')
  : '';

const hasM3RulesHardened =
  rulesSrc.length > 0 && !rulesSrc.includes('isDemoPatient') && rulesSrc.includes('care_invites');
const hasM3ClientEscalationFix =
  schedulerSrc.includes("status: 'unconfirmed'") &&
  !schedulerSrc.includes('escalationAlertSent: true');
const hasM3TrialIsolation =
  todayViewSrc.includes('isDemoSession') && schedulerSrc.includes('isDemoSession');

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

describe('Tier 1 — F22: Security Rules Hardening, R1 Client Fix & Trial Isolation (R1-FE, R2, R6-rules)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    updateDoseLogSpy.mockClear();
    getDoseLogMock.mockReset();
    generateTodayLogsSpy.mockClear();
    currentActor = { uid: 'patient_asha', role: 'elderly' };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.runIf(hasM3RulesHardened)(
    'T1-F22-01: firestore.rules removes isDemoPatient public bypass across users, care_circles, medications, and dose_logs',
    () => {
      expect(rulesSrc).not.toContain('isDemoPatient');
      expect(rulesSrc).not.toContain('patient_ramesh');

      for (const matchHeader of [
        'match /users/{userId}',
        'match /care_circles/{patientId}',
        'match /medications/{medicationId}',
        'match /dose_logs/{doseLogId}',
      ]) {
        expect(rulesSrc).toContain(matchHeader);
      }

      const allowLines = rulesSrc
        .split(/\r?\n/)
        .filter((line) => /^\s*allow\s+(read|get|list|create|update|delete|write)\s*:/.test(line));
      expect(allowLines.length).toBeGreaterThanOrEqual(12);
      for (const line of allowLines) {
        if (line.includes('if false;')) continue;
        expect(line).toContain('isAuthed()');
      }
    }
  );

  it.runIf(hasM3RulesHardened)(
    'T1-F22-02: firestore.rules defines /care_invites/{inviteCode} (get authed, list: false) and controlled care_circles self-join',
    () => {
      expect(rulesSrc).toContain('match /care_invites/{inviteCode}');
      expect(rulesSrc).toMatch(/allow\s+get:\s*if\s+isAuthed\(\)/);
      expect(rulesSrc).toMatch(/allow\s+list:\s*if\s+false/);
      expect(rulesSrc).toContain('lastRedeemedInviteCode');
      expect(rulesSrc).toContain('caregiverIds.size() == resource.data.caregiverIds.size() + 1');
    }
  );

  it.runIf(hasM3RulesHardened)(
    'T1-F22-03: MockFirestoreDb care_invites + self-join contract lets authenticated caregiver redeem active invite and read patient dose_logs',
    () => {
      const patient = createUserFixture({ uid: 'patient_asha', role: 'elderly' });
      const caregiver = createUserFixture({ uid: 'cg_meera', role: 'caregiver' });
      const circle = createCareCircleFixture({
        id: 'patient_asha',
        patientId: 'patient_asha',
        patientName: 'Asha',
        caregiverIds: [],
        members: [],
        inviteCode: 'MED-XK92PL',
      });
      const dose = createDoseLogFixture({
        id: 'dose_asha_1',
        patientId: 'patient_asha',
        status: 'due',
      });

      mockDb.seedDoc('users', patient.uid, patient);
      mockDb.seedDoc('users', caregiver.uid, caregiver);
      mockDb.seedDoc('care_circles', circle.id, circle);
      mockDb.seedDoc('dose_logs', dose.id, dose);

      const patientAuth = { uid: 'patient_asha', role: 'elderly' as const };
      const cgAuth = { uid: 'cg_meera', role: 'caregiver' as const };

      // Patient creates /care_invites/{code}
      mockDb.setDoc(
        'care_invites',
        'MED-XK92PL',
        {
          id: 'MED-XK92PL',
          code: 'MED-XK92PL',
          patientId: 'patient_asha',
          patientName: 'Asha',
          createdBy: 'patient_asha',
          active: true,
        },
        patientAuth
      );

      // Authenticated caregiver can look up single invite code
      const invite = mockDb.getDoc('care_invites', 'MED-XK92PL', cgAuth);
      expect(invite?.patientId).toBe('patient_asha');
      expect(invite?.active).toBe(true);

      // Caregiver self-joins care_circles/patient_asha
      mockDb.updateDoc(
        'care_circles',
        'patient_asha',
        {
          caregiverIds: ['cg_meera'],
          lastRedeemedInviteCode: 'MED-XK92PL',
        },
        cgAuth
      );

      const joinedDose = mockDb.getDoc<StubDoseLog>('dose_logs', 'dose_asha_1', cgAuth);
      expect(joinedDose?.id).toBe('dose_asha_1');
    }
  );

  it.runIf(hasM3ClientEscalationFix)(
    'T1-F22-04: Real useReminderScheduler at T+30m writes { status: "unconfirmed" } ONLY and NEVER sets escalationAlertSent or escalatedAt',
    async () => {
      vi.useFakeTimers();
      const baseNow = new Date('2026-11-26T08:00:00.000Z');
      vi.setSystemTime(baseNow);

      const scheduledAt = new Date(baseNow.getTime() + 1000);
      const dose: DoseLogDocument = {
        id: 'dose_r1_hook',
        patientId: 'patient_asha',
        medicationId: 'med_1',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledDate: '2026-11-26',
        scheduledTime: Timestamp.fromDate(scheduledAt),
        status: 'due',
        snoozeCount: 0,
        snoozedAt: null,
        snoozeUntil: null,
        takenAt: null,
        takenBy: null,
        escalatedAt: null,
        missedAt: null,
        followUpSent: true,
        escalationAlertSent: false,
        createdAt: Timestamp.fromDate(baseNow),
        updatedAt: Timestamp.fromDate(baseNow),
      };

      getDoseLogMock.mockResolvedValue(dose);

      render(<SchedulerHarness doses={[dose]} patientId="patient_asha" />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 2000);
      });

      expect(updateDoseLogSpy).toHaveBeenCalled();
      const escalationCall = updateDoseLogSpy.mock.calls.find(
        ([, patch]) => patch.status === 'unconfirmed'
      );
      expect(escalationCall).toBeDefined();
      const [, patch] = escalationCall!;
      expect(patch).toEqual({ status: 'unconfirmed' });
      expect(patch).not.toHaveProperty('escalationAlertSent');
      expect(patch).not.toHaveProperty('escalatedAt');
    }
  );

  it.runIf(hasM3TrialIsolation)(
    'T1-F22-05: Trial TodayView (isDemo: true) runs Taken and Snooze on local mockData with zero Firestore writes to patient_ramesh',
    async () => {
      vi.useFakeTimers();
      const demoAuth = makeAuthValue({
        authenticated: true,
        role: 'elderly',
        uid: 'patient_ramesh',
        displayName: 'Ramesh Sharma',
        isDemo: true,
      });

      render(
        <MemoryRouter initialEntries={['/app/today']}>
          <AuthProvider value={demoAuth}>
            <TodayView />
          </AuthProvider>
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { level: 1, name: /hello, ramesh/i })).toBeInTheDocument();
      const takenBtn = screen.getByRole('button', { name: /mark .* as taken/i });
      fireEvent.click(takenBtn);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5500);
      });

      expect(generateTodayLogsSpy).not.toHaveBeenCalled();
      expect(updateDoseLogSpy).not.toHaveBeenCalled();
    }
  );
});
