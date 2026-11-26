import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import {
  MockFirestoreDb,
  PermissionDeniedError,
  createCareCircleFixture,
  createDoseLogFixture,
  createUserFixture,
  type FirestoreRecord,
} from '@harness/index';
import {
  MockAdminFirestore,
  createMockAdminMessaging,
} from '@harness/mockAdminFirestore';
import {
  PROJECT_ROOT,
  createMockFirestoreAdapter,
  hasProjectFile,
  hasServerRuntimeReady,
  loadOptionalModule,
  localTodayISO,
  makeAuthValue,
} from '@harness/reactTestHelper';
import { Timestamp } from 'firebase/firestore';
import type { CareCircleDocument, CareCircleMember, DoseLogDocument } from '@/types/firestore';

const signInWithEmailAndPasswordMock = vi.fn();
const createUserWithEmailAndPasswordMock = vi.fn();
const signInWithPopupMock = vi.fn();
const signInWithRedirectMock = vi.fn();
const getRedirectResultMock = vi.fn(async () => null);
const sendPasswordResetEmailMock = vi.fn();
const firebaseSignOutMock = vi.fn(async () => {});

class MockGoogleAuthProvider {
  setCustomParameters = vi.fn();
}

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: (...args: unknown[]) => signInWithEmailAndPasswordMock(...args),
  createUserWithEmailAndPassword: (...args: unknown[]) =>
    createUserWithEmailAndPasswordMock(...args),
  signInWithPopup: (...args: unknown[]) => signInWithPopupMock(...args),
  signInWithRedirect: (...args: unknown[]) => signInWithRedirectMock(...args),
  getRedirectResult: (...args: unknown[]) => getRedirectResultMock(...args),
  updateProfile: vi.fn(async () => {}),
  signOut: (...args: unknown[]) => firebaseSignOutMock(...args),
  sendPasswordResetEmail: (...args: unknown[]) => sendPasswordResetEmailMock(...args),
  GoogleAuthProvider: MockGoogleAuthProvider,
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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
const getUserDocumentMock = vi.fn();
const upsertUserDocumentMock = vi.fn(async () => {});
const generateTodayLogsSpy = vi.fn(async () => ({ created: 0, skipped: 0 }));
const inviteCareCircleMemberSpy = vi.fn(
  async (patientId: string, member: CareCircleMember) => {
    const existing = mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', patientId);
    if (!existing) throw new Error('Care circle not found');
    mockDb.updateDoc(
      'care_circles',
      patientId,
      { members: [...(existing.members ?? []), member], updatedAt: new Date() },
      currentActor
    );
  }
);

vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: { currentUser: null },
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
  getUserDocument: (...args: unknown[]) => getUserDocumentMock(...args),
  upsertUserDocument: (...args: unknown[]) => upsertUserDocumentMock(...args),
  getCareCircle: vi.fn(async () => null),
  updateUserAccessibilityPreferences: vi.fn(async () => {}),
  inviteCareCircleMember: (patientId: string, member: CareCircleMember) =>
    inviteCareCircleMemberSpy(patientId, member),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: () => generateTodayLogsSpy(),
  generateTodayLogsForMedication: (...args: Parameters<typeof bridge.generateTodayLogsForMedication>) =>
    bridge.generateTodayLogsForMedication(...args),
}));

vi.mock('@/lib/sound', () => ({
  playConfirmationChime: vi.fn(),
}));

import { LoginScreen } from '@/components/auth/LoginScreen';
import { useReminderScheduler } from '@/hooks/useReminderScheduler';
import { TodayView } from '@/pages/TodayView';

interface ExpressLikeApp {
  (req: http.IncomingMessage, res: http.ServerResponse): void;
}

async function startTestServer(app: ExpressLikeApp): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind ephemeral port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

const serverIndexSrc = hasProjectFile('server/src/index.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/index.ts'), 'utf-8')
  : '';
const serverEscSrc = hasProjectFile('server/src/jobs/dueDosesEscalation.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/jobs/dueDosesEscalation.ts'), 'utf-8')
  : '';
const loginSrc = hasProjectFile('src/components/auth/LoginScreen.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/components/auth/LoginScreen.tsx'), 'utf-8')
  : '';
