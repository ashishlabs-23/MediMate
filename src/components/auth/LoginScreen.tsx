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
        } else {
          msg = err.message;
        }
      }
      setErrorMsg(msg);
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
        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-slate-200" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-surface px-3 text-ink-muted font-medium">or use your personal account</span>
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
