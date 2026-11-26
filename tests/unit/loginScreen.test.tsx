import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { LoginScreen } from '../../src/components/auth/LoginScreen';
import { AuthProvider, type AuthContextValue } from '../../src/contexts/AuthContext';
import type { UserDocument, UserRole } from '../../src/types/firestore';
import { checkAriaCompliance, checkTouchTarget } from '../e2e/harness/accessibilityHelper';

const {
  mockAuthObj,
  mockSignInWithEmailAndPassword,
  mockCreateUserWithEmailAndPassword,
  mockSignInWithPopup,
  mockSignInWithRedirect,
  mockGetRedirectResult,
  mockFirebaseSignOut,
  mockSendPasswordResetEmail,
  mockSetCustomParameters,
  mockGetUserDocument,
  mockUpsertUserDocument,
} = vi.hoisted(() => ({
  mockAuthObj: { name: 'mock-auth' },
  mockSignInWithEmailAndPassword: vi.fn(),
  mockCreateUserWithEmailAndPassword: vi.fn(),
  mockSignInWithPopup: vi.fn(),
  mockSignInWithRedirect: vi.fn(),
  mockGetRedirectResult: vi.fn(),
  mockFirebaseSignOut: vi.fn(),
  mockSendPasswordResetEmail: vi.fn(),
  mockSetCustomParameters: vi.fn(),
  mockGetUserDocument: vi.fn<(uid: string) => Promise<UserDocument | null>>(),
  mockUpsertUserDocument: vi.fn<
    (uid: string, data: Omit<UserDocument, 'createdAt' | 'updatedAt'>) => Promise<void>
  >(),
}));

vi.mock('../../src/lib/firebase', () => ({
  auth: mockAuthObj,
}));

vi.mock('firebase/auth', () => {
  class MockGoogleAuthProvider {
    setCustomParameters = mockSetCustomParameters;
  }
  return {
    GoogleAuthProvider: MockGoogleAuthProvider,
    signInWithEmailAndPassword: (...args: unknown[]) => mockSignInWithEmailAndPassword(...args),
    createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUserWithEmailAndPassword(...args),
    signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
    signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
    getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
    signOut: (...args: unknown[]) => mockFirebaseSignOut(...args),
    sendPasswordResetEmail: (...args: unknown[]) => mockSendPasswordResetEmail(...args),
  };
});

vi.mock('../../src/lib/firestore', () => ({
  getUserDocument: (uid: string) => mockGetUserDocument(uid),
  upsertUserDocument: (uid: string, data: Omit<UserDocument, 'createdAt' | 'updatedAt'>) =>
    mockUpsertUserDocument(uid, data),
}));