const authCtxSrc = hasProjectFile('src/contexts/AuthContext.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/contexts/AuthContext.tsx'), 'utf-8')
  : '';
const appShellSrc = hasProjectFile('src/components/layout/AppShell.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/components/layout/AppShell.tsx'), 'utf-8')
  : '';
const rulesSrc = hasProjectFile('firestore.rules')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'firestore.rules'), 'utf-8')
  : '';
const schedulerSrc = hasProjectFile('src/hooks/useReminderScheduler.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/hooks/useReminderScheduler.ts'), 'utf-8')
  : '';
const todayViewSrc = hasProjectFile('src/pages/TodayView.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/TodayView.tsx'), 'utf-8')
  : '';
const caregiverDashboardSrc = hasProjectFile('src/pages/CaregiverDashboard.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/CaregiverDashboard.tsx'), 'utf-8')
  : '';

const hasM1Backend =
  hasServerRuntimeReady() &&
  hasProjectFile('server/src/jobs/eodMissedCloseout.ts') &&
  serverIndexSrc.includes('/ping') &&
  serverIndexSrc.includes('/api/jobs/close-missed-doses') &&
  serverEscSrc.includes('!data.escalationAlertSent');

const hasM2AuthUx =
  loginSrc.includes('trial-demo-section') &&
  loginSrc.includes('google-role-confirmation') &&
  authCtxSrc.includes('refreshUserProfile') &&
  appShellSrc.includes('trial-mode-banner');

const hasM3RulesAndClientR1 =
  !rulesSrc.includes('isDemoPatient') &&
  rulesSrc.includes('care_invites') &&
  schedulerSrc.includes("status: 'unconfirmed'") &&
  !schedulerSrc.includes('escalationAlertSent: true') &&
  todayViewSrc.includes('isDemoSession');

const hasM4MultiTenancy =
  hasProjectFile('src/lib/careCircleService.ts') &&
  !caregiverDashboardSrc.includes("'9876543210'") &&
  caregiverDashboardSrc.includes('careCircleService');

function registerCareCircleServiceMock() {
  if (!hasProjectFile('src/lib/careCircleService.ts')) return;
  vi.doMock('@/lib/careCircleService', () => ({
    generateInviteCode: () => bridge.generateInviteCode(),
    lookupCareInvite: (code: string) => bridge.lookupCareInvite(code),
    createOrSyncCareInvite: (input: Parameters<typeof bridge.createOrSyncCareInvite>[0]) =>
      bridge.createOrSyncCareInvite(input),
    subscribeToCareCirclesForCaregiver: (
      caregiverUid: string,
      cb: Parameters<typeof bridge.subscribeToCareCirclesForCaregiver>[1],
      onErr?: Parameters<typeof bridge.subscribeToCareCirclesForCaregiver>[2]
    ) => bridge.subscribeToCareCirclesForCaregiver(caregiverUid, cb, onErr),
    getCareCirclesForCaregiver: (caregiverUid: string) =>
      bridge.getCareCirclesForCaregiver(caregiverUid),
    redeemCareInviteCode: (
      rawCode: string,
      caregiver: { uid: string; displayName: string; email: string }
    ) => bridge.redeemCareInviteCode(rawCode, caregiver),
  }));
}

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

