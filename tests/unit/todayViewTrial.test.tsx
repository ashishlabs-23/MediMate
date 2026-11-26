import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { AuthProvider, type AuthContextValue } from '../../src/contexts/AuthContext';
import { TodayView } from '../../src/pages/TodayView';
import type { DoseLogDocument, UserDocument } from '../../src/types/firestore';

type SnapshotCallback = (doses: DoseLogDocument[]) => void;

const mockSubscribeToDoseLogs = vi.fn<
  (
    patientId: string,
    date: string,
    cb: SnapshotCallback,
    onErr?: (err: Error) => void
  ) => () => void
>();
const mockUpdateDoseLog = vi.fn<
  (doseId: string, patch: Partial<DoseLogDocument>) => Promise<void>
>();
const mockGetDoseLog = vi.fn<(doseId: string) => Promise<DoseLogDocument | null>>();
const mockGenerateTodayLogs = vi.fn<(patientId: string) => Promise<number>>();
const mockPlayConfirmationChime = vi.fn<() => void>();

vi.mock('../../src/lib/firestore', () => ({
  subscribeToDoseLogs: (
    patientId: string,
    date: string,
    cb: SnapshotCallback,
    onErr?: (err: Error) => void
  ) => mockSubscribeToDoseLogs(patientId, date, cb, onErr),
  updateDoseLog: (doseId: string, patch: Partial<DoseLogDocument>) =>
    mockUpdateDoseLog(doseId, patch),
  getDoseLog: (doseId: string) => mockGetDoseLog(doseId),
}));

vi.mock('../../src/lib/generateTodayLogs', () => ({
  generateTodayLogs: (patientId: string) => mockGenerateTodayLogs(patientId),
}));

vi.mock('../../src/lib/sound', () => ({
  playConfirmationChime: () => mockPlayConfirmationChime(),
}));

vi.mock('../../src/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => (
    <div data-testid="app-shell">{children}</div>
  ),
}));

