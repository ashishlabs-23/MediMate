/**
 * useReminderScheduler — Client-side replacement for the checkDueDosesAndEscalate Cloud Function.
 *
 * Runs in the browser. For each non-terminal dose in today's list:
 *   T+0m  → marks dose 'due' + shows browser notification
 *   T+10m → snooze expiry handled via state machine (existing code)
 *   T+15m → gentle follow-up reminder notification
 *   T+30m → escalation: marks dose 'unconfirmed', shows urgent notification
 *
 * Design decisions for Spark plan (no Cloud Functions):
 *   - Uses window.setTimeout to schedule notifications while the tab is open.
 *   - Uses the Web Notifications API (requires permission granted by user).
 *   - Clears all timers on unmount to avoid memory leaks.
 *   - Re-schedules whenever the `doses` array changes (new dose confirmed = clear its timers).
 *   - Skips scheduling for doses already in terminal states (taken / missed).
 *
 * Limitations (acceptable for academic MVP):
 *   - Notifications only fire if the browser tab is open (or PWA is installed).
 *   - For installed PWA on mobile, Periodic Background Sync can be added later.
 */

import { useEffect, useRef } from 'react';
import { getDoseLog, updateDoseLog } from '../lib/firestore';
import { GENTLE_REMINDER_OFFSET_MS, ESCALATION_OFFSET_MS, SNOOZE_DURATION_MS } from '../domain/intervals';
import type { DoseLogDocument } from '../types/firestore';

// Notification permission is requested once and remembered.
let notificationPermissionRequested = false;

async function ensureNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (notificationPermissionRequested) return false;
  notificationPermissionRequested = true;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

function showNotification(title: string, body: string, tag: string): void {
  if (!('serviceWorker' in navigator)) {
    // Fallback: direct Notification (requires tab focus)
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, tag, icon: '/icons/icon-192.png' });
    }
    return;
  }
  navigator.serviceWorker.ready
    .then((reg) => {
      reg.showNotification(title, {
        body,
        tag,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        requireInteraction: false,
      });
    })
    .catch(() => {
      // If service worker not ready, fall back to direct Notification
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(title, { body, tag });
      }
    });
}

export type DoseSchedulerPatch = Partial<
  Omit<DoseLogDocument, 'id' | 'patientId' | 'createdAt'>
>;

export interface UseReminderSchedulerOptions {
  isDemoSession?: boolean | undefined;
  onDemoDoseUpdate?: ((doseId: string, patch: DoseSchedulerPatch) => void) | undefined;
}

