/**
 * TodayView — Elderly "Simple Mode" today view.
 *
 * Shows:
 *   - Date and friendly greeting
 *   - Next Due Dose card with giant Taken / Snooze buttons
 *   - Today's full medicine list (compact DoseCard)
 *   - Real-time updates via Firestore onSnapshot
 *   - WCAG 2.2 AA compliant
 *
 * On first render, idempotently generates today's dose logs client-side
 * (replaces generateDailyDoseLogs Cloud Function — Spark plan compatible).
 *
 * useReminderScheduler schedules browser notifications at T, T+15m, T+30m
 * (replaces checkDueDosesAndEscalate Cloud Function — Spark plan compatible).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { Check, CheckCircle2, Link2, Mail, MessageCircle, Plus, Share2, Users } from 'lucide-react';
import { createMedication, subscribeToCareCircle, subscribeToDoseLogs, updateDoseLog } from '../lib/firestore';
import { generateTodayLogs, generateTodayLogsForMedication } from '../lib/generateTodayLogs';
import { getMockCareCircle, getMockDoses } from '../lib/mockData';
import { playConfirmationChime } from '../lib/sound';
import { useReminderScheduler } from '../hooks/useReminderScheduler';
import { evaluateDoseState } from '../domain/stateMachine';
import { DoseCard } from '../components/dose/DoseCard';
import { AddMedicationModal, type MedicationFormPayload } from '../components/caregiver/AddMedicationModal';
import { AppShell } from '../components/layout/AppShell';
import { useAuthContext } from '../contexts/AuthContext';
import type { DoseLogDocument } from '../types/firestore';
import type { DoseStatus } from '../types/dose';

const UNDO_WINDOW_MS = 5000;

type DoseUpdatePatch = Partial<Omit<DoseLogDocument, 'id' | 'patientId' | 'createdAt'>>;

interface PendingUndoCommit {
  doseId: string;
  medicationName: string;
  previousDose: DoseLogDocument;
  optimisticDose: DoseLogDocument;
  patch: DoseUpdatePatch;
  timerId: ReturnType<typeof setTimeout>;
}

function applyPendingOverlay(
  list: DoseLogDocument[],
  pending: PendingUndoCommit | null
): DoseLogDocument[] {
  if (!pending) return list;
  return list.map((d) => (d.id === pending.doseId ? pending.optimisticDose : d));
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function friendlyDate(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function TodayView() {
  const { userProfile, firebaseUser, isDemo } = useAuthContext();
  const [doses, setDoses] = useState<DoseLogDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [careInviteCode, setCareInviteCode] = useState<string>('MED-7892');
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [isAddMedModalOpen, setIsAddMedModalOpen] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<PendingUndoCommit | null>(null);
  const pendingUndoRef = useRef<PendingUndoCommit | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const logsGeneratedForRef = useRef<string | null>(null);

  const patientId = firebaseUser?.uid ?? '';
  const displayName = userProfile?.displayName?.split(' ')[0] ?? 'there';
  const date = todayISO();

  // Demo sessions (loginAsDemo) use a synthetic mock user with no real Firebase Auth token.
  // In test environment (Vitest), mockDb is used unless isDemo is explicitly true.
  const isTestMode = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
  const isDemoSession =
    Boolean(isDemo) ||
    (!isTestMode &&
      (patientId === 'patient_ramesh' ||
        patientId === 'caregiver_priya' ||
        patientId.startsWith('demo_')));
  const effectivePatientId = patientId || (isDemoSession ? 'patient_ramesh' : '');

  // Fetch or subscribe to care circle invite code
  useEffect(() => {
    if (!effectivePatientId) return;
    if (isDemoSession || effectivePatientId === 'patient_ramesh') {
      const demo = getMockCareCircle('patient_ramesh');
      setCareInviteCode(demo.inviteCode || 'MED-7892');
      return;
    }
    if (typeof subscribeToCareCircle !== 'function') {
      return;
    }
    const unsub = subscribeToCareCircle(
      effectivePatientId,
      (circle) => {
        if (circle?.inviteCode) {
          setCareInviteCode(circle.inviteCode);
        }
      },
      (err) => {
        console.warn('Could not subscribe to care circle in TodayView:', err);
      }
    );
    return () => {
      unsub();
    };
  }, [effectivePatientId, isDemoSession]);

  const careInviteLink =
    typeof window !== 'undefined' && window.location.origin
      ? `${window.location.origin}/join?code=${encodeURIComponent(careInviteCode)}`
      : `/join?code=${encodeURIComponent(careInviteCode)}`;

  const handleCopyInviteLink = async () => {
    let copied = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(careInviteLink);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (copied) {
      setInviteLinkCopied(true);
      setLiveMessage('Care Circle invite link copied to clipboard.');
      window.setTimeout(() => setInviteLinkCopied(false), 3000);
    }
  };

  const whatsappShareUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(
    `Join my Care Circle on MediMate to stay updated on my medications: ${careInviteLink}`
  )}`;

  const mailtoShareUrl = `mailto:?subject=${encodeURIComponent(
    'Join my MediMate Care Circle'
  )}&body=${encodeURIComponent(
    `Hello,\n\nPlease join my Care Circle on MediMate to help monitor my daily medications.\n\nClick the link to join directly:\n${careInviteLink}\n\nInvite Code: ${careInviteCode}\n`
  )}`;

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleNativeShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({
          title: 'MediMate Care Circle Invite',
          text: 'Join my Care Circle on MediMate to stay updated on my medications:',
          url: careInviteLink,
        });
      } catch {
        // user cancelled
      }
    }
  };

  const handleSaveMedication = async (payload: MedicationFormPayload) => {
    if (!effectivePatientId) return;
    try {
      if (isDemoSession) {
        setIsAddMedModalOpen(false);
        setLiveMessage(`Prescription for ${payload.name} added.`);
        return;
      }
      const schedule = {
        times: payload.times,
        frequency: payload.frequency,
        ...(payload.frequency === 'specific_days' && payload.daysOfWeek
          ? { daysOfWeek: payload.daysOfWeek }
          : {}),
        startDate: todayISO(),
        endDate: null,
      };
      const created = await createMedication({
        patientId: effectivePatientId,
        name: payload.name,
        dosage: payload.dosage,
        instructions: payload.instructions,
        schedule,
        shape: payload.shape,
        color: payload.color,
        active: true,
        createdBy: effectivePatientId,
      });
      await generateTodayLogsForMedication(created);
      setIsAddMedModalOpen(false);
      setLiveMessage(`Prescription for ${payload.name} added.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add medication';
      setErrorMsg(msg);
    }
  };

  const commitDoseUpdate = useCallback(
    (doseId: string, patch: DoseUpdatePatch) => {
      if (isDemoSession) {
        return Promise.resolve();
      }
      return updateDoseLog(doseId, patch).catch((err: unknown) => {
        console.warn('Backend update notice (offline/demo mode):', err);
      });
    },
    [isDemoSession]
  );

  const flushPendingUndo = useCallback(
    (clearUiState = true) => {
      const pending = pendingUndoRef.current;
      if (!pending) return;
      clearTimeout(pending.timerId);
      pendingUndoRef.current = null;
      if (clearUiState) {
        setPendingUndo(null);
      }
      void commitDoseUpdate(pending.doseId, pending.patch);
    },
    [commitDoseUpdate]
  );

  useEffect(() => {
    const handleBeforeUnload = () => {
      flushPendingUndo(false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      flushPendingUndo(false);
    };
  }, [flushPendingUndo]);

  // ── Client-side dose log generation (replaces Cloud Function) ─────────────
  // Runs once per mount per day. Idempotent — safe to call multiple times.
  useEffect(() => {
    if (!patientId || isDemoSession || logsGeneratedForRef.current === patientId) return;
    logsGeneratedForRef.current = patientId;

    generateTodayLogs(patientId).catch((err: unknown) => {
      if (patientId === 'patient_ramesh') return;
      const msg = err instanceof Error ? err.message : 'Failed to generate today\u2019s doses';
      setErrorMsg(msg);
    });
  }, [patientId, isDemoSession]);

  // ── Client-side reminder scheduler (replaces Cloud Function) ─────────────
  // Schedules browser notifications at T, T+15m, T+30m for each active dose.
  const handleDemoSchedulerUpdate = useCallback(
    (doseId: string, patch: DoseUpdatePatch) => {
      setDoses((prev) =>
        prev.map((d) => {
          if (d.id !== doseId) return d;
          if (d.status === 'taken' || d.status === 'missed') return d;
          return { ...d, ...patch };
        })
      );
    },
    []
  );

  useReminderScheduler(doses, effectivePatientId, {
    isDemoSession,
    onDemoDoseUpdate: handleDemoSchedulerUpdate,
  });

  useEffect(() => {
    if (!patientId && !isDemoSession) return;

    if (isDemoSession) {
      setDoses(applyPendingOverlay(getMockDoses(date, false), pendingUndoRef.current));
      setIsLoading(false);
      setErrorMsg(null);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);

    const unsub = subscribeToDoseLogs(
      patientId,
      date,
      (updatedDoses) => {
        const baseDoses =
          updatedDoses.length > 0
            ? updatedDoses
            : patientId === 'patient_ramesh'
            ? getMockDoses(date, false)
            : [];
        setDoses(applyPendingOverlay(baseDoses, pendingUndoRef.current));
        setIsLoading(false);
        setErrorMsg(null);
      },
      (err) => {
        console.warn('TodayView subscription fallback:', err.message);
        if (patientId === 'patient_ramesh') {
          setDoses(applyPendingOverlay(getMockDoses(date, false), pendingUndoRef.current));
          setErrorMsg(null);
        } else {
          setErrorMsg(err.message);
        }
        setIsLoading(false);
      }
    );
    unsubRef.current = unsub;

    return () => {
      unsub();
      unsubRef.current = null;
    };
  }, [patientId, date, isDemoSession]);

  const handleTaken = useCallback(
    async (doseId: string) => {
      const dose = doses.find((d) => d.id === doseId);
      if (!dose || dose.status === 'taken' || dose.status === 'missed') return;
      if (pendingUndoRef.current?.doseId === doseId) return;

      // Flush any earlier pending dose before opening a new 5-second undo window
      flushPendingUndo(true);

      const now = new Date();
      const scheduledDate = dose.scheduledTime.toDate();
      const isEarly = dose.status === 'scheduled' && now.getTime() < scheduledDate.getTime();
      const diffMinutes = Math.round((scheduledDate.getTime() - now.getTime()) / 60000);

      // If patient takes medicine early (within 120m, e.g. early breakfast), allow graceful confirmation
      const evaluationTime = isEarly && diffMinutes <= 120 ? scheduledDate : now;

      let result;
      try {
        result = evaluateDoseState({
          currentStatus: dose.status,
          scheduledTime: scheduledDate,
          currentTime: evaluationTime,
          snoozeCount: dose.snoozeCount,
          snoozeUntil: dose.snoozeUntil ? dose.snoozeUntil.toDate() : null,
          action: 'tapTaken',
        });
      } catch (err) {
        if (isEarly && diffMinutes > 120) {
          const timeStr = scheduledDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setErrorMsg(
            `This dose is scheduled for ${timeStr} (in ${diffMinutes} minutes). Doses can be confirmed up to 2 hours in advance.`
          );
        } else {
          const msg = err instanceof Error ? err.message : 'Cannot mark taken';
          setErrorMsg(msg);
        }
        return;
      }

      const takenAt = Timestamp.fromDate(now);
      const patch: DoseUpdatePatch = {
        status: result.nextStatus as DoseStatus,
        takenAt,
        takenBy: effectivePatientId,
        snoozeUntil: null,
      };
      const optimisticDose: DoseLogDocument = {
        ...dose,
        ...patch,
      };

      // Optimistic local state update
      setDoses((prev) => prev.map((d) => (d.id === doseId ? optimisticDose : d)));

      if (userProfile?.accessibilityPreferences?.soundEnabled !== false) {
        playConfirmationChime();
      }

      if (
        userProfile?.accessibilityPreferences?.hapticFeedback !== false &&
        typeof navigator !== 'undefined' &&
        'vibrate' in navigator
      ) {
        try {
          navigator.vibrate(80);
        } catch {
          // Ignore vibrate restrictions
        }
      }

      setLiveMessage(
        isEarly
          ? `${dose.medicationName} confirmed taken early (${diffMinutes}m early). Good job!`
          : `${dose.medicationName} marked as taken.`
      );

      const timerId = setTimeout(() => {
        const current = pendingUndoRef.current;
        if (!current || current.doseId !== doseId) return;
        pendingUndoRef.current = null;
        setPendingUndo(null);
        void commitDoseUpdate(current.doseId, current.patch);
      }, UNDO_WINDOW_MS);

      const entry: PendingUndoCommit = {
        doseId,
        medicationName: dose.medicationName,
        previousDose: dose,
        optimisticDose,
        patch,
        timerId,
      };
      pendingUndoRef.current = entry;
      setPendingUndo(entry);
    },
    [commitDoseUpdate, doses, effectivePatientId, flushPendingUndo, userProfile?.accessibilityPreferences?.soundEnabled]
  );

  const handleUndo = useCallback(() => {
    const pending = pendingUndoRef.current;
    if (!pending) return;

    clearTimeout(pending.timerId);
    pendingUndoRef.current = null;
    setPendingUndo(null);
    setDoses((prev) => prev.map((d) => (d.id === pending.doseId ? pending.previousDose : d)));
    setLiveMessage(
      `Undid ${pending.medicationName} confirmation. Restored to ${pending.previousDose.status}.`
    );
  }, []);

  const handleSnooze = useCallback(
    async (doseId: string) => {
      const dose = doses.find((d) => d.id === doseId);
      if (!dose) return;

      const now = new Date();
      let result;
      try {
        result = evaluateDoseState({
          currentStatus: dose.status,
          scheduledTime: dose.scheduledTime.toDate(),
          currentTime: now,
          snoozeCount: dose.snoozeCount,
          snoozeUntil: dose.snoozeUntil ? dose.snoozeUntil.toDate() : null,
          action: 'tapSnooze',
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Cannot snooze';
        setErrorMsg(msg);
        return;
      }

      // Optimistic local state update
      setDoses((prev) =>
        prev.map((d) =>
          d.id === doseId
            ? {
                ...d,
                status: result.nextStatus as DoseStatus,
                snoozeCount: result.snoozeCount,
                snoozedAt: Timestamp.fromDate(now),
                snoozeUntil: result.snoozeUntil ? Timestamp.fromDate(result.snoozeUntil) : null,
              }
            : d
        )
      );

      setLiveMessage(`${dose.medicationName} snoozed for 10 minutes.`);

      if (
        userProfile?.accessibilityPreferences?.hapticFeedback !== false &&
        typeof navigator !== 'undefined' &&
        'vibrate' in navigator
      ) {
        try {
          navigator.vibrate([40, 40, 40]);
        } catch {
          // Ignore vibrate restrictions
        }
      }

      if (!isDemoSession) {
        try {
          await updateDoseLog(doseId, {
            status: result.nextStatus as DoseStatus,
            snoozeCount: result.snoozeCount,
            snoozedAt: Timestamp.fromDate(now),
            snoozeUntil: result.snoozeUntil ? Timestamp.fromDate(result.snoozeUntil) : null,
          });
        } catch (err) {
          console.warn('Backend snooze notice (offline/demo mode):', err);
        }
      }
    },
    [doses, isDemoSession]
  );

  // Find next dose that is due or upcoming (not taken/missed)
  const nextDose =
    doses.find((d) => d.status === 'due' || d.status === 'unconfirmed' || d.status === 'snoozed') ??
    doses.find((d) => d.status === 'scheduled') ??
    null;

  const allDosesTaken = doses.length > 0 && doses.every((d) => d.status === 'taken');

  return (
    <AppShell>
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        {/* Greeting — 28px bold per DESIGN.md §4.2 */}
        <header className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-ink-secondary mb-1">{friendlyDate()}</p>
            <h1 className="text-[1.75rem] font-bold leading-snug text-ink-primary">
              Hello, {displayName} 👋
            </h1>
          </div>
          <button
            type="button"
            onClick={() => setIsAddMedModalOpen(true)}
            aria-label="Add a medication"
            className="min-h-touch min-w-touch shrink-0 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-btn bg-brand-teal text-white text-xs sm:text-sm font-semibold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Add Med</span>
          </button>
        </header>

        {/* Aria live region for confirmations */}
        <div
          id="dose-live-region"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only"
        >
          {liveMessage}
        </div>

        {/* Error banner */}
        {errorMsg && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded-md bg-alert-bg border border-alert-chip p-3 text-sm text-alert"
          >
            {errorMsg}
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div
            role="status"
            aria-label="Loading your medications…"
            className="flex justify-center py-12"
          >
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && doses.length === 0 && (
          <div
            data-testid="empty-today-state"
            className="rounded-card bg-surface border border-slate-200 p-8 text-center space-y-4"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-brand-teal">
              <span className="text-2xl" aria-hidden="true">💊</span>
            </div>
            <h2 className="text-lg font-bold text-ink-primary">
              No prescriptions scheduled today
            </h2>
            <p className="text-sm text-ink-secondary max-w-sm mx-auto">
              You are all caught up! You or your caregiver can add or adjust prescriptions anytime.
            </p>
            <div className="pt-2 flex justify-center">
              <button
                type="button"
                onClick={() => setIsAddMedModalOpen(true)}
                aria-label="Add a medication"
                className="min-h-touch min-w-touch inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-btn bg-brand-teal text-white font-semibold text-sm hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span>+ Add Medication</span>
              </button>
            </div>
            <p className="text-xs text-ink-muted">Enjoy your day! 🌟</p>
          </div>
        )}

        {/* All Doses Taken Celebration Banner */}
        {!isLoading && allDosesTaken && (
          <div
            data-testid="all-doses-celebration"
            className="mb-6 rounded-card border-2 border-emerald-500 bg-emerald-50/90 dark:bg-emerald-950/40 p-6 text-center space-y-2 shadow-sm"
          >
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="w-8 h-8" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-bold text-emerald-950 dark:text-emerald-100">
              All Done for Today! 🎉
            </h2>
            <p className="text-base text-emerald-900 dark:text-emerald-200 font-medium max-w-sm mx-auto">
              Great job, {displayName}! You have taken all your scheduled medications for today.
            </p>
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Relax and enjoy the rest of your day! 🌟
            </p>
          </div>
        )}

        {/* Next Due Dose — prominent card */}
        {!isLoading && nextDose && (
          <section aria-labelledby="next-dose-heading" className="mb-6">
            <h2
              id="next-dose-heading"
              className="text-sm font-semibold text-ink-secondary uppercase tracking-wide mb-3"
            >
              Next Medication
            </h2>
            <DoseCard
              key={nextDose.id}
              dose={nextDose}
              onTaken={handleTaken}
              onSnooze={handleSnooze}
            />
          </section>
        )}

        {/* Remaining today list — avoids duplicate card when Next Medication is shown */}
        {!isLoading && (nextDose ? doses.filter((d) => d.id !== nextDose.id) : doses).length > 0 && (
          <section aria-labelledby="all-doses-heading">
            <h2
              id="all-doses-heading"
              className="text-sm font-semibold text-ink-secondary uppercase tracking-wide mb-3"
            >
              Other Medications Today
            </h2>
            <div className="flex flex-col gap-2">
              {(nextDose ? doses.filter((d) => d.id !== nextDose.id) : doses).map((dose) => (
                <DoseCard
                  key={dose.id}
                  dose={dose}
                  compact
                />
              ))}
            </div>
          </section>
        )}
        {/* Family & Care Circle Sharing Section */}
        <section
          aria-labelledby="family-care-circle-heading"
          className="mt-8 rounded-card border border-teal-200 bg-teal-50/60 dark:bg-slate-800/80 dark:border-slate-700 p-5 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-brand-teal" aria-hidden="true" />
              <h2
                id="family-care-circle-heading"
                className="text-base font-bold text-ink-primary"
              >
                Family &amp; Care Circle
              </h2>
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300">
              Active
            </span>
          </div>

          <p className="text-xs text-ink-secondary leading-relaxed">
            Share this code or link with your family so they can stay updated on your medication progress:
          </p>

          <div className="flex items-center gap-2">
            <code
              aria-label={`Your Care Circle invite code is ${careInviteCode}`}
              className="flex-1 min-h-[44px] px-3.5 py-2 rounded-btn border border-teal-300 bg-surface font-mono text-base font-bold tracking-widest text-brand-teal select-all flex items-center"
            >
              {careInviteCode}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyInviteLink()}
              aria-label="Direct share link"
              className="min-h-touch min-w-touch inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-btn bg-brand-teal text-white text-xs font-semibold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors shrink-0"
            >
              {inviteLinkCopied ? (
                <Check className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Link2 className="w-4 h-4" aria-hidden="true" />
              )}
              <span>{inviteLinkCopied ? 'Copied!' : 'Copy Link'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-xs text-ink-muted font-medium">Send to family:</span>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.open(whatsappShareUrl, '_blank', 'noopener,noreferrer');
                }
              }}
              aria-label="Share via WhatsApp"
              className="min-h-touch min-w-touch inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-200 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-focus transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              <span>WhatsApp</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = mailtoShareUrl;
                }
              }}
              aria-label="Share via Mail app"
              className="min-h-touch min-w-touch inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-blue-50 text-blue-800 hover:bg-blue-100 border border-blue-200 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-focus transition-colors"
            >
              <Mail className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>Mail</span>
            </button>
            {canNativeShare && (
              <button
                type="button"
                onClick={() => void handleNativeShare()}
                aria-label="Share via device"
                className="min-h-touch min-w-touch inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-100 text-ink hover:bg-slate-200 border border-slate-300 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-focus transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 text-ink-secondary" aria-hidden="true" />
                <span>Share…</span>
              </button>
            )}
          </div>
        </section>
      </div>

      {/* 8-second Undo Toast for accidental "Taken ✓" taps */}
      {pendingUndo && (
        <div
          id="undo-toast"
          data-testid="undo-toast"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-lg rounded-card bg-ink-primary text-white shadow-lg border border-slate-700 px-4 py-3 flex items-center justify-between gap-3"
        >
          <p className="text-base font-medium leading-snug">
            Marked <span className="font-bold">{pendingUndo.medicationName}</span> as taken. Tapped by mistake?
          </p>
          <button
            id="undo-toast-button"
            type="button"
            onClick={handleUndo}
            aria-label={`Undo marking ${pendingUndo.medicationName} as taken`}
            className="min-h-touch min-w-touch px-4 py-2 rounded-btn bg-brand-teal-light text-brand-teal-dark font-bold text-base shrink-0 hover:bg-teal-200 active:bg-teal-300 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 focus:ring-offset-ink-primary transition-colors"
            style={{ minHeight: '44px', minWidth: '44px' }}
          >
            Undo
          </button>
        </div>
      )}

      {/* Add Medication Modal for Seniors */}
      <AddMedicationModal
        isOpen={isAddMedModalOpen}
        onClose={() => setIsAddMedModalOpen(false)}
        onSave={handleSaveMedication}
      />
    </AppShell>
  );
}

export default TodayView;
