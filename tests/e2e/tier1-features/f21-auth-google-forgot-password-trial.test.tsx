import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  PROJECT_ROOT,
  hasProjectFile,
  makeAuthValue,
  makeUserProfile,
} from '@harness/reactTestHelper';

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

const getUserDocumentMock = vi.fn();
const upsertUserDocumentMock = vi.fn(async () => {});

vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: { currentUser: null },
  db: {},
  getMessagingInstance: vi.fn(async () => null),
  VAPID_KEY: undefined,
}));

vi.mock('@/lib/firestore', () => ({
  getUserDocument: (...args: unknown[]) => getUserDocumentMock(...args),
  upsertUserDocument: (...args: unknown[]) => upsertUserDocumentMock(...args),
  updateUserAccessibilityPreferences: vi.fn(async () => {}),
}));

import { LoginScreen } from '@/components/auth/LoginScreen';
import { AppShell } from '@/components/layout/AppShell';

const loginSrc = hasProjectFile('src/components/auth/LoginScreen.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/components/auth/LoginScreen.tsx'), 'utf-8')
  : '';
const authCtxSrc = hasProjectFile('src/contexts/AuthContext.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/contexts/AuthContext.tsx'), 'utf-8')
  : '';
const appShellSrc = hasProjectFile('src/components/layout/AppShell.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/components/layout/AppShell.tsx'), 'utf-8')
  : '';

const hasM2LoginUx =
  loginSrc.includes('trial-demo-section') && authCtxSrc.includes('refreshUserProfile');
const hasM2TrialBanner = appShellSrc.includes('trial-mode-banner');

function renderLoginWithRouter(authOverrides: Parameters<typeof makeAuthValue>[0] = {}) {
  const authVal = makeAuthValue({ authenticated: false, ...authOverrides });
  return {
    authVal,
    ...render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider value={authVal}>
          <Routes>
            <Route path="/login" element={<LoginScreen />} />
            <Route path="/app/today" element={<h1>Today Route</h1>} />
            <Route path="/app/caregiver" element={<h1>Caregiver Route</h1>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    ),
  };
}

