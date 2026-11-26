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

/** Small icon wrapper for input fields */
function InputIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400">
      {children}
    </span>
  );
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
        <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 text-center">
          I Am An:
        </label>
        <div
          className="grid grid-cols-2 gap-1.5 p-1.5 bg-slate-100 rounded-xl"
          role="radiogroup"
          aria-label="Select User Role"
        >
          <button
            type="button"
            role="radio"
            aria-checked={selectedRole === 'elderly'}
            disabled={isSubmitting}
            onClick={() => setSelectedRole('elderly')}
            className={`py-2.5 px-3 text-xs sm:text-sm font-bold rounded-lg transition-all text-center min-h-[44px] flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed ${
              selectedRole === 'elderly'
                ? 'bg-white text-teal-600 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-700'
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
            className={`py-2.5 px-3 text-xs sm:text-sm font-bold rounded-lg transition-all text-center min-h-[44px] flex items-center justify-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed ${
              selectedRole === 'caregiver'
                ? 'bg-white text-teal-600 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:text-slate-700'
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
      className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-cyan-50 flex flex-col items-center justify-center p-4 sm:p-6"
    >
      {/* Card */}
      <section
        aria-labelledby="login-heading"
        className="w-full max-w-md rounded-2xl bg-white border border-slate-200/80 p-6 sm:p-8 shadow-xl shadow-slate-200/60"
      >
        {/* ── Brand header ── */}
        <div className="mb-7 text-center">
          {/* Logo pill */}
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-teal-200 mb-4">
            <svg className="w-9 h-9 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h1
            id="login-heading"
            className="text-3xl font-extrabold bg-gradient-to-r from-teal-600 to-cyan-600 bg-clip-text text-transparent tracking-tight"
          >
            MediMate
          </h1>
          <p className="mt-1.5 text-sm text-slate-500 font-medium">
            Smart Medication Reminder for Older Adults &amp; Caregivers
          </p>
          <span className="inline-flex items-center gap-1 mt-2.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-100">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
            UN SDG 3 — Good Health &amp; Well-Being
          </span>
        </div>

        {/* ── Banners ── */}
        {successMsg && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-sm text-emerald-800 font-medium"
          >
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 p-3.5 text-sm text-red-700 font-medium"
          >
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {errorMsg}
          </div>
        )}

        {/* ── First-Time Google Role Confirmation ── */}
        {pendingGoogleUser ? (
          <div
            data-testid="google-role-confirmation"
            className="space-y-4 mb-6 rounded-xl border border-teal-200 bg-teal-50/60 p-5"
          >
            <div className="text-center">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-teal-100 mb-2">
                <svg className="w-5 h-5 text-teal-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-800">Complete Your Account Setup</h2>
              <p className="mt-1 text-sm text-slate-500">
                Welcome,{' '}
                <span className="font-semibold text-slate-700">
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
              className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white text-base font-semibold px-6 py-3 hover:from-teal-600 hover:to-cyan-700 active:from-teal-700 active:to-cyan-800 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-md shadow-teal-200"
            >
              {isSubmitting
                ? 'Setting up account…'
                : `Continue as ${selectedRole === 'caregiver' ? 'Family Caregiver' : 'Older Adult'}`}
            </button>

            <button
              type="button"
              onClick={() => void handleCancelGoogleRole()}
              disabled={isSubmitting}
              className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white text-slate-600 text-sm font-semibold px-4 py-2.5 hover:bg-slate-50 active:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
            >
              Use another account
            </button>
          </div>

        ) : mode === 'reset' ? (
          /* ── Forgot Password Panel ── */
          <form
            onSubmit={(e) => void handleForgotPasswordSubmit(e)}
            noValidate
            data-testid="password-reset-panel"
            className="mb-6"
          >
            <div className="mb-5">
              <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-teal-50 border border-teal-100 mb-3">
                <svg className="w-5 h-5 text-teal-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-slate-800">Reset Your Password</h2>
              <p className="mt-1 text-sm text-slate-500">
                Enter your email address and we will send you a password reset link.
              </p>
            </div>

            <div className="mb-5">
              <label htmlFor="reset-email" className="block mb-1.5 text-sm font-semibold text-slate-700">
                Email address
              </label>
              <div className="relative">
                <InputIcon>
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                    <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                  </svg>
                </InputIcon>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full min-h-[44px] rounded-xl border border-slate-200 pl-10 pr-4 py-2.5 text-base text-slate-800 bg-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent focus:bg-white transition-colors disabled:opacity-50"
                  aria-label="Email address"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-3">
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white text-base font-semibold px-6 py-3 hover:from-teal-600 hover:to-cyan-700 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-md shadow-teal-200"
              >
                {isSubmitting ? 'Sending Reset Link…' : 'Send Reset Link'}
              </button>
              <button
                type="button"
                onClick={() => { setMode('signin'); setErrorMsg(null); setSuccessMsg(null); }}
                disabled={isSubmitting}
                className="w-full min-h-[44px] rounded-xl border border-slate-200 bg-white text-slate-700 text-sm font-semibold px-4 py-2.5 hover:bg-slate-50 active:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
              >
                ← Back to Sign In
              </button>
            </div>
          </form>

        ) : (
          /* ── Main Auth Flow (Google + Email) ── */
          <>
            {/* Google button */}
            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={isSubmitting}
              className="w-full min-h-[48px] py-3 px-4 mb-5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 text-sm font-semibold shadow-sm hover:shadow-md transition-all flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
              aria-label="Continue with Google"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Continue with Google</span>
            </button>

            {/* Divider */}
            <div className="relative mb-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-3 text-slate-400 font-medium">or continue with email</span>
              </div>
            </div>

            {/* Pill tabs */}
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                disabled={isSubmitting}
                onClick={() => { if (submittingRef.current) return; setMode('signin'); setErrorMsg(null); setSuccessMsg(null); }}
                className={`flex-1 min-h-[40px] rounded-lg text-sm font-bold transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'signin'
                    ? 'bg-white text-teal-600 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signup'}
                disabled={isSubmitting}
                onClick={() => { if (submittingRef.current) return; setMode('signup'); setErrorMsg(null); setSuccessMsg(null); }}
                className={`flex-1 min-h-[40px] rounded-lg text-sm font-bold transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'signup'
                    ? 'bg-white text-teal-600 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                Create New Account
              </button>
            </div>

            {/* Email/Password Form */}
            <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mb-6 space-y-4">
              {/* Role selector — signup only */}
              {mode === 'signup' && renderRoleSelector()}

              {/* Display Name — signup only, prominent */}
              {mode === 'signup' && (
                <div>
                  <label
                    htmlFor="fullName"
                    className="block mb-1.5 text-sm font-semibold text-slate-700"
                  >
                    Display Name
                    <span className="ml-1.5 text-[11px] font-normal text-slate-400">
                      (how you appear in MediMate)
                    </span>
                  </label>
                  <div className="relative">
                    <InputIcon>
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                      </svg>
                    </InputIcon>
                    <input
                      id="fullName"
                      type="text"
                      autoComplete="name"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder={selectedRole === 'caregiver' ? 'e.g. Priya Sharma' : 'e.g. Ramesh Sharma'}
                      maxLength={60}
                      className="w-full min-h-[44px] rounded-xl border border-slate-200 pl-10 pr-4 py-2.5 text-base text-slate-800 bg-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent focus:bg-white transition-colors disabled:opacity-50"
                      disabled={isSubmitting}
                    />
                  </div>
                  {fullName.trim().length > 0 && fullName.trim().length < 2 && (
                    <p className="mt-1 text-xs text-amber-600 font-medium">Please enter at least 2 characters.</p>
                  )}
                </div>
              )}

              {/* Email */}
              <div>
                <label htmlFor="email" className="block mb-1.5 text-sm font-semibold text-slate-700">
                  Email address
                </label>
                <div className="relative">
                  <InputIcon>
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                      <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                    </svg>
                  </InputIcon>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 pl-10 pr-4 py-2.5 text-base text-slate-800 bg-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent focus:bg-white transition-colors disabled:opacity-50"
                    aria-label="Email address"
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="text-sm font-semibold text-slate-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-2 text-xs text-teal-600 font-semibold hover:underline"
                  >
                    {showPassword ? 'Hide password' : 'Show password'}
                  </button>
                </div>
                <div className="relative">
                  <InputIcon>
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </InputIcon>
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === 'signup' ? 'At least 6 characters' : 'Enter your password'}
                    className="w-full min-h-[44px] rounded-xl border border-slate-200 pl-10 pr-4 py-2.5 text-base text-slate-800 bg-slate-50 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent focus:bg-white transition-colors disabled:opacity-50"
                    aria-label="Password"
                    disabled={isSubmitting}
                  />
                </div>
                {mode === 'signin' && (
                  <div className="flex justify-end mt-1">
                    <button
                      type="button"
                      onClick={() => { setMode('reset'); setErrorMsg(null); setSuccessMsg(null); }}
                      disabled={isSubmitting}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-xs text-teal-600 font-semibold hover:underline disabled:opacity-50 px-2"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                className="w-full min-h-[44px] rounded-xl bg-gradient-to-r from-teal-500 to-cyan-600 text-white text-base font-semibold px-6 py-3 hover:from-teal-600 hover:to-cyan-700 active:from-teal-700 active:to-cyan-800 focus:outline-none focus:ring-2 focus:ring-teal-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-md shadow-teal-200 flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Please wait…
                  </>
                ) : mode === 'signup' ? (
                  `Create ${selectedRole === 'caregiver' ? 'Caregiver' : 'Older Adult'} Account`
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          </>
        )}

        {/* ── Demo Section ── */}
        {!pendingGoogleUser && (
          <div
            data-testid="trial-demo-section"
            aria-labelledby="trial-demo-heading"
            className="pt-5 border-t border-slate-100"
          >
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-100 text-center">
              <div className="flex items-center justify-center gap-1.5 mb-1.5">
                <svg className="w-3.5 h-3.5 text-amber-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
                </svg>
                <h2
                  id="trial-demo-heading"
                  className="text-xs font-extrabold text-amber-700 uppercase tracking-wider"
                >
                  Try Demo — Sample Data Only
                </h2>
              </div>
              <p className="text-xs text-amber-600 mb-3">
                Explore MediMate with preloaded sample medications. No account needed.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleDemoLogin('elderly')}
                  className="min-h-[44px] py-2.5 px-3 rounded-xl border border-amber-200 bg-white text-slate-700 text-xs font-semibold hover:bg-amber-50 active:bg-amber-100 transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <span aria-hidden="true">👴</span>
                  <span>Try Older Adult Demo (Ramesh Sharma)</span>
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => handleDemoLogin('caregiver')}
                  className="min-h-[44px] py-2.5 px-3 rounded-xl border border-amber-200 bg-white text-slate-700 text-xs font-semibold hover:bg-amber-50 active:bg-amber-100 transition-colors flex items-center justify-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed"
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
