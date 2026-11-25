/**
 * SettingsModal — Accessible Settings & Accessibility Preferences dialog.
 *
 * Features:
 *   - WCAG 2.2 AA dialog semantics (role="dialog", aria-modal="true", aria-labelledby)
 *   - Escape key, backdrop click, Tab/Shift+Tab focus trap, and focus restoration
 *   - 4 accessible role="switch" toggles (Sound, Haptics, High Contrast, Large Text)
 *   - Live Notification permission status (granted/denied/default/unsupported) + requestPermission()
 *   - Honest note on client-side tab-open notification delivery
 */

import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Contrast, Type, Vibrate, Volume2, X } from 'lucide-react';
import type { AccessibilityPreferences } from '../../types/firestore';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: AccessibilityPreferences;
  onUpdatePreferences: (patch: Partial<AccessibilityPreferences>) => Promise<void> | void;
}

type NotificationStatus = NotificationPermission | 'unsupported';

function getNotificationStatus(): NotificationStatus {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const selector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

export function SettingsModal({
  isOpen,
  onClose,
  preferences,
  onUpdatePreferences,
}: SettingsModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const [notificationStatus, setNotificationStatus] = useState<NotificationStatus>(() =>
    getNotificationStatus()
  );
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  // Handle focus-on-open and focus restoration on close
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setNotificationStatus(getNotificationStatus());
      setAnnouncement('');

      const timer = window.setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 0);

      wasOpenRef.current = true;
      return () => {
        window.clearTimeout(timer);
      };
    }

    if (!isOpen && wasOpenRef.current) {
      wasOpenRef.current = false;
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    }

    return undefined;
  }, [isOpen]);

  // Restore focus if unmounted while open
  useEffect(() => {
    return () => {
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const target = previousFocusRef.current;
        previousFocusRef.current = null;
        if (target && typeof target.focus === 'function') {
          target.focus();
        }
      }
    };
  }, []);

  // Keyboard handling: Escape to close + Tab/Shift+Tab focus trap
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = getFocusableElements(dialogRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;

        if (e.shiftKey) {
          if (active === first || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  function handleToggle(key: keyof AccessibilityPreferences, label: string) {
    const nextValue = !preferences[key];
    setAnnouncement(`${label} turned ${nextValue ? 'on' : 'off'}.`);
    void onUpdatePreferences({ [key]: nextValue });
  }

  async function handleRequestNotificationPermission() {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      setNotificationStatus('unsupported');
      setAnnouncement('Browser notifications are not supported on this device.');
      return;
    }

    setIsRequestingPermission(true);
    try {
      const result = await window.Notification.requestPermission();
      setNotificationStatus(result);
      if (result === 'granted') {
        setAnnouncement('Browser notifications enabled.');
      } else if (result === 'denied') {
        setAnnouncement('Browser notifications were blocked.');
      } else {
        setAnnouncement('Notification permission request was dismissed.');
      }
    } catch {
      const fallback = getNotificationStatus();
      setNotificationStatus(fallback);
      setAnnouncement('Unable to update browser notification permission.');
    } finally {
      setIsRequestingPermission(false);
    }
  }

  const toggleRows: Array<{
    key: keyof AccessibilityPreferences;
    label: string;
    description: string;
    icon: typeof Volume2;
  }> = [
    {
      key: 'soundEnabled',
      label: 'Sound Effects',
      description: 'Play a gentle confirmation chime when marking a dose taken.',
      icon: Volume2,
    },
    {
      key: 'hapticFeedback',
      label: 'Haptic Feedback',
      description: 'Vibrate gently on supported mobile devices when confirming or snoozing.',
      icon: Vibrate,
    },
    {
      key: 'highContrast',
      label: 'High-Contrast Mode',
      description: 'Increase border and text contrast across all screens.',
      icon: Contrast,
    },
    {
      key: 'largeText',
      label: 'Large Text',
      description: 'Scale text sizes up for easier reading.',
      icon: Type,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="w-full max-w-lg rounded-card bg-surface border border-slate-200 shadow-xl my-auto max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="settings-modal-title" className="text-xl font-bold text-ink-primary">
            Settings &amp; Accessibility
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="min-h-touch min-w-touch min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-btn text-ink-secondary hover:bg-slate-100 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Accessibility & Feedback Toggles */}
          <section aria-labelledby="a11y-preferences-heading" className="space-y-3">
            <h3
              id="a11y-preferences-heading"
              className="text-xs font-bold uppercase tracking-wider text-ink-muted"
            >
              Display &amp; Feedback
            </h3>

            <div className="space-y-2.5">
              {toggleRows.map(({ key, label, description, icon: Icon }) => {
                const checked = Boolean(preferences[key]);
                const labelId = `settings-switch-label-${key}`;
                const descId = `settings-switch-desc-${key}`;

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 rounded-btn border border-slate-200 bg-slate-50/70 px-4 py-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <Icon
                        className="w-5 h-5 text-brand-teal shrink-0 mt-0.5"
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p id={labelId} className="text-sm font-semibold text-ink-primary">
                          {label}
                        </p>
                        <p id={descId} className="text-xs text-ink-secondary mt-0.5">
                          {description}
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      role="switch"
                      aria-checked={checked}
                      aria-labelledby={labelId}
                      aria-describedby={descId}
                      onClick={() => handleToggle(key, label)}
                      className={`min-h-touch min-w-touch min-h-[44px] min-w-[56px] shrink-0 inline-flex items-center rounded-full p-1 transition-colors focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 ${
                        checked ? 'bg-brand-teal justify-end' : 'bg-slate-300 justify-start'
                      }`}
                    >
                      <span className="sr-only">{checked ? 'On' : 'Off'}</span>
                      <span
                        aria-hidden="true"
                        className="h-6 w-6 rounded-full bg-white shadow-sm"
                      />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Browser Notifications */}
          <section
            aria-labelledby="notifications-heading"
            className="rounded-btn border border-slate-200 bg-slate-50/70 p-4 space-y-3"
          >
            <div className="flex items-start gap-3">
              {notificationStatus === 'denied' || notificationStatus === 'unsupported' ? (
                <BellOff className="w-5 h-5 text-ink-secondary shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <Bell className="w-5 h-5 text-brand-teal shrink-0 mt-0.5" aria-hidden="true" />
              )}

              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 id="notifications-heading" className="text-sm font-semibold text-ink-primary">
                    Browser Dose Reminders
                  </h3>
                  <span
                    data-testid="notification-status-badge"
                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      notificationStatus === 'granted'
                        ? 'bg-taken-bg text-taken'
                        : notificationStatus === 'denied'
                        ? 'bg-alert-bg text-alert'
                        : notificationStatus === 'default'
                        ? 'bg-due-bg text-due'
                        : 'bg-slate-200 text-ink-secondary'
                    }`}
                  >
                    {notificationStatus === 'granted'
                      ? 'Allowed'
                      : notificationStatus === 'denied'
                      ? 'Blocked'
                      : notificationStatus === 'default'
                      ? 'Not Enabled'
                      : 'Unsupported'}
                  </span>
                </div>

                <p className="text-xs text-ink-secondary">
                  {notificationStatus === 'granted' &&
                    'Notifications are enabled. You will receive dose alerts while MediMate is open.'}
                  {notificationStatus === 'denied' &&
                    'Notifications are blocked by your browser. Re-enable notifications for this site in your browser settings to receive alerts.'}
                  {notificationStatus === 'default' &&
                    'Notifications are not enabled yet. Allow browser notifications to receive gentle dose alerts.'}
                  {notificationStatus === 'unsupported' &&
                    'This browser or device does not support Web Notifications.'}
                </p>

                <p className="text-xs text-ink-muted">
                  Reminder notifications are delivered client-side while MediMate stays open in a
                  browser tab or installed PWA.
                </p>

                {notificationStatus === 'default' && (
                  <div className="pt-1">
                    <button
                      type="button"
                      disabled={isRequestingPermission}
                      aria-disabled={isRequestingPermission ? 'true' : undefined}
                      onClick={() => void handleRequestNotificationPermission()}
                      className="min-h-touch min-w-touch min-h-[44px] min-w-[44px] inline-flex items-center justify-center px-4 py-2 rounded-btn bg-brand-teal text-white text-sm font-semibold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 disabled:opacity-60 transition-colors"
                    >
                      {isRequestingPermission
                        ? 'Requesting Permission…'
                        : 'Enable Browser Notifications'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Screen reader live announcement */}
          <p role="status" aria-live="polite" className="sr-only">
            {announcement}
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="min-h-touch min-w-touch min-h-[44px] min-w-[44px] px-5 py-2.5 rounded-btn bg-brand-teal text-white text-sm font-semibold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default SettingsModal;