function StatefulDemoApp() {
  const [authVal, setAuthVal] = useState<AuthContextValue>(() =>
    makeAuthValue({
      authenticated: false,
      loginAsDemo: (role) => {
        setAuthVal(
          makeAuthValue({
            authenticated: true,
            role,
            uid: role === 'caregiver' ? 'caregiver_priya' : 'patient_ramesh',
            displayName: role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma',
            isDemo: true,
          })
        );
      },
    })
  );

  return (
    <MemoryRouter initialEntries={['/login']}>
      <AuthProvider value={authVal}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/app/today" element={<TodayView />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Tier 3 — R1–R7 & Google Sign-In Pairwise Interactions', () => {
  const originalEnv = { ...process.env };
  let activeClose: (() => Promise<void>) | null = null;

  beforeEach(() => {
    mockDb.clearAll();
    updateDoseLogSpy.mockClear();
    getDoseLogMock.mockReset();
    getUserDocumentMock.mockReset();
    upsertUserDocumentMock.mockReset();
    upsertUserDocumentMock.mockResolvedValue(undefined);
    generateTodayLogsSpy.mockClear();
    inviteCareCircleMemberSpy.mockClear();
    signInWithPopupMock.mockReset();
    sendPasswordResetEmailMock.mockReset();
    currentActor = { uid: 'patient_asha', role: 'elderly' };
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (activeClose) {
      await activeClose();
      activeClose = null;
    }
    process.env = { ...originalEnv };
  });

  it.runIf(hasM1Backend && hasM3RulesAndClientR1)(
    'T3-R1R3-01: [R1 Browser T+30m + Backend Escalation + R3 EOD Closeout] client unconfirmed triggers FCM escalation then midnight EOD closes to missed',
    async () => {
      vi.useFakeTimers();
      const baseNow = new Date('2026-11-26T08:00:00.000Z');
      vi.setSystemTime(baseNow);

      const adminDb = new MockAdminFirestore();
      const { messaging, sentMessages } = createMockAdminMessaging();
      adminDb.seed('users', 'patient_asha', {
        uid: 'patient_asha',
        timezone: 'UTC',
        fcmTokens: ['pat_tok'],
      });
      adminDb.seed('users', 'cg_vikram', {
        uid: 'cg_vikram',
        fcmTokens: ['cg_tok'],
      });
      adminDb.seed('care_circles', 'patient_asha', {
        patientId: 'patient_asha',
        caregiverIds: ['cg_vikram'],
      });

      const scheduledAt = new Date(baseNow.getTime() + 1000);
      adminDb.seed('dose_logs', 'dose_r1r3', {
        patientId: 'patient_asha',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledDate: '2026-11-26',
        scheduledTime: scheduledAt,
        status: 'due',
        snoozeCount: 0,
        followUpSent: true,
        escalationAlertSent: false,
      });

      const clientDose: DoseLogDocument = {
        id: 'dose_r1r3',
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

      getDoseLogMock.mockResolvedValue(clientDose);
      mockDb.seedDoc('care_circles', 'patient_asha', {
        id: 'patient_asha',
        patientId: 'patient_asha',
        caregiverIds: ['cg_vikram'],
        members: [],
      });
      mockDb.seedDoc('dose_logs', 'dose_r1r3', {
        ...clientDose,
        scheduledTime: scheduledAt,
        createdAt: baseNow,
        updatedAt: baseNow,
      });

      render(<SchedulerHarness doses={[clientDose]} patientId="patient_asha" />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 2000);
      });

      const clientPatch = updateDoseLogSpy.mock.calls.find(
        ([id, p]) => id === 'dose_r1r3' && p.status === 'unconfirmed'
      )?.[1];
      expect(clientPatch).toEqual({ status: 'unconfirmed' });

      // Apply browser patch to Admin Firestore
      await adminDb.collection('dose_logs').doc('dose_r1r3').update(clientPatch!);
      vi.useRealTimers();

      const escMod = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[] }>;
      }>('server/src/jobs/dueDosesEscalation.ts');
      const eodMod = await loadOptionalModule<{
        closeMissedDoses: (
          db: unknown,
          now: Date
        ) => Promise<{ closedCount: number; missedIds: string[] }>;
      }>('server/src/jobs/eodMissedCloseout.ts');

      const escRes = await escMod.processDueDoses(
        adminDb,
        new Date('2026-11-26T08:35:00.000Z'),
        messaging
      );
      expect(escRes.escalatedIds).toEqual(['dose_r1r3']);
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].tokens).toContain('cg_tok');
      expect(adminDb.inspect('dose_logs', 'dose_r1r3')?.escalationAlertSent).toBe(true);

      // Past midnight UTC -> EOD closes to missed
      const afterMidnight = new Date('2026-11-27T00:05:00.000Z');
      const eodRes = await eodMod.closeMissedDoses(adminDb, afterMidnight);
      expect(eodRes.closedCount).toBe(1);
      expect(eodRes.missedIds).toEqual(['dose_r1r3']);
      expect(adminDb.inspect('dose_logs', 'dose_r1r3')?.status).toBe('missed');
      expect(adminDb.inspect('dose_logs', 'dose_r1r3')?.missedAt).toBeDefined();

      // Subsequent escalation scan skips closed 'missed' dose
      const postCloseEsc = await escMod.processDueDoses(adminDb, afterMidnight, messaging);
      expect(postCloseEsc.escalatedIds).toEqual([]);
    }
  );

  it.runIf(hasM1Backend)(
    'T3-R3R4-02: [R3 EOD Closeout + R4 Multi-TZ] at 18:30Z (00:00 IST / 13:30 EST) closes only IST past-midnight dose and generates IST next day',
    async () => {
      const serverIndex = await loadOptionalModule<{
        runMidnightTimezoneCycle: (
          db: unknown,
          now?: Date
        ) => Promise<{
          midnightTimezones: string[];
          closedCount: number;
          createdCount: number;
        }>;
      }>('server/src/index.ts');

      const adminDb = new MockAdminFirestore();
      adminDb.seed('users', 'p_ist', { uid: 'p_ist', timezone: 'Asia/Kolkata' });
      adminDb.seed('users', 'p_ny', { uid: 'p_ny', timezone: 'America/New_York' });

      adminDb.seed('medications', 'med_ist', {
        patientId: 'p_ist',
        name: 'Metformin',
        dosage: '500 mg',
        schedule: { times: ['21:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
        active: true,
      });
      adminDb.seed('medications', 'med_ny', {
        patientId: 'p_ny',
        name: 'Lisinopril',
        dosage: '10 mg',
        schedule: { times: ['21:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
        active: true,
      });

      // IST 21:00 on Nov 25 = 15:30Z
      adminDb.seed('dose_logs', 'ist_nov25_2100', {
        patientId: 'p_ist',
        scheduledDate: '2026-11-25',
        scheduledTime: new Date('2026-11-25T15:30:00.000Z'),
        status: 'unconfirmed',
      });
      // NY 11:00 on Nov 25 = 16:00Z (not past NY midnight at 18:30Z)
      adminDb.seed('dose_logs', 'ny_nov25_1100', {
        patientId: 'p_ny',
        scheduledDate: '2026-11-25',
        scheduledTime: new Date('2026-11-25T16:00:00.000Z'),
        status: 'due',
      });

      const cycle = await serverIndex.runMidnightTimezoneCycle(
        adminDb,
        new Date('2026-11-25T18:30:00.000Z')
      );

      expect(cycle.midnightTimezones).toEqual(['Asia/Kolkata']);
      expect(cycle.closedCount).toBe(1);
      expect(cycle.createdCount).toBe(1);
      expect(adminDb.inspect('dose_logs', 'ist_nov25_2100')?.status).toBe('missed');
      expect(adminDb.inspect('dose_logs', 'ny_nov25_1100')?.status).toBe('due');
      expect(adminDb.inspect('dose_logs', 'p_ist_med_ist_2026-11-26_2100')).not.toBeNull();
      expect(adminDb.inspect('dose_logs', 'p_ny_med_ny_2026-11-26_2100')).toBeNull();
    }
  );

  it.runIf(hasM1Backend)(
    'T3-R4R5-03: [R4 Multi-TZ + R5 Express Endpoints] GET /ping + POST generate-daily-logs + POST close-missed-doses succeed over HTTP',
    async () => {
      process.env.CRON_SECRET = 'pairwise_http_secret';
      const indexMod = await loadOptionalModule<{
        createApp: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');

      const adminDb = new MockAdminFirestore();
      adminDb.seed('users', 'p_ny', { uid: 'p_ny', timezone: 'America/New_York' });
      adminDb.seed('medications', 'med_ny', {
        patientId: 'p_ny',
        name: 'Lisinopril',
        dosage: '10 mg',
        schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
        active: true,
      });
      adminDb.seed('dose_logs', 'ny_past', {
        patientId: 'p_ny',
        scheduledDate: '2020-01-01',
        scheduledTime: new Date('2020-01-01T13:00:00.000Z'),
        status: 'due',
      });

      const srv = await startTestServer(
        indexMod.createApp({
          db: adminDb,
          messaging: null,
          isInitialized: true,
          jobsActive: false,
        })
      );
      activeClose = srv.close;

      const pingRes = await fetch(`${srv.baseUrl}/ping`);
      expect(pingRes.status).toBe(200);
      expect(((await pingRes.json()) as { ok: boolean }).ok).toBe(true);

      const genRes = await fetch(`${srv.baseUrl}/api/jobs/generate-daily-logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'pairwise_http_secret',
        },
        body: JSON.stringify({ targetDate: '2026-11-26' }),
      });
      expect(genRes.status).toBe(200);
      expect(((await genRes.json()) as { createdCount: number }).createdCount).toBe(1);
      const genTime = (
        adminDb.inspect('dose_logs', 'p_ny_med_ny_2026-11-26_0800')?.scheduledTime as {
          toDate: () => Date;
        }
      ).toDate();
      expect(genTime.toISOString()).toBe('2026-11-26T13:00:00.000Z');

      const closeRes = await fetch(`${srv.baseUrl}/api/jobs/close-missed-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'pairwise_http_secret' },
      });
      expect(closeRes.status).toBe(200);
      expect(((await closeRes.json()) as { closedCount: number }).closedCount).toBe(1);
      expect(adminDb.inspect('dose_logs', 'ny_past')?.status).toBe('missed');
    }
  );

  it.runIf(hasM2AuthUx && hasM3RulesAndClientR1)(
    'T3-R2R7-04: [R2 Trial Isolation + R7 Trial UX] Entering Trial Mode from LoginScreen shows AppShell Trial badge and runs TodayView on mockData with zero Firestore writes',
    async () => {
      vi.useFakeTimers();
      render(<StatefulDemoApp />);

      fireEvent.click(
        screen.getByRole('button', { name: /try older adult demo \(ramesh sharma\)/i })
      );

      expect(screen.getByTestId('trial-mode-banner')).toBeInTheDocument();
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

  it.runIf(hasM2AuthUx)(
    'T3-R4R7G-05: [R4 Signup TZ + R7 Google Sign-In + AuthContext] First-time Google Sign-In records IANA timezone, calls refreshUserProfile, and routes without reload',
    async () => {
      signInWithPopupMock.mockResolvedValue({
        user: {
          uid: 'google_pair_1',
          email: 'asha.pair@example.com',
          displayName: 'Asha Pair',
        },
      });
      getUserDocumentMock.mockResolvedValue(null);
      const refreshSpy = vi.fn(async () => {});
      const expectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

      const authVal = makeAuthValue({
        authenticated: false,
        refreshUserProfile: refreshSpy,
      });

      render(
        <MemoryRouter initialEntries={['/login']}>
          <AuthProvider value={authVal}>
            <Routes>
              <Route path="/login" element={<LoginScreen />} />
              <Route path="/app/caregiver" element={<h1>Caregiver Landing</h1>} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      );

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
      });

      expect(await screen.findByTestId('google-role-confirmation')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: /family caregiver/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /continue as family caregiver/i }));
      });

      await waitFor(() => {
        expect(upsertUserDocumentMock).toHaveBeenCalledTimes(1);
      });
      const [, doc] = upsertUserDocumentMock.mock.calls[0] as [string, Record<string, unknown>];
      expect(doc.role).toBe('caregiver');
      expect(doc.timezone).toBe(expectedTz);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('heading', { name: /caregiver landing/i })).toBeInTheDocument();
    }
  );

  it.runIf(hasM3RulesAndClientR1 && hasM4MultiTenancy)(
    'T3-R2R6-06: [R2 Rules + R6 Invite Pairing] Unlinked Caregiver Eve is denied reads, redeems invite code via self-join, and monitors Patient Asha while Ramesh stays isolated',
    async () => {
      const today = localTodayISO();
      const asha = createUserFixture({ uid: 'patient_asha', role: 'elderly', displayName: 'Asha Devi' });
      const eve = createUserFixture({ uid: 'cg_eve', role: 'caregiver', displayName: 'Eve' });
      mockDb.seedDoc('users', asha.uid, asha);
      mockDb.seedDoc('users', eve.uid, eve);
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          caregiverIds: [],
          members: [],
          inviteCode: 'MED-EVEP99',
        })
      );
      mockDb.seedDoc('care_invites', 'MED-EVEP99', {
        id: 'MED-EVEP99',
        code: 'MED-EVEP99',
        patientId: 'patient_asha',
        patientName: 'Asha Devi',
        createdBy: 'patient_asha',
        active: true,
      });
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha_1',
        createDoseLogFixture({
          id: 'dose_asha_1',
          patientId: 'patient_asha',
          medicationName: 'Atorvastatin',
          scheduledDate: today,
          status: 'due',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_ramesh_secret',
        createDoseLogFixture({
          id: 'dose_ramesh_secret',
          patientId: 'patient_ramesh',
          medicationName: 'SecretMed',
          scheduledDate: today,
          status: 'due',
        })
      );

      // Before pairing: Eve cannot read Asha's or Ramesh's dose logs
      const eveAuth = { uid: 'cg_eve', role: 'caregiver' as const };
      expect(() => mockDb.getDoc('dose_logs', 'dose_asha_1', eveAuth)).toThrow(
        PermissionDeniedError
      );
      expect(() => mockDb.getDoc('dose_logs', 'dose_ramesh_secret', eveAuth)).toThrow(
        PermissionDeniedError
      );

      currentActor = eveAuth;
      registerCareCircleServiceMock();
      const { CaregiverDashboard } = await loadOptionalModule<{
        CaregiverDashboard: React.ComponentType;
      }>('src/pages/CaregiverDashboard.tsx');

      const authVal = makeAuthValue({
        authenticated: true,
        role: 'caregiver',
        uid: 'cg_eve',
        displayName: 'Eve',
        isDemo: false,
      });

      render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      const codeInput = await screen.findByLabelText(/invite code/i);
      fireEvent.change(codeInput, { target: { value: 'MED-EVEP99' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect|join|pair/i }));
      });

      expect(await screen.findByText(/Atorvastatin/i)).toBeInTheDocument();
      expect(screen.queryByText(/SecretMed/i)).toBeNull();
      expect(() => mockDb.getDoc('dose_logs', 'dose_ramesh_secret', eveAuth)).toThrow(
        PermissionDeniedError
      );
    }
  );

  it.runIf(hasM1Backend && hasM3RulesAndClientR1 && hasM4MultiTenancy)(
    'T3-R1R6-07: [R1 Escalation + R6 Multi-Tenant Dashboard] Urgent banner scopes strictly to patient with unconfirmed escalated dose when switching patients',
    async () => {
      const today = localTodayISO();
      mockDb.seedDoc(
        'care_circles',
        'patient_a',
        createCareCircleFixture({
          id: 'patient_a',
          patientId: 'patient_a',
          patientName: 'Patient Alpha',
          caregiverIds: ['cg_vikram'],
          inviteCode: 'MED-ALPHA1',
        })
      );
      mockDb.seedDoc(
        'care_circles',
        'patient_b',
        createCareCircleFixture({
          id: 'patient_b',
          patientId: 'patient_b',
          patientName: 'Patient Beta',
          caregiverIds: ['cg_vikram'],
          inviteCode: 'MED-BETA02',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_alpha_ok',
        createDoseLogFixture({
          id: 'dose_alpha_ok',
          patientId: 'patient_a',
          medicationName: 'Vitamin D',
          scheduledDate: today,
          status: 'taken',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_beta_unconf',
        createDoseLogFixture({
          id: 'dose_beta_unconf',
          patientId: 'patient_b',
          medicationName: 'Warfarin',
          scheduledDate: today,
          status: 'unconfirmed',
          escalationAlertSent: true,
        })
      );

      currentActor = { uid: 'cg_vikram', role: 'caregiver' };
      registerCareCircleServiceMock();
      const { CaregiverDashboard } = await loadOptionalModule<{
        CaregiverDashboard: React.ComponentType;
      }>('src/pages/CaregiverDashboard.tsx');

      const authVal = makeAuthValue({
        authenticated: true,
        role: 'caregiver',
        uid: 'cg_vikram',
        displayName: 'Vikram',
        isDemo: false,
      });

      render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      await screen.findByText(/Vitamin D/i);
      expect(document.getElementById('unconfirmed-alert-banner')).toBeNull();

      const switcher = screen.getByRole('combobox', { name: /select patient|monitoring/i });
      fireEvent.change(switcher, { target: { value: 'patient_b' } });

      expect(await screen.findByText(/Warfarin/i)).toBeInTheDocument();
      const banner = document.getElementById('unconfirmed-alert-banner');
      expect(banner).not.toBeNull();
      expect(banner!.textContent).toContain('Patient Beta');
      expect(banner!.textContent).toContain('Warfarin');
    }
  );
});
