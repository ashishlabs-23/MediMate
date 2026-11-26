/**
 * LoginScreen — Firebase Auth authentication (Google Sign-In, Email Sign In / Sign Up,
 * Inline Forgot Password reset) with a clearly demarcated Trial Mode sandbox section below.
 *
 * Roles:
 *   - 'elderly': Older adult managing their daily schedule in Simple Mode.
 *   - 'caregiver': Family caregiver monitoring patient adherence in Dashboard.
 */

import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { auth } from '../../lib/firebase';
import { getUserDocument, upsertUserDocument } from '../../lib/firestore';
import { useAuthContext } from '../../contexts/AuthContext';
import type { UserDocument, UserRole } from '../../types/firestore';

type AuthMode = 'signin' | 'signup' | 'reset';
type OnboardingRole = 'elderly' | 'caregiver';

const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GOOGLE_REDIRECT_PENDING_KEY = 'medimate_google_redirect_pending';

function resolveBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && tz.trim().length > 0 ? tz : 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
}

function hasValidFirebaseAuth(authObj: unknown): boolean {
  if (!authObj || typeof authObj !== 'object') return false;
  return (
    'app' in authObj ||
    'name' in authObj ||
    'config' in authObj ||
    'currentUser' in authObj
  );
}

function readPendingGoogleRedirectFlag(): boolean {
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem(GOOGLE_REDIRECT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

function writePendingGoogleRedirectFlag(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(GOOGLE_REDIRECT_PENDING_KEY, '1');
    }
  } catch {
    // Ignore storage errors in restricted browsing contexts
  }
}

function clearPendingGoogleRedirectFlag(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(GOOGLE_REDIRECT_PENDING_KEY);
    }
  } catch {
    // Ignore storage errors in restricted browsing contexts
  }
}

function extractAuthErrorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const codeVal = (err as { code?: unknown }).code;
    if (typeof codeVal === 'string' && codeVal.trim().length > 0) {
      return codeVal.trim();
    }
  }
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const authMatch = /(auth\/[a-z0-9-]+)/i.exec(msg);
  if (authMatch) {
    return authMatch[1].toLowerCase();
  }
  if (/CONFIGURATION_NOT_FOUND/i.test(msg)) {
    return 'auth/configuration-not-found';
  }
  return '';
}

function mapEmailAuthError(err: unknown): string {
  const code = extractAuthErrorCode(err);
  switch (code) {
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Please switch to the Sign In tab.';
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/weak-password':
      return 'Password should be at least 6 characters.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
      return 'No account found with this email. Switch to the "Create New Account" tab above to register.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error while signing in. Please check your internet connection and try again.';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication is not activated yet in the Firebase Console. Click "Get Started" in Firebase Console > Authentication, or try the sample demo section below.';
    case 'auth/operation-not-allowed':
      return 'Email/Password sign-in is not enabled in Firebase Console. Please enable it under Authentication > Sign-in method.';
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'Authentication failed. Please check your details.';
  }
}

function mapGoogleAuthError(err: unknown): string | null {
  const code = extractAuthErrorCode(err);
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
    case 'auth/popup-blocked':
      // Handled silently via redirect fallback — never shown as an error message
      return null;
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email using a different sign-in method. Please sign in with your email and password.';
    case 'auth/operation-not-allowed':
      return 'Google sign-in is disabled in your Firebase project. Please enable "Google" under Firebase Console > Authentication > Sign-in method.';
    case 'auth/unauthorized-domain':
      return 'This domain is not authorized for Google Sign-In. Please add this domain under Firebase Console > Authentication > Settings > Authorized domains.';
    case 'auth/network-request-failed':
      return 'Network error while connecting to Google Sign-In. Please check your internet connection and try again.';
    case 'auth/configuration-not-found':
      return 'Google Sign-In is not activated yet in Firebase Console. Click "Get Started" in Firebase Console > Authentication, and enable Google under Sign-in method.';
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'Google Sign-In failed. Please try again.';
  }
}

function mapPasswordResetError(err: unknown): string {
  const code = extractAuthErrorCode(err);
  switch (code) {
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
      return 'No account found with this email address.';
    case 'auth/missing-email':
      return 'Please enter your email address.';
    case 'auth/too-many-requests':
      return 'Too many password reset attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error while sending password reset email. Please check your internet connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Password reset is currently disabled in Firebase Console. Please enable Email/Password under Authentication > Sign-in method.';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication is not activated yet in the Firebase Console. Click "Get Started" in Firebase Console > Authentication.';
    default:
      return err instanceof Error && err.message
        ? err.message
        : 'Unable to send password reset email. Please try again.';
  }
}