export function useReminderScheduler(
  doses: DoseLogDocument[],
  patientId: string,
  options?: UseReminderSchedulerOptions
): void {
  const isDemoSession = Boolean(options?.isDemoSession);
  // Map of doseId → array of timer IDs to clear on re-schedule or unmount
  const timerMap = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());
  const dosesRef = useRef<DoseLogDocument[]>(doses);
  const isDemoSessionRef = useRef<boolean>(isDemoSession);
  const onDemoDoseUpdateRef = useRef<UseReminderSchedulerOptions['onDemoDoseUpdate']>(
    options?.onDemoDoseUpdate
  );
  // Tracks doses observed before their T+30m boundary so demo Undo past T+30m escalates
  // while initial late-hour demo mounts keep seeded Metformin snoozable.
  const sawFutureEscalationRef = useRef<Set<string>>(new Set());
  // Preserves post-snooze gentle timestamp across snooze-expiry re-renders when snoozedAt is absent.
  const postSnoozeGentleTargetRef = useRef<Map<string, number>>(new Map());
  const prevPatientIdRef = useRef<string>(patientId);

  useEffect(() => {
    dosesRef.current = doses;
  }, [doses]);

  useEffect(() => {
    isDemoSessionRef.current = isDemoSession;
    onDemoDoseUpdateRef.current = options?.onDemoDoseUpdate;
  }, [isDemoSession, options?.onDemoDoseUpdate]);

  useEffect(() => {
    const activeTimerMap = timerMap.current;
    if (prevPatientIdRef.current !== patientId) {
      prevPatientIdRef.current = patientId;
      sawFutureEscalationRef.current.clear();
      postSnoozeGentleTargetRef.current.clear();
    }
    dosesRef.current = doses;
    isDemoSessionRef.current = isDemoSession;
    let cancelled = false;

    // Clear all existing timers before re-scheduling or when doses become empty
    for (const timers of activeTimerMap.values()) {
      timers.forEach(clearTimeout);
    }
    activeTimerMap.clear();

    // Don't schedule if no doses or no patientId
    if (!patientId || doses.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    // Request notification permission on first dose load
    void ensureNotificationPermission();

    const readLatestDose = async (doseId: string): Promise<DoseLogDocument | null> => {
      if (isDemoSessionRef.current) {
        return dosesRef.current.find((d) => d.id === doseId) ?? null;
      }
      return getDoseLog(doseId).catch(() => null);
    };

    const writeDosePatch = (doseId: string, patch: DoseSchedulerPatch): void => {
      if (cancelled) return;
      if (isDemoSessionRef.current) {
        onDemoDoseUpdateRef.current?.(doseId, patch);
        return;
      }
      void updateDoseLog(doseId, patch).catch(() => null);
    };

    const now = Date.now();

    for (const dose of doses) {
      // Skip terminal states
      if (dose.status === 'taken' || dose.status === 'missed') {
        postSnoozeGentleTargetRef.current.delete(dose.id);
        continue;
      }

      const scheduledMs = dose.scheduledTime.toMillis();
      const escalationMs = scheduledMs + ESCALATION_OFFSET_MS;
      if (now < escalationMs) {
        sawFutureEscalationRef.current.add(dose.id);
      }
      const allowPastEscalationCatchup =
        !isDemoSession || sawFutureEscalationRef.current.has(dose.id);
      const timers: ReturnType<typeof setTimeout>[] = [];

      // ── T+0  Initial "due" notification ───────────────────────────────────
      const dueDelay = scheduledMs - now;
      if (dueDelay > 0 && dose.status === 'scheduled') {
        timers.push(
          setTimeout(async () => {
            if (cancelled) return;
            const fresh = await readLatestDose(dose.id);
            if (cancelled || !fresh) return;
            const localDose = dosesRef.current.find((d) => d.id === dose.id);
            if (localDose && (localDose.status === 'taken' || localDose.status === 'missed')) {
              return;
            }
            if (
              fresh.status !== 'scheduled' ||
              localDose?.status !== 'scheduled' ||
              Date.now() >= escalationMs
            ) {
              return;
            }
            showNotification(
              `💊 Time for ${dose.medicationName}`,
              `${dose.dosage} — please take now.`,
              `due-${dose.id}`
            );
            writeDosePatch(dose.id, { status: 'due' });
          }, dueDelay)
        );
      } else if (
        dose.status === 'scheduled' &&
        dueDelay <= 0 &&
        (now < escalationMs || !allowPastEscalationCatchup)
      ) {
        // Already past due time (before escalation ceiling, or late-hour demo mount) — mark due immediately
        writeDosePatch(dose.id, { status: 'due' });
      }

      // ── T+15m / Post-Snooze  Gentle follow-up reminder ────────────────────
      if (dose.status === 'snoozed' && dose.snoozeUntil && !dose.snoozedAt) {
        postSnoozeGentleTargetRef.current.set(
          dose.id,
          dose.snoozeUntil.toMillis() + SNOOZE_DURATION_MS
        );
      }
      if (dose.followUpSent || dose.status === 'unconfirmed') {
        postSnoozeGentleTargetRef.current.delete(dose.id);
      }

      if (!dose.followUpSent && dose.status !== 'unconfirmed') {
        const baseGentleMs = scheduledMs + GENTLE_REMINDER_OFFSET_MS;
        let postSnoozeMs = 0;
        if (dose.snoozeUntil) {
          postSnoozeMs = dose.snoozeUntil.toMillis() + SNOOZE_DURATION_MS;
        } else if (dose.snoozedAt) {
          postSnoozeMs = dose.snoozedAt.toMillis() + 2 * SNOOZE_DURATION_MS;
        } else if (dose.snoozeCount > 0) {
          postSnoozeMs = postSnoozeGentleTargetRef.current.get(dose.id) ?? 0;
        }

        const gentleMs = Math.max(baseGentleMs, postSnoozeMs);
        const gentleDelay = gentleMs - now;
        if (gentleDelay > 0 && gentleMs < escalationMs) {
          timers.push(
            setTimeout(async () => {
              if (cancelled) return;
              // Re-check: skip if user already took the dose or already escalated
              const fresh = await readLatestDose(dose.id);
              if (cancelled || !fresh) return;
              const localDose = dosesRef.current.find((d) => d.id === dose.id);
              if (
                localDose &&
                (localDose.status === 'taken' ||
                  localDose.status === 'missed' ||
                  localDose.status === 'unconfirmed' ||
                  localDose.followUpSent)
              ) {
                return;
              }
              if (
                fresh.status === 'taken' ||
                fresh.status === 'missed' ||
                fresh.status === 'unconfirmed' ||
                fresh.followUpSent
              ) {
                return;
              }

              // Respect active snooze
              if (fresh.status === 'snoozed' && fresh.snoozeUntil) {
                const snoozeExpiresMs = fresh.snoozeUntil.toMillis();
                if (Date.now() < snoozeExpiresMs) return; // Still in snooze window
              }
              if (localDose?.status === 'snoozed' && localDose.snoozeUntil) {
                const localSnoozeExpiresMs = localDose.snoozeUntil.toMillis();
                if (Date.now() < localSnoozeExpiresMs) return;
              }

              showNotification(
                `⏰ Reminder: ${dose.medicationName} is overdue`,
                `You haven't confirmed ${dose.dosage} yet. Please take or snooze.`,
                `gentle-${dose.id}`
              );
              writeDosePatch(dose.id, { followUpSent: true });
            }, gentleDelay)
          );
        }
      }

      // ── T+30m  Escalation (sets status: 'unconfirmed' ONLY; backend sends FCM & sets escalationAlertSent) ──
      if (!dose.escalationAlertSent && dose.status !== 'unconfirmed') {
        const runEscalationCheck = async () => {
          if (cancelled) return;
          const fresh = await readLatestDose(dose.id);
          if (cancelled || !fresh) return;
          const localDose = dosesRef.current.find((d) => d.id === dose.id);
          if (
            localDose &&
            (localDose.status === 'taken' ||
              localDose.status === 'missed' ||
              localDose.status === 'unconfirmed' ||
              localDose.escalationAlertSent)
          ) {
            return;
          }
          if (
            fresh.status === 'taken' ||
            fresh.status === 'missed' ||
            fresh.status === 'unconfirmed' ||
            fresh.escalationAlertSent
          ) {
            return;
          }

          // Respect active snooze: if currently in an active snooze window, do not escalate
          if (fresh.status === 'snoozed' && fresh.snoozeUntil) {
            const snoozeExpiresMs = fresh.snoozeUntil.toMillis();
            if (Date.now() < snoozeExpiresMs) {
              return;
            }
          }
          if (localDose?.status === 'snoozed' && localDose.snoozeUntil) {
            const localSnoozeExpiresMs = localDose.snoozeUntil.toMillis();
            if (Date.now() < localSnoozeExpiresMs) {
              return;
            }
          }

          showNotification(
            `🚨 URGENT: ${dose.medicationName} not taken`,
            `${dose.dosage} has not been confirmed. Escalating to your caregiver.`,
            `escalation-${dose.id}`
          );
          writeDosePatch(dose.id, { status: 'unconfirmed' });
        };

        const escalationDelay = escalationMs - now;
        if (escalationDelay > 0) {
          timers.push(setTimeout(() => void runEscalationCheck(), escalationDelay));
        } else if (allowPastEscalationCatchup) {
          void runEscalationCheck();
        }
      }

      // ── Snooze expiry: re-notification at T+10m after snooze tapped ───────
      if (dose.status === 'snoozed' && dose.snoozeUntil) {
        const snoozeExpiresMs = dose.snoozeUntil.toMillis();
        const snoozeExpiredDelay = snoozeExpiresMs - now;

        if (snoozeExpiredDelay > 0) {
          timers.push(
            setTimeout(async () => {
              if (cancelled) return;
              const fresh = await readLatestDose(dose.id);
              if (cancelled || !fresh) return;
              const localDose = dosesRef.current.find((d) => d.id === dose.id);
              if (localDose && (localDose.status === 'taken' || localDose.status === 'missed')) {
                return;
              }
              if (
                fresh.status !== 'snoozed' ||
                localDose?.status !== 'snoozed' ||
                Date.now() >= escalationMs
              ) {
                return;
              }

              showNotification(
                `💊 ${dose.medicationName} — Snooze ended`,
                `${dose.dosage} — ready to take now.`,
                `snooze-expired-${dose.id}`
              );
              writeDosePatch(dose.id, { status: 'due', snoozeUntil: null });
            }, snoozeExpiredDelay)
          );
        } else if (now < escalationMs) {
          // Snooze expired while tab was inactive before T+30m escalation
          void (async () => {
            if (cancelled) return;
            const fresh = await readLatestDose(dose.id);
            if (cancelled || !fresh) return;
            const localDose = dosesRef.current.find((d) => d.id === dose.id);
            if (localDose && (localDose.status === 'taken' || localDose.status === 'missed')) {
              return;
            }
            if (
              fresh.status !== 'snoozed' ||
              localDose?.status !== 'snoozed' ||
              Date.now() >= escalationMs
            ) {
              return;
            }
            writeDosePatch(dose.id, { status: 'due', snoozeUntil: null });
          })();
        }
      }

      if (timers.length > 0) {
        activeTimerMap.set(dose.id, timers);
      }
    }

    // Cleanup: clear all timers when doses change or component unmounts
    return () => {
      cancelled = true;
      for (const timers of activeTimerMap.values()) {
        timers.forEach(clearTimeout);
      }
      activeTimerMap.clear();
    };
  }, [doses, patientId, isDemoSession]);
}
