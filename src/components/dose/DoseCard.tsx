/**
 * DoseCard — Reusable dose card with status chip, Taken/Snooze actions.
 *
 * DESIGN.md compliance:
 *   - Medication name:   32px / 2rem / 700 bold  (#0F172A)
 *   - Dosage:            22px / 1.375rem / 600 semibold  (#334155)
 *   - Instructions:      18px / 1.125rem / 400 regular in #F1F5F9 callout
 *   - Taken button:      68px height, 24px bold white on #166534 (7.13:1 AAA)
 *   - Snooze button:     52px height, 18px semibold #B45309 border
 *   - Pill marker SVG:   48×48px geometric, color + shape from medication
 *   - Haptics:           navigator.vibrate([40,60,40]) on taken; [80] on snooze
 *   - Due state pulse:   teal glow border animation
 *   - Confirmation text: "Recorded! Good job." on success
 *   - Touch targets:     ≥44×44px all interactive elements
 *   - Focus ring:        3px solid #0284C7
 */

import { useContext, useEffect, useRef, useState } from 'react';
import type { DoseLogDocument } from '../../types/firestore';
import { AuthContext } from '../../contexts/AuthContext';
import { canSnooze } from '../../domain/stateMachine';
import { StatusChip } from './StatusChip';
import { PillMarker } from './PillMarker';
import { MealBadge } from './MealBadge';

interface DoseCardProps {
  dose: DoseLogDocument;
  onTaken?: (doseId: string) => void | Promise<void>;
  onSnooze?: (doseId: string) => void | Promise<void>;
  /** If true, renders in compact mode (for the full-day list). */
  compact?: boolean;
}