function makeAuthValue(options: {
  uid: string;
  isDemo: boolean;
  nullFirebaseUser?: boolean;
}): AuthContextValue {
  const ts = Timestamp.fromDate(new Date(2026, 10, 25, 0, 0, 0));
  const userProfile: UserDocument = {
    uid: options.uid,
    email: `${options.uid}@medimate.local`,
    displayName: 'Ramesh Sharma',
    role: 'elderly',
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: ts,
    updatedAt: ts,
  };

  return {
    firebaseUser: options.nullFirebaseUser ? null : ({ uid: options.uid } as unknown as User),
    userProfile,
    isLoading: false,
    isDemo: options.isDemo,
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

describe('TodayView — R2-FE Trial / Demo Isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 8, 5, 0, 0));
    mockSubscribeToDoseLogs.mockImplementation(() => vi.fn());
    mockUpdateDoseLog.mockResolvedValue(undefined);
    mockGetDoseLog.mockResolvedValue(null);
    mockGenerateTodayLogs.mockResolvedValue(0);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('hydrates from local mockData on mount with ZERO Firestore reads or writes', () => {
    render(
      <AuthProvider value={makeAuthValue({ uid: 'patient_ramesh', isDemo: true })}>
        <TodayView />
      </AuthProvider>
    );

    expect(screen.getByRole('heading', { name: /Hello, Ramesh/i })).toBeInTheDocument();
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Metformin');
    expect(screen.getByText('Amlodipine')).toBeInTheDocument();
    expect(screen.getByText('Atorvastatin')).toBeInTheDocument();

    expect(mockGenerateTodayLogs).not.toHaveBeenCalled();
    expect(mockSubscribeToDoseLogs).not.toHaveBeenCalled();
    expect(mockGetDoseLog).not.toHaveBeenCalled();
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
  });

  it('supports Taken ✓, 5-second Undo, and deferred local completion with ZERO updateDoseLog calls', async () => {
    render(
      <AuthProvider value={makeAuthValue({ uid: 'patient_ramesh', isDemo: true })}>
        <TodayView />
      </AuthProvider>
    );

    // Click Taken -> undo toast opens
    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });
    expect(document.getElementById('undo-toast')).toHaveTextContent('Metformin');
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Amlodipine');

    // Click Undo -> restores Metformin as Next Medication
    act(() => {
      fireEvent.click(document.getElementById('undo-toast-button') as HTMLButtonElement);
    });
    expect(document.getElementById('undo-toast')).not.toBeInTheDocument();
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Metformin');

    // Confirm Taken again and let 5000ms elapse
    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(document.getElementById('undo-toast')).not.toBeInTheDocument();
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Amlodipine');
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
  });

  it('supports local Snooze (10 min) with ZERO updateDoseLog calls', async () => {
    render(
      <AuthProvider value={makeAuthValue({ uid: 'patient_ramesh', isDemo: true })}>
        <TodayView />
      </AuthProvider>
    );

    await act(async () => {
      fireEvent.click(document.getElementById('snooze-button') as HTMLButtonElement);
    });

    expect(document.getElementById('snooze-button')).toHaveTextContent(
      'Snooze limit reached (10 min delay active)'
    );
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
  });

  it('drives useReminderScheduler T+30m unconfirmed transition locally in TodayView with ZERO Firestore I/O', async () => {
    render(
      <AuthProvider value={makeAuthValue({ uid: 'patient_ramesh', isDemo: true })}>
        <TodayView />
      </AuthProvider>
    );

    expect(document.getElementById('snooze-button')).not.toBeDisabled();

    // Advance 25 minutes from 08:05 -> 08:30 (T+30m from 08:00 scheduled Metformin)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60_000);
    });

    // Metformin transitioned locally to 'unconfirmed', which disables snooze
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Metformin');
    expect(document.getElementById('snooze-button')).toBeDisabled();

    expect(mockGenerateTodayLogs).not.toHaveBeenCalled();
    expect(mockSubscribeToDoseLogs).not.toHaveBeenCalled();
    expect(mockGetDoseLog).not.toHaveBeenCalled();
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
  });

  it('preserves Firestore generation and subscription for non-demo authenticated users (isDemo: false)', () => {
    render(
      <AuthProvider value={makeAuthValue({ uid: 'real_patient_uid', isDemo: false })}>
        <TodayView />
      </AuthProvider>
    );

    expect(mockGenerateTodayLogs).toHaveBeenCalledWith('real_patient_uid');
    expect(mockSubscribeToDoseLogs).toHaveBeenCalledTimes(1);
    expect(mockSubscribeToDoseLogs.mock.calls[0][0]).toBe('real_patient_uid');
  });

  it('RACE A2: tapping Taken ✓ during TodayView 5s undo window while T+30m getDoseLog is in-flight prevents escalation overwrite', async () => {
    vi.setSystemTime(new Date(2026, 10, 25, 8, 29, 0, 0));

    let emitSnapshot: SnapshotCallback | null = null;
    mockSubscribeToDoseLogs.mockImplementation((_pid, _date, cb) => {
      emitSnapshot = cb;
      return vi.fn();
    });

    let resolveGetDose!: (doc: DoseLogDocument | null) => void;
    mockGetDoseLog.mockImplementation(
      () =>
        new Promise<DoseLogDocument | null>((resolve) => {
          resolveGetDose = resolve;
        })
    );

    const ts = Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0, 0));
    const dose: DoseLogDocument = {
      id: 'dose-tv-race',
      patientId: 'real_patient_uid',
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
    };

    render(
      <AuthProvider value={makeAuthValue({ uid: 'real_patient_uid', isDemo: false })}>
        <TodayView />
      </AuthProvider>
    );

    act(() => {
      emitSnapshot?.([dose]);
    });

    // Advance 60s to 08:30 so T+30m fires and awaits getDoseLog
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(mockGetDoseLog).toHaveBeenCalledWith('dose-tv-race');

    // User taps Taken ✓ while getDoseLog is still in-flight (starts 5s undo window; Firestore untouched)
    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });

    // Stale getDoseLog resolves with status: 'due'
    await act(async () => {
      resolveGetDose(dose);
      await Promise.resolve();
    });

    // Scheduler must NOT write { status: 'unconfirmed' }
    expect(mockUpdateDoseLog).not.toHaveBeenCalledWith('dose-tv-race', {
      status: 'unconfirmed',
    });

    // Let 5s undo window finish -> only { status: 'taken' } commits
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoseLog).toHaveBeenCalledWith(
      'dose-tv-race',
      expect.objectContaining({ status: 'taken' })
    );
  });

  it('runs local scheduler timers in isDemo: true even when firebaseUser is null with ZERO Firestore calls', async () => {
    render(
      <AuthProvider
        value={makeAuthValue({ uid: 'patient_ramesh', isDemo: true, nullFirebaseUser: true })}
      >
        <TodayView />
      </AuthProvider>
    );

    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Metformin');
    expect(document.getElementById('snooze-button')).not.toBeDisabled();

    // Advance 25m from 08:05 -> 08:30
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25 * 60_000);
    });

    expect(document.getElementById('snooze-button')).toBeDisabled();
    expect(mockGenerateTodayLogs).not.toHaveBeenCalled();
    expect(mockSubscribeToDoseLogs).not.toHaveBeenCalled();
    expect(mockGetDoseLog).not.toHaveBeenCalled();
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
  });

  it('escalates Undo past T+30m in active session while keeping initial late-hour demo Metformin snoozable', async () => {
    // (a) Active demo session crossing 08:30: Taken at 08:29:58, Undo at 08:30:01 -> escalates to unconfirmed
    vi.setSystemTime(new Date(2026, 10, 25, 8, 29, 58, 0));
    const { unmount } = render(
      <AuthProvider value={makeAuthValue({ uid: 'patient_ramesh', isDemo: true })}>
        <TodayView />
      </AuthProvider>
    );

    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    await act(async () => {
      fireEvent.click(document.getElementById('undo-toast-button') as HTMLButtonElement);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Metformin');
    expect(document.getElementById('snooze-button')).toBeDisabled();
    unmount();

    // (b) Initial late-hour demo mount at 14:00 keeps seeded Metformin snoozable
    vi.setSystemTime(new Date(2026, 10, 25, 14, 0, 0, 0));
    render(
      <AuthProvider value={makeAuthValue({ uid: 'patient_ramesh', isDemo: true })}>
        <TodayView />
      </AuthProvider>
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Metformin');
    expect(document.getElementById('snooze-button')).not.toBeDisabled();
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
  });
});
