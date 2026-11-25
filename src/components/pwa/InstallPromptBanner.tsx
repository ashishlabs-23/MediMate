/**
 * InstallPromptBanner — Non-intrusive PWA install banner capturing `beforeinstallprompt`.
 * Suppressed when already running in standalone mode or dismissed via localStorage.
 */

import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_STORAGE_KEY = 'medimate_pwa_install_dismissed';

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const mediaMatch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches === true;
  const navStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mediaMatch || navStandalone;
}

function isPreviouslyDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function InstallPromptBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => isPreviouslyDismissed());
  const [isStandalone, setIsStandalone] = useState<boolean>(() => isStandaloneMode());

  useEffect(() => {
    setIsStandalone(isStandaloneMode());
    setIsDismissed(isPreviouslyDismissed());

    function handleBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      if (isStandaloneMode() || isPreviouslyDismissed()) {
        return;
      }
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  if (!deferredPrompt || isStandalone || isDismissed) {
    return null;
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      setDeferredPrompt(null);
    }
  }

  function handleDismiss() {
    try {
      window.localStorage.setItem(DISMISS_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage failures in restricted browsing contexts
    }
    setIsDismissed(true);
    setDeferredPrompt(null);
  }

  return (
    <div
      role="region"
      aria-label="Install MediMate app"
      className="bg-brand-teal-light/40 border-b border-teal-200 px-4 py-3"
    >
      <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <Download className="w-5 h-5 text-brand-teal shrink-0" aria-hidden="true" />
          <p className="text-sm font-medium text-ink-primary">
            Install MediMate on your device for quick access and offline reminders.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => void handleInstall()}
            className="min-h-touch min-w-touch px-4 py-2 rounded-btn bg-brand-teal text-white text-sm font-bold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors"
          >
            Install App
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            className="min-h-touch min-w-touch px-4 py-2 rounded-btn bg-surface border border-slate-300 text-ink-primary text-sm font-semibold hover:bg-slate-50 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

export default InstallPromptBanner;