function formatTime(ts: { toDate: () => Date } | Date): string {
  const d = typeof (ts as { toDate?: () => Date }).toDate === 'function'
    ? (ts as { toDate: () => Date }).toDate()
    : (ts as Date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

export function DoseCard({ dose, onTaken, onSnooze, compact = false }: DoseCardProps) {
  const authCtx = useContext(AuthContext);
  const hapticEnabled = authCtx?.userProfile?.accessibilityPreferences?.hapticFeedback !== false;
  const [justTakenDoseId, setJustTakenDoseId] = useState<string | null>(null);
  const justTakenTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevStatusRef = useRef(dose.status);
  const prevDoseIdRef = useRef(dose.id);
  const isMountedRef = useRef(true);

  const justTaken = justTakenDoseId === dose.id;
  const isTaken = dose.status === 'taken';
  const isMissed = dose.status === 'missed';
  const isTerminal = isTaken || isMissed;
  const isDue = dose.status === 'due' || dose.status === 'unconfirmed';
  const snoozeable = canSnooze(dose.snoozeCount, dose.status);

  useEffect(() => {
    if (prevDoseIdRef.current !== dose.id) {
      if (justTakenTimerRef.current !== null) {
        clearTimeout(justTakenTimerRef.current);
        justTakenTimerRef.current = null;
      }
      setJustTakenDoseId(null);
    } else if (prevStatusRef.current === 'taken' && dose.status !== 'taken') {
      if (justTakenTimerRef.current !== null) {
        clearTimeout(justTakenTimerRef.current);
        justTakenTimerRef.current = null;
      }
      setJustTakenDoseId(null);
    }
    prevDoseIdRef.current = dose.id;
    prevStatusRef.current = dose.status;
  }, [dose.id, dose.status]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (justTakenTimerRef.current !== null) {
        clearTimeout(justTakenTimerRef.current);
        justTakenTimerRef.current = null;
      }
    };
  }, []);

  async function handleTaken() {
    if (isTerminal || !onTaken) return;
    if (hapticEnabled) {
      vibrate([40, 60, 40]); // DESIGN.md §9.2 — double haptic pulse
    }
    if (justTakenTimerRef.current !== null) {
      clearTimeout(justTakenTimerRef.current);
      justTakenTimerRef.current = null;
    }
    setJustTakenDoseId(dose.id);
    await onTaken(dose.id);
    if (!isMountedRef.current) return;
    // Reset after 2s so standalone DoseCard confirmation feedback clears cleanly
    justTakenTimerRef.current = setTimeout(() => {
      setJustTakenDoseId((prev) => (prev === dose.id ? null : prev));
      justTakenTimerRef.current = null;
    }, 2000);
  }

  async function handleSnooze() {
    if (!snoozeable || !onSnooze) return;
    if (hapticEnabled) {
      vibrate(80); // DESIGN.md §9.2 — single gentle pulse
    }
    await onSnooze(dose.id);
  }

  // ── Compact mode (Today's full-day list) ───────────────────────────────────
  if (compact) {
    return (
      <article
        aria-label={`${dose.medicationName} ${dose.dosage} at ${formatTime(dose.scheduledTime)}`}
        className="flex items-center justify-between gap-3 p-3 rounded-card bg-surface border border-slate-200"
      >
        <div className="min-w-0">
          <p className="font-semibold text-ink-primary truncate">{dose.medicationName}</p>
          <div className="flex flex-wrap items-center gap-2 mt-0.5">
            <p className="text-sm text-ink-secondary">
              {dose.dosage} · {formatTime(dose.scheduledTime)}
            </p>
            <MealBadge scheduledTime={dose.scheduledTime} />
          </div>
        </div>
        <StatusChip status={dose.status} className="shrink-0" />
      </article>
    );
  }

  // ── Full hero card (Next Dose Card) ────────────────────────────────────────
  return (
    <article
      id="next-dose-card"
      aria-label={`Next dose: ${dose.medicationName} ${dose.dosage}`}
      className={[
        'rounded-card bg-surface p-6 shadow-sm transition-shadow',
        isDue
          ? 'border-2 border-brand-teal animate-pulse-border'
          : 'border-2 border-slate-200',
      ].join(' ')}
    >
      {/* Pill marker + Status badge row */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-4">
          {/* 48×48 geometric pill SVG */}
          <PillMarker
            color={dose.color ?? '#0D9488'}
            shape={dose.shape ?? 'round'}
            name={dose.medicationName}
            dosage={dose.dosage}
          />
          <div>
            {/* Status "DUE NOW" badge — DESIGN.md §5.3 */}
            {isDue && (
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-full mb-1
                           text-xs font-bold bg-brand-teal-light text-brand-teal-dark tracking-wide"
                aria-label="Dose status: Due now"
              >
                💊 DUE NOW
              </span>
            )}
            {/* Medication name — 32px / 700 bold — DESIGN.md §5.3 */}
            <h2
              id="dose-medication-name"
              className="text-[2rem] font-bold leading-tight text-ink-primary"
            >
              {dose.medicationName}
            </h2>
            {/* Dosage — 22px / 600 semibold — DESIGN.md §5.3 */}
            <p id="dose-dosage" className="text-[1.375rem] font-semibold text-ink-secondary mt-0.5">
              {dose.dosage}
            </p>
          </div>
        </div>
        {!isDue && <StatusChip status={dose.status} />}
      </div>

      {/* Scheduled time + Meal association badge */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p id="dose-scheduled-time" className="text-sm text-ink-muted">
          Scheduled: <span className="font-medium text-ink-secondary">{formatTime(dose.scheduledTime)}</span>
        </p>
        <MealBadge scheduledTime={dose.scheduledTime} />
      </div>

      {/* Instructions callout — 18px in #F1F5F9 box — DESIGN.md §5.3 */}
      {dose.instructions && (
        <div
          id="dose-instructions"
          className="rounded-btn bg-slate-100 px-4 py-3 mb-5"
          role="note"
          aria-label={`Instructions: ${dose.instructions}`}
        >
          <p className="text-[1.125rem] leading-relaxed text-ink-primary">
            📋 {dose.instructions}
          </p>
        </div>
      )}

      {/* ── Taken button — 68px, 24px bold, #166534 (7.13:1 AAA) ── */}
      <button
        id="taken-button"
        type="button"
        aria-label={`Mark ${dose.medicationName} as Taken`}
        aria-disabled={isTerminal}
        disabled={isTerminal}
        onClick={() => void handleTaken()}
        className={[
          'w-full rounded-btn flex items-center justify-center gap-2',
          'text-2xl font-bold text-white',           // 24px bold white
          'focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2',
          'transition-all mb-3',
          isTerminal
            ? 'opacity-60 cursor-not-allowed bg-taken'
            : 'bg-taken hover:bg-green-800 active:bg-green-900',
        ].join(' ')}
        style={{ minHeight: '68px', backgroundColor: isTerminal ? '#166534' : undefined }}
      >
        {justTaken || isTaken
          ? '✓ Recorded! Good job.'
          : 'Taken ✓'}
      </button>

      {/* ── Snooze button — 52px, 18px semibold, #B45309 border ── */}
      {!isTaken && !isMissed && (
        <button
          id="snooze-button"
          type="button"
          aria-label={
            snoozeable
              ? 'Remind Me Later (10 minutes)'
              : dose.snoozeCount >= 1
              ? 'Snooze limit reached (10 min delay active)'
              : 'Snooze not available'
          }
          aria-disabled={!snoozeable}
          disabled={!snoozeable}
          onClick={() => void handleSnooze()}
          className={[
            'w-full rounded-btn flex items-center justify-center',
            'text-[1.125rem] font-semibold',         // 18px semibold
            'focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2',
            'transition-colors border-2',
            snoozeable
              ? 'bg-white border-snooze text-snooze hover:bg-snooze-bg active:bg-snooze-bg'
              : 'bg-slate-100 border-slate-300 text-slate-400 cursor-not-allowed',
          ].join(' ')}
          style={{ minHeight: '52px' }}
        >
          {dose.snoozeCount >= 1
            ? 'Snooze limit reached (10 min delay active)'
            : snoozeable
            ? 'Remind Me Later (10 min)'
            : 'Remind Me Later'}
        </button>
      )}
    </article>
  );
}

export default DoseCard;
