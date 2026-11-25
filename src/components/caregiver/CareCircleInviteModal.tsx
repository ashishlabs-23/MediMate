/**
 * CareCircleInviteModal — Accessible modal dialog for sharing a Care Circle invite code
 * or sending an email invitation to a family member or caregiver.
 *
 * Features:
 *   - WCAG 2.2 AA dialog semantics (role="dialog", aria-modal="true", aria-labelledby)
 *   - Escape key, backdrop click, Tab/Shift+Tab focus trap, and focus restoration
 *   - Copy invite code via navigator.clipboard.writeText with execCommand + manual fallbacks
 *   - Email invite form with validation, case-insensitive duplicate check, role & permissions
 *   - Stays open post-submit with inline confirmation banner + mailto: handoff link
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Check, Copy, Mail, Send, X } from 'lucide-react';
import type {
  CareCircleMember,
  CareCircleMemberRole,
  CareCirclePermission,
} from '../../types/firestore';

export interface CareCircleInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
  inviteCode: string;
  existingEmails: string[];
  onInviteMember: (member: CareCircleMember) => Promise<void> | void;
  patientName?: string | undefined;
}

interface InvitedConfirmation {
  email: string;
  displayName: string;
  role: CareCircleMemberRole;
}

interface PermissionOption {
  value: CareCirclePermission;
  label: string;
  description: string;
}

const DEFAULT_PERMISSIONS: CareCirclePermission[] = ['read', 'receive_alerts'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const PERMISSION_OPTIONS: PermissionOption[] = [
  {
    value: 'read',
    label: 'View dose schedule & history',
    description: 'See daily medications, taken confirmations, and adherence trends.',
  },
  {
    value: 'write_schedule',
    label: 'Edit & write prescriptions',
    description: 'Add, edit, or pause prescriptions for the patient.',
  },
  {
    value: 'receive_alerts',
    label: 'Receive missed-dose alerts',
    description: 'Get notified if a scheduled dose remains unconfirmed.',
  },
];

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

function deriveDisplayName(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  return localPart || 'Family Member';
}

function buildMailtoHref(
  recipientEmail: string,
  inviteCode: string,
  patientName: string | undefined,
  role: CareCircleMemberRole
): string {
  const targetPatient = patientName?.trim() || 'your family member';
  const roleLabel = role === 'primary' ? 'Primary Caregiver' : 'Secondary Caregiver';
  const subject = `MediMate Care Circle Invitation for ${targetPatient}`;
  const body = [
    'Hello,',
    '',
    `You have been invited as a ${roleLabel} to join the MediMate Care Circle for ${targetPatient}.`,
    '',
    `Care Circle Invite Code: ${inviteCode}`,
    '',
    'Open MediMate and enter this invite code to connect.',
  ].join('\n');

  return `mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function CareCircleInviteModal({
  isOpen,
  onClose,
  inviteCode,
  existingEmails,
  onInviteMember,
  patientName,
}: CareCircleInviteModalProps) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const copyButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const copyTimerRef = useRef<number | null>(null);

  const effectiveCode = inviteCode.trim() || 'MED-7892';

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<CareCircleMemberRole>('secondary');
  const [permissions, setPermissions] = useState<CareCirclePermission[]>(DEFAULT_PERMISSIONS);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [copyAnnouncement, setCopyAnnouncement] = useState('');
  const [invitedConfirmation, setInvitedConfirmation] = useState<InvitedConfirmation | null>(null);

  // Reset form/feedback state, capture trigger focus on open, and restore focus on close
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      previousFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;

      setEmail('');
      setDisplayName('');
      setRole('secondary');
      setPermissions(DEFAULT_PERMISSIONS);
      setError(null);
      setIsSubmitting(false);
      setCopyStatus('idle');
      setCopyAnnouncement('');
      setInvitedConfirmation(null);

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
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
      const target = previousFocusRef.current;
      previousFocusRef.current = null;
      if (target && typeof target.focus === 'function') {
        target.focus();
      }
    }

    return undefined;
  }, [isOpen]);

  // Restore focus and clear timers if unmounted while open
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = null;
      }
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
        if (!isSubmitting) {
          e.preventDefault();
          onClose();
        }
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
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  function scheduleCopyReset() {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopyStatus('idle');
      copyTimerRef.current = null;
    }, 3000);
  }

  async function handleCopyCode() {
    let copied = false;

    try {
      if (
        typeof navigator !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === 'function'
      ) {
        await navigator.clipboard.writeText(effectiveCode);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined' && typeof document.execCommand === 'function') {
      let textarea: HTMLTextAreaElement | null = null;
      try {
        textarea = document.createElement('textarea');
        textarea.value = effectiveCode;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        copied = Boolean(document.execCommand('copy'));
      } catch {
        copied = false;
      } finally {
        if (textarea && textarea.parentNode) {
          textarea.parentNode.removeChild(textarea);
        }
        copyButtonRef.current?.focus();
      }
    }

    if (copied) {
      setCopyStatus('copied');
      setCopyAnnouncement(`Invite code ${effectiveCode} copied to clipboard.`);
      scheduleCopyReset();
    } else {
      setCopyStatus('failed');
      setCopyAnnouncement(
        `Automatic copy unavailable. Please copy code ${effectiveCode} manually.`
      );
    }
  }

  function togglePermission(perm: CareCirclePermission) {
    if (error) {
      setError(null);
    }
    setPermissions((prev) =>
      prev.includes(perm) ? prev.filter((p) => p !== perm) : [...prev, perm]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedEmail = email.trim();
    const normalizedEmail = trimmedEmail.toLowerCase();

    if (!trimmedEmail) {
      setError('Please enter an email address.');
      return;
    }

    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    const isDuplicate = existingEmails.some(
      (existing) => existing.trim().toLowerCase() === normalizedEmail
    );
    if (isDuplicate) {
      setError('This email address is already in or invited to the Care Circle.');
      return;
    }

    if (permissions.length === 0) {
      setError('Please select at least one permission.');
      return;
    }

    const trimmedName = displayName.trim();
    const member: CareCircleMember = {
      userId: `invited_${normalizedEmail.replace(/[^a-z0-9]/g, '_')}_${Date.now()}`,
      displayName: trimmedName || deriveDisplayName(normalizedEmail),
      email: normalizedEmail,
      role,
      permissions: [...permissions],
      status: 'invited',
      invitedAt: Timestamp.now(),
    };

    setIsSubmitting(true);
    try {
      await onInviteMember(member);
      setInvitedConfirmation({
        email: normalizedEmail,
        displayName: member.displayName,
        role: member.role,
      });
      setEmail('');
      setDisplayName('');
      setCopyAnnouncement('');
      setCopyStatus('idle');
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Unable to send invitation. Please try again.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="care-circle-invite-title"
        className="w-full max-w-lg rounded-card bg-surface border border-slate-200 shadow-xl my-auto max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="care-circle-invite-title" className="text-xl font-bold text-ink-primary">
            Invite to Care Circle
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Dismiss dialog"
            className="min-h-touch min-w-touch inline-flex items-center justify-center rounded-btn text-ink-secondary hover:bg-slate-100 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 disabled:opacity-60"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Invite Code Section */}
          <section
            aria-labelledby="invite-code-heading"
            className="rounded-btn border border-slate-200 bg-slate-50/70 p-4 space-y-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              <h3
                id="invite-code-heading"
                className="text-xs font-bold uppercase tracking-wider text-ink-secondary"
              >
                Share Care Circle Invite Code
              </h3>
            </div>

            <div className="flex items-center justify-between gap-3">
              <code
                aria-label={`Care Circle invite code ${effectiveCode}`}
                className="flex-1 min-h-touch inline-flex items-center px-3.5 py-2 rounded-btn border border-slate-200 bg-surface font-mono text-lg font-bold tracking-widest text-brand-teal select-all"
              >
                {effectiveCode}
              </code>
              <button
                ref={copyButtonRef}
                type="button"
                onClick={() => void handleCopyCode()}
                aria-label={copyStatus === 'copied' ? 'Copy code (Copied)' : 'Copy code'}
                className="min-h-touch min-w-touch inline-flex items-center justify-center gap-2 px-4 py-2 rounded-btn bg-brand-teal text-white text-sm font-semibold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors shrink-0"
              >
                {copyStatus === 'copied' ? (
                  <Check className="w-4 h-4" aria-hidden="true" />
                ) : (
                  <Copy className="w-4 h-4" aria-hidden="true" />
                )}
                <span>{copyStatus === 'copied' ? 'Copied!' : 'Copy Code'}</span>
              </button>
            </div>

            <p
              role={!invitedConfirmation || copyAnnouncement ? 'status' : undefined}
              aria-live="polite"
              className="text-xs font-medium text-brand-teal-dark min-h-[1.25rem]"
            >
              {copyAnnouncement}
            </p>
          </section>

          {/* Divider */}
          <div className="flex items-center gap-3" aria-hidden="true">
            <div className="flex-1 border-t border-slate-200" />
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              Or send an email invitation
            </span>
            <div className="flex-1 border-t border-slate-200" />
          </div>

          {/* Post-submit Confirmation Banner + mailto: handoff */}
          {invitedConfirmation && (
            <div
              role="status"
              aria-live="polite"
              className="rounded-btn border border-emerald-200 bg-emerald-50 p-4 space-y-3"
            >
              <div>
                <p className="text-sm font-bold text-emerald-900">
                  Invitation recorded for {invitedConfirmation.displayName} (
                  {invitedConfirmation.email})
                </p>
                <p className="text-xs text-emerald-800 mt-1">
                  They now appear as Invited in the Care Circle. Use the link below to send the
                  invitation email from your mail app.
                </p>
              </div>
              <a
                href={buildMailtoHref(
                  invitedConfirmation.email,
                  effectiveCode,
                  patientName,
                  invitedConfirmation.role
                )}
                className="min-h-touch min-w-touch inline-flex items-center justify-center gap-2 w-full px-4 py-2 rounded-btn bg-brand-teal text-white text-sm font-semibold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors"
              >
                <Mail className="w-4 h-4" aria-hidden="true" />
                <span>Send Email to {invitedConfirmation.email}</span>
              </a>
            </div>
          )}

          {/* Email Invite Form */}
          <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
            {error && (
              <div
                id="invite-form-error"
                role="alert"
                aria-live="assertive"
                className="rounded-btn bg-alert-bg border border-alert-chip px-4 py-3 text-sm font-medium text-alert"
              >
                {error}
              </div>
            )}

            <div>
              <label
                htmlFor="invite-email"
                className="block text-sm font-semibold text-ink-primary mb-1.5"
              >
                Email Address
              </label>
              <input
                id="invite-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                aria-invalid={error ? 'true' : undefined}
                aria-describedby={error ? 'invite-form-error' : undefined}
                placeholder="family.member@example.com"
                className="w-full min-h-touch px-3.5 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-base focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
              />
            </div>

            <div>
              <label
                htmlFor="invite-display-name"
                className="block text-sm font-semibold text-ink-primary mb-1.5"
              >
                Name <span className="text-ink-muted font-normal">(Optional)</span>
              </label>
              <input
                id="invite-display-name"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="e.g. Asha Sharma"
                className="w-full min-h-touch px-3.5 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-base focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
              />
            </div>

            <div>
              <label
                htmlFor="invite-role"
                className="block text-sm font-semibold text-ink-primary mb-1.5"
              >
                Caregiver Role
              </label>
              <select
                id="invite-role"
                value={role}
                onChange={(e) => {
                  setRole(e.target.value as CareCircleMemberRole);
                  if (error) setError(null);
                }}
                className="w-full min-h-touch px-3.5 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-base focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
              >
                <option value="secondary">Secondary Caregiver</option>
                <option value="primary">Primary Caregiver</option>
              </select>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold text-ink-primary mb-1">
                Permissions
              </legend>
              <div className="space-y-2">
                {PERMISSION_OPTIONS.map((opt) => {
                  const checked = permissions.includes(opt.value);
                  const checkboxId = `invite-perm-${opt.value}`;
                  const descId = `invite-perm-desc-${opt.value}`;
                  return (
                    <div
                      key={opt.value}
                      className="min-h-touch flex items-start gap-3 rounded-btn border border-slate-200 bg-slate-50/70 px-3.5 py-2.5"
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePermission(opt.value)}
                        aria-describedby={descId}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-teal focus:ring-[3px] focus:ring-focus cursor-pointer"
                      />
                      <label
                        htmlFor={checkboxId}
                        className="min-w-0 cursor-pointer"
                      >
                        <span className="block text-sm font-semibold text-ink-primary">
                          {opt.label}
                        </span>
                        <span id={descId} className="block text-xs text-ink-secondary">
                          {opt.description}
                        </span>
                      </label>
                    </div>
                  );
                })}
              </div>
            </fieldset>

            {/* Footer Actions */}
            <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="min-h-touch min-w-touch px-4 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-sm font-semibold hover:bg-slate-50 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 disabled:opacity-60"
              >
                {invitedConfirmation ? 'Done' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="min-h-touch min-w-touch inline-flex items-center justify-center gap-2 px-5 py-2 rounded-btn bg-brand-teal text-white text-sm font-bold hover:bg-brand-teal-dark disabled:opacity-60 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                <span>{isSubmitting ? 'Sending…' : 'Send Invite'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

export default CareCircleInviteModal;
