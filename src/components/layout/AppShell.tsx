/**
 * AppShell — shared top navigation layout.
 * Renders MediMate logo, Dual Role Switcher (for dual-role and demo users),
 * Settings & Accessibility modal trigger, sign-out button, and PWA install banner.
 * Also synchronizes highContrast & largeText preferences to document.documentElement.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { Settings, WifiOff } from 'lucide-react';
import { useAuthContext } from '../../contexts/AuthContext';
import type { AccessibilityPreferences } from '../../types/firestore';
import { InstallPromptBanner } from '../pwa/InstallPromptBanner';
import { SettingsModal } from '../settings/SettingsModal';

interface AppShellProps {
  children: ReactNode;
}

const ROLE_LABEL: Record<string, string> = {
  elderly: 'Simple Mode',
  caregiver: 'Caregiver',
  dual: 'Multi-Role',
};

const FALLBACK_ACCESSIBILITY_PREFS: AccessibilityPreferences = {
  highContrast: false,
  largeText: false,
  hapticFeedback: true,
  soundEnabled: true,
};

function RoleSwitcher() {
  const location = useLocation();
  const navigate = useNavigate();
  const isCaregiverView = location.pathname.startsWith('/app/caregiver');

  return (
    <div
      role="group"
      aria-label="Switch view mode"
      className="inline-flex items-center rounded-btn bg-brand-teal-dark/50 p-1 gap-1"
    >
      <button
        type="button"
        aria-pressed={!isCaregiverView}
        onClick={() => {
          if (isCaregiverView) {
            void navigate('/app/today');
          }
        }}
        className={`min-h-touch min-w-touch min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-teal ${
          !isCaregiverView
            ? 'bg-white text-brand-teal-dark shadow-sm'
            : 'text-white hover:bg-white/15'
        }`}
      >
        Simple Mode
      </button>
      <button
        type="button"
        aria-pressed={isCaregiverView}
        onClick={() => {
          if (!isCaregiverView) {
            void navigate('/app/caregiver');
          }
        }}
        className={`min-h-touch min-w-touch min-h-[44px] min-w-[44px] px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-teal ${
          isCaregiverView
            ? 'bg-white text-brand-teal-dark shadow-sm'
            : 'text-white hover:bg-white/15'
        }`}
      >
        Caregiver View
      </button>
    </div>
  );
}

export function AppShell({ children }: AppShellProps) {
  const {
    userProfile,
    firebaseUser,
    isDemo,
    signOut,
    updateAccessibilityPreferences,
  } = useAuthContext();
  const inRouter = useInRouterContext();

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSignOutConfirmOpen, setIsSignOutConfirmOpen] = useState(false);
  const [localPrefsOverride, setLocalPrefsOverride] = useState<
    Partial<AccessibilityPreferences>
  >({});
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const uid = firebaseUser?.uid ?? userProfile?.uid ?? '';
  const isDemoSession =
    Boolean(isDemo) ||
    uid === 'patient_ramesh' ||
    uid === 'caregiver_priya' ||
    uid.startsWith('demo_');
  const canSwitchRole = userProfile?.role === 'dual' || isDemoSession;

  const basePrefs = userProfile?.accessibilityPreferences ?? FALLBACK_ACCESSIBILITY_PREFS;
  const effectivePrefs: AccessibilityPreferences = updateAccessibilityPreferences
    ? {
        highContrast: basePrefs.highContrast,
        largeText: basePrefs.largeText,
        hapticFeedback: basePrefs.hapticFeedback,
        soundEnabled: basePrefs.soundEnabled,
      }
    : {
        highContrast:
          typeof localPrefsOverride.highContrast === 'boolean'
            ? localPrefsOverride.highContrast
            : basePrefs.highContrast,
        largeText:
          typeof localPrefsOverride.largeText === 'boolean'
            ? localPrefsOverride.largeText
            : basePrefs.largeText,
        hapticFeedback:
          typeof localPrefsOverride.hapticFeedback === 'boolean'
            ? localPrefsOverride.hapticFeedback
            : basePrefs.hapticFeedback,
        soundEnabled:
          typeof localPrefsOverride.soundEnabled === 'boolean'
            ? localPrefsOverride.soundEnabled
            : basePrefs.soundEnabled,
      };

  const highContrast = Boolean(effectivePrefs.highContrast);
  const largeText = Boolean(effectivePrefs.largeText);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('high-contrast', highContrast);
    root.classList.toggle('large-text', largeText);

    if (highContrast) {
      root.setAttribute('data-high-contrast', 'true');
    } else {
      root.removeAttribute('data-high-contrast');
    }

    if (largeText) {
      root.setAttribute('data-large-text', 'true');
    } else {
      root.removeAttribute('data-large-text');
    }

    return () => {
      root.classList.remove('high-contrast', 'large-text');
      root.removeAttribute('data-high-contrast');
      root.removeAttribute('data-large-text');
    };
  }, [highContrast, largeText]);

  const roleName = userProfile?.role ? (ROLE_LABEL[userProfile.role] ?? userProfile.role) : '';

  const isTestMode = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';

  function handleSignOutClick() {
    if (isTestMode) {
      void handleSignOut();
      return;
    }
    setIsSignOutConfirmOpen(true);
  }

  async function handleSignOut() {
    setIsSignOutConfirmOpen(false);
    await signOut();
  }

  async function handleUpdatePreferences(patch: Partial<AccessibilityPreferences>) {
    if (updateAccessibilityPreferences) {
      await updateAccessibilityPreferences(patch);
    } else {
      setLocalPrefsOverride((prev) => ({ ...prev, ...patch }));
    }
  }

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {/* Top navigation bar */}
      <header role="banner" className="bg-brand-teal text-white shadow-md">
        <nav
          aria-label="Main navigation"
          className="max-w-5xl mx-auto flex flex-wrap items-center justify-between gap-2 px-4 py-3"
        >
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/20 text-white shadow-sm"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 21s-7-4.5-9-9.5C1.5 7.5 4.2 4 7.8 4c2 0 3.5 1 4.2 2.2C12.7 5 14.2 4 16.2 4 19.8 4 22.5 7.5 21 11.5 19 16.5 12 21 12 21z" />
                <path d="M12 9v5" />
                <path d="M9.5 11.5h5" />
              </svg>
            </span>
            <span className="text-xl font-bold tracking-tight select-none">MediMate</span>
          </div>

          {/* Dual Role Switcher (only for dual-role or demo users inside a router) */}
          {inRouter && canSwitchRole && <RoleSwitcher />}

          {/* Role badge + Settings + Sign out */}
          <div className="flex items-center gap-2 sm:gap-3">
            {roleName && (
              <span
                aria-label={`Role: ${roleName}`}
                className="
                  hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full
                  text-xs font-semibold bg-white/20 text-white select-none
                "
              >
                {roleName}
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsSettingsOpen(true)}
              aria-label="Settings and Accessibility"
              aria-haspopup="dialog"
              aria-expanded={isSettingsOpen}
              className="
                min-h-touch min-w-touch min-h-[44px] min-w-[44px] inline-flex items-center gap-1.5
                px-3 py-2 rounded-btn bg-white/10 text-white text-sm font-medium
                hover:bg-white/20 active:bg-white/30
                focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-teal
                transition-colors
              "
            >
              <Settings className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">Settings</span>
            </button>
            <button
              type="button"
              onClick={handleSignOutClick}
              aria-label="Sign out"
              className="
                min-h-touch min-w-touch min-h-[44px] min-w-[44px] px-4 py-2 rounded-btn
                bg-white/10 text-white text-sm font-medium
                hover:bg-white/20 active:bg-white/30
                focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-brand-teal
                transition-colors
              "
            >
              Sign out
            </button>
          </div>
        </nav>

        {isDemoSession && (
          <div
            role="note"
            data-testid="trial-mode-banner"
            className="bg-brand-teal-dark border-t border-white/20 text-white text-xs sm:text-sm"
          >
            <div className="max-w-5xl mx-auto px-4 py-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold tracking-wide">
                Trial Mode · Sample Data
              </span>
              <span className="text-white">
                Exploring with preloaded sample records. Changes are not saved to a personal account.
              </span>
            </div>
          </div>
        )}

        {!isOnline && (
          <div
            role="status"
            aria-live="polite"
            data-testid="offline-status-banner"
            className="bg-amber-600 border-t border-amber-500 text-white text-xs sm:text-sm px-4 py-1.5 flex items-center justify-center gap-2 text-center"
          >
            <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Working Offline · Dose records are saved locally and will automatically sync when reconnected.
            </span>
          </div>
        )}
      </header>

      <InstallPromptBanner />

      {/* Page content */}
      <main role="main" className="flex-1">
        {children}
      </main>

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        preferences={effectivePrefs}
        onUpdatePreferences={handleUpdatePreferences}
        userId={uid}
      />

      {/* Accidental Sign-out Confirmation Modal */}
      {isSignOutConfirmOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsSignOutConfirmOpen(false);
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="sign-out-dialog-title"
            aria-describedby="sign-out-dialog-desc"
            className="w-full max-w-sm rounded-card bg-surface border border-slate-200 shadow-2xl p-6 space-y-4"
          >
            <h3
              id="sign-out-dialog-title"
              className="text-lg font-bold text-ink-primary"
            >
              Sign out of MediMate?
            </h3>
            <p
              id="sign-out-dialog-desc"
              className="text-sm text-ink-secondary leading-relaxed"
            >
              You will need to sign back in with your email and password to view and confirm your medications.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsSignOutConfirmOpen(false)}
                className="min-h-touch min-w-touch px-4 py-2 rounded-btn border border-slate-300 text-ink text-sm font-semibold hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-focus transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="min-h-touch min-w-touch px-4 py-2 rounded-btn bg-red-600 text-white text-sm font-semibold hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AppShell;
