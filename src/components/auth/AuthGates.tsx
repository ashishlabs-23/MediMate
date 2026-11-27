import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { reload, sendEmailVerification, type User } from 'firebase/auth';
import { LogOut } from 'lucide-react';
import { AuthShell } from './AuthShell';
import { useAuthContext } from '../../contexts/AuthContext';
import { getUserDocument, saveUserProfileWithUsername } from '../../lib/firestore';
import {
  getSafeAuthRedirect,
  isValidUsername,
  sanitizePlainText,
} from '../../lib/authValidation';
import type { UserRole } from '../../types/firestore';

const VERIFY_COOLDOWN_MS = 60_000;

// eslint-disable-next-line react-refresh/only-export-components
export function requiresEmailVerification(user: User): boolean {
  return !user.emailVerified && (user.providerData?.some((provider) => provider.providerId === 'password') ?? false);
}

function dashboardPath(role: UserRole): string {
  return role === 'caregiver' ? '/app/caregiver' : '/app/today';
}

function verificationCooldownKey(uid: string): string {
  return `medimate_email_verification_resend_until_${uid}`;
}

function readCooldownEnd(uid: string): number {
  try {
    return Number(sessionStorage.getItem(verificationCooldownKey(uid))) || 0;
  } catch {
    return 0;
  }
}

