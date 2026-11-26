import fs from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb } from '@harness/index';
import {
  PROJECT_ROOT,
  createMockFirestoreAdapter,
  hasProjectFile,
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
} from '@harness/reactTestHelper';
import type { DoseLogDocument } from '@/types/firestore';

const signInWithEmailAndPasswordMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const createUserWithEmailAndPasswordMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const signInWithPopupMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const signInWithRedirectMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getRedirectResultMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
const sendPasswordResetEmailMock = vi.fn<(...args: unknown[]) => Promise<void>>();
const firebaseSignOutMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

vi.mock('firebase/auth', () => {
  class MockGoogleAuthProvider {
    setCustomParameters = vi.fn();
  }
  return {
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
  };
});

const mockDb = new MockFirestoreDb();
const bridge = createMockFirestoreAdapter(mockDb, () => ({
  uid: 'patient_ramesh',
  role: 'elderly',
}));

const getUserDocumentMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const upsertUserDocumentMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const updateDoseLogSpy = vi.fn(
  async (doseId: string, patch: Partial<Omit<DoseLogDocument, 'id' | 'patientId' | 'createdAt'>>) =>
    bridge.updateDoseLog(doseId, patch)
);
const generateTodayLogsSpy = vi.fn(async () => ({ created: 0, skipped: 0 }));

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
  getDoseLog: vi.fn(async () => null),
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

import { LoginScreen } from '@/components/auth/LoginScreen';
import { AppShell } from '@/components/layout/AppShell';
import { TodayView } from '@/pages/TodayView';

const loginSrc = hasProjectFile('src/components/auth/LoginScreen.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/components/auth/LoginScreen.tsx'), 'utf-8')
  : '';
const authCtxSrc = hasProjectFile('src/contexts/AuthContext.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/contexts/AuthContext.tsx'), 'utf-8')
  : '';
const appShellSrc = hasProjectFile('src/components/layout/AppShell.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/components/layout/AppShell.tsx'), 'utf-8')
  : '';
const todayViewSrc = hasProjectFile('src/pages/TodayView.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/TodayView.tsx'), 'utf-8')
  : '';

const hasM2 =
  loginSrc.includes('trial-demo-section') &&
  loginSrc.includes('google-role-confirmation') &&
  authCtxSrc.includes('refreshUserProfile') &&
  appShellSrc.includes('trial-mode-banner');
const hasM3Trial = todayViewSrc.includes('isDemoSession');

function JourneyAuthHarness({
  refreshSpy,
}: {
  refreshSpy: ReturnType<typeof vi.fn<() => Promise<void>>>;
}) {
  const [authVal, setAuthVal] = useState<AuthContextValue>(() =>
    makeAuthValue({
      authenticated: false,
      refreshUserProfile: async () => {
        await refreshSpy();
        setAuthVal(
          makeAuthValue({
            authenticated: true,
            role: 'caregiver',
            uid: 'google_cg_journey',
            displayName: 'Meera Kapoor',
            isDemo: false,
          })
        );
      },
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
          <Route
            path="/app/caregiver"
            element={
              <AppShell>
                <h1>Caregiver Journey View</h1>
              </AppShell>
            }
          />
        </Routes>
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Tier 4 — Scenario 10: Google Auth Recovery & Trial Mode Sandbox Isolation (R2, R4, R7, Google)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    signInWithEmailAndPasswordMock.mockReset();
    signInWithPopupMock.mockReset();
    sendPasswordResetEmailMock.mockReset();
    getUserDocumentMock.mockReset();
    upsertUserDocumentMock.mockReset();
    upsertUserDocumentMock.mockResolvedValue(undefined);
    updateDoseLogSpy.mockClear();
    generateTodayLogsSpy.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.runIf(hasM2)(
    'T4-S10-01: User triggers Forgot Password reset, recovers via Continue with Google as Caregiver, hydrates AuthContext without Trial banner',
    async () => {
      sendPasswordResetEmailMock.mockResolvedValue(undefined);
      signInWithPopupMock.mockResolvedValue({
        user: {
          uid: 'google_cg_journey',
          email: 'meera.kapoor@example.com',
          displayName: 'Meera Kapoor',
        },
      });
      getUserDocumentMock.mockResolvedValue(null);
      const refreshSpy = vi.fn(async () => {});
      const expectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

      render(<JourneyAuthHarness refreshSpy={refreshSpy} />);

      // Step 1: Forgot password flow
      fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }));
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'meera.kapoor@example.com' },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /send reset link/i }));
      });
      expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toBeInTheDocument();

      // Step 2: Back to Sign In and Continue with Google
      fireEvent.click(screen.getByRole('button', { name: /back to sign in/i }));
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
      const [, doc] = upsertUserDocumentMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(doc.timezone).toBe(expectedTz);
      expect(doc.role).toBe('caregiver');
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      expect(
        await screen.findByRole('heading', { name: /caregiver journey view/i })
      ).toBeInTheDocument();
      expect(screen.queryByTestId('trial-mode-banner')).toBeNull();
    }
  );

  it.runIf(hasM2 && hasM3Trial)(
    'T4-S10-02: Unauthenticated visitor enters Trial Mode, confirms demo dose in TodayView, switches to Caregiver View with zero Firestore writes',
    async () => {
      vi.useFakeTimers();
      const refreshSpy = vi.fn(async () => {});

      render(<JourneyAuthHarness refreshSpy={refreshSpy} />);

      // Enter Trial Mode from demarcated section
      fireEvent.click(
        screen.getByRole('button', { name: /try older adult demo \(ramesh sharma\)/i })
      );

      expect(screen.getByTestId('trial-mode-banner')).toBeInTheDocument();
      expect(screen.getByRole('heading', { level: 1, name: /hello, ramesh/i })).toBeInTheDocument();

      // Mark a demo dose taken and let 5s undo timer elapse
      fireEvent.click(screen.getByRole('button', { name: /mark .* as taken/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5500);
      });

      // Switch to Caregiver View using RoleSwitcher
      fireEvent.click(screen.getByRole('button', { name: /caregiver view/i }));
      expect(screen.getByRole('heading', { name: /caregiver journey view/i })).toBeInTheDocument();
      expect(screen.getByTestId('trial-mode-banner')).toBeInTheDocument();

      // Zero live Firestore writes attempted
      expect(generateTodayLogsSpy).not.toHaveBeenCalled();
      expect(updateDoseLogSpy).not.toHaveBeenCalled();
      expect(makeUserProfile('elderly').uid).toBe('patient_ramesh');
    }
  );
});
