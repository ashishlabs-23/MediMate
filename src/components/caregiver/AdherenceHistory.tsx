/**
 * AdherenceHistory — 7-day record completion calendar/overview for CaregiverDashboard.
 * Explicitly framed as logged reminder completion rather than clinical outcomes or medical judgement.
 */

import { AlertTriangle, CheckCircle2, Clock, XCircle } from 'lucide-react';
import type { DoseLogDocument } from '../../types/firestore';

export interface AdherenceHistoryProps {
  doses?: DoseLogDocument[] | undefined;
  dates?: string[] | undefined;
  isLoading?: boolean | undefined;
}

function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getDefaultLast7Dates(): string[] {
  const today = new Date();
  const result: string[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    result.push(formatLocalDate(d));
  }
  return result;
}

function formatDayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  if (Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) return dateStr;
  const dateObj = new Date(y, m - 1, d);
  return dateObj.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function AdherenceHistory({
  doses = [],
  dates,
  isLoading = false,
}: AdherenceHistoryProps) {
  const displayDates = dates && dates.length > 0 ? dates : getDefaultLast7Dates();
  const todayStr = formatLocalDate(new Date());
  const safeDoses = Array.isArray(doses) ? doses : [];

  const totalLogged = safeDoses.filter((d) => displayDates.includes(d.scheduledDate)).length;
  const totalTaken = safeDoses.filter(
    (d) => displayDates.includes(d.scheduledDate) && d.status === 'taken'
  ).length;

  return (
    <section
      id="adherence-history-section"
      aria-labelledby="adherence-history-heading"
      className="mt-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <div>
          <h2
            id="adherence-history-heading"
            aria-label="7-Day Record Completion"
            className="text-sm font-bold text-ink-secondary uppercase tracking-wider"
          >
            Past Week Summary
          </h2>
          <p className="text-sm text-ink-secondary mt-1">
            {totalTaken} of {totalLogged} scheduled reminders logged as taken ({displayDates.length} days).
          </p>
        </div>
      </div>

      {/* Explicit non-medical-judgement framing */}
      <p className="mb-4 rounded-btn bg-slate-100 border border-slate-200 px-3.5 py-2.5 text-xs text-ink-secondary">
        Record completion reflects logged reminders only, not clinical outcomes or medical judgement.
      </p>

      {isLoading ? (
        <div
          role="status"
          aria-label="Loading 7-day history…"
          className="flex justify-center py-10 rounded-card bg-surface border border-slate-200"
        >
          <div className="h-7 w-7 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
          {displayDates.map((dateStr, idx) => {
            const dayDoses = safeDoses.filter((d) => d.scheduledDate === dateStr);
            const takenCount = dayDoses.filter((d) => d.status === 'taken').length;
            const missedCount = dayDoses.filter((d) => d.status === 'missed').length;
            const unconfirmedCount = dayDoses.filter((d) => d.status === 'unconfirmed').length;
            const scheduledCount = dayDoses.filter(
              (d) => d.status === 'scheduled' || d.status === 'due' || d.status === 'snoozed'
            ).length;
            const isToday = dateStr === todayStr || idx === displayDates.length - 1;

            return (
              <article
                key={dateStr}
                data-date={dateStr}
                className={`rounded-card bg-surface border p-3.5 shadow-sm flex flex-col gap-2.5 ${
                  isToday ? 'border-brand-teal' : 'border-slate-200'
                }`}
              >
                <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
                  <span className="text-xs font-bold text-ink-primary">
                    {formatDayLabel(dateStr)}
                  </span>
                  {isToday && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand-teal-light text-brand-teal-dark">
                      Today
                    </span>
                  )}
                </div>

                {dayDoses.length === 0 ? (
                  <p className="text-xs text-ink-muted py-2">No reminders logged</p>
                ) : (
                  <ul className="space-y-1.5 text-xs">
                    <li className="flex items-center justify-between rounded px-2 py-1 bg-taken-bg text-taken font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        Taken
                      </span>
                      <span>{takenCount}</span>
                    </li>
                    <li className="flex items-center justify-between rounded px-2 py-1 bg-slate-200 text-ink-secondary font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        Missed
                      </span>
                      <span>{missedCount}</span>
                    </li>
                    <li className="flex items-center justify-between rounded px-2 py-1 bg-alert-chip text-alert font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        Unconfirmed
                      </span>
                      <span>{unconfirmedCount}</span>
                    </li>
                    <li className="flex items-center justify-between rounded px-2 py-1 bg-pending-bg text-pending font-semibold">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        Scheduled
                      </span>
                      <span>{scheduledCount}</span>
                    </li>
                  </ul>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default AdherenceHistory;