function writeCooldownEnd(uid: string, value: number): void {
  try {
    sessionStorage.setItem(verificationCooldownKey(uid), String(value));
  } catch {
    // The Firebase Auth service also applies server-side abuse protections.
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export function beginEmailVerificationCooldown(uid: string): number {
  const end = Date.now() + VERIFY_COOLDOWN_MS;
  writeCooldownEnd(uid, end);
  return end;
}

function authErrorMessage(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  if (code === 'auth/too-many-requests') {
    return 'Too many requests. Please wait a little while before trying again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'You appear to be offline. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function EmailVerificationGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { firebaseUser, isLoading, userProfile, refreshUserProfile, signOut } = useAuthContext();
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    typeof location.state?.notice === 'string' ? location.state.notice : null
  );
  const [busy, setBusy] = useState(false);
  const safeRedirectTo = getSafeAuthRedirect(
    typeof location.state?.redirectTo === 'string' ? location.state.redirectTo : null
  );

  const user = firebaseUser && typeof firebaseUser === 'object'
    ? (firebaseUser as User)
    : null;
  const remaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));

  useEffect(() => {
    if (!user) return;
    setCooldownUntil(readCooldownEnd(user.uid));
  }, [user]);

  useEffect(() => {
    if (remaining <= 0) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  useEffect(() => {
    if (isLoading || !user) return;
    if (!requiresEmailVerification(user)) {
      navigate(
        userProfile?.username ? safeRedirectTo ?? dashboardPath(userProfile.role) : '/complete-profile',
        {
        replace: true,
        state: userProfile?.username ? undefined : location.state,
      });
    }
  }, [isLoading, location.state, navigate, safeRedirectTo, user, userProfile]);

  if (isLoading) {
    return <p role="status" className="p-6 text-center text-ink-secondary">Checking your account…</p>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!requiresEmailVerification(user)) return <Navigate to="/complete-profile" replace />;

  async function handleResend() {
    if (!user || busy || remaining > 0) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await sendEmailVerification(user);
      const end = beginEmailVerificationCooldown(user.uid);
      setCooldownUntil(end);
      setNow(Date.now());
      setNotice('Verification email sent. Check your inbox and spam folder.');
    } catch (sendError) {
      setError(authErrorMessage(sendError));
      if (
        sendError &&
        typeof sendError === 'object' &&
        'code' in sendError &&
        sendError.code === 'auth/too-many-requests'
      ) {
        const end = beginEmailVerificationCooldown(user.uid);
        setCooldownUntil(end);
        setNow(Date.now());
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleCheckVerification() {
    if (!user) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await reload(user);
      if (!user.emailVerified) {
        setNotice('Your email is not verified yet. Open the link in your email, then check again.');
        return;
      }
      await refreshUserProfile?.();
      const profile = await getUserDocument(user.uid);
      navigate(
        profile?.username ? safeRedirectTo ?? dashboardPath(profile.role) : '/complete-profile',
        {
        replace: true,
        state: profile?.username ? undefined : location.state,
      });
    } catch (checkError) {
      setError(authErrorMessage(checkError));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (signOutError) {
      setError(authErrorMessage(signOutError));
    }
  }

  return (
    <AuthShell label="Verify your email">
      <div className="space-y-5 pt-2">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-ink-primary">Verify your email</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            We sent a verification link to <strong className="break-all">{user.email}</strong>.
          </p>
        </div>
        <ol className="list-inside list-decimal space-y-2 rounded-card bg-canvas p-4 text-sm text-ink-secondary">
          <li>Open the message from MediMate in your email inbox.</li>
          <li>Select its verification link.</li>
          <li>Return here and check your verification status.</li>
        </ol>
        {error && <p role="alert" className="rounded-btn bg-alert-bg p-3 text-sm text-alert">{error}</p>}
        {notice && <p role="status" className="rounded-btn bg-taken-bg p-3 text-sm text-taken">{notice}</p>}
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void handleCheckVerification()}
            disabled={busy}
            className="min-h-touch w-full rounded-btn bg-brand-teal px-5 py-3 font-semibold text-white hover:bg-brand-teal-dark disabled:opacity-60"
          >
            {busy ? 'Checking…' : 'I verified my email — check now'}
          </button>
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={busy || remaining > 0}
            className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-surface px-5 py-3 font-semibold text-brand-teal hover:bg-canvas disabled:opacity-60"
          >
            {remaining > 0 ? `Resend available in ${remaining}s` : 'Resend verification email'}
          </button>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="inline-flex min-h-touch w-full items-center justify-center gap-2 rounded-btn px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-canvas"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out or switch account
          </button>
        </div>
      </div>
    </AuthShell>
  );
}

export function CompleteProfileGate() {
  const navigate = useNavigate();
  const location = useLocation();
  const { firebaseUser, isLoading, userProfile, refreshUserProfile, signOut } = useAuthContext();
  const requestedRole = location.state?.onboardingRole;
  const onboardingRole =
    requestedRole === 'caregiver' ||
    requestedRole === 'elderly' ||
    requestedRole === 'dual'
      ? requestedRole
      : null;
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<UserRole>(onboardingRole ?? 'elderly');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const safeRedirectTo = getSafeAuthRedirect(
    typeof location.state?.redirectTo === 'string' ? location.state.redirectTo : null
  );

  const user = firebaseUser && typeof firebaseUser === 'object'
    ? (firebaseUser as User)
    : null;

  useEffect(() => {
    if (userProfile?.role) setRole(userProfile.role);
  }, [userProfile?.role]);

  useEffect(() => {
    if (isLoading || !user || requiresEmailVerification(user)) return;
    if (userProfile?.username) {
      navigate(safeRedirectTo ?? dashboardPath(userProfile.role), { replace: true });
    }
  }, [isLoading, navigate, safeRedirectTo, user, userProfile]);

  if (isLoading) {
    return <p role="status" className="p-6 text-center text-ink-secondary">Checking your account…</p>;
  }
  if (!user) return <Navigate to="/login" replace />;
  if (requiresEmailVerification(user)) {
    return <Navigate to="/verify-email" replace />;
  }

  const cleanUsername = sanitizePlainText(username);
  const usernameValid = isValidUsername(cleanUsername);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !usernameValid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const initialProfile = userProfile
        ? undefined
        : {
            uid: user.uid,
            email: user.email ?? '',
            displayName: cleanUsername,
            role,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
            fcmTokens: [],
            accessibilityPreferences: {
              highContrast: false,
              largeText: true,
              hapticFeedback: true,
              soundEnabled: true,
            },
          };
      await saveUserProfileWithUsername(user.uid, cleanUsername, initialProfile);
      await refreshUserProfile?.();
      const profile = await getUserDocument(user.uid);
      navigate(safeRedirectTo ?? dashboardPath(profile?.role ?? role), { replace: true });
    } catch (setupError) {
      if (setupError instanceof Error && setupError.message === 'USERNAME_TAKEN') {
        setError('That username is already in use. Please choose another.');
      } else if (setupError instanceof Error && setupError.message === 'USERNAME_ALREADY_SET') {
        setError('This account already has a username. Sign out and sign in again to refresh it.');
      } else {
        setError(authErrorMessage(setupError));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
      navigate('/login', { replace: true });
    } catch (signOutError) {
      setError(authErrorMessage(signOutError));
    }
  }

  return (
    <AuthShell label="Complete your account setup">
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5 pt-2">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-ink-primary">Choose your username</h1>
          <p className="mt-2 text-sm text-ink-secondary">
            Set a name for your MediMate profile before continuing.
          </p>
        </div>
        {!userProfile && !onboardingRole && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink-primary">How will you use MediMate?</legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(['elderly', 'caregiver', 'dual'] as const).map((value) => (
                <label key={value} className="flex min-h-touch cursor-pointer items-center gap-2 rounded-btn border border-ink-muted/30 p-3 text-sm text-ink-primary">
                  <input
                    type="radio"
                    name="onboarding-role"
                    value={value}
                    checked={role === value}
                    onChange={() => setRole(value)}
                    className="accent-brand-teal"
                  />
                  {value === 'elderly'
                    ? 'Older adult'
                    : value === 'caregiver'
                      ? 'Family caregiver'
                      : 'Dual user'}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor="onboarding-username" className="mb-1.5 block text-sm font-semibold text-ink-primary">
            Username
          </label>
          <input
            id="onboarding-username"
            type="text"
            autoComplete="nickname"
            minLength={2}
            maxLength={30}
            value={username}
            onChange={(event) => setUsername(sanitizePlainText(event.target.value))}
            aria-describedby="onboarding-username-hint"
            className="min-h-touch w-full rounded-btn border border-ink-muted/30 bg-surface px-4 py-3 text-base text-ink-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          />
          <p id="onboarding-username-hint" className="mt-1 text-xs text-ink-muted">
            2–30 characters; letters, numbers, spaces, and underscores. Usernames are unique.
          </p>
          {username.length > 0 && !usernameValid && (
            <p className="mt-1 text-xs text-alert">Use 2–30 allowed characters, without spaces at either end.</p>
          )}
        </div>
        {error && <p role="alert" className="rounded-btn bg-alert-bg p-3 text-sm text-alert">{error}</p>}
        <button
          type="submit"
          disabled={busy || !usernameValid}
          className="min-h-touch w-full rounded-btn bg-brand-teal px-5 py-3 font-semibold text-white hover:bg-brand-teal-dark disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save username and continue'}
        </button>
        <button
          type="button"
          onClick={() => void handleSignOut()}
          className="min-h-touch w-full rounded-btn px-4 py-2 text-sm font-semibold text-ink-secondary hover:bg-canvas"
        >
          Sign out or switch account
        </button>
      </form>
    </AuthShell>
  );
}
