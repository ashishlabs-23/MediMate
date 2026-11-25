/**
 * CaregiverDashboard — Real-time dose monitoring, prescription management, 7-day history, and care circle.
 *
 * DESIGN.md Section 6:
 *   - Care Circle Header & Patient Switcher [Monitoring: Ramesh Sharma ▼]
 *   - Persistent Escalation Alert Banner (role="alert", aria-live="assertive")
 *   - 4 Compliance Summary Badges (Scheduled, Confirmed, Pending, Unconfirmed)
 *   - Real-Time Dose Timeline (Firestore onSnapshot live stream) with PillMarker
 *   - Prescriptions management (+ Add Medication, Edit, Pause/Resume soft-delete)
 *   - 7-Day Record Completion (AdherenceHistory)
 *   - Care Circle management and member status
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Timestamp } from 'firebase/firestore';
import { CheckCircle2, PauseCircle, Pencil, PlayCircle, Plus } from 'lucide-react';
import {
  createMedication,
  getDoseLogsForDateRange,
  inviteCareCircleMember,
  setMedicationActive,
  subscribeToCareCircle,
  subscribeToDoseLogs,
  subscribeToMedications,
  updateDoseLog,
  updateMedication,
} from '../lib/firestore';
import {
  generateTodayLogs,
  generateTodayLogsForMedication,
} from '../lib/generateTodayLogs';
import {
  getMockCareCircle,
  getMockDoses,
  getMockDoseLogsForRange,
  getMockMedications,
} from '../lib/mockData';
import { StatusChip } from '../components/dose/StatusChip';
import { PillMarker } from '../components/dose/PillMarker';
import {
  AddMedicationModal,
  type MedicationFormPayload,
} from '../components/caregiver/AddMedicationModal';
import { AdherenceHistory } from '../components/caregiver/AdherenceHistory';
import { CareCircleInviteModal } from '../components/caregiver/CareCircleInviteModal';
import { AppShell } from '../components/layout/AppShell';
import { useAuthContext } from '../contexts/AuthContext';
import type {
  CareCircleDocument,
  CareCircleMember,
  DoseLogDocument,
  MedicationDocument,
  MedicationSchedule,
} from '../types/firestore';

const WEEKDAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isPermissionDeniedError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  if (code === 'permission-denied') return true;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && /permission[-_]denied|unauthorized/i.test(message);
}

function todayISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getLast7Dates(endDateStr: string): string[] {
  const [y, m, d] = endDateStr.split('-').map(Number);
  const result: string[] = [];
  for (let offset = 6; offset >= 0; offset--) {
    const dt = new Date(y, m - 1, d - offset);
    const yy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    result.push(`${yy}-${mm}-${dd}`);
  }
  return result;
}

function formatTime(ts: { toDate: () => Date } | Date): string {
  const d =
    typeof (ts as { toDate?: () => Date }).toDate === 'function'
      ? (ts as { toDate: () => Date }).toDate()
      : (ts as Date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatScheduleSummary(schedule: MedicationSchedule): string {
  const timesText = schedule.times.join(', ');
  if (schedule.frequency === 'daily') {
    return `${timesText} · Every day`;
  }
  const daysText = (schedule.daysOfWeek ?? [])
    .map((d) => WEEKDAY_NAMES[d] ?? '')
    .filter(Boolean)
    .join(', ');
  return `${timesText} · ${daysText || 'Specific days'}`;
}

function buildLocalDoseLogsForToday(
  med: MedicationDocument,
  dateStr: string
): DoseLogDocument[] {
  if (!med.active) return [];
  const [y, m, d] = dateStr.split('-').map(Number);
  const dayOfWeek = new Date(y, m - 1, d).getDay();
  if (med.schedule.startDate > dateStr) return [];
  if (med.schedule.endDate && med.schedule.endDate < dateStr) return [];
  if (
    med.schedule.frequency === 'specific_days' &&
    (!med.schedule.daysOfWeek || !med.schedule.daysOfWeek.includes(dayOfWeek))
  ) {
    return [];
  }

  const now = Timestamp.now();
  return med.schedule.times.map((timeStr) => {
    const [hh, mm] = timeStr.split(':').map(Number);
    const scheduledTime = new Date(y, m - 1, d, hh, mm, 0, 0);
    return {
      id: `${med.patientId}_${med.id}_${dateStr}_${timeStr.replace(':', '')}`,
      patientId: med.patientId,
      medicationId: med.id,
      medicationName: med.name,
      dosage: med.dosage,
      instructions: med.instructions,
      color: med.color,
      shape: med.shape,
      scheduledDate: dateStr,
      scheduledTime: Timestamp.fromDate(scheduledTime),
      status: 'scheduled',
      snoozeCount: 0,
      snoozedAt: null,
      snoozeUntil: null,
      takenAt: null,
      takenBy: null,
      escalatedAt: null,
      missedAt: null,
      followUpSent: false,
      escalationAlertSent: false,
      createdAt: now,
      updatedAt: now,
    };
  });
}

export function CaregiverDashboard() {
  const { userProfile, firebaseUser, isDemo } = useAuthContext();
  const [doses, setDoses] = useState<DoseLogDocument[]>([]);
  const [careCircle, setCareCircle] = useState<CareCircleDocument | null>(null);
  const [medications, setMedications] = useState<MedicationDocument[]>([]);
  const [historyDoses, setHistoryDoses] = useState<DoseLogDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isMedsLoading, setIsMedsLoading] = useState(true);
  const [isHistoryLoading, setIsHistoryLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMed, setEditingMed] = useState<MedicationDocument | null>(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);

  const unsubDosesRef = useRef<(() => void) | null>(null);
  const unsubCircleRef = useRef<(() => void) | null>(null);
  const unsubMedsRef = useRef<(() => void) | null>(null);
  const demoMedMutatedRef = useRef(false);
  const demoDoseMutatedRef = useRef(false);
  const demoCircleMutatedRef = useRef(false);

  // If user is caregiver, monitor target patient (default 'patient_ramesh')
  const currentUid = firebaseUser?.uid ?? '';
  const isCaregiverRole = userProfile?.role === 'caregiver' || currentUid.includes('caregiver');
  const patientId = isCaregiverRole ? 'patient_ramesh' : currentUid;
  const patientName =
    careCircle?.patientName ?? (patientId === 'patient_ramesh' ? 'Ramesh Sharma' : 'Patient');
  const patientPhone = '9876543210';
  const date = todayISO();
  const last7Dates = useMemo(() => getLast7Dates(date), [date]);

  // Detect demo session: loginAsDemo() sets a mock uid that is not a real Firebase Auth token.
  // In test environment (Vitest), mockDb is used so we allow normal Firestore subscription flow.
  const isTestMode = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
  const isDemoSession =
    !isTestMode &&
    (currentUid === 'patient_ramesh' ||
      currentUid === 'caregiver_priya' ||
      currentUid.startsWith('demo_'));

  useEffect(() => {
    if (!patientId) return;

    let cancelled = false;
    demoMedMutatedRef.current = false;
    demoDoseMutatedRef.current = false;
    demoCircleMutatedRef.current = false;

    setIsLoading(true);
    setIsMedsLoading(true);
    setIsHistoryLoading(true);
    setErrorMsg(null);

    // Ensure today's logs exist for patient if connected
    void (generateTodayLogs(patientId) as Promise<unknown> | undefined)?.catch(() => null);

    // Subscribe to dose logs
    const unsubDoses = subscribeToDoseLogs(
      patientId,
      date,
      (updatedDoses) => {
        if (updatedDoses.length > 0) {
          setDoses(updatedDoses);
        } else if (patientId === 'patient_ramesh') {
          if (!demoDoseMutatedRef.current) {
            setDoses(getMockDoses(date, true));
          }
        } else if (!demoDoseMutatedRef.current) {
          setDoses([]);
        }
        setIsLoading(false);
        setErrorMsg(null);
      },
      (err) => {
        console.warn('Firestore subscription fallback (demo/unlinked):', err.message);
        if (patientId === 'patient_ramesh' || isDemoSession) {
          if (!demoDoseMutatedRef.current) {
            setDoses(getMockDoses(date, true));
          }
          setErrorMsg(null);
        } else {
          setErrorMsg(err.message);
        }
        setIsLoading(false);
      }
    );
    unsubDosesRef.current = unsubDoses;

    // Subscribe to care circle
    const unsubCircle = subscribeToCareCircle(
      patientId,
      (circle) => {
        if (circle) {
          setCareCircle(circle);
        } else if (patientId === 'patient_ramesh' && !demoCircleMutatedRef.current) {
          setCareCircle(getMockCareCircle(patientId));
        }
      },
      (err) => {
        console.warn('Care circle subscription fallback:', err.message);
        if ((patientId === 'patient_ramesh' || isDemoSession) && !demoCircleMutatedRef.current) {
          setCareCircle(getMockCareCircle(patientId));
          setErrorMsg(null);
        }
      }
    );
    unsubCircleRef.current = unsubCircle;

    // Subscribe to medications (active and paused)
    const unsubMeds = subscribeToMedications(
      patientId,
      (meds) => {
        if (meds.length > 0) {
          demoMedMutatedRef.current = false;
          setMedications(meds);
        } else if (patientId === 'patient_ramesh') {
          if (!demoMedMutatedRef.current) {
            setMedications(getMockMedications(patientId));
          }
        } else if (!demoMedMutatedRef.current) {
          setMedications([]);
        }
        setIsMedsLoading(false);
      },
      (err) => {
        console.warn('Medications subscription fallback:', err.message);
        if ((patientId === 'patient_ramesh' || isDemoSession) && !demoMedMutatedRef.current) {
          setMedications(getMockMedications(patientId));
          setErrorMsg(null);
        }
        setIsMedsLoading(false);
      }
    );
    unsubMedsRef.current = unsubMeds;

    // Load 7-day adherence history
    const startDate = last7Dates[0] ?? date;
    const endDate = last7Dates[last7Dates.length - 1] ?? date;
    getDoseLogsForDateRange(patientId, startDate, endDate)
      .then((logs) => {
        if (cancelled) return;
        if (logs.length > 0) {
          setHistoryDoses(logs);
        } else if (patientId === 'patient_ramesh') {
          setHistoryDoses(getMockDoseLogsForRange(patientId, last7Dates));
        } else {
          setHistoryDoses([]);
        }
        setIsHistoryLoading(false);
      })
      .catch((err) => {
        console.warn('7-day history fallback:', err);
        if (cancelled) return;
        if (patientId === 'patient_ramesh' || isDemoSession) {
          setHistoryDoses(getMockDoseLogsForRange(patientId, last7Dates));
        } else {
          setHistoryDoses([]);
        }
        setIsHistoryLoading(false);
      });

    return () => {
      cancelled = true;
      unsubDoses();
      unsubCircle();
      unsubMeds();
    };
  }, [patientId, date, last7Dates, isDemoSession]);

  // Handler to manually resolve an unconfirmed dose
  const handleMarkResolved = async (doseId: string) => {
    demoDoseMutatedRef.current = true;
    const now = Timestamp.now();
    // Optimistic local state update
    setDoses((prev) =>
      prev.map((d) =>
        d.id === doseId
          ? {
              ...d,
              status: 'taken' as const,
              takenAt: now,
              takenBy: currentUid || 'caregiver',
            }
          : d
      )
    );

    try {
      await updateDoseLog(doseId, {
        status: 'taken',
        takenAt: now,
        takenBy: currentUid || 'caregiver',
      });
    } catch (err) {
      console.warn('Backend update notice (offline/demo mode):', err);
    }
  };

  function openAddModal() {
    setEditingMed(null);
    setIsModalOpen(true);
  }

  function openEditModal(med: MedicationDocument) {
    setEditingMed(med);
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setEditingMed(null);
  }

  async function handleSaveMedication(
    payload: MedicationFormPayload,
    existingId?: string
  ): Promise<void> {
    if (!patientId) return;

    const existingMed = existingId
      ? medications.find((m) => m.id === existingId)
      : undefined;

    const schedule: MedicationSchedule = {
      times: payload.times,
      frequency: payload.frequency,
      ...(payload.frequency === 'specific_days' && payload.daysOfWeek
        ? { daysOfWeek: payload.daysOfWeek }
        : {}),
      startDate: existingMed?.schedule.startDate ?? date,
      endDate: existingMed?.schedule.endDate ?? null,
    };

    if (existingId) {
      demoMedMutatedRef.current = true;
      const now = Timestamp.now();
      setMedications((prev) =>
        prev.map((m) =>
          m.id === existingId
            ? {
                ...m,
                name: payload.name,
                dosage: payload.dosage,
                instructions: payload.instructions,
                schedule,
                shape: payload.shape,
                color: payload.color,
                updatedAt: now,
              }
            : m
        )
      );

      try {
        await updateMedication(existingId, {
          name: payload.name,
          dosage: payload.dosage,
          instructions: payload.instructions,
          schedule,
          shape: payload.shape,
          color: payload.color,
        });
      } catch (err) {
        console.warn('Medication update notice (offline/demo mode):', err);
      }
      return;
    }

    demoMedMutatedRef.current = true;
    const newMedBase = {
      patientId,
      name: payload.name,
      dosage: payload.dosage,
      instructions: payload.instructions,
      schedule,
      shape: payload.shape,
      color: payload.color,
      active: true,
      createdBy: currentUid || 'caregiver',
    };

    try {
      const created = await createMedication(newMedBase);
      setMedications((prev) =>
        prev.some((m) => m.id === created.id) ? prev : [created, ...prev]
      );
      await generateTodayLogsForMedication(created).catch(() => 0);
    } catch (err) {
      console.warn('Medication create notice (offline/demo mode):', err);
      const now = Timestamp.now();
      const localMed: MedicationDocument = {
        ...newMedBase,
        id: `local_med_${Date.now()}`,
        createdAt: now,
        updatedAt: now,
      };
      setMedications((prev) => [localMed, ...prev]);

      const newTodayLogs = buildLocalDoseLogsForToday(localMed, date);
      if (newTodayLogs.length > 0) {
        demoDoseMutatedRef.current = true;
        setDoses((prev) =>
          [...prev, ...newTodayLogs].sort(
            (a, b) => a.scheduledTime.toMillis() - b.scheduledTime.toMillis()
          )
        );
      }
    }
  }

  async function handleToggleActive(med: MedicationDocument) {
    const nextActive = !med.active;
    demoMedMutatedRef.current = true;

    setMedications((prev) =>
      prev.map((m) =>
        m.id === med.id ? { ...m, active: nextActive, updatedAt: Timestamp.now() } : m
      )
    );

    try {
      await setMedicationActive(med.id, nextActive);
      if (nextActive) {
        await generateTodayLogsForMedication({ ...med, active: true }).catch(() => 0);
      }
    } catch (err) {
      console.warn('Medication active toggle notice (offline/demo mode):', err);
    }
  }

  const existingInviteEmails = useMemo(
    () => (careCircle?.members ?? []).map((m) => m.email).filter(Boolean),
    [careCircle]
  );

  async function handleInviteMember(member: CareCircleMember): Promise<void> {
    if (!patientId) return;
    const normalizedEmail = member.email.trim().toLowerCase();

    const applyOptimisticInvite = () => {
      demoCircleMutatedRef.current = true;
      setCareCircle((prev) => {
        const base: CareCircleDocument =
          prev ??
          (patientId === 'patient_ramesh'
            ? getMockCareCircle(patientId)
            : {
                id: patientId,
                patientId,
                patientName,
                caregiverIds: isCaregiverRole && currentUid ? [currentUid] : [],
                members: [],
                inviteCode: 'MED-7892',
                createdAt: Timestamp.now(),
                updatedAt: Timestamp.now(),
              });
        const filtered = base.members.filter(
          (m) => (m.email ?? '').trim().toLowerCase() !== normalizedEmail
        );
        return {
          ...base,
          members: [...filtered, member],
          updatedAt: Timestamp.now(),
        };
      });
    };

    try {
      await inviteCareCircleMember(patientId, member);
      applyOptimisticInvite();
    } catch (err) {
      if (!isDemo && !isDemoSession && isPermissionDeniedError(err)) {
        throw err;
      }
      console.warn('Care circle invite notice (offline/demo mode):', err);
      applyOptimisticInvite();
    }
  }

  // Merge today's live doses into 7-day history so resolving/adding doses reflects immediately
  const mergedHistoryDoses = useMemo(() => {
    const priorDays = historyDoses.filter((d) => d.scheduledDate !== date);
    return [...priorDays, ...doses];
  }, [historyDoses, doses, date]);

  // Compliance summary
  const summary = {
    scheduled: doses.length,
    taken: doses.filter((d) => d.status === 'taken').length,
    pending: doses.filter(
      (d) => d.status === 'scheduled' || d.status === 'due' || d.status === 'snoozed'
    ).length,
    unconfirmed: doses.filter((d) => d.status === 'unconfirmed').length,
  };

  const unconfirmedDoses = doses.filter((d) => d.status === 'unconfirmed');

  return (
    <AppShell>
      <div className="max-w-5xl mx-auto px-4 py-6">
        {/* Page heading & Patient switcher */}
        <header className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-ink-primary">
              Caregiver Dashboard
            </h1>
            <p className="text-sm text-ink-secondary mt-1">
              Real-time adherence overview · {date}
            </p>
          </div>

          {/* DESIGN.md §6.2: Patient Switcher Button */}
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-btn bg-surface border border-slate-300 shadow-sm text-sm font-semibold text-ink-primary">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              Monitoring: <span className="text-brand-teal font-bold">{patientName}</span>
            </div>
          </div>
        </header>

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

        {/* DESIGN.md §6.3: High-Visibility Persistent Escalation Alert Banner */}
        {unconfirmedDoses.length > 0 && (
          <div
            id="unconfirmed-alert-banner"
            role="alert"
            aria-live="assertive"
            className="mb-6 rounded-card border-2 border-alert bg-alert-bg p-5 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xl">⚠️</span>
              <h2 className="font-bold text-alert text-lg">
                URGENT ALERT: {patientName} has {unconfirmedDoses.length} unconfirmed dose{unconfirmedDoses.length > 1 ? 's' : ''}!
              </h2>
            </div>

            <div className="space-y-3 mt-3">
              {unconfirmedDoses.map((d) => {
                const overdueMinutes = Math.max(
                  1,
                  Math.round((Date.now() - d.scheduledTime.toMillis()) / 60000)
                );
                return (
                  <div
                    key={d.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-white/70 rounded-btn border border-red-200"
                  >
                    <div>
                      <p className="font-bold text-ink-primary text-base">
                        {d.medicationName} ({d.dosage})
                      </p>
                      <p className="text-sm text-alert font-medium">
                        Scheduled for {formatTime(d.scheduledTime)} · Overdue by {overdueMinutes} minutes
                      </p>
                    </div>

                    {/* Action buttons: Call Patient + Mark Resolved */}
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={`tel:${patientPhone}`}
                        aria-label={`Call ${patientName} now at ${patientPhone}`}
                        className="
                          min-h-[44px] px-4 py-2 rounded-btn
                          bg-alert text-white text-sm font-bold
                          flex items-center gap-1.5 hover:bg-red-900 active:bg-red-950
                          focus:outline-none focus:ring-2 focus:ring-alert focus:ring-offset-2
                          shadow-sm transition-colors
                        "
                      >
                        📞 Call {patientName.split(' ')[0]}
                      </a>

                      <button
                        type="button"
                        onClick={() => void handleMarkResolved(d.id)}
                        className="
                          min-h-[44px] px-4 py-2 rounded-btn
                          bg-white border border-slate-300 text-ink-primary text-sm font-semibold
                          hover:bg-slate-50 active:bg-slate-100
                          focus:outline-none focus:ring-2 focus:ring-focus focus:ring-offset-2
                          shadow-sm transition-colors
                        "
                      >
                        Mark Resolved
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* DESIGN.md §6.3: Today's Compliance Summary Badges */}
        <section
          id="compliance-summary-badges"
          aria-label="Today's compliance summary"
          className="mb-6 grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4"
        >
          <div
            id="badge-scheduled"
            data-count={summary.scheduled}
            className="rounded-card bg-surface border border-slate-200 p-4 text-center shadow-sm"
          >
            <p className="text-3xl font-extrabold text-ink-primary">{summary.scheduled}</p>
            <p className="text-xs text-ink-secondary mt-1 uppercase font-semibold tracking-wider">Scheduled</p>
            <span className="text-[11px] text-ink-muted">Total Prescribed</span>
          </div>

          <div
            id="badge-taken"
            data-count={summary.taken}
            className="rounded-card bg-surface border border-emerald-200 p-4 text-center shadow-sm"
          >
            <p className="text-3xl font-extrabold text-emerald-700">{summary.taken}</p>
            <p className="text-xs text-emerald-600 mt-1 uppercase font-semibold tracking-wider">Confirmed</p>
            <span className="text-[11px] text-emerald-600">Taken on Time</span>
          </div>

          <div
            id="badge-pending"
            data-count={summary.pending}
            className="rounded-card bg-surface border border-sky-200 p-4 text-center shadow-sm"
          >
            <p className="text-3xl font-extrabold text-sky-700">{summary.pending}</p>
            <p className="text-xs text-sky-600 mt-1 uppercase font-semibold tracking-wider">Pending</p>
            <span className="text-[11px] text-sky-600">Upcoming Today</span>
          </div>

          <div
            id="badge-unconfirmed"
            data-count={summary.unconfirmed}
            className={`rounded-card bg-surface border p-4 text-center shadow-sm transition-all ${
              summary.unconfirmed > 0 ? 'border-alert bg-alert-bg' : 'border-slate-200'
            }`}
          >
            <p
              className={`text-3xl font-extrabold ${
                summary.unconfirmed > 0 ? 'text-alert' : 'text-ink-primary'
              }`}
            >
              {summary.unconfirmed}
            </p>
            <p
              className={`text-xs mt-1 uppercase font-semibold tracking-wider ${
                summary.unconfirmed > 0 ? 'text-alert' : 'text-ink-secondary'
              }`}
            >
              Unconfirmed
            </p>
            <span className={`text-[11px] ${summary.unconfirmed > 0 ? 'text-alert font-bold' : 'text-ink-muted'}`}>
              {summary.unconfirmed > 0 ? 'Overdue >30m' : 'All Clear'}
            </span>
          </div>
        </section>

        {/* Main Grid: Timeline (2 cols) & Care Circle (1 col) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Dose timeline */}
          <section aria-label="Dose timeline" className="lg:col-span-2">
            <h2 className="text-sm font-bold text-ink-secondary uppercase tracking-wider mb-3">
              Today&apos;s Live Dose Timeline
            </h2>

            {/* Loading */}
            {isLoading && (
              <div
                role="status"
                aria-label="Loading dose timeline…"
                className="flex justify-center py-12"
              >
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" />
              </div>
            )}

            {/* Empty */}
            {!isLoading && doses.length === 0 && (
              <div className="rounded-card bg-surface border border-slate-200 p-8 text-center">
                <p className="text-ink-secondary text-base">No doses scheduled for today.</p>
              </div>
            )}

            {/* Timeline cards */}
            {!isLoading && doses.length > 0 && (
              <div id="dose-timeline" aria-live="polite" className="flex flex-col gap-3">
                {doses.map((dose) => (
                  <article
                    key={dose.id}
                    data-dose-id={dose.id}
                    data-status={dose.status}
                    className="flex items-center justify-between gap-4 p-4 rounded-card bg-surface border border-slate-200 shadow-sm hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <PillMarker
                        color={dose.color ?? '#0D9488'}
                        shape={dose.shape ?? 'round'}
                        name={dose.medicationName}
                        dosage={dose.dosage}
                        size={40}
                      />
                      <div className="min-w-0">
                        <p className="font-bold text-ink-primary text-base truncate">
                          {dose.medicationName} <span className="font-normal text-ink-secondary text-sm">({dose.dosage})</span>
                        </p>
                        <p className="text-xs text-ink-muted mt-0.5">
                          Scheduled: {formatTime(dose.scheduledTime)}
                          {dose.takenAt && (
                            <span className="ml-2 font-semibold text-emerald-700">
                              ✓ Taken at {formatTime(dose.takenAt.toDate())}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0">
                      <StatusChip status={dose.status} />
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* Care Circle Sidebar */}
          <section aria-labelledby="care-circle-heading" className="lg:col-span-1">
            <h2
              id="care-circle-heading"
              className="text-sm font-bold text-ink-secondary uppercase tracking-wider mb-3"
            >
              Care Circle
            </h2>

            <div
              id="care-circle-members"
              className="rounded-card bg-surface border border-slate-200 p-5 shadow-sm"
            >
              <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-100">
                <span className="text-xs font-semibold text-ink-secondary uppercase">
                  Active Members
                </span>
                <span className="text-xs text-brand-teal font-bold font-mono">
                  Code: {careCircle?.inviteCode ?? 'MED-7892'}
                </span>
              </div>

              <div className="space-y-3">
                {careCircle?.members && careCircle.members.length > 0 ? (
                  careCircle.members.map((member) => (
                    <div key={member.userId || member.email} className="flex items-center gap-3 py-1.5">
                      <div className="h-9 w-9 rounded-full bg-brand-teal-light flex items-center justify-center shrink-0">
                        <span className="text-xs font-bold text-brand-teal-dark">
                          {(member.displayName || member.email).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-ink-primary truncate">
                          {member.displayName || member.email}
                        </p>
                        <p className="text-xs text-ink-muted truncate">
                          {member.role === 'primary' ? 'Family Caregiver (Primary)' : 'Family Caregiver (Secondary)'}
                        </p>
                        {member.status === 'invited' && member.email && (
                          <p className="text-[11px] text-ink-muted truncate">{member.email}</p>
                        )}
                      </div>
                      <span
                        className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${
                          member.status === 'active'
                            ? 'bg-emerald-100 text-emerald-700'
                            : member.status === 'invited'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {member.status === 'active'
                          ? 'Active'
                          : member.status === 'invited'
                            ? 'Invited'
                            : 'Declined'}
                      </span>
                    </div>
                  ))
                ) : (
                  /* Primary Caregiver Fallback */
                  <div className="flex items-center gap-3 py-1.5">
                    <div className="h-9 w-9 rounded-full bg-brand-teal-light flex items-center justify-center shrink-0">
                      <span className="text-xs font-bold text-brand-teal-dark">P</span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-ink-primary truncate">Priya Sharma</p>
                      <p className="text-xs text-ink-muted">Family Caregiver (Primary)</p>
                    </div>
                    <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 shrink-0">
                      Active
                    </span>
                  </div>
                )}

                {/* Patient */}
                <div className="flex items-center gap-3 py-1.5">
                  <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                    <span className="text-xs font-bold text-ink-primary">{patientName.charAt(0)}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-ink-primary truncate">{patientName}</p>
                    <p className="text-xs text-ink-muted">Patient (Self-monitoring)</p>
                  </div>
                  <span className="ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 shrink-0">
                    Patient
                  </span>
                </div>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsInviteModalOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={isInviteModalOpen}
                  className="w-full min-h-touch min-w-touch py-2 px-3 rounded-btn bg-slate-50 border border-slate-200 text-xs font-bold text-brand-teal hover:bg-slate-100 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors"
                >
                  + Invite Another Family Member
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Prescriptions Management Section */}
        <section
          id="prescriptions-section"
          aria-labelledby="prescriptions-heading"
          className="mt-8"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
            <div>
              <h2
                id="prescriptions-heading"
                className="text-sm font-bold text-ink-secondary uppercase tracking-wider"
              >
                Prescriptions
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Stores caregiver-entered prescription schedules. Pausing preserves historical reminder logs.
              </p>
            </div>
            <button
              type="button"
              onClick={openAddModal}
              className="min-h-touch min-w-touch inline-flex items-center justify-center gap-2 px-4 py-2 rounded-btn bg-brand-teal text-white text-sm font-bold hover:bg-brand-teal-dark focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors shrink-0"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Add Medication</span>
            </button>
          </div>

          {isMedsLoading ? (
            <div
              role="status"
              aria-label="Loading prescriptions…"
              className="flex justify-center py-8 rounded-card bg-surface border border-slate-200"
            >
              <div className="h-7 w-7 animate-spin rounded-full border-4 border-brand-teal border-t-transparent" />
            </div>
          ) : medications.length === 0 ? (
            <div className="rounded-card bg-surface border border-slate-200 p-6 text-center">
              <p className="text-sm text-ink-secondary">
                No prescriptions added yet. Use &ldquo;+ Add Medication&rdquo; to set up a reminder schedule.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {medications.map((med) => (
                <article
                  key={med.id}
                  data-medication-id={med.id}
                  data-active={String(med.active)}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-card bg-surface border shadow-sm transition-colors ${
                    med.active ? 'border-slate-200' : 'border-slate-200 bg-slate-50/70'
                  }`}
                >
                  <div className="flex items-start sm:items-center gap-3.5 min-w-0">
                    <PillMarker
                      color={med.color}
                      shape={med.shape}
                      name={med.name}
                      dosage={med.dosage}
                      size={40}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-ink-primary text-base truncate">
                          {med.name}{' '}
                          <span className="font-normal text-ink-secondary text-sm">
                            ({med.dosage})
                          </span>
                        </h3>
                        {med.active ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-taken-bg text-taken">
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-200 text-ink-secondary">
                            <PauseCircle className="w-3.5 h-3.5" aria-hidden="true" />
                            Paused
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-secondary mt-1">
                        {formatScheduleSummary(med.schedule)}
                      </p>
                      {med.instructions && (
                        <p className="text-xs text-ink-muted mt-0.5">{med.instructions}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditModal(med)}
                      aria-label={`Edit ${med.name}`}
                      className="min-h-touch min-w-touch inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-sm font-semibold hover:bg-slate-50 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors"
                    >
                      <Pencil className="w-4 h-4" aria-hidden="true" />
                      Edit
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleToggleActive(med)}
                      aria-label={med.active ? `Pause ${med.name}` : `Resume ${med.name}`}
                      className={`min-h-touch min-w-touch inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-btn border text-sm font-semibold focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 transition-colors ${
                        med.active
                          ? 'border-slate-300 bg-surface text-ink-secondary hover:bg-slate-100'
                          : 'border-brand-teal bg-brand-teal-light/40 text-brand-teal-dark hover:bg-brand-teal-light'
                      }`}
                    >
                      {med.active ? (
                        <>
                          <PauseCircle className="w-4 h-4" aria-hidden="true" />
                          Pause
                        </>
                      ) : (
                        <>
                          <PlayCircle className="w-4 h-4" aria-hidden="true" />
                          Resume
                        </>
                      )}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        {/* 7-Day Adherence History Section */}
        <AdherenceHistory
          doses={mergedHistoryDoses}
          dates={last7Dates}
          isLoading={isHistoryLoading}
        />

        {/* Add / Edit Medication Modal */}
        <AddMedicationModal
          isOpen={isModalOpen}
          onClose={closeModal}
          onSave={handleSaveMedication}
          initialMedication={editingMed}
        />

        {/* Care Circle Invite Modal — Phase 4D */}
        <CareCircleInviteModal
          isOpen={isInviteModalOpen}
          onClose={() => setIsInviteModalOpen(false)}
          inviteCode={careCircle?.inviteCode ?? 'MED-7892'}
          existingEmails={existingInviteEmails}
          onInviteMember={handleInviteMember}
          patientName={patientName}
        />
      </div>
    </AppShell>
  );
}

export default CaregiverDashboard;