function makeUserDoc(overrides?: Partial<UserDocument>): UserDocument {
  const now = Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0));
  return {
    uid: 'user-123',
    email: 'user@example.com',
    displayName: 'Kamala Iyer',
    role: 'elderly',
    timezone: 'America/New_York',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function renderLoginScreen(options?: {
  initialEntry?: string;
  loginAsDemo?: (role: UserRole) => void;
  refreshUserProfile?: () => Promise<void>;
}) {
  const loginAsDemo = options?.loginAsDemo ?? vi.fn();
  const refreshUserProfile = options?.refreshUserProfile ?? vi.fn().mockResolvedValue(undefined);
  const authValue: AuthContextValue = {
    firebaseUser: null,
    userProfile: null,
    isLoading: false,
    isDemo: false,
    signOut: vi.fn().mockResolvedValue(undefined),
    loginAsDemo,
    refreshUserProfile,
  };

  const view = render(
    <AuthProvider value={authValue}>
      <MemoryRouter initialEntries={[options?.initialEntry ?? '/login']}>
        <Routes>
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/app/today" element={<div data-testid="route-today">Today View</div>} />
          <Route path="/app/caregiver" element={<div data-testid="route-caregiver">Caregiver View</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );

  return { ...view, loginAsDemo, refreshUserProfile };
}

describe('LoginScreen', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockGetRedirectResult.mockResolvedValue(null);
    mockGetUserDocument.mockResolvedValue(null);
    mockUpsertUserDocument.mockResolvedValue(undefined);
    mockFirebaseSignOut.mockResolvedValue(undefined);
    mockSendPasswordResetEmail.mockResolvedValue(undefined);
    mockSignInWithRedirect.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('defaults to Sign In mode, preserves unique /sign in/i button, demarcates Trial section below auth, and passes touch targets', async () => {
    renderLoginScreen();
    await act(async () => {});

    // Default tab is Sign In; role selector and full name are hidden
    expect(screen.getByRole('tab', { name: 'Sign In' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Create New Account' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
    expect(screen.queryByRole('radiogroup', { name: 'Select User Role' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/display name/i)).not.toBeInTheDocument();

    // Unique button matching /sign in/i (Google button is "Continue with Google", trial buttons avoid "sign in")
    const signInBtn = screen.getByRole('button', { name: /sign in/i });
    expect(signInBtn).toHaveTextContent('Sign In');
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();

    // Trial sandbox section appears AFTER personal auth form
    const trialSection = screen.getByTestId('trial-demo-section');
    expect(trialSection).toHaveTextContent(/Try Demo/i);
    expect(trialSection).toHaveTextContent(/Sample Data Only/i);
    expect(
      signInBtn.compareDocumentPosition(trialSection) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();

    // Touch target & ARIA compliance across all visible buttons and tabs
    const controls = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('tab'),
    ];
    for (const el of controls) {
      expect(checkAriaCompliance(el).passed).toBe(true);
      const target = checkTouchTarget(el, 44);
      expect(target.passed, `Touch target failed on "${el.textContent}": ${target.reason}`).toBe(true);
    }
  });

  it('supports ?mode=signup query param, switches tabs, toggles password visibility, and launches both trial personas', async () => {
    const loginAsDemo = vi.fn();
    renderLoginScreen({ initialEntry: '/login?mode=signup', loginAsDemo });
    await act(async () => {});

    expect(screen.getByRole('tab', { name: 'Create New Account' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('radiogroup', { name: 'Select User Role' })).toBeInTheDocument();

    // Password visibility toggle
    const pwdInput = screen.getByLabelText('Password');
    expect(pwdInput).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(pwdInput).toHaveAttribute('type', 'text');

    // Launch Caregiver demo
    fireEvent.click(screen.getByRole('button', { name: /Try Caregiver Demo/i }));
    expect(loginAsDemo).toHaveBeenCalledWith('caregiver');
    expect(screen.getByTestId('route-caregiver')).toBeInTheDocument();
  });

  it('launches Older Adult demo and navigates to /app/today', async () => {
    const loginAsDemo = vi.fn();
    renderLoginScreen({ loginAsDemo });
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: /Try Older Adult Demo/i }));
    expect(loginAsDemo).toHaveBeenCalledWith('elderly');
    expect(screen.getByTestId('route-today')).toBeInTheDocument();
  });

  it('creates account with dynamic browser timezone, refreshes profile, and navigates for chosen role', async () => {
    const dateTimeSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: 'America/Chicago' }),
        }) as unknown as Intl.DateTimeFormat
    );

    const refreshUserProfile = vi.fn().mockResolvedValue(undefined);
    mockCreateUserWithEmailAndPassword.mockResolvedValueOnce({
      user: { uid: 'new-caregiver-1' },
    });

    renderLoginScreen({ refreshUserProfile });
    await act(async () => {});

    fireEvent.click(screen.getByRole('tab', { name: 'Create New Account' }));
    fireEvent.click(screen.getByRole('radio', { name: /Family Caregiver/i }));
    fireEvent.change(screen.getByLabelText(/Display Name/i), {
      target: { value: '  Anita Rao  ' },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'anita@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Create Caregiver Account' }));
    });

    expect(mockCreateUserWithEmailAndPassword).toHaveBeenCalledWith(
      mockAuthObj,
      'anita@example.com',
      'secret123'
    );
    expect(mockUpsertUserDocument).toHaveBeenCalledWith(
      'new-caregiver-1',
      expect.objectContaining({
        uid: 'new-caregiver-1',
        email: 'anita@example.com',
        displayName: 'Anita Rao',
        role: 'caregiver',
        timezone: 'America/Chicago',
        fcmTokens: [],
      })
    );
    expect(refreshUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('route-caregiver')).toBeInTheDocument();

    dateTimeSpy.mockRestore();
  });

  it('signs in existing email/password user, refreshes profile, and maps email auth error codes cleanly', async () => {
    const refreshUserProfile = vi.fn().mockResolvedValue(undefined);
    renderLoginScreen({ refreshUserProfile });
    await act(async () => {});

    // Empty fields validation
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter both email and password.');
    expect(mockSignInWithEmailAndPassword).not.toHaveBeenCalled();

    // Error code mapping (no stale "below" / "above" copy)
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });

    mockSignInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/user-not-found' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/Create New Account.*above/i);

    mockSignInWithEmailAndPassword.mockRejectedValueOnce(
      new Error('Firebase: Error (auth/configuration-not-found).')
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/demo section below/i);

    // Successful sign-in for caregiver
    mockSignInWithEmailAndPassword.mockResolvedValueOnce({
      user: { uid: 'existing-cg-1' },
    });
    mockGetUserDocument.mockResolvedValueOnce(
      makeUserDoc({ uid: 'existing-cg-1', role: 'caregiver' })
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    });

    expect(refreshUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('route-caregiver')).toBeInTheDocument();
  });

  it('handles inline Forgot Password flow: pre-populated email, validation, success status, error mapping, and Back to Sign In', async () => {
    renderLoginScreen();
    await act(async () => {});

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'ramesh@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    const resetPanel = screen.getByTestId('password-reset-panel');
    expect(resetPanel).toBeInTheDocument();
    expect(within(resetPanel).getByLabelText('Email address')).toHaveValue('ramesh@example.com');

    // Check touch targets in reset mode
    for (const btn of screen.getAllByRole('button')) {
      expect(checkTouchTarget(btn, 44).passed).toBe(true);
    }

    // Invalid email validation
    fireEvent.change(within(resetPanel).getByLabelText('Email address'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(within(resetPanel).getByRole('button', { name: 'Send Reset Link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter a valid email address.');
    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();

    // Empty email validation
    fireEvent.change(within(resetPanel).getByLabelText('Email address'), {
      target: { value: '   ' },
    });
    fireEvent.click(within(resetPanel).getByRole('button', { name: 'Send Reset Link' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Please enter your email address.');

    // Error code mapping
    const resetErrors: Array<[string, RegExp]> = [
      ['auth/invalid-email', /valid email address/i],
      ['auth/user-not-found', /No account found/i],
      ['auth/missing-email', /enter your email address/i],
      ['auth/too-many-requests', /Too many password reset attempts/i],
      ['auth/network-request-failed', /Network error/i],
      ['auth/operation-not-allowed', /currently disabled/i],
      ['auth/configuration-not-found', /not activated yet/i],
    ];
    fireEvent.change(within(resetPanel).getByLabelText('Email address'), {
      target: { value: 'ramesh@example.com' },
    });
    for (const [code, pattern] of resetErrors) {
      mockSendPasswordResetEmail.mockRejectedValueOnce({ code });
      await act(async () => {
        fireEvent.click(within(resetPanel).getByRole('button', { name: 'Send Reset Link' }));
      });
      expect(screen.getByRole('alert')).toHaveTextContent(pattern);
    }

    // Success confirmation in role="status"
    mockSendPasswordResetEmail.mockResolvedValueOnce(undefined);
    await act(async () => {
      fireEvent.click(within(resetPanel).getByRole('button', { name: 'Send Reset Link' }));
    });
    expect(mockSendPasswordResetEmail).toHaveBeenLastCalledWith(mockAuthObj, 'ramesh@example.com');
    expect(screen.getByRole('status')).toHaveTextContent(/Password reset email sent to ramesh@example\.com/i);

    // Back to Sign In clears reset panel and banners
    fireEvent.click(within(resetPanel).getByRole('button', { name: /Back to Sign In/i }));
    expect(screen.queryByTestId('password-reset-panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
  });

  it('Google Sign-In preserves existing user role without calling upsertUserDocument and handles Firestore read failure', async () => {
    const refreshUserProfile = vi.fn().mockResolvedValue(undefined);
    renderLoginScreen({ refreshUserProfile });
    await act(async () => {});

    // 1. Firestore read failure -> surfaces error banner, does NOT treat as new user
    mockSignInWithPopup.mockResolvedValueOnce({
      user: { uid: 'google-err-1', email: 'g@example.com', displayName: 'G User' },
    });
    mockGetUserDocument.mockRejectedValueOnce(new Error('unavailable'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });

    expect(mockSetCustomParameters).toHaveBeenCalledWith({ prompt: 'select_account' });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load your profile/i);
    expect(screen.queryByTestId('google-role-confirmation')).not.toBeInTheDocument();
    expect(mockUpsertUserDocument).not.toHaveBeenCalled();

    // 2. Existing Google profile -> preserves role ('caregiver'), never overwrites profile
    mockSignInWithPopup.mockResolvedValueOnce({
      user: { uid: 'google-existing-1', email: 'priya@example.com', displayName: 'Priya' },
    });
    mockGetUserDocument.mockResolvedValueOnce(
      makeUserDoc({ uid: 'google-existing-1', role: 'caregiver' })
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });

    expect(mockUpsertUserDocument).not.toHaveBeenCalled();
    expect(refreshUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('route-caregiver')).toBeInTheDocument();
  });

  it('first-time Google Sign-In requires explicit role confirmation before upsertUserDocument and supports cancelling', async () => {
    const refreshUserProfile = vi.fn().mockResolvedValue(undefined);
    const dateTimeSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(
      () =>
        ({
          resolvedOptions: () => ({ timeZone: 'Europe/London' }),
        }) as unknown as Intl.DateTimeFormat
    );

    renderLoginScreen({ refreshUserProfile });
    await act(async () => {});

    const newGoogleUser = {
      uid: 'google-first-1',
      email: 'first@example.com',
      displayName: 'Meera Nair',
    } as unknown as User;

    mockSignInWithPopup.mockResolvedValue({ user: newGoogleUser });
    mockGetUserDocument.mockResolvedValue(null);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });

    // Profile must NOT be written yet (prevents irreversible elderly lock-in)
    expect(mockUpsertUserDocument).not.toHaveBeenCalled();
    const confirmBox = screen.getByTestId('google-role-confirmation');
    expect(confirmBox).toHaveTextContent('Meera Nair');

    // Cancel -> signs out and returns to login without writing profile
    await act(async () => {
      fireEvent.click(within(confirmBox).getByRole('button', { name: 'Use another account' }));
    });
    expect(mockFirebaseSignOut).toHaveBeenCalledWith(mockAuthObj);
    expect(mockUpsertUserDocument).not.toHaveBeenCalled();
    expect(screen.queryByTestId('google-role-confirmation')).not.toBeInTheDocument();

    // Sign in again -> pick Family Caregiver -> Continue
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    const confirmBox2 = screen.getByTestId('google-role-confirmation');
    fireEvent.click(within(confirmBox2).getByRole('radio', { name: /Family Caregiver/i }));

    await act(async () => {
      fireEvent.click(
        within(confirmBox2).getByRole('button', { name: 'Continue as Family Caregiver' })
      );
    });

    expect(mockUpsertUserDocument).toHaveBeenCalledWith(
      'google-first-1',
      expect.objectContaining({
        uid: 'google-first-1',
        email: 'first@example.com',
        displayName: 'Meera Nair',
        role: 'caregiver',
        timezone: 'Europe/London',
        fcmTokens: [],
      })
    );
    expect(refreshUserProfile).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('route-caregiver')).toBeInTheDocument();

    dateTimeSpy.mockRestore();
  });

  it('handles Google popup error codes, silent cancellations, popup-blocked redirect fallback, and mount getRedirectResult', async () => {
    renderLoginScreen();
    await act(async () => {});

    // Silent popup closure / cancellation
    for (const silentCode of ['auth/popup-closed-by-user', 'auth/cancelled-popup-request']) {
      mockSignInWithPopup.mockRejectedValueOnce({ code: silentCode });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
      });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    }

    // Error mappings
    const mappedCodes: Array<[string, RegExp]> = [
      ['auth/account-exists-with-different-credential', /different sign-in method/i],
      ['auth/operation-not-allowed', /Google sign-in is disabled/i],
      ['auth/unauthorized-domain', /not authorized for Google Sign-In/i],
      ['auth/network-request-failed', /Network error/i],
      ['auth/configuration-not-found', /not activated yet/i],
    ];
    for (const [code, regex] of mappedCodes) {
      mockSignInWithPopup.mockRejectedValueOnce({ code });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
      });
      expect(screen.getByRole('alert')).toHaveTextContent(regex);
    }

    // auth/popup-blocked -> triggers signInWithRedirect fallback
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('medimate_google_redirect_pending')).toBe('1');

    // Unmount and remount with getRedirectResult resolving an existing elderly user
    cleanup();
    const refreshUserProfile = vi.fn().mockResolvedValue(undefined);
    mockGetRedirectResult.mockResolvedValueOnce({
      user: { uid: 'google-redirect-1', email: 'r@example.com', displayName: 'Ramesh' },
    });
    mockGetUserDocument.mockResolvedValueOnce(
      makeUserDoc({ uid: 'google-redirect-1', role: 'elderly' })
    );

    renderLoginScreen({ refreshUserProfile });

    await waitFor(() => {
      expect(screen.getByTestId('route-today')).toBeInTheDocument();
    });
    expect(refreshUserProfile).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('medimate_google_redirect_pending')).toBeNull();
  });

  it('does not allow a slow mount getRedirectResult(null) to re-enable an in-flight email submission', async () => {
    let resolveRedirect: ((val: null) => void) | null = null;
    mockGetRedirectResult.mockReturnValueOnce(
      new Promise<null>((resolve) => {
        resolveRedirect = resolve;
      })
    );

    let resolveSignIn: ((val: { user: { uid: string } }) => void) | null = null;
    mockSignInWithEmailAndPassword.mockReturnValueOnce(
      new Promise<{ user: { uid: string } }>((resolve) => {
        resolveSignIn = resolve;
      })
    );
    mockGetUserDocument.mockResolvedValueOnce(
      makeUserDoc({ uid: 'slow-redirect-user', role: 'elderly' })
    );

    renderLoginScreen();

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'elder@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'secret123' },
    });

    const submitBtn = screen.getByRole('button', { name: 'Sign In' });
    const form = submitBtn.closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);

    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Please wait…' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Sign In' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Create New Account' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Try Older Adult Demo/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Try Caregiver Demo/i })).toBeDisabled();

    // Slow mount getRedirectResult resolves null while sign-in is still pending
    await act(async () => {
      resolveRedirect?.(null);
    });

    expect(screen.getByRole('button', { name: 'Please wait…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Please wait…' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Sign In' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Create New Account' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Try Older Adult Demo/i })).toBeDisabled();

    await act(async () => {
      resolveSignIn?.({ user: { uid: 'slow-redirect-user' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('route-today')).toBeInTheDocument();
    });
  });

  it('guards handleSubmit, handleGoogleSignIn, handleConfirmGoogleRole, and handleForgotPasswordSubmit against synchronous re-entrant submits', async () => {
    const loginAsDemo = vi.fn();
    renderLoginScreen({ loginAsDemo });
    await act(async () => {});

    // 1. Synchronous double submit on email form + concurrent Google/demo clicks
    let resolveEmail: ((val: { user: { uid: string } }) => void) | null = null;
    mockSignInWithEmailAndPassword.mockReturnValueOnce(
      new Promise<{ user: { uid: string } }>((resolve) => {
        resolveEmail = resolve;
      })
    );
    mockGetUserDocument.mockRejectedValueOnce(new Error('abort-stay-on-login'));

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'user@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'password123' },
    });

    const form = screen.getByRole('button', { name: 'Sign In' }).closest('form');
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    fireEvent.submit(form!);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    fireEvent.click(screen.getByRole('button', { name: /Try Older Adult Demo/i }));

    expect(mockSignInWithEmailAndPassword).toHaveBeenCalledTimes(1);
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
    expect(loginAsDemo).not.toHaveBeenCalled();

    // Finish email submit (stay on login via getUserDocument failure)
    await act(async () => {
      resolveEmail?.({ user: { uid: 'email-guard-1' } });
    });

    // 2. Synchronous double click on Continue with Google
    let resolvePopup:
      | ((val: { user: { uid: string; email: string; displayName: string } }) => void)
      | null = null;
    mockSignInWithPopup.mockReturnValueOnce(
      new Promise<{ user: { uid: string; email: string; displayName: string } }>((resolve) => {
        resolvePopup = resolve;
      })
    );
    mockGetUserDocument.mockResolvedValueOnce(null);

    const googleBtn = screen.getByRole('button', { name: 'Continue with Google' });
    fireEvent.click(googleBtn);
    fireEvent.click(googleBtn);
    expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolvePopup?.({
        user: { uid: 'google-guard-new', email: 'g@example.com', displayName: 'G Guard' },
      });
    });

    // 3. Synchronous double click on Continue as Older Adult + concurrent Use another account
    const confirmBox = screen.getByTestId('google-role-confirmation');
    let resolveUpsert: (() => void) | null = null;
    mockUpsertUserDocument.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveUpsert = resolve;
      })
    );

    const continueBtn = within(confirmBox).getByRole('button', {
      name: 'Continue as Older Adult',
    });
    const cancelBtn = within(confirmBox).getByRole('button', { name: 'Use another account' });
    fireEvent.click(continueBtn);
    fireEvent.click(continueBtn);
    fireEvent.click(cancelBtn);

    expect(mockUpsertUserDocument).toHaveBeenCalledTimes(1);
    expect(mockFirebaseSignOut).not.toHaveBeenCalled();

    await act(async () => {
      resolveUpsert?.();
    });
    await waitFor(() => {
      expect(screen.getByTestId('route-today')).toBeInTheDocument();
    });

    // 4. Synchronous double submit on Forgot Password form
    cleanup();
    renderLoginScreen();
    await act(async () => {});

    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'reset@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    const resetPanel = screen.getByTestId('password-reset-panel');
    let resolveReset: (() => void) | null = null;
    mockSendPasswordResetEmail.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveReset = resolve;
      })
    );

    fireEvent.submit(resetPanel);
    fireEvent.submit(resetPanel);
    expect(mockSendPasswordResetEmail).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveReset?.();
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      /Password reset email sent to reset@example\.com/i
    );
  });

  it('disables mode tabs and trial demo buttons while submitting and hides trial-demo-section during pendingGoogleUser', async () => {
    renderLoginScreen();
    await act(async () => {});

    let resolvePopup:
      | ((val: { user: { uid: string; email: string; displayName: string } }) => void)
      | null = null;
    mockSignInWithPopup.mockReturnValueOnce(
      new Promise<{ user: { uid: string; email: string; displayName: string } }>((resolve) => {
        resolvePopup = resolve;
      })
    );
    mockGetUserDocument.mockResolvedValueOnce(null);

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    expect(screen.getByRole('tab', { name: 'Sign In' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: 'Create New Account' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Try Older Adult Demo/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Try Caregiver Demo/i })).toBeDisabled();

    await act(async () => {
      resolvePopup?.({
        user: { uid: 'google-hide-trial', email: 'h@example.com', displayName: 'Hari' },
      });
    });

    const confirmBox = screen.getByTestId('google-role-confirmation');
    expect(confirmBox).toBeInTheDocument();
    expect(screen.queryByTestId('trial-demo-section')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(confirmBox).getByRole('button', { name: 'Use another account' }));
    });

    expect(screen.queryByTestId('google-role-confirmation')).not.toBeInTheDocument();
    expect(screen.getByTestId('trial-demo-section')).toBeInTheDocument();
  });

  it('keeps Google button disabled while signInWithRedirect is pending and maps redirect fallback errors cleanly', async () => {
    renderLoginScreen();
    await act(async () => {});

    // 1. In-flight signInWithRedirect keeps Google button disabled and displays redirect status
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    let resolveRedirect: (() => void) | null = null;
    mockSignInWithRedirect.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveRedirect = resolve;
      })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Redirecting to Google Sign-In… please wait.'
      );
    });
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDisabled();
    expect(sessionStorage.getItem('medimate_google_redirect_pending')).toBe('1');

    await act(async () => {
      resolveRedirect?.();
    });
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeDisabled();

    // 2. signInWithRedirect rejects with auth/popup-blocked -> fallback popup guidance
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    mockSignInWithRedirect.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    expect(sessionStorage.getItem('medimate_google_redirect_pending')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/blocked the Google Sign-In popup/i);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeDisabled();

    // 3. signInWithRedirect rejects with auth/unauthorized-domain -> mapped error (not popup copy)
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    mockSignInWithRedirect.mockRejectedValueOnce({ code: 'auth/unauthorized-domain' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    expect(sessionStorage.getItem('medimate_google_redirect_pending')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/not authorized for Google Sign-In/i);
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeDisabled();

    // 4. signInWithRedirect rejects with auth/network-request-failed -> mapped network error
    mockSignInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-blocked' });
    mockSignInWithRedirect.mockRejectedValueOnce({ code: 'auth/network-request-failed' });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    });
    expect(sessionStorage.getItem('medimate_google_redirect_pending')).toBeNull();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      /Network error while connecting to Google Sign-In/i
    );
    expect(screen.getByRole('button', { name: 'Continue with Google' })).not.toBeDisabled();
  });
});
