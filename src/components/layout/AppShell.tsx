/**
 * AppShell — shared top navigation layout.
 * Renders MediMate logo, Dual Role Switcher (for dual-role and demo users),
 * Settings & Accessibility modal trigger, sign-out button, and PWA install banner.
 * Also synchronizes highContrast & largeText preferences to document.documentElement.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { Settings } from 'lucide-react';
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
  const [localPrefsOverride, setLocalPrefsOverride] = useState<
    Partial<AccessibilityPreferences>
  >({});

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

  async function handleSignOut() {
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
          <span className="text-xl font-bold tracking-tight select-none">MediMate</span>

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
              onClick={() => void handleSignOut()}
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
    </div>
  );
}

export default AppShell;
