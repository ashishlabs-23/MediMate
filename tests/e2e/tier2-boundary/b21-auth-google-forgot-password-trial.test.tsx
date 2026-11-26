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
} from '@harness/reactTestHelper';

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

const getUserDocumentMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const upsertUserDocumentMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

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

const loginSrc = hasProjectFile('src/components/auth/LoginScreen.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/components/auth/LoginScreen.tsx'), 'utf-8')
  : '';
const authCtxSrc = hasProjectFile('src/contexts/AuthContext.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/contexts/AuthContext.tsx'), 'utf-8')
  : '';

const hasM2LoginUx =
  loginSrc.includes('trial-demo-section') &&
  loginSrc.includes('google-role-confirmation') &&
  authCtxSrc.includes('refreshUserProfile');

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

describe('Tier 2 — B21: Auth UX, Google Sign-In & Forgot Password Boundaries (R7 + Google)', () => {
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

  it('T2-B21-01: [PASS-NOW] Forgot Password rejects empty, whitespace, and malformed emails locally and surfaces role="alert" on auth/user-not-found', async () => {
    renderLoginWithRouter();

    fireEvent.click(screen.getByRole('button', { name: /forgot password\?/i }));
    const emailInput = screen.getByLabelText(/email address/i);
    const submitResetBtn = screen.getByRole('button', { name: /send reset link/i });

    for (const invalidEmail of ['', '   ', 'invalid-email']) {
      fireEvent.change(emailInput, { target: { value: invalidEmail } });
      await act(async () => {
        fireEvent.click(submitResetBtn);
      });
      expect(sendPasswordResetEmailMock).not.toHaveBeenCalled();
      expect(screen.getByRole('alert')).toBeInTheDocument();
    }

    sendPasswordResetEmailMock.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    fireEvent.change(emailInput, { target: { value: 'missing.user@example.com' } });
    await act(async () => {
      fireEvent.click(submitResetBtn);
    });

    await waitFor(() => {
      expect(sendPasswordResetEmailMock).toHaveBeenCalledTimes(1);
    });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/no account found|not found/i);
  });

  it('T2-B21-02: [PASS-NOW] Switching to Create New Account hides Forgot password? and clears prior error/status banners', async () => {
    renderLoginWithRouter();

    // Trigger an error banner in Sign In mode
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^sign in$/i }));
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /forgot password\?/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /create new account/i }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /forgot password\?/i })).toBeNull();
  });

  it('T2-B21-03: [PASS-NOW] Google Sign-In popup closed/cancelled exits silently with zero error banner and re-enables buttons', async () => {
    renderLoginWithRouter();
    const googleBtn = screen.getByRole('button', { name: /continue with google/i });

    for (const code of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request']) {
      signInWithPopupMock.mockRejectedValueOnce({ code });
      await act(async () => {
        fireEvent.click(googleBtn);
      });

      expect(screen.queryByRole('alert')).toBeNull();
      expect(googleBtn).not.toBeDisabled();
      expect(screen.getByRole('button', { name: /^sign in$/i })).not.toBeDisabled();
    }
  });

  it('T2-B21-04: [PASS-NOW] Google Sign-In Firebase errors surface clear accessible role="alert" guidance', async () => {
    renderLoginWithRouter();
    const googleBtn = screen.getByRole('button', { name: /continue with google/i });

    const errorCases: Array<{ code: string; pattern: RegExp }> = [
      { code: 'auth/configuration-not-found', pattern: /not activated|firebase console/i },
      { code: 'auth/operation-not-allowed', pattern: /disabled|enable/i },
      { code: 'auth/account-exists-with-different-credential', pattern: /different sign-in method|email/i },
      { code: 'auth/popup-blocked', pattern: /popup was blocked|allow popups/i },
    ];

    for (const { code, pattern } of errorCases) {
      if (code === 'auth/popup-blocked') {
        signInWithRedirectMock.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
      }
      signInWithPopupMock.mockRejectedValueOnce({ code });
      await act(async () => {
        fireEvent.click(googleBtn);
      });

      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(pattern);
      expect(googleBtn).not.toBeDisabled();
    }
  });

  it.runIf(hasM2LoginUx)(
    'T2-B21-05: Double-clicking Continue with Google while submitting disables button and invokes signInWithPopup once',
    async () => {
      let resolvePopup!: (val: unknown) => void;
      signInWithPopupMock.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePopup = resolve;
          })
      );
      getUserDocumentMock.mockResolvedValue(null);

      renderLoginWithRouter();
      const googleBtn = screen.getByRole('button', { name: /continue with google/i });

      fireEvent.click(googleBtn);
      expect(googleBtn).toBeDisabled();
      fireEvent.click(googleBtn);

      expect(signInWithPopupMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolvePopup({
          user: { uid: 'g_dbl_1', email: 'dbl@example.com', displayName: 'Test User' },
        });
      });

      expect(await screen.findByTestId('google-role-confirmation')).toBeInTheDocument();
    }
  );

  it.runIf(hasM2LoginUx)(
    'T2-B21-06: First-time Google Sign-In with null displayName and empty Intl timezone falls back safely to role name and Asia/Kolkata',
    async () => {
      const origDateTimeFormat = Intl.DateTimeFormat;
      vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((...args: unknown[]) => {
        const instance = new origDateTimeFormat(...(args as [string?, Intl.DateTimeFormatOptions?]));
        return {
          ...instance,
          format: instance.format.bind(instance),
          formatToParts: instance.formatToParts.bind(instance),
          formatRange: instance.formatRange.bind(instance),
          formatRangeToParts: instance.formatRangeToParts.bind(instance),
          resolvedOptions: () => ({
            ...instance.resolvedOptions(),
            timeZone: '',
          }),
        } as Intl.DateTimeFormat;
      });

      signInWithPopupMock.mockResolvedValue({
        user: {
          uid: 'g_null_name',
          email: 'noname@example.com',
          displayName: null,
        },
      });
      getUserDocumentMock.mockResolvedValue(null);

      renderLoginWithRouter();

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));
      });

      const confirmStep = await screen.findByTestId('google-role-confirmation');
      expect(confirmStep).toBeInTheDocument();

      fireEvent.click(screen.getByRole('radio', { name: /family caregiver/i }));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /continue as family caregiver/i }));
      });

      await waitFor(() => {
        expect(upsertUserDocumentMock).toHaveBeenCalledTimes(1);
      });
      const [, doc] = upsertUserDocumentMock.mock.calls[0] as unknown as [string, Record<string, unknown>];
      expect(doc.displayName).toBe('Caregiver');
      expect(doc.timezone).toBe('Asia/Kolkata');
    }
  );
});
