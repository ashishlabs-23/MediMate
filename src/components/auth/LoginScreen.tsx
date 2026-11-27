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
  sendEmailVerification,
  sendPasswordResetEmail,
  type User,
} from 'firebase/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { auth } from '../../lib/firebase';
import {
  getUserDocument,
  saveUserProfileWithUsername,
} from '../../lib/firestore';
import { useAuthContext } from '../../contexts/AuthContext';
import type { UserDocument, UserRole } from '../../types/firestore';
import { AuthShell } from './AuthShell';
import { beginEmailVerificationCooldown, requiresEmailVerification } from './AuthGates';
import {
  EMAIL_FORMAT_REGEX,
  getSafeAuthRedirect,
  getPasswordRequirements,
  isValidUsername,
  sanitizePlainText,
} from '../../lib/authValidation';

type AuthMode = 'signin' | 'signup' | 'reset';

const GOOGLE_REDIRECT_PENDING_KEY = 'medimate_google_redirect_pending';
const PASSWORD_RESET_COOLDOWN_MS = 60_000;

function resetCooldownKey(emailAddress: string): string {
  return `medimate_password_reset_cooldown_${encodeURIComponent(emailAddress.toLowerCase())}`;
}

function readResetCooldown(emailAddress: string): number {
  try {
    return Number(sessionStorage.getItem(resetCooldownKey(emailAddress))) || 0;
  } catch {
    return 0;
  }
}

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
      return 'Use at least 8 characters with uppercase, lowercase, a number, and a special character.';
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/user-not-found':
      return 'No account found with this email. Switch to the "Create New Account" tab above to register.';
    case 'auth/too-many-requests':
      return 'Too many failed attempts. Please wait a few minutes and try again.';
    case 'auth/network-request-failed':
      return 'Network error while signing in. Please check your internet connection and try again.';
    case 'auth/indexeddb-unavailable':
    case 'auth/web-storage-unsupported':
      return 'Secure browser storage is unavailable. Enable IndexedDB or use the sample demo below.';
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
    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-muted">
      {children}
    </span>
  );
}