export function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginAsDemo, refreshUserProfile } = useAuthContext();

  const initialMode: AuthMode =
    new URLSearchParams(location.search).get('mode') === 'signup' ? 'signup' : 'signin';

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [selectedRole, setSelectedRole] = useState<OnboardingRole>('elderly');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pendingGoogleUser, setPendingGoogleUser] = useState<User | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const navigateForRole = useCallback(
    (role: UserRole) => {
      if (role === 'caregiver') {
        navigate('/app/caregiver', { replace: true });
      } else {
        navigate('/app/today', { replace: true });
      }
    },
    [navigate]
  );

  const handleGoogleAuthenticatedUser = useCallback(
    async (user: User) => {
      let profile: UserDocument | null = null;
      try {
        profile = await getUserDocument(user.uid);
      } catch {
        setErrorMsg(
          'We signed you in with Google, but could not load your profile right now. Please try again.'
        );
        return;
      }

      if (profile) {
        await refreshUserProfile?.();
        navigateForRole(profile.role);
        return;
      }

      // First-time Google user: hold until user explicitly confirms role
      // to prevent irreversible 'elderly' lock-in under firestore.rules.
      setPendingGoogleUser(user);
      setErrorMsg(null);
      setSuccessMsg(null);
    },
    [navigateForRole, refreshUserProfile]
  );

  useEffect(() => {
    if (!hasValidFirebaseAuth(auth) || typeof getRedirectResult !== 'function') {
      return;
    }

    let active = true;
    const hadPendingRedirect = readPendingGoogleRedirectFlag();

    void (async () => {
      try {
        const result = await getRedirectResult(auth);
        clearPendingGoogleRedirectFlag();
        if (!active || !result?.user || submittingRef.current) return;
        submittingRef.current = true;
        setIsSubmitting(true);
        try {
          await handleGoogleAuthenticatedUser(result.user);
        } finally {
          submittingRef.current = false;
          if (active) {
            setIsSubmitting(false);
          }
        }
      } catch (err: unknown) {
        clearPendingGoogleRedirectFlag();
        if (!active || !hadPendingRedirect) return;
        const mapped = mapGoogleAuthError(err);
        if (mapped) {
          setErrorMsg(mapped);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [handleGoogleAuthenticatedUser]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;

    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        const name = fullName.trim() || (selectedRole === 'caregiver' ? 'Caregiver' : 'Older Adult');

        await upsertUserDocument(credential.user.uid, {
          uid: credential.user.uid,
          email: cleanEmail,
          displayName: name,
          role: selectedRole,
          timezone: resolveBrowserTimezone(),
          fcmTokens: [],
          accessibilityPreferences: {
            highContrast: false,
            largeText: true,
            hapticFeedback: true,
            soundEnabled: true,
          },
        });

        await refreshUserProfile?.();
        navigateForRole(selectedRole);
      } else {
        const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
        const profile = await getUserDocument(credential.user.uid);
        await refreshUserProfile?.();
        const role: UserRole = profile?.role ?? 'elderly';
        navigateForRole(role);
      }
    } catch (err: unknown) {
      setErrorMsg(mapEmailAuthError(err));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
      const credential = await signInWithPopup(auth, provider);
      await handleGoogleAuthenticatedUser(credential.user);
    } catch (err: unknown) {
      const code = extractAuthErrorCode(err);
      if (code === 'auth/popup-blocked') {
        if (hasValidFirebaseAuth(auth) && typeof signInWithRedirect === 'function') {
          try {
            writePendingGoogleRedirectFlag();
            setSuccessMsg('Redirecting to Google Sign-In… please wait.');
            await signInWithRedirect(auth, provider);
            return;
          } catch (redirectErr: unknown) {
            clearPendingGoogleRedirectFlag();
            setSuccessMsg(null);
            const mappedRedirectErr = mapGoogleAuthError(redirectErr);
            setErrorMsg(
              mappedRedirectErr ??
                'Your browser blocked the Google Sign-In popup. Please allow popups for this site, or try in a different browser.'
            );
            return;
          }
        }
        // Redirect not available — guide the user clearly
        setErrorMsg(
          'Your browser blocked the Google Sign-In popup. Please allow popups for this site and try again.'
        );
        return;
      }

      const mapped = mapGoogleAuthError(err);
      if (mapped) {
        setErrorMsg(mapped);
      }
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleConfirmGoogleRole() {
    if (!pendingGoogleUser || submittingRef.current) return;
    const targetUser = pendingGoogleUser;
    const chosenRole = selectedRole;
    submittingRef.current = true;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      await upsertUserDocument(targetUser.uid, {
        uid: targetUser.uid,
        email: targetUser.email ?? '',
        displayName:
          targetUser.displayName ||
          (chosenRole === 'caregiver' ? 'Caregiver' : 'Older Adult'),
        role: chosenRole,
        timezone: resolveBrowserTimezone(),
        fcmTokens: [],
        accessibilityPreferences: {
          highContrast: false,
          largeText: true,
          hapticFeedback: true,
          soundEnabled: true,
        },
      });

      await refreshUserProfile?.();
      setPendingGoogleUser(null);
      navigateForRole(chosenRole);
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to complete your account setup. Please try again.';
      setErrorMsg(msg);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleCancelGoogleRole() {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      if (hasValidFirebaseAuth(auth) && typeof firebaseSignOut === 'function') {
        await firebaseSignOut(auth);
      }
    } catch {
      // Best-effort sign-out when cancelling onboarding
    } finally {
      setPendingGoogleUser(null);
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleForgotPasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    if (!EMAIL_FORMAT_REGEX.test(cleanEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setSuccessMsg(
        `Password reset email sent to ${cleanEmail}. Please check your inbox and spam folder.`
      );
    } catch (err: unknown) {
      setErrorMsg(mapPasswordResetError(err));
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  function handleDemoLogin(role: OnboardingRole) {
    if (submittingRef.current) return;
    if (loginAsDemo) {
      loginAsDemo(role);
      navigateForRole(role);
    }
  }

  function renderRoleSelector() {
    return (
      <div className="mb-5">
        <label className="block text-xs font-bold text-ink-muted uppercase tracking-wider mb-2 text-center">
          I Am An:
        </label>
        <div
          className="grid grid-cols-2 gap-2 p-1 bg-slate-100 rounded-btn"
          role="radiogroup"
          aria-label="Select User Role"
        >
          <button
            type="button"
            role="radio"
            aria-checked={selectedRole === 'elderly'}
            disabled={isSubmitting}
            onClick={() => setSelectedRole('elderly')}
            className={`py-2.5 px-3 text-xs sm:text-sm font-bold rounded-md transition-all text-center min-h-touch min-w-touch min-h-[44px] min-w-[44px] flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed ${
              selectedRole === 'elderly'
                ? 'bg-white text-brand-teal shadow-sm border border-slate-200'
                : 'text-ink-secondary hover:text-ink-primary'
            }`}
          >
            <span aria-hidden="true">👴</span> Older Adult
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={selectedRole === 'caregiver'}
            disabled={isSubmitting}
            onClick={() => setSelectedRole('caregiver')}
            className={`py-2.5 px-3 text-xs sm:text-sm font-bold rounded-md transition-all text-center min-h-touch min-w-touch min-h-[44px] min-w-[44px] flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed ${
              selectedRole === 'caregiver'
                ? 'bg-white text-brand-teal shadow-sm border border-slate-200'
                : 'text-ink-secondary hover:text-ink-primary'
            }`}
          >
            <span aria-hidden="true">👩‍⚕️</span> Family Caregiver
          </button>
        </div>
      </div>
    );
  }

  return (
    <main
      role="main"
      className="min-h-screen bg-canvas flex flex-col items-center justify-center p-4 sm:p-6"
    >
      <section
        aria-labelledby="login-heading"
        className="w-full max-w-md rounded-card bg-surface border border-slate-200 p-6 sm:p-8 shadow-sm"
      >
        {/* Header / Brand */}
        <div className="mb-6 text-center">
          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-brand-teal-light text-brand-teal-dark mb-2">
            UN SDG 3 — Good Health & Well-Being
          </span>
          <h1
            id="login-heading"
            className="text-3xl font-extrabold text-brand-teal tracking-tight"
          >
            MediMate
          </h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Smart Medication Reminder for Older Adults & Caregivers
          </p>
        </div>

        {/* Success banner */}
        {successMsg && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 font-medium"
          >
            {successMsg}
          </div>
        )}

        {/* Error banner */}
        {errorMsg && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded-md bg-alert-bg border border-alert-chip p-3 text-sm text-alert font-medium"
          >
            {errorMsg}
          </div>
        )}

        {/* First-Time Google Role Confirmation Step */}
        {pendingGoogleUser ? (
          <div
            data-testid="google-role-confirmation"
            className="space-y-4 mb-6 rounded-btn border border-teal-200 bg-teal-50/40 p-4"
          >
            <div className="text-center">
              <h2 className="text-lg font-bold text-ink-primary">
                Complete Your Account Setup
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">
                Welcome,{' '}
                <span className="font-semibold text-ink-primary">
                  {pendingGoogleUser.displayName || pendingGoogleUser.email || 'Google User'}
                </span>
                . Choose how you will use MediMate:
              </p>
            </div>

            {renderRoleSelector()}

            <button
              type="button"
              onClick={() => void handleConfirmGoogleRole()}
              disabled={isSubmitting}
              aria-busy={isSubmitting}
              className="
                w-full min-h-touch min-h-[44px] rounded-btn bg-brand-teal text-white
                text-base font-semibold px-6 py-3
                hover:bg-brand-teal-dark active:bg-brand-teal-dark
                focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed
                transition-colors shadow-sm
              "
            >
              {isSubmitting
                ? 'Setting up account…'
                : `Continue as ${selectedRole === 'caregiver' ? 'Family Caregiver' : 'Older Adult'}`}
            </button>

            <button
              type="button"
              onClick={() => void handleCancelGoogleRole()}
              disabled={isSubmitting}
              className="
                w-full min-h-touch min-h-[44px] rounded-btn border border-slate-300 bg-white
                text-ink-secondary text-sm font-semibold px-4 py-2.5
                hover:bg-slate-50 active:bg-slate-100
                focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2
                disabled:opacity-60 disabled:cursor-not-allowed
                transition-colors
              "
            >
              Use another account
            </button>
          </div>
        ) : mode === 'reset' ? (
          /* Dedicated Inline Forgot Password Panel */
          <form
            onSubmit={(e) => void handleForgotPasswordSubmit(e)}
            noValidate
            data-testid="password-reset-panel"
            className="mb-6"
          >
            <div className="mb-4">
              <h2 className="text-lg font-bold text-ink-primary">
                Reset Your Password
              </h2>
              <p className="mt-1 text-sm text-ink-secondary">
                Enter your email address and we will send you a password reset link.
              </p>
            </div>

            <div className="mb-5">
              <label
                htmlFor="reset-email"
                className="block mb-1 text-sm font-medium text-ink-primary"
              >
                Email address
              </label>
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="
                  w-full min-h-touch min-h-[44px] rounded-btn border border-slate-300 px-4 py-2
                  text-base text-ink-primary bg-surface
                  focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent
                  disabled:opacity-50
                "
                aria-label="Email address"
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-3">
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="
                  w-full min-h-touch min-h-[44px] rounded-btn bg-brand-teal text-white
                  text-base font-semibold px-6 py-3
                  hover:bg-brand-teal-dark active:bg-brand-teal-dark
                  focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2
                  disabled:opacity-60 disabled:cursor-not-allowed
                  transition-colors shadow-sm
                "
              >
                {isSubmitting ? 'Sending Reset Link…' : 'Send Reset Link'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('signin');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                disabled={isSubmitting}
                className="
                  w-full min-h-touch min-h-[44px] rounded-btn border border-slate-300 bg-white
                  text-ink-primary text-sm font-semibold px-4 py-2.5
                  hover:bg-slate-50 active:bg-slate-100
                  focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2
                  disabled:opacity-60 disabled:cursor-not-allowed
                  transition-colors
                "
              >
                Back to Sign In
              </button>
            </div>
          </form>
        ) : (
          /* Primary Personal Authentication (Google + Email Sign In / Create Account) */
          <>
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={isSubmitting}
              className="w-full min-h-touch min-h-[48px] py-2.5 px-4 mb-5 rounded-btn border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-ink-primary text-sm font-semibold shadow-sm transition-colors flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="Continue with Google"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            <div className="relative mb-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-surface px-3 text-ink-muted font-medium">
                  or continue with email
                </span>
              </div>
            </div>

            {/* Sign In vs Create New Account Tabs */}
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="flex border-b border-slate-200 mb-5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                disabled={isSubmitting}
                onClick={() => {
                  if (submittingRef.current) return;
                  setMode('signin');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`flex-1 min-h-touch min-w-touch min-h-[44px] min-w-[44px] pb-2.5 text-sm font-bold border-b-2 transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'signin'
                    ? 'border-brand-teal text-brand-teal'
                    : 'border-transparent text-ink-muted hover:text-ink-secondary'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                disabled={isSubmitting}
                onClick={() => {
                  if (submittingRef.current) return;
                  setMode('signup');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`flex-1 min-h-touch min-w-touch min-h-[44px] min-w-[44px] pb-2.5 text-sm font-bold border-b-2 transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'signup'
                    ? 'border-brand-teal text-brand-teal'
                    : 'border-transparent text-ink-muted hover:text-ink-secondary'
                }`}
              >
                Create New Account
              </button>
            </div>

            {/* Email/Password Form */}
            <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mb-6">
              {mode === 'signup' && renderRoleSelector()}

              {mode === 'signup' && (
                <div className="mb-4">
                  <label
                    htmlFor="fullName"
                    className="block mb-1 text-sm font-medium text-ink-primary"
                  >
                    Your Full Name
                  </label>
                  <input
                    id="fullName"
                    type="text"
                    autoComplete="name"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={
                      selectedRole === 'caregiver' ? 'e.g. Priya Sharma' : 'e.g. Ramesh Sharma'
                    }
                    className="
                      w-full min-h-touch min-h-[44px] rounded-btn border border-slate-300 px-4 py-2
                      text-base text-ink-primary bg-surface
                      focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent
                      disabled:opacity-50
                    "
                    disabled={isSubmitting}
                  />
                </div>
              )}

              {/* Email */}
              <div className="mb-4">
                <label
                  htmlFor="email"
                  className="block mb-1 text-sm font-medium text-ink-primary"
                >
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="
                    w-full min-h-touch min-h-[44px] rounded-btn border border-slate-300 px-4 py-2
                    text-base text-ink-primary bg-surface
                    focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent
                    disabled:opacity-50
                  "
                  aria-label="Email address"
                  disabled={isSubmitting}
                />
              </div>

              {/* Password with Show/Hide toggle */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-1">
                  <label
                    htmlFor="password"
                    className="text-sm font-medium text-ink-primary"
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="min-h-touch min-w-touch min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-2 text-xs text-brand-teal font-semibold hover:underline"
                  >
                    {showPassword ? 'Hide password' : 'Show password'}
                  </button>
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'signup' ? 'At least 6 characters' : 'Enter your password'}
                  className="
                    w-full min-h-touch min-h-[44px] rounded-btn border border-slate-300 px-4 py-2
                    text-base text-ink-primary bg-surface
                    focus:outline-none focus:ring-2 focus:ring-focus focus:border-transparent
                    disabled:opacity-50
                  "
                  aria-label="Password"
                  disabled={isSubmitting}
                />
                {mode === 'signin' && (
                  <div className="flex justify-end mt-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setMode('reset');
                        setErrorMsg(null);
                        setSuccessMsg(null);
                      }}
                      disabled={isSubmitting}
                      className="min-h-touch min-w-touch min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-xs text-brand-teal font-semibold hover:underline disabled:opacity-50 px-2"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>

              {/* Submit CTA */}
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="
                  w-full min-h-touch min-h-[44px] rounded-btn bg-brand-teal text-white
                  text-base font-semibold px-6 py-3
                  hover:bg-brand-teal-dark active:bg-brand-teal-dark
                  focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2
                  disabled:opacity-60 disabled:cursor-not-allowed
                  transition-colors shadow-sm
                "
              >
                {isSubmitting
                  ? 'Please wait…'
                  : mode === 'signup'
                  ? `Create ${selectedRole === 'caregiver' ? 'Caregiver' : 'Older Adult'} Account`
                  : 'Sign In'}
              </button>
            </form>
          </>
        )}

        {/* Demarcated Trial Sandbox Section (Below Personal Auth) */}
        {!pendingGoogleUser && (
          <div
            data-testid="trial-demo-section"
            aria-labelledby="trial-demo-heading"
            className="pt-5 border-t border-slate-200"
          >
            <div className="p-4 rounded-btn bg-slate-50 border-2 border-dashed border-slate-300 text-center">
              <h2
                id="trial-demo-heading"
                className="text-xs font-extrabold text-ink-secondary uppercase tracking-wider mb-1.5"
              >
                Try Demo (Sample Data Only)
              </h2>
              <p className="text-xs text-ink-secondary mb-3">
                Explore MediMate with preloaded sample medications. Changes made in trial mode are not saved to a personal account.
              </p>
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleDemoLogin('elderly')}
                  className="w-full min-h-touch min-h-[44px] py-2.5 px-4 rounded-btn border border-slate-300 bg-white text-ink-primary text-sm font-semibold hover:bg-slate-100 active:bg-slate-200 transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">👴</span>
                  <span>Try Older Adult Demo (Ramesh Sharma)</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleDemoLogin('caregiver')}
                  className="w-full min-h-touch min-h-[44px] py-2.5 px-4 rounded-btn border border-slate-300 bg-white text-ink-primary text-sm font-semibold hover:bg-slate-100 active:bg-slate-200 transition-colors flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">👩‍⚕️</span>
                  <span>Try Caregiver Demo (Priya Sharma)</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export default LoginScreen;
