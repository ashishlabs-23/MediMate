/**
 * LoginScreen — Firebase Auth authentication with Sign In / Sign Up modes
 * and streamlined One-Click Demo Account access.
 *
 * Roles:
 *   - 'elderly': Older adult managing their daily schedule in Simple Mode.
 *   - 'caregiver': Family caregiver monitoring patient adherence in Dashboard.
 *   ("Both" removed to eliminate user confusion).
 */

import { type FormEvent, useState } from 'react';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../lib/firebase';
import { getUserDocument, upsertUserDocument } from '../../lib/firestore';
import { useAuthContext } from '../../contexts/AuthContext';

export function LoginScreen() {
  const navigate = useNavigate();
  const { loginAsDemo } = useAuthContext();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [selectedRole, setSelectedRole] = useState<'elderly' | 'caregiver'>('elderly');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setIsSubmitting(true);

    const cleanEmail = email.trim();
    if (!cleanEmail || !password) {
      setErrorMsg('Please enter both email and password.');
      setIsSubmitting(false);
      return;
    }

    try {
      if (mode === 'signup') {
        // Create new Firebase Auth account
        const credential = await createUserWithEmailAndPassword(auth, cleanEmail, password);
        const name = fullName.trim() || (selectedRole === 'caregiver' ? 'Caregiver' : 'Older Adult');

        // Initialize Firestore profile with chosen role
        await upsertUserDocument(credential.user.uid, {
          uid: credential.user.uid,
          email: cleanEmail,
          displayName: name,
          role: selectedRole,
          timezone: 'Asia/Kolkata',
          fcmTokens: [],
          accessibilityPreferences: {
            highContrast: false,
            largeText: true,
            hapticFeedback: true,
            soundEnabled: true,
          },
        });

        if (selectedRole === 'caregiver') {
          navigate('/app/caregiver', { replace: true });
        } else {
          navigate('/app/today', { replace: true });
        }
      } else {
        // Existing user sign-in
        const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
        const profile = await getUserDocument(credential.user.uid);
        const role = profile?.role ?? selectedRole;

        if (role === 'caregiver') {
          navigate('/app/caregiver', { replace: true });
        } else {
          navigate('/app/today', { replace: true });
        }
      }
    } catch (err: unknown) {
      let msg = 'Authentication failed. Please check your details.';
      if (err instanceof Error) {
        if (err.message.includes('auth/email-already-in-use')) {
          msg = 'An account with this email already exists. Please switch to Sign In.';
        } else if (err.message.includes('auth/wrong-password') || err.message.includes('auth/invalid-credential')) {
          msg = 'Incorrect email or password.';
        } else if (err.message.includes('auth/weak-password')) {
          msg = 'Password should be at least 6 characters.';
        } else if (err.message.includes('auth/user-not-found')) {
          msg = 'No account found with this email. Click "Create New Account" below.';
        } else if (
          err.message.includes('auth/configuration-not-found') ||
          err.message.includes('CONFIGURATION_NOT_FOUND')
        ) {
          msg = 'Firebase Authentication is not activated yet in the Firebase Console. Click "Get Started" in Firebase Console > Authentication, or use the Quick Demo Account button above.';
        } else if (
          err.message.includes('auth/operation-not-allowed')
        ) {
          msg = 'Email/Password sign-in is not enabled in Firebase Console. Please enable it under Authentication > Sign-in method.';
        } else {
          msg = err.message;
        }
      }
      setErrorMsg(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      const credential = await signInWithPopup(auth, provider);
      const user = credential.user;

      // Check for existing user document or initialize
      const profile = await getUserDocument(user.uid);
      const role = profile?.role ?? selectedRole;

      if (!profile) {
        await upsertUserDocument(user.uid, {
          uid: user.uid,
          email: user.email ?? '',
          displayName: user.displayName || (selectedRole === 'caregiver' ? 'Caregiver' : 'Older Adult'),
          role: selectedRole,
          timezone: 'Asia/Kolkata',
          fcmTokens: [],
          accessibilityPreferences: {
            highContrast: false,
            largeText: true,
            hapticFeedback: true,
            soundEnabled: true,
          },
        });
      }

      if (role === 'caregiver') {
        navigate('/app/caregiver', { replace: true });
      } else {
        navigate('/app/today', { replace: true });
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (
          err.message.includes('auth/popup-closed-by-user') ||
          err.message.includes('auth/cancelled-popup-request')
        ) {
          // Closed by user, no error needed
          return;
        }
        if (
          err.message.includes('auth/configuration-not-found') ||
          err.message.includes('CONFIGURATION_NOT_FOUND')
        ) {
          setErrorMsg(
            'Google Sign-In is not activated yet in Firebase Console. Click "Get Started" in Firebase Console > Authentication, and enable Google under Sign-in method.'
          );
          return;
        }
        if (err.message.includes('auth/operation-not-allowed')) {
          setErrorMsg(
            'Google sign-in is disabled in your Firebase project. Please enable "Google" under Firebase Console > Authentication > Sign-in method.'
          );
          return;
        }
        setErrorMsg(err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleForgotPassword() {
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMsg('Please enter your email address in the Email field below, then click "Forgot password?".');
      return;
    }

    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);

    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setSuccessMsg(`Password reset email sent to ${cleanEmail}. Please check your inbox and spam folder.`);
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.message.includes('auth/user-not-found')) {
          setErrorMsg('No user account found with this email address.');
        } else {
          setErrorMsg(err.message);
        }
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDemoLogin() {
    if (loginAsDemo) {
      loginAsDemo(selectedRole);
      if (selectedRole === 'caregiver') {
        navigate('/app/caregiver', { replace: true });
      } else {
        navigate('/app/today', { replace: true });
      }
    }
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

        {/* 1. Clear Role Toggle: Older Adult vs Family Caregiver */}
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
              onClick={() => setSelectedRole('elderly')}
              className={`py-2.5 px-3 text-xs sm:text-sm font-bold rounded-md transition-all text-center min-h-[44px] flex items-center justify-center gap-1.5 ${
                selectedRole === 'elderly'
                  ? 'bg-white text-brand-teal shadow-sm border border-slate-200'
                  : 'text-ink-secondary hover:text-ink-primary'
              }`}
            >
              <span>👴</span> Older Adult
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={selectedRole === 'caregiver'}
              onClick={() => setSelectedRole('caregiver')}
              className={`py-2.5 px-3 text-xs sm:text-sm font-bold rounded-md transition-all text-center min-h-[44px] flex items-center justify-center gap-1.5 ${
                selectedRole === 'caregiver'
                  ? 'bg-white text-brand-teal shadow-sm border border-slate-200'
                  : 'text-ink-secondary hover:text-ink-primary'
              }`}
            >
              <span>👩‍⚕️</span> Family Caregiver
            </button>
          </div>
        </div>

        {/* 2. One Streamlined Demo Account Card */}
        <div className="mb-6 p-4 rounded-btn bg-teal-50/70 border border-teal-200/80 text-center">
          <p className="text-xs font-extrabold text-brand-teal uppercase tracking-wider mb-1.5">
            ⚡ Quick Demo Account
          </p>
          <p className="text-xs text-ink-secondary mb-3">
            Explore with preloaded medications & real-time schedule. No sign-up required.
          </p>
          <button
            type="button"
            onClick={handleDemoLogin}
            className="w-full min-h-[48px] py-2.5 px-4 rounded-btn bg-brand-teal text-white text-sm font-bold hover:bg-brand-teal-dark active:bg-brand-teal-dark shadow-sm transition-colors flex items-center justify-center gap-2"
          >
            <span>🚀 Enter Demo as {selectedRole === 'caregiver' ? 'Caregiver (Priya Sharma)' : 'Older Adult (Ramesh Sharma)'}</span>
          </button>
        </div>

        {/* Divider */}
        <div className="relative mb-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-surface px-3 text-ink-muted font-medium">or use your personal account</span>
          </div>
        </div>

        {/* Google Sign-In Button */}
        <button
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={isSubmitting}
          className="w-full min-h-[48px] py-2.5 px-4 mb-5 rounded-btn border border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 text-ink-primary text-sm font-semibold shadow-sm transition-colors flex items-center justify-center gap-3 disabled:opacity-60 disabled:cursor-not-allowed"
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

        {/* Or with Email */}
        <div className="relative mb-5">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-surface px-3 text-ink-muted font-medium">or continue with email</span>
          </div>
        </div>

        {/* 3. Sign In vs Create Account Tabs */}
        <div role="tablist" aria-label="Authentication mode" className="flex border-b border-slate-200 mb-5">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'signin'}
            onClick={() => {
              setMode('signin');
              setErrorMsg(null);
            }}
            className={`flex-1 pb-2.5 text-sm font-bold border-b-2 transition-all ${
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
            onClick={() => {
              setMode('signup');
              setErrorMsg(null);
            }}
            className={`flex-1 pb-2.5 text-sm font-bold border-b-2 transition-all ${
              mode === 'signup'
                ? 'border-brand-teal text-brand-teal'
                : 'border-transparent text-ink-muted hover:text-ink-secondary'
            }`}
          >
            Create New Account
          </button>
        </div>

        {/* Success banner */}
        {successMsg && (
          <div
            role="status"
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

        {/* Form: handles both Sign In and Sign Up */}
        <form onSubmit={(e) => void handleSubmit(e)} noValidate>
          {/* Full Name (only in Sign Up mode) */}
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
                placeholder={selectedRole === 'caregiver' ? 'e.g. Priya Sharma' : 'e.g. Ramesh Sharma'}
                className="
                  w-full min-h-touch rounded-btn border border-slate-300 px-4 py-2
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
                w-full min-h-touch rounded-btn border border-slate-300 px-4 py-2
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
                className="text-xs text-brand-teal font-semibold hover:underline"
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
                w-full min-h-touch rounded-btn border border-slate-300 px-4 py-2
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
                  onClick={() => void handleForgotPassword()}
                  disabled={isSubmitting}
                  className="text-xs text-brand-teal font-semibold hover:underline disabled:opacity-50 min-h-[32px] px-1"
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
              w-full min-h-touch rounded-btn bg-brand-teal text-white
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
      </section>
    </main>
  );
}

export default LoginScreen;