export function LoginScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const { loginAsDemo, refreshUserProfile } = useAuthContext();
  const reducedMotion = useReducedMotion();

  const searchParams = new URLSearchParams(location.search);
  const initialMode: AuthMode =
    searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const safeRedirectTo = getSafeAuthRedirect(searchParams.get('redirect'));

  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [selectedRole, setSelectedRole] = useState<UserRole>('elderly');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [resetCooldownUntil, setResetCooldownUntil] = useState(0);
  const [clockNow, setClockNow] = useState(Date.now());
  const [pendingGoogleUser, setPendingGoogleUser] = useState<User | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const cleanUsername = sanitizePlainText(username);
  const emailIsValid = EMAIL_FORMAT_REGEX.test(email.trim());
  const passwordRequirements = getPasswordRequirements(password);
  const passwordIsValid = passwordRequirements.every((requirement) => requirement.met);
  const resetCooldownSeconds = Math.max(
    0,
    Math.ceil((resetCooldownUntil - clockNow) / 1000)
  );

  useEffect(() => {
    setResetCooldownUntil(readResetCooldown(email.trim()));
  }, [email]);

  useEffect(() => {
    if (resetCooldownSeconds <= 0) return;
    const timer = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [resetCooldownSeconds]);

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
        if (!profile.username) {
          navigate('/complete-profile', {
            replace: true,
            state: safeRedirectTo ? { redirectTo: safeRedirectTo } : undefined,
          });
        } else if (safeRedirectTo) {
          navigate(safeRedirectTo, { replace: true });
        } else {
          navigateForRole(profile.role);
        }
        return;
      }

      // First-time Google user: hold until user explicitly confirms role
      // to prevent irreversible 'elderly' lock-in under firestore.rules.
      setPendingGoogleUser(user);
      setErrorMsg(null);
      setSuccessMsg(null);
    },
    [navigate, navigateForRole, refreshUserProfile, safeRedirectTo]
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
    if (mode === 'signup') {
      if (!isValidUsername(cleanUsername)) {
        setErrorMsg('Username must be 2–30 characters using letters, numbers, spaces, or underscores.');
        return;
      }
      if (!emailIsValid) {
        setErrorMsg('Please enter a valid email address.');
        return;
      }
      if (!passwordIsValid) {
        setErrorMsg('Please meet all password requirements before creating your account.');
        return;
      }
    }

    submittingRef.current = true;
    setIsSubmitting(true);

    try {
      if (mode === 'signup') {
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        await saveUserProfileWithUsername(credential.user.uid, cleanUsername, {
            uid: credential.user.uid,
            email: cleanEmail,
            displayName: cleanUsername,
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
        await sendEmailVerification(credential.user);
          beginEmailVerificationCooldown(credential.user.uid);
        await refreshUserProfile?.();
        navigate('/verify-email', {
          replace: true,
          state: safeRedirectTo ? { redirectTo: safeRedirectTo } : undefined,
        });
      } else {
        const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
        const profile = await getUserDocument(credential.user.uid);
        await refreshUserProfile?.();
        if (requiresEmailVerification(credential.user)) {
          navigate('/verify-email', {
            replace: true,
            state: safeRedirectTo ? { redirectTo: safeRedirectTo } : undefined,
          });
        } else if (!profile?.username) {
          navigate('/complete-profile', {
            replace: true,
            state: safeRedirectTo ? { redirectTo: safeRedirectTo } : undefined,
          });
        } else if (safeRedirectTo) {
          navigate(safeRedirectTo, { replace: true });
        } else {
          navigateForRole(profile.role);
        }
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
      if (mapped) setErrorMsg(mapped);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleConfirmGoogleRole() {
    if (!pendingGoogleUser || submittingRef.current) return;
    const chosenRole = selectedRole;
    submittingRef.current = true;
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      setPendingGoogleUser(null);
      navigate('/complete-profile', {
        replace: true,
        state: {
          onboardingRole: chosenRole,
          ...(safeRedirectTo ? { redirectTo: safeRedirectTo } : {}),
        },
      });
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
      if (!hasValidFirebaseAuth(auth) || typeof firebaseSignOut !== 'function') {
        throw new Error('Sign-out is unavailable in this browser.');
      }
      await firebaseSignOut(auth);
      setPendingGoogleUser(null);
    } catch (signOutError) {
      setErrorMsg(
        signOutError instanceof Error
          ? signOutError.message
          : 'Unable to sign out. Please try again.'
      );
    } finally {
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
    const storedCooldownEnd = readResetCooldown(cleanEmail);
    if (storedCooldownEnd > Date.now()) {
      setResetCooldownUntil(storedCooldownEnd);
      setClockNow(Date.now());
      setErrorMsg('Please wait for the cooldown to finish before requesting another reset email.');
      return;
    }

    submittingRef.current = true;
    setIsSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      const cooldownEnd = Date.now() + PASSWORD_RESET_COOLDOWN_MS;
      try {
        sessionStorage.setItem(resetCooldownKey(cleanEmail), String(cooldownEnd));
      } catch {
        // Firebase also enforces server-side rate limits.
      }
      setResetCooldownUntil(cooldownEnd);
      setClockNow(Date.now());
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

  function handleDemoLogin(role: Exclude<UserRole, 'dual'>) {
    if (submittingRef.current) return;
    if (loginAsDemo) {
      loginAsDemo(role);
      navigateForRole(role);
    }
  }

  function renderRoleSelector() {
    return (
      <div className="mb-2.5">
        <label className="mb-1 block text-center text-[11px] font-bold uppercase tracking-wider text-ink-secondary">
          I Am An:
        </label>
        <div
          className="grid grid-cols-3 gap-1 rounded-btn bg-canvas p-1"
          role="radiogroup"
          aria-label="Select User Role"
        >
          <button
            type="button"
            role="radio"
            aria-checked={selectedRole === 'elderly'}
            disabled={isSubmitting}
            onClick={() => setSelectedRole('elderly')}
            className={`flex min-h-touch w-full items-center justify-center gap-1 rounded-btn px-2 py-2 text-center text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
              selectedRole === 'elderly'
                ? 'border border-ink-muted/30 bg-surface text-brand-teal shadow-sm'
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
            className={`flex min-h-touch w-full items-center justify-center gap-1 rounded-btn px-2 py-2 text-center text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
              selectedRole === 'caregiver'
                ? 'border border-ink-muted/30 bg-surface text-brand-teal shadow-sm'
                : 'text-ink-secondary hover:text-ink-primary'
            }`}
          >
            <span aria-hidden="true">👩‍⚕️</span> Family Caregiver
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={selectedRole === 'dual'}
            disabled={isSubmitting}
            onClick={() => setSelectedRole('dual')}
            className={`flex min-h-touch w-full items-center justify-center gap-1 rounded-btn px-2 py-2 text-center text-xs font-bold transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
              selectedRole === 'dual'
                ? 'border border-ink-muted/30 bg-surface text-brand-teal shadow-sm'
                : 'text-ink-secondary hover:text-ink-primary'
            }`}
          >
            <span aria-hidden="true">👥</span> Dual User
          </button>
        </div>
      </div>
    );
  }

  return (
    <AuthShell label="Sign in or create a MediMate account" onClose={() => navigate('/')}>
      {/* Card */}
      <section
        aria-labelledby="login-heading"
        className="w-full"
      >
        {/* ── Compact Brand header ── */}
        <div className="mb-3.5 flex flex-col items-center text-center">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-btn bg-brand-teal text-white shadow-sm">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M12 21s-7-4.5-9-9.5C1.5 7.5 4.2 4 7.8 4c2 0 3.5 1 4.2 2.2C12.7 5 14.2 4 16.2 4 19.8 4 22.5 7.5 21 11.5 19 16.5 12 21 12 21z" />
                <path d="M12 9v5" />
                <path d="M9.5 11.5h5" />
              </svg>
            </div>
            <h1
              id="login-heading"
              className="text-2xl font-extrabold text-brand-teal-dark tracking-tight"
            >
              MediMate
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full border border-brand-teal/20 bg-brand-teal-light px-2 py-0.5 text-[10px] font-semibold text-brand-teal-dark">
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
              </svg>
              UN SDG 3
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-secondary">
            Smart Medication Reminder for Older Adults &amp; Caregivers
          </p>
        </div>

        {/* ── Banners ── */}
        {successMsg && (
          <div
            role="status"
            aria-live="polite"
            className="mb-4 flex items-start gap-2.5 rounded-btn border border-taken/30 bg-taken-bg p-3.5 text-sm font-medium text-taken"
          >
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-taken" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            {successMsg}
          </div>
        )}
        {errorMsg && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 flex items-start gap-2.5 rounded-btn border border-alert/30 bg-alert-bg p-3.5 text-sm font-medium text-alert"
          >
            <svg className="mt-0.5 h-4 w-4 flex-shrink-0 text-alert" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            {errorMsg}
          </div>
        )}

        {/* ── First-Time Google Role Confirmation ── */}
        {pendingGoogleUser ? (
          <div
            data-testid="google-role-confirmation"
            className="mb-6 space-y-4 rounded-card border border-brand-teal/30 bg-brand-teal-light/25 p-5"
          >
            <div className="text-center">
              <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-teal-light">
                <svg className="h-5 w-5 text-brand-teal" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-ink-primary">Complete Your Account Setup</h2>
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
              className="min-h-touch w-full rounded-btn bg-brand-teal px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-teal-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting
                ? 'Setting up account…'
                : `Continue as ${
                    selectedRole === 'caregiver'
                      ? 'Family Caregiver'
                      : selectedRole === 'dual'
                        ? 'Dual User'
                        : 'Older Adult'
                  }`}
            </button>

            <button
              type="button"
              onClick={() => void handleCancelGoogleRole()}
              disabled={isSubmitting}
              className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-secondary transition-colors hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
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
              <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-btn border border-brand-teal/20 bg-brand-teal-light">
                <svg className="h-5 w-5 text-brand-teal" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                  <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                </svg>
              </div>
              <h2 className="text-lg font-bold text-ink-primary">Reset Your Password</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                Enter your email address and we will send you a password reset link.
              </p>
            </div>

            <div className="mb-5">
              <label htmlFor="reset-email" className="mb-1.5 block text-sm font-semibold text-ink-primary">
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
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(sanitizePlainText(e.target.value))}
                  placeholder="you@example.com"
                  className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-canvas py-2.5 pl-10 pr-4 text-base text-ink-primary placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                  aria-label="Email address"
                  disabled={isSubmitting}
                />
              </div>
            </div>

            <div className="space-y-3">
              <button
                type="submit"
                disabled={isSubmitting || resetCooldownSeconds > 0}
                aria-busy={isSubmitting}
                className="min-h-touch w-full rounded-btn bg-brand-teal px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-brand-teal-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting
                  ? 'Sending Reset Link…'
                  : resetCooldownSeconds > 0
                    ? `Try again in ${resetCooldownSeconds}s`
                    : 'Send Reset Link'}
              </button>
              <button
                type="button"
                onClick={() => { setMode('signin'); setErrorMsg(null); setSuccessMsg(null); }}
                disabled={isSubmitting}
                className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-primary transition-colors hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
              >
                ← Back to Sign In
              </button>
            </div>
          </form>

        ) : (
          /* ── Main Auth Flow (Google + Email) ── */
          <>
            {/* Pill tabs */}
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="mb-2.5 flex gap-1 rounded-btn bg-canvas p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'signin'}
                disabled={isSubmitting}
                onClick={() => { if (submittingRef.current) return; setMode('signin'); setErrorMsg(null); setSuccessMsg(null); }}
                className={`w-full flex-1 min-h-[44px] rounded-lg text-sm font-bold transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'signin'
                    ? 'border border-ink-muted/30 bg-surface text-brand-teal shadow-sm'
                    : 'text-ink-secondary hover:text-ink-primary'
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
                className={`w-full flex-1 min-h-[44px] rounded-lg text-sm font-bold transition-all flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'signup'
                    ? 'border border-ink-muted/30 bg-surface text-brand-teal shadow-sm'
                    : 'text-ink-secondary hover:text-ink-primary'
                }`}
              >
                Create New Account
              </button>
            </div>

            {/* Google button */}
            <motion.button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={isSubmitting}
              {...(!reducedMotion
                ? { whileHover: { y: -2 }, whileTap: { scale: 0.97 } }
                : {})}
              transition={{ type: 'spring', stiffness: 300, damping: 20 }}
              className="mb-2.5 flex min-h-touch w-full items-center justify-center gap-2.5 rounded-btn border border-ink-muted/30 bg-surface px-4 py-2.5 text-sm font-semibold text-ink-primary transition-colors hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Continue with Google"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
              </svg>
              <span>Continue with Google</span>
            </motion.button>

            {/* Divider */}
            <div className="relative mb-2.5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-ink-muted/20" />
              </div>
              <div className="relative flex justify-center text-[11px]">
                <span className="bg-surface px-2.5 font-medium text-ink-muted">or continue with email</span>
              </div>
            </div>

            {/* Email/Password Form */}
            <form onSubmit={(e) => void handleSubmit(e)} noValidate className="mb-3 space-y-2.5">
              {/* Role selector — signup only */}
              {mode === 'signup' && renderRoleSelector()}

              {/* Display Name — signup only, prominent */}
              {mode === 'signup' && (
                <div>
                  <label
                    htmlFor="username"
                    className="mb-1 block text-xs font-semibold text-ink-primary"
                  >
                    Username / Display Name
                    <span className="ml-1 text-[10px] font-normal text-ink-muted">
                      (2–30 chars)
                    </span>
                  </label>
                  <div className="relative">
                    <InputIcon>
                      <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                      </svg>
                    </InputIcon>
                    <input
                      id="username"
                      type="text"
                      autoComplete="nickname"
                      required
                      value={username}
                      onChange={(e) => setUsername(sanitizePlainText(e.target.value))}
                      placeholder="Choose a username"
                      minLength={2}
                      maxLength={30}
                      className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-canvas py-2 pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                      disabled={isSubmitting}
                    />
                  </div>
                  {username.length > 0 && !isValidUsername(cleanUsername) && (
                    <p className="mt-0.5 text-xs text-alert font-medium">
                      Use 2–30 characters: letters, numbers, spaces, or underscores.
                    </p>
                  )}
                </div>
              )}

              {/* Email */}
              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-semibold text-ink-primary">
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
                    onChange={(e) => setEmail(sanitizePlainText(e.target.value))}
                    placeholder="you@example.com"
                    className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-canvas py-2 pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                    aria-label="Email address"
                    aria-invalid={mode === 'signup' && email.length > 0 && !emailIsValid}
                    disabled={isSubmitting}
                  />
                </div>
                {mode === 'signup' && email.length > 0 && (
                  <p
                    aria-live="polite"
                    className={`mt-0.5 text-xs ${emailIsValid ? 'text-taken' : 'text-alert'}`}
                  >
                    {emailIsValid ? 'Email format looks good.' : 'Enter a valid email address.'}
                  </p>
                )}
              </div>

              {/* Password */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label htmlFor="password" className="text-xs font-semibold text-ink-primary">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="inline-flex min-h-touch min-w-touch items-center justify-center px-1 text-xs font-semibold text-brand-teal hover:underline"
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
                    placeholder={mode === 'signup' ? 'Create a strong password' : 'Enter your password'}
                    className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-canvas py-2 pl-9 pr-3 text-sm text-ink-primary placeholder:text-ink-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50"
                    aria-label="Password"
                    aria-describedby={mode === 'signup' ? 'password-requirements' : undefined}
                    disabled={isSubmitting}
                  />
                </div>
                {mode === 'signup' && (
                  <ul id="password-requirements" aria-label="Password validation rules" className="mt-1.5 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[11px]">
                    {passwordRequirements.map(({ label, met }) => (
                      <li key={label} className={`flex items-center gap-1 ${met ? 'font-medium text-taken' : 'text-ink-muted'}`}>
                        <span aria-hidden="true">{met ? '✓' : '○'}</span>
                        <span className="truncate">{label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {mode === 'signin' && (
                  <div className="flex justify-end mt-0.5">
                    <button
                      type="button"
                      onClick={() => { setMode('reset'); setErrorMsg(null); setSuccessMsg(null); }}
                      disabled={isSubmitting}
                      className="inline-flex min-h-touch min-w-touch items-center justify-center px-1 text-xs font-semibold text-brand-teal hover:underline disabled:opacity-50"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </div>

              {/* Submit */}
              <motion.button
                type="submit"
                disabled={isSubmitting}
                aria-busy={isSubmitting}
                {...(!reducedMotion
                  ? { whileHover: { y: -1 }, whileTap: { scale: 0.97 } }
                  : {})}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="flex min-h-touch w-full items-center justify-center gap-2 rounded-btn bg-brand-teal px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-teal-dark focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
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
                  `Create ${
                    selectedRole === 'caregiver'
                      ? 'Caregiver'
                      : selectedRole === 'dual'
                        ? 'Dual User'
                        : 'Older Adult'
                  } Account`
                ) : (
                  'Sign In'
                )}
              </motion.button>
            </form>
          </>
        )}

        {/* ── Compact Demo Section ── */}
        {!pendingGoogleUser && (
          <div
            data-testid="trial-demo-section"
            aria-labelledby="trial-demo-heading"
            className="border-t border-ink-muted/20 pt-2.5 text-center"
          >
            <div className="flex items-center justify-center gap-1.5 mb-1.5">
              <svg className="h-3.5 w-3.5 text-brand-teal" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd" />
              </svg>
              <h2
                id="trial-demo-heading"
                className="text-[11px] font-bold uppercase tracking-wider text-ink-secondary"
              >
                Try Demo — Sample Data Only
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <motion.button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleDemoLogin('elderly')}
                {...(!reducedMotion
                  ? { whileHover: { y: -1 }, whileTap: { scale: 0.97 } }
                  : {})}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="flex min-h-touch w-full items-center justify-center gap-1.5 rounded-btn border border-ink-muted/30 bg-surface px-2.5 py-2 text-xs font-semibold text-ink-primary transition-colors hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span aria-hidden="true">👴</span>
                <span>Try Older Adult Demo (Ramesh Sharma)</span>
              </motion.button>
              <motion.button
                type="button"
                disabled={isSubmitting}
                onClick={() => handleDemoLogin('caregiver')}
                {...(!reducedMotion
                  ? { whileHover: { y: -1 }, whileTap: { scale: 0.97 } }
                  : {})}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className="flex min-h-touch w-full items-center justify-center gap-1.5 rounded-btn border border-ink-muted/30 bg-surface px-2.5 py-2 text-xs font-semibold text-ink-primary transition-colors hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span aria-hidden="true">👩‍⚕️</span>
                <span>Try Caregiver Demo (Priya Sharma)</span>
              </motion.button>
            </div>
          </div>
        )}
      </section>
    </AuthShell>
  );
}

export default LoginScreen;
