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
import { subscribeToDoseLogs, updateDoseLog } from '../lib/firestore';
import { generateTodayLogs } from '../lib/generateTodayLogs';
import { getMockDoses } from '../lib/mockData';
import { playConfirmationChime } from '../lib/sound';
import { useReminderScheduler } from '../hooks/useReminderScheduler';
import { evaluateDoseState } from '../domain/stateMachine';
import { DoseCard } from '../components/dose/DoseCard';
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
  const { userProfile, firebaseUser } = useAuthContext();
  const [doses, setDoses] = useState<DoseLogDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [pendingUndo, setPendingUndo] = useState<PendingUndoCommit | null>(null);
  const pendingUndoRef = useRef<PendingUndoCommit | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const logsGeneratedRef = useRef(false);

  const patientId = firebaseUser?.uid ?? '';
  const displayName = userProfile?.displayName?.split(' ')[0] ?? 'there';
  const date = todayISO();

  // Demo sessions (loginAsDemo) use a synthetic mock user with no real Firebase Auth token.
  // In test environment (Vitest), mockDb is used so we allow normal Firestore subscription flow.
  const isTestMode = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
  const isDemoSession =
    !isTestMode &&
    (patientId === 'patient_ramesh' ||
      patientId === 'caregiver_priya' ||
      patientId.startsWith('demo_'));

  const commitDoseUpdate = useCallback((doseId: string, patch: DoseUpdatePatch) => {
    return updateDoseLog(doseId, patch).catch((err: unknown) => {
      console.warn('Backend update notice (offline/demo mode):', err);
    });
  }, []);

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
    if (!patientId || logsGeneratedRef.current) return;
    logsGeneratedRef.current = true;

    generateTodayLogs(patientId).catch((err: unknown) => {
      if (patientId === 'patient_ramesh' || isDemoSession) return;
      const msg = err instanceof Error ? err.message : 'Failed to generate today\u2019s doses';
      setErrorMsg(msg);
    });
  }, [patientId, isDemoSession]);

  // ── Client-side reminder scheduler (replaces Cloud Function) ─────────────
  // Schedules browser notifications at T, T+15m, T+30m for each active dose.
  useReminderScheduler(doses, patientId);

  useEffect(() => {
    if (!patientId) return;

    setIsLoading(true);
    setErrorMsg(null);

    const unsub = subscribeToDoseLogs(
      patientId,
      date,
      (updatedDoses) => {
        const baseDoses =
          updatedDoses.length > 0
            ? updatedDoses
            : patientId === 'patient_ramesh' || isDemoSession
            ? getMockDoses(date, false)
            : [];
        setDoses(applyPendingOverlay(baseDoses, pendingUndoRef.current));
        setIsLoading(false);
        setErrorMsg(null);
      },
      (err) => {
        console.warn('TodayView subscription fallback:', err.message);
        if (patientId === 'patient_ramesh' || isDemoSession) {
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

      // If patient takes medicine early (within 60m, e.g. early breakfast), allow graceful confirmation
      const evaluationTime = isEarly && diffMinutes <= 60 ? scheduledDate : now;

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
        const msg = err instanceof Error ? err.message : 'Cannot mark taken';
        setErrorMsg(msg);
        return;
      }

      const takenAt = Timestamp.fromDate(now);
      const patch: DoseUpdatePatch = {
        status: result.nextStatus as DoseStatus,
        takenAt,
        takenBy: patientId,
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
    [commitDoseUpdate, doses, flushPendingUndo, patientId, userProfile?.accessibilityPreferences?.soundEnabled]
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
    },
    [doses]
  );

  // Find next dose that is due or upcoming (not taken/missed)
  const nextDose =
    doses.find((d) => d.status === 'due' || d.status === 'unconfirmed' || d.status === 'snoozed') ??
    doses.find((d) => d.status === 'scheduled') ??
    null;

  return (
    <AppShell>
      <div className="max-w-lg mx-auto px-4 py-6 pb-24">
        {/* Greeting — 28px bold per DESIGN.md §4.2 */}
        <header className="mb-6">
          <p className="text-sm text-ink-secondary mb-1">{friendlyDate()}</p>
          <h1 className="text-[1.75rem] font-bold leading-snug text-ink-primary">
            Hello, {displayName} 👋
          </h1>
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
          <div className="rounded-card bg-surface border border-slate-200 p-8 text-center">
            <p className="text-lg text-ink-secondary">No doses scheduled for today.</p>
            <p className="mt-2 text-sm text-ink-muted">Enjoy your day! 🌟</p>
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
      </div>

      {/* 5-second Undo Toast for accidental "Taken ✓" taps */}
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
    </AppShell>
  );
}

export default TodayView;
