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
    if (Notification.permission === 'granted') {
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
      if (Notification.permission === 'granted') {
        new Notification(title, { body, tag });
      }
    });
}

export function useReminderScheduler(
  doses: DoseLogDocument[],
  patientId: string
): void {
  // Map of doseId → array of timer IDs to clear on re-schedule or unmount
  const timerMap = useRef<Map<string, ReturnType<typeof setTimeout>[]>>(new Map());

  useEffect(() => {
    // Don't schedule if no doses or no patientId
    if (!patientId || doses.length === 0) return;

    // Request notification permission on first dose load
    void ensureNotificationPermission();

    const now = Date.now();

    // Clear all existing timers before re-scheduling (doses list changed)
    for (const timers of timerMap.current.values()) {
      timers.forEach(clearTimeout);
    }
    timerMap.current.clear();

    for (const dose of doses) {
      // Skip terminal states
      if (dose.status === 'taken' || dose.status === 'missed') continue;

      const scheduledMs = dose.scheduledTime.toMillis();
      const timers: ReturnType<typeof setTimeout>[] = [];

      // ── T+0  Initial "due" notification ───────────────────────────────────
      const dueDelay = scheduledMs - now;
      if (dueDelay > 0 && dose.status === 'scheduled') {
        timers.push(
          setTimeout(() => {
            showNotification(
              `💊 Time for ${dose.medicationName}`,
              `${dose.dosage} — please take now.`,
              `due-${dose.id}`
            );
            // Update status to 'due' in Firestore (idempotent — cloud function did this before)
            void updateDoseLog(dose.id, { status: 'due' }).catch(() => null);
          }, dueDelay)
        );
      } else if (dose.status === 'scheduled' && dueDelay <= 0) {
        // Already past due time but not yet marked — fix it immediately
        void updateDoseLog(dose.id, { status: 'due' }).catch(() => null);
      }

      // ── T+15m  Gentle follow-up reminder ─────────────────────────────────
      if (!dose.followUpSent) {
        const gentleMs = scheduledMs + GENTLE_REMINDER_OFFSET_MS;
        const gentleDelay = gentleMs - now;
        if (gentleDelay > 0) {
          timers.push(
            setTimeout(async () => {
              // Re-check: skip if user already took the dose
              const fresh = await getDoseLog(dose.id).catch(() => null);
              if (!fresh || fresh.status === 'taken' || fresh.status === 'missed') return;

              // Respect active snooze
              if (fresh.status === 'snoozed' && fresh.snoozeUntil) {
                const snoozeExpiresMs = fresh.snoozeUntil.toMillis();
                if (Date.now() < snoozeExpiresMs) return; // Still in snooze window
              }

              showNotification(
                `⏰ Reminder: ${dose.medicationName} is overdue`,
                `You haven't confirmed ${dose.dosage} yet. Please take or snooze.`,
                `gentle-${dose.id}`
              );
              void updateDoseLog(dose.id, { followUpSent: true }).catch(() => null);
            }, gentleDelay)
          );
        }
      }

      // ── T+30m  Escalation ─────────────────────────────────────────────────
      if (!dose.escalationAlertSent) {
        const escalationMs = scheduledMs + ESCALATION_OFFSET_MS;
        const escalationDelay = escalationMs - now;
        if (escalationDelay > 0) {
          timers.push(
            setTimeout(async () => {
              const fresh = await getDoseLog(dose.id).catch(() => null);
              if (!fresh || fresh.status === 'taken' || fresh.status === 'missed') return;

              showNotification(
                `🚨 URGENT: ${dose.medicationName} not taken`,
                `${dose.dosage} has not been confirmed. Your caregiver has been alerted.`,
                `escalation-${dose.id}`
              );
              void updateDoseLog(dose.id, {
                status: 'unconfirmed',
                escalationAlertSent: true,
              }).catch(() => null);
            }, escalationDelay)
          );
        }
      }

      // ── Snooze expiry: re-notification at T+10m after snooze tapped ───────
      if (dose.status === 'snoozed' && dose.snoozeUntil) {
        const snoozeExpiresMs = dose.snoozeUntil.toMillis();
        const snoozeExpiredDelay = snoozeExpiresMs - now;
        // Also compute when snooze+15m gentle reminder would fire
        const postSnoozeGentleDelay = snoozeExpiresMs + SNOOZE_DURATION_MS - now;

        if (snoozeExpiredDelay > 0) {
          timers.push(
            setTimeout(() => {
              showNotification(
                `💊 ${dose.medicationName} — Snooze ended`,
                `${dose.dosage} — ready to take now.`,
                `snooze-expired-${dose.id}`
              );
              void updateDoseLog(dose.id, { status: 'due' }).catch(() => null);
            }, snoozeExpiredDelay)
          );
        }

        if (!dose.followUpSent && postSnoozeGentleDelay > 0) {
          timers.push(
            setTimeout(() => {
              void updateDoseLog(dose.id, { followUpSent: true }).catch(() => null);
            }, postSnoozeGentleDelay)
          );
        }
      }

      if (timers.length > 0) {
        timerMap.current.set(dose.id, timers);
      }
    }

    // Cleanup: clear all timers when doses change or component unmounts
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const timers of timerMap.current.values()) {
        timers.forEach(clearTimeout);
      }
      timerMap.current.clear();
    };
  }, [doses, patientId]);
}