describe('Tier 1 — F21: Auth UX, Google Sign-In, Forgot Password & Trial Mode (R4-tz, R7, Google)', () => {
  beforeEach(() => {
    signInWithEmailAndPasswordMock.mockReset();
    createUserWithEmailAndPasswordMock.mockReset();
    signInWithPopupMock.mockReset();
    signInWithRedirectMock.mockReset();
    getRedirectResultMock.mockReset();
    getRedirectResultMock.mockResolvedValue(null);
    sendPasswordResetEmailMock.mockReset();
    getUserDocumentMock.mockReset();
    upsertUserDocumentMock.mockReset();
    upsertUserDocumentMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('T1-F21-01: [PASS-NOW] Clicking Forgot password? and submitting valid email calls sendPasswordResetEmail and shows status banner', async () => {
    sendPasswordResetEmailMock.mockResolvedValue(undefined);
    renderLoginWithRouter();

    const forgotBtn = screen.getByRole('button', { name: /forgot password\?/i });
    fireEvent.click(forgotBtn);

    const emailInput = screen.getByLabelText(/email address/i);
    fireEvent.change(emailInput, { target: { value: 'asha@example.com' } });

    const submitResetBtn = screen.queryByRole('button', { name: /send reset link/i });
    if (submitResetBtn) {
      await act(async () => {
        fireEvent.click(submitResetBtn);
      });
    } else {
      await act(async () => {
        fireEvent.click(forgotBtn);
      });
    }

    await waitFor(() => {
      expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
    });
    expect(sendPasswordResetEmailMock.mock.calls[0][1]).toBe('asha@example.com');
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/asha@example\.com|reset/i);
  });

  it('T1-F21-02: [PASS-NOW] First-time Continue with Google creates UserDocument via upsertUserDocument and navigates to role route', async () => {
    signInWithPopupMock.mockResolvedValue({
      user: {
        uid: 'google_new_1',
        email: 'new.google@example.com',
        displayName: 'Asha Patel',
      },
    });
    getUserDocumentMock.mockResolvedValue(null);

    renderLoginWithRouter();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    });

    // If M2 role-confirmation step is active, confirm as Family Caregiver
    const confirmStep = screen.queryByTestId('google-role-confirmation');
    if (confirmStep) {
      fireEvent.click(screen.getByRole('radio', { name: /family caregiver/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /continue as family caregiver/i }));
      });
    }

    await waitFor(() => {
      expect(upsertUserDocumentMock).toHaveBeenCalledTimes(1);
    });

    const [uidArg, docArg] = upsertUserDocumentMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(uidArg).toBe('google_new_1');
    expect(docArg.email).toBe('new.google@example.com');
    expect(docArg.displayName).toBe('Asha Patel');

    if (confirmStep) {
      expect(docArg.role).toBe('caregiver');
      expect(screen.getByRole('heading', { name: /caregiver route/i })).toBeInTheDocument();
    } else {
      expect(screen.getByRole('heading', { name: /today route/i })).toBeInTheDocument();
    }
  });

  it('T1-F21-03: [PASS-NOW] Returning Google user with existing caregiver profile preserves stored role regardless of selected toggle', async () => {
    signInWithPopupMock.mockResolvedValue({
      user: {
        uid: 'google_existing_cg',
        email: 'existing.cg@example.com',
        displayName: 'Vikram Rao',
      },
    });
    getUserDocumentMock.mockResolvedValue(
      makeUserProfile('caregiver', {
        uid: 'google_existing_cg',
        email: 'existing.cg@example.com',
        displayName: 'Vikram Rao',
      })
    );

    renderLoginWithRouter();

    // Ensure Older Adult is selected on role toggle if visible
    const elderlyRadio = screen.queryByRole('radio', { name: /older adult/i });
    if (elderlyRadio) {
      fireEvent.click(elderlyRadio);
    }

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /caregiver route/i })).toBeInTheDocument();
    });
    expect(upsertUserDocumentMock).not.toHaveBeenCalled();
  });

  it.runIf(hasM2LoginUx)(
    'T1-F21-04: New email signup & first-time Google Sign-In capture valid browser IANA timezone and trigger refreshUserProfile',
    async () => {
      const refreshSpy = vi.fn(async () => {});
      createUserWithEmailAndPasswordMock.mockResolvedValue({
        user: { uid: 'signup_tz_1', email: 'tz1@example.com' },
      });

      const resolvedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';

      const { unmount } = renderLoginWithRouter({ refreshUserProfile: refreshSpy });
      fireEvent.click(screen.getByRole('tab', { name: /create new account/i }));
      fireEvent.change(screen.getByLabelText(/your full name/i), {
        target: { value: 'Kiran Nair' },
      });
      fireEvent.change(screen.getByLabelText(/email address/i), {
        target: { value: 'tz1@example.com' },
      });
      fireEvent.change(screen.getByLabelText(/password/i), {
        target: { value: 'secret123' },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /create .* account/i }));
      });

      await waitFor(() => {
        expect(upsertUserDocumentMock).toHaveBeenCalledTimes(1);
      });
      const [, emailDoc] = upsertUserDocumentMock.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(emailDoc.timezone).toBe(resolvedTz);
      expect(refreshSpy).toHaveBeenCalledTimes(1);

      unmount();
      upsertUserDocumentMock.mockClear();
      refreshSpy.mockClear();

      signInWithPopupMock.mockResolvedValue({
        user: { uid: 'google_tz_2', email: 'tz2@example.com', displayName: 'Meera' },
      });
      getUserDocumentMock.mockResolvedValue(null);

      renderLoginWithRouter({ refreshUserProfile: refreshSpy });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /continue as older adult/i }));
      });

      await waitFor(() => {
        expect(upsertUserDocumentMock).toHaveBeenCalledTimes(1);
      });
      const [, googleDoc] = upsertUserDocumentMock.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      expect(googleDoc.timezone).toBe(resolvedTz);
      expect(refreshSpy).toHaveBeenCalledTimes(1);
    }
  );

  it.runIf(hasM2LoginUx)(
    'T1-F21-05: LoginScreen presents personal account auth (Google + Email) primary above demarcated Trial Demo section',
    () => {
      renderLoginWithRouter();

      const googleBtn = screen.getByRole('button', { name: /continue with google/i });
      const signInTab = screen.getByRole('tab', { name: /sign in/i });
      const trialSection = screen.getByTestId('trial-demo-section');

      expect(googleBtn).toBeInTheDocument();
      expect(signInTab).toBeInTheDocument();
      expect(trialSection).toBeInTheDocument();
      expect(trialSection.textContent).toMatch(/sample data|trial/i);

      // Personal auth controls appear earlier in document order than Trial Demo section
      const order = googleBtn.compareDocumentPosition(trialSection);
      expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  );

  it.runIf(hasM2TrialBanner)(
    'T1-F21-06: AppShell renders explicit Trial Mode banner when isDemoSession is true and hides it for real authenticated users',
    () => {
      const demoAuth = makeAuthValue({
        authenticated: true,
        role: 'elderly',
        uid: 'patient_ramesh',
        isDemo: true,
      });

      const { unmount } = render(
        <MemoryRouter initialEntries={['/app/today']}>
          <AuthProvider value={demoAuth}>
            <AppShell>
              <div>Demo Child</div>
            </AppShell>
          </AuthProvider>
        </MemoryRouter>
      );

      const banner = screen.getByTestId('trial-mode-banner');
      expect(banner).toBeInTheDocument();
      expect(banner.textContent).toMatch(/trial mode|sample data/i);
      unmount();

      const realAuth = makeAuthValue({
        authenticated: true,
        role: 'elderly',
        uid: 'real_user_123',
        displayName: 'Kamala Iyer',
        isDemo: false,
      });

      render(
        <MemoryRouter initialEntries={['/app/today']}>
          <AuthProvider value={realAuth}>
            <AppShell>
              <div>Real Child</div>
            </AppShell>
          </AuthProvider>
        </MemoryRouter>
      );

      expect(screen.queryByTestId('trial-mode-banner')).toBeNull();
    }
  );
});
