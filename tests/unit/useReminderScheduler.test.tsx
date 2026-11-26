import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import {
  useReminderScheduler,
  type DoseSchedulerPatch,
  type UseReminderSchedulerOptions,
} from '../../src/hooks/useReminderScheduler';
import type { DoseLogDocument } from '../../src/types/firestore';

const mockGetDoseLog = vi.fn<(doseId: string) => Promise<DoseLogDocument | null>>();
const mockUpdateDoseLog = vi.fn<(doseId: string, patch: DoseSchedulerPatch) => Promise<void>>();

vi.mock('../../src/lib/firestore', () => ({
  getDoseLog: (doseId: string) => mockGetDoseLog(doseId),
  updateDoseLog: (doseId: string, patch: DoseSchedulerPatch) =>
    mockUpdateDoseLog(doseId, patch),
}));

interface NotificationCall {
  title: string;
  options: NotificationOptions | undefined;
}

function installNotificationStub(): {
  calls: NotificationCall[];
  restore: () => void;
} {
  const calls: NotificationCall[] = [];
  const originalNotification = window.Notification;

  class MockNotification {
    static permission: NotificationPermission = 'granted';
    static requestPermission = vi.fn<() => Promise<NotificationPermission>>(
      async () => 'granted'
    );

    constructor(title: string, options?: NotificationOptions) {
      calls.push({ title, options });
    }
  }

  Object.defineProperty(window, 'Notification', {
    configurable: true,
    writable: true,
    value: MockNotification,
  });

  return {
    calls,
    restore: () => {
      Object.defineProperty(window, 'Notification', {
        configurable: true,
        writable: true,
        value: originalNotification,
      });
    },
  };
}

function makeDose(overrides?: Partial<DoseLogDocument>): DoseLogDocument {
  const scheduled = new Date(2026, 10, 25, 8, 0, 0, 0);
  const ts = Timestamp.fromDate(scheduled);
  return {
    id: 'dose-1',
    patientId: 'patient-1',
    medicationId: 'med-1',
    medicationName: 'Metformin',
    dosage: '500mg',
    instructions: 'Take after breakfast',
    color: '#0D9488',
    shape: 'round',
    scheduledDate: '2026-11-25',
    scheduledTime: ts,
    status: 'due',
    snoozeCount: 0,
    followUpSent: true,
    escalationAlertSent: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function SchedulerHarness({
  doses,
  patientId,
  options,
}: {
  doses: DoseLogDocument[];
  patientId: string;
  options?: UseReminderSchedulerOptions;
}) {
  useReminderScheduler(doses, patientId, options);
  return null;
}

describe('useReminderScheduler — R1-FE & R2-FE', () => {
  let notifStub: ReturnType<typeof installNotificationStub>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 8, 0, 0, 0));
    notifStub = installNotificationStub();
    mockGetDoseLog.mockReset();
    mockUpdateDoseLog.mockReset();
    mockUpdateDoseLog.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    notifStub.restore();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('at T+30m writes { status: "unconfirmed" } ONLY without escalationAlertSent or escalatedAt', async () => {
    const dose = makeDose({ status: 'due', followUpSent: true, escalationAlertSent: false });
    mockGetDoseLog.mockResolvedValue(dose);

    render(<SchedulerHarness doses={[dose]} patientId="patient-1" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });

    expect(mockGetDoseLog).toHaveBeenCalledWith('dose-1');
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);

    const [calledId, patch] = mockUpdateDoseLog.mock.calls[0];
    expect(calledId).toBe('dose-1');
    expect(patch).toEqual({ status: 'unconfirmed' });
    expect(patch).not.toHaveProperty('escalationAlertSent');
    expect(patch).not.toHaveProperty('escalatedAt');

    const escalationNotifications = notifStub.calls.filter(
      (c) => c.options?.tag === 'escalation-dose-1'
    );
    expect(escalationNotifications).toHaveLength(1);
  });

  it('does not emit duplicate escalation notifications or writes when dose is already unconfirmed with escalationAlertSent: false', async () => {
    // (a) Initial prop already unconfirmed with escalationAlertSent: false
    const alreadyUnconfirmed = makeDose({
      status: 'unconfirmed',
      followUpSent: false,
      escalationAlertSent: false,
    });
    const { rerender, unmount } = render(
      <SchedulerHarness doses={[alreadyUnconfirmed]} patientId="patient-1" />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });

    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
    expect(notifStub.calls).toHaveLength(0);

    // (b) Re-render to unconfirmed after T+30m fires does not schedule duplicate
    vi.setSystemTime(new Date(2026, 10, 25, 8, 0, 0, 0));
    const dueDose = makeDose({ status: 'due', followUpSent: true, escalationAlertSent: false });
    mockGetDoseLog.mockResolvedValue(dueDose);
    rerender(<SchedulerHarness doses={[dueDose]} patientId="patient-1" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);

    rerender(
      <SchedulerHarness
        doses={[{ ...dueDose, status: 'unconfirmed', escalationAlertSent: false }]}
        patientId="patient-1"
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);
    unmount();

    // (c) Fresh Firestore doc returned as 'unconfirmed' when timer fires skips notification & write
    vi.setSystemTime(new Date(2026, 10, 25, 8, 0, 0, 0));
    mockUpdateDoseLog.mockClear();
    notifStub.calls.length = 0;

    const staleDue = makeDose({ status: 'due', followUpSent: true, escalationAlertSent: false });
    mockGetDoseLog.mockResolvedValue({
      ...staleDue,
      status: 'unconfirmed',
      escalationAlertSent: false,
    });
    render(<SchedulerHarness doses={[staleDue]} patientId="patient-1" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
    expect(notifStub.calls).toHaveLength(0);
  });

  it('skips T+30m update and notification when fresh dose is taken or missed', async () => {
    for (const terminalStatus of ['taken', 'missed'] as const) {
      vi.setSystemTime(new Date(2026, 10, 25, 8, 0, 0, 0));
      mockUpdateDoseLog.mockClear();
      notifStub.calls.length = 0;

      const staleDue = makeDose({ status: 'due', followUpSent: true, escalationAlertSent: false });
      mockGetDoseLog.mockResolvedValue({ ...staleDue, status: terminalStatus });

      const { unmount } = render(
        <SchedulerHarness doses={[staleDue]} patientId="patient-1" />
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60_000);
      });

      expect(mockUpdateDoseLog).not.toHaveBeenCalled();
      expect(notifStub.calls).toHaveLength(0);
      unmount();
    }
  });

  it('executes T+0 due, T+15m gentle (skipping active snooze), snooze expiry, and T+30m ceiling over active snooze', async () => {
    // Part 1: Scheduled at 08:05 from 08:00 -> T+0 due, T+15m gentle, T+30m unconfirmed
    const futureScheduled = makeDose({
      id: 'dose-future',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 5, 0, 0)),
      status: 'scheduled',
      followUpSent: false,
      escalationAlertSent: false,
    });
    mockGetDoseLog
      .mockResolvedValueOnce(futureScheduled)
      .mockResolvedValue({ ...futureScheduled, status: 'due' });

    const { unmount } = render(
      <SchedulerHarness doses={[futureScheduled]} patientId="patient-1" />
    );

    // T+0 (08:05)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledWith('dose-future', { status: 'due' });
    expect(notifStub.calls.some((c) => c.options?.tag === 'due-dose-future')).toBe(true);

    // T+15m (08:20)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledWith('dose-future', { followUpSent: true });
    expect(notifStub.calls.some((c) => c.options?.tag === 'gentle-dose-future')).toBe(true);

    // T+30m (08:35)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(mockUpdateDoseLog).toHaveBeenLastCalledWith('dose-future', { status: 'unconfirmed' });
    expect(notifStub.calls.some((c) => c.options?.tag === 'escalation-dose-future')).toBe(true);
    unmount();

    // Part 2: Snoozed dose respects active snooze at T+15m, clears snoozeUntil on expiry, and still escalates at T+30m
    vi.setSystemTime(new Date(2026, 10, 25, 8, 10, 0, 0));
    mockUpdateDoseLog.mockClear();
    notifStub.calls.length = 0;

    // Snoozed at 08:10 until 08:20 (T+15m is 08:15, inside active snooze)
    const snoozedDose = makeDose({
      id: 'dose-snooze',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozeUntil: Timestamp.fromDate(new Date(2026, 10, 25, 8, 20, 0, 0)),
      followUpSent: false,
      escalationAlertSent: false,
    });
    mockGetDoseLog.mockResolvedValue(snoozedDose);

    render(<SchedulerHarness doses={[snoozedDose]} patientId="patient-1" />);

    // At 08:15 (T+15m), still snoozed -> gentle notification suppressed
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(notifStub.calls.some((c) => c.options?.tag === 'gentle-dose-snooze')).toBe(false);
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();

    // At 08:20, snooze expires -> writes { status: 'due', snoozeUntil: null }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledWith('dose-snooze', {
      status: 'due',
      snoozeUntil: null,
    });
    expect(notifStub.calls.some((c) => c.options?.tag === 'snooze-expired-dose-snooze')).toBe(true);

    // At 08:30 (T+30m), escalation ceiling overrides even if fresh status is still 'snoozed'
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(mockUpdateDoseLog).toHaveBeenLastCalledWith('dose-snooze', {
      status: 'unconfirmed',
    });
  });

  it('demo mode (isDemoSession: true) routes all updates to onDemoDoseUpdate with zero Firestore calls', async () => {
    // Immediate past-due scheduled dose + future snooze + escalation
    vi.setSystemTime(new Date(2026, 10, 25, 8, 5, 0, 0));
    const onDemoDoseUpdate = vi.fn<(doseId: string, patch: DoseSchedulerPatch) => void>();

    const pastDueScheduled = makeDose({
      id: 'demo-past-scheduled',
      patientId: 'patient_ramesh',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0)),
      status: 'scheduled',
      followUpSent: false,
      escalationAlertSent: false,
    });
    const demoSnoozed = makeDose({
      id: 'demo-snoozed',
      patientId: 'patient_ramesh',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozeUntil: Timestamp.fromDate(new Date(2026, 10, 25, 8, 15, 0, 0)),
      followUpSent: true,
      escalationAlertSent: false,
    });

    const { unmount } = render(
      <SchedulerHarness
        doses={[pastDueScheduled, demoSnoozed]}
        patientId="patient_ramesh"
        options={{ isDemoSession: true, onDemoDoseUpdate }}
      />
    );

    // Immediate promotion of past-due scheduled dose happens locally on mount
    expect(onDemoDoseUpdate).toHaveBeenCalledWith('demo-past-scheduled', { status: 'due' });
    expect(mockGetDoseLog).not.toHaveBeenCalled();
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();

    // Advance 10 min to 08:15 -> demoSnoozed expires locally
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(onDemoDoseUpdate).toHaveBeenCalledWith('demo-snoozed', {
      status: 'due',
      snoozeUntil: null,
    });

    // Advance 5 min to 08:20 (T+20m; T+15m already fired at 08:15) -> gentle reminder for demo-past-scheduled
    expect(onDemoDoseUpdate).toHaveBeenCalledWith('demo-past-scheduled', {
      followUpSent: true,
    });

    // Advance 15 min to 08:30 -> T+30m escalation writes status: 'unconfirmed' locally
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15 * 60_000);
    });
    expect(onDemoDoseUpdate).toHaveBeenCalledWith('demo-past-scheduled', {
      status: 'unconfirmed',
    });
    expect(onDemoDoseUpdate).toHaveBeenCalledWith('demo-snoozed', {
      status: 'unconfirmed',
    });

    expect(mockGetDoseLog).not.toHaveBeenCalled();
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();

    // Cleanup on unmount leaves no dangling timers
    onDemoDoseUpdate.mockClear();
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60 * 60_000);
    });
    expect(onDemoDoseUpdate).not.toHaveBeenCalled();
  });

  it('RACE A: aborts in-flight T+30m escalation when component unmounts or dose becomes taken before getDoseLog resolves', async () => {
    let resolveDose!: (value: DoseLogDocument | null) => void;
    const pendingRead = new Promise<DoseLogDocument | null>((resolve) => {
      resolveDose = resolve;
    });
    mockGetDoseLog.mockReturnValueOnce(pendingRead);

    const dueDose = makeDose({
      id: 'dose-race-a',
      status: 'due',
      followUpSent: true,
      escalationAlertSent: false,
    });

    const { rerender, unmount } = render(
      <SchedulerHarness doses={[dueDose]} patientId="patient-1" />
    );

    // Advance to T+30m so getDoseLog is in-flight
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30 * 60_000);
    });
    expect(mockGetDoseLog).toHaveBeenCalledTimes(1);

    // Dose becomes taken and component unmounts before Firestore responds
    rerender(
      <SchedulerHarness doses={[{ ...dueDose, status: 'taken' }]} patientId="patient-1" />
    );
    unmount();

    // Now stale 'due' resolves from Firestore
    await act(async () => {
      resolveDose(dueDose);
      await Promise.resolve();
    });

    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
    expect(notifStub.calls.filter((c) => c.options?.tag === 'escalation-dose-race-a')).toHaveLength(
      0
    );
  });

  it('RACE B: dueDelay and snoozeExpiredDelay do not overwrite unconfirmed or terminal status past escalationMs', async () => {
    // (a) snoozeExpiredDelay at 08:31 (> escalationMs 08:30) does not overwrite unconfirmed back to due
    vi.setSystemTime(new Date(2026, 10, 25, 8, 21, 0, 0));
    const snoozedPastEscalation = makeDose({
      id: 'dose-race-b',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozedAt: Timestamp.fromDate(new Date(2026, 10, 25, 8, 21, 0, 0)),
      snoozeUntil: Timestamp.fromDate(new Date(2026, 10, 25, 8, 31, 0, 0)),
      followUpSent: true,
      escalationAlertSent: false,
    });
    mockGetDoseLog.mockResolvedValue({ ...snoozedPastEscalation, status: 'unconfirmed' });

    const { unmount } = render(
      <SchedulerHarness doses={[snoozedPastEscalation]} patientId="patient-1" />
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(11 * 60_000);
    });

    expect(mockUpdateDoseLog).not.toHaveBeenCalledWith('dose-race-b', {
      status: 'due',
      snoozeUntil: null,
    });
    expect(
      notifStub.calls.some((c) => c.options?.tag === 'snooze-expired-dose-race-b')
    ).toBe(false);
    unmount();

    // (b) dueDelay skips write/notification if fresh Firestore dose is already taken
    vi.setSystemTime(new Date(2026, 10, 25, 8, 0, 0, 0));
    mockUpdateDoseLog.mockClear();
    notifStub.calls.length = 0;

    const scheduledDose = makeDose({
      id: 'dose-due-race',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 5, 0, 0)),
      status: 'scheduled',
      followUpSent: true,
      escalationAlertSent: false,
    });
    mockGetDoseLog.mockResolvedValue({ ...scheduledDose, status: 'taken' });

    render(<SchedulerHarness doses={[scheduledDose]} patientId="patient-1" />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60_000);
    });

    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
    expect(notifStub.calls.some((c) => c.options?.tag === 'due-dose-due-race')).toBe(false);
  });

  it('RACE C2: preserves post-snooze gentle reminder across snooze-expiry re-render', async () => {
    vi.setSystemTime(new Date(2026, 10, 25, 8, 8, 0, 0));
    const patches: Array<{ doseId: string; patch: DoseSchedulerPatch }> = [];

    const initialSnoozed = makeDose({
      id: 'dose-c2',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozedAt: Timestamp.fromDate(new Date(2026, 10, 25, 8, 8, 0, 0)),
      snoozeUntil: Timestamp.fromDate(new Date(2026, 10, 25, 8, 18, 0, 0)),
      followUpSent: false,
      escalationAlertSent: false,
    });

    let currentDose = initialSnoozed;
    const { rerender } = render(
      <SchedulerHarness
        doses={[currentDose]}
        patientId="patient-1"
        options={{
          isDemoSession: true,
          onDemoDoseUpdate: (doseId, patch) => {
            patches.push({ doseId, patch });
            currentDose = { ...currentDose, ...patch };
          },
        }}
      />
    );

    // At 08:15 (T+15m), gentle is suppressed because snoozeUntil is 08:18
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7 * 60_000);
    });
    expect(patches).toHaveLength(0);

    // At 08:18, snooze expires -> { status: 'due', snoozeUntil: null } -> parent re-renders
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 60_000);
    });
    expect(patches).toEqual([{ doseId: 'dose-c2', patch: { status: 'due', snoozeUntil: null } }]);

    rerender(
      <SchedulerHarness
        doses={[currentDose]}
        patientId="patient-1"
        options={{
          isDemoSession: true,
          onDemoDoseUpdate: (doseId, patch) => {
            patches.push({ doseId, patch });
            currentDose = { ...currentDose, ...patch };
          },
        }}
      />
    );

    // At 08:28 (snoozedAt + 20m < 08:30 escalation), post-snooze gentle reminder fires
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });
    expect(patches).toContainEqual({ doseId: 'dose-c2', patch: { followUpSent: true } });
    expect(notifStub.calls.some((c) => c.options?.tag === 'gentle-dose-c2')).toBe(true);
  });

  it('EDGE D: late non-demo mount past T+30m escalates scheduled dose directly to unconfirmed without writing due; late demo mount preserves due', async () => {
    // Non-demo late mount at 08:35 for 08:00 scheduled dose -> escalates directly to unconfirmed
    vi.setSystemTime(new Date(2026, 10, 25, 8, 35, 0, 0));
    const pastScheduled = makeDose({
      id: 'dose-past-35',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0)),
      status: 'scheduled',
      followUpSent: false,
      escalationAlertSent: false,
    });
    mockGetDoseLog.mockResolvedValue(pastScheduled);

    const { unmount } = render(<SchedulerHarness doses={[pastScheduled]} patientId="patient-1" />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoseLog).toHaveBeenCalledWith('dose-past-35', { status: 'unconfirmed' });
    expect(mockUpdateDoseLog).not.toHaveBeenCalledWith('dose-past-35', { status: 'due' });
    expect(notifStub.calls.some((c) => c.options?.tag === 'escalation-dose-past-35')).toBe(true);
    unmount();

    // Demo mode late-hour mount at 14:00 with 08:00 'due' Metformin does NOT retroactively escalate
    vi.setSystemTime(new Date(2026, 10, 25, 14, 0, 0, 0));
    const onDemoDoseUpdate = vi.fn<(doseId: string, patch: DoseSchedulerPatch) => void>();
    const demoMetformin = makeDose({
      id: 'dose_metformin_demo',
      patientId: 'patient_ramesh',
      scheduledTime: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0)),
      status: 'due',
      followUpSent: true,
      escalationAlertSent: false,
    });

    render(
      <SchedulerHarness
        doses={[demoMetformin]}
        patientId="patient_ramesh"
        options={{ isDemoSession: true, onDemoDoseUpdate }}
      />
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onDemoDoseUpdate).not.toHaveBeenCalled();
  });
});
