import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
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
}));

vi.mock('../../src/lib/generateTodayLogs', () => ({
  generateTodayLogs: (patientId: string) => mockGenerateTodayLogs(patientId),
}));

vi.mock('../../src/lib/sound', () => ({
  playConfirmationChime: () => mockPlayConfirmationChime(),
}));

vi.mock('../../src/hooks/useReminderScheduler', () => ({
  useReminderScheduler: vi.fn(),
}));

vi.mock('../../src/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div data-testid="app-shell">{children}</div>,
}));

function makeDose(overrides?: Partial<DoseLogDocument>): DoseLogDocument {
  const now = new Date(2026, 10, 25, 8, 0, 0, 0);
  const ts = Timestamp.fromDate(now);
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
    followUpSent: false,
    escalationAlertSent: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function makeAuthValue(options?: {
  uid?: string;
  soundEnabled?: boolean;
}): AuthContextValue {
  const uid = options?.uid ?? 'patient-1';
  const ts = Timestamp.fromDate(new Date(2026, 10, 25, 0, 0, 0));
  const userProfile: UserDocument = {
    uid,
    email: `${uid}@medimate.local`,
    displayName: 'Ramesh Sharma',
    role: 'elderly',
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: options?.soundEnabled ?? true,
    },
    createdAt: ts,
    updatedAt: ts,
  };

  return {
    firebaseUser: { uid } as unknown as User,
    userProfile,
    isLoading: false,
    signOut: vi.fn().mockResolvedValue(undefined),
  };
}

function renderTodayView(authOptions?: { uid?: string; soundEnabled?: boolean }) {
  let latestCallback: SnapshotCallback | null = null;
  mockSubscribeToDoseLogs.mockImplementation((_pid, _date, cb) => {
    latestCallback = cb;
    return vi.fn();
  });
  mockUpdateDoseLog.mockResolvedValue(undefined);
  mockGenerateTodayLogs.mockResolvedValue(0);

  const view = render(
    <AuthProvider value={makeAuthValue(authOptions)}>
      <TodayView />
    </AuthProvider>
  );

  return {
    ...view,
    emitSnapshot: (doses: DoseLogDocument[]) => {
      act(() => {
        latestCallback?.(doses);
      });
    },
  };
}

describe('TodayView 5-second Undo Toast & Chime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 25, 8, 5, 0, 0));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('optimistically marks taken, plays chime, shows accessible Undo Toast, and defers Firestore write for 5000ms', () => {
    const { emitSnapshot } = renderTodayView();
    emitSnapshot([makeDose({ id: 'dose-1', medicationName: 'Metformin', status: 'due' })]);

    const takenBtn = document.getElementById('taken-button') as HTMLButtonElement;
    act(() => {
      fireEvent.click(takenBtn);
    });

    expect(mockPlayConfirmationChime).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();

    const toast = document.getElementById('undo-toast');
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveAttribute('role', 'status');
    expect(toast).toHaveAttribute('aria-live', 'polite');
    expect(toast).toHaveAttribute('aria-atomic', 'true');
    expect(toast).toHaveTextContent('Metformin');

    const undoBtn = document.getElementById('undo-toast-button') as HTMLButtonElement;
    expect(undoBtn).toBeInTheDocument();
    expect(undoBtn.style.minHeight).toBe('44px');
    expect(undoBtn.style.minWidth).toBe('44px');

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();
    expect(document.getElementById('undo-toast')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(document.getElementById('undo-toast')).not.toBeInTheDocument();
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoseLog).toHaveBeenCalledWith(
      'dose-1',
      expect.objectContaining({
        status: 'taken',
        takenBy: 'patient-1',
        snoozeUntil: null,
      })
    );
  });

  it('reverts due, unconfirmed, and snoozed doses cleanly on Undo with zero Firestore writes', () => {
    const snoozeUntilTs = Timestamp.fromDate(new Date(2026, 10, 25, 8, 15, 0, 0));
    const statuses: Array<Pick<DoseLogDocument, 'status' | 'snoozeCount' | 'snoozeUntil'>> = [
      { status: 'due', snoozeCount: 0, snoozeUntil: null },
      { status: 'unconfirmed', snoozeCount: 0, snoozeUntil: null },
      { status: 'snoozed', snoozeCount: 1, snoozeUntil: snoozeUntilTs },
    ];

    for (const state of statuses) {
      const { emitSnapshot, unmount } = renderTodayView();
      emitSnapshot([
        makeDose({
          id: 'dose-revert',
          medicationName: 'Amlodipine',
          status: state.status,
          snoozeCount: state.snoozeCount,
          snoozeUntil: state.snoozeUntil,
        }),
      ]);

      act(() => {
        fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
      });
      expect(document.getElementById('undo-toast')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
        fireEvent.click(document.getElementById('undo-toast-button') as HTMLButtonElement);
      });

      expect(document.getElementById('undo-toast')).not.toBeInTheDocument();
      const restoredBtn = document.getElementById('taken-button') as HTMLButtonElement;
      expect(restoredBtn).toHaveTextContent('Taken ✓');
      expect(restoredBtn).not.toBeDisabled();
      expect(document.getElementById('dose-live-region')).toHaveTextContent(
        `Undid Amlodipine confirmation. Restored to ${state.status}.`
      );

      if (state.status === 'snoozed') {
        expect(document.getElementById('snooze-button')).toHaveTextContent(
          'Snooze limit reached (10 min delay active)'
        );
      }

      act(() => {
        vi.advanceTimersByTime(10000);
      });
      expect(mockUpdateDoseLog).not.toHaveBeenCalled();

      unmount();
      vi.clearAllMocks();
    }
  });

  it('immediately flushes the first pending dose when confirming a second dose, without leaking justTaken text', () => {
    const { emitSnapshot } = renderTodayView();
    emitSnapshot([
      makeDose({ id: 'dose-1', medicationName: 'Metformin', status: 'due' }),
      makeDose({ id: 'dose-2', medicationName: 'Lisinopril', status: 'due' }),
    ]);

    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });

    // Next Medication immediately switches to Lisinopril and must NOT show "Recorded! Good job."
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Lisinopril');
    expect(document.getElementById('taken-button')).toHaveTextContent('Taken ✓');
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1500);
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });

    // Dose 1 flushed immediately; Dose 2 waits its own 5000ms window
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoseLog).toHaveBeenCalledWith(
      'dose-1',
      expect.objectContaining({ status: 'taken' })
    );
    expect(document.getElementById('undo-toast')).toHaveTextContent('Lisinopril');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(2);
    expect(mockUpdateDoseLog).toHaveBeenLastCalledWith(
      'dose-2',
      expect.objectContaining({ status: 'taken' })
    );
  });

  it('preserves optimistic taken state when subscribeToDoseLogs emits during the 5s undo window', () => {
    const { emitSnapshot } = renderTodayView();
    const dose1 = makeDose({ id: 'dose-1', medicationName: 'Metformin', status: 'due' });
    const dose2 = makeDose({ id: 'dose-2', medicationName: 'Atorvastatin', status: 'scheduled' });
    emitSnapshot([dose1, dose2]);

    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Atorvastatin');

    // Firestore snapshot arrives with dose-1 still marked 'due'
    emitSnapshot([dose1, dose2]);

    // Dose 1 remains optimistically taken and Undo Toast remains visible
    expect(document.getElementById('dose-medication-name')).toHaveTextContent('Atorvastatin');
    expect(document.getElementById('undo-toast')).toBeInTheDocument();
  });

  it('flushes pending commit on unmount and beforeunload without double-committing', () => {
    const { emitSnapshot, unmount } = renderTodayView();
    emitSnapshot([makeDose({ id: 'dose-1', status: 'due' })]);

    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });
    expect(mockUpdateDoseLog).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new Event('beforeunload'));
    });
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockUpdateDoseLog).toHaveBeenCalledTimes(1);
  });

  it('does not play confirmation chime when userProfile.accessibilityPreferences.soundEnabled is false', () => {
    const { emitSnapshot } = renderTodayView({ soundEnabled: false });
    emitSnapshot([makeDose({ id: 'dose-1', status: 'due' })]);

    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });

    expect(mockPlayConfirmationChime).not.toHaveBeenCalled();
    expect(document.getElementById('undo-toast')).toBeInTheDocument();
  });

  it('supports demo patient_ramesh fallback without overwriting optimistic taken state', () => {
    const { emitSnapshot } = renderTodayView({ uid: 'patient_ramesh' });
    emitSnapshot([]);

    expect(document.getElementById('next-dose-card')).toBeInTheDocument();
    const firstMedName = document.getElementById('dose-medication-name')?.textContent ?? '';
    expect(firstMedName.length).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(document.getElementById('taken-button') as HTMLButtonElement);
    });
    expect(document.getElementById('undo-toast')).toHaveTextContent(firstMedName);

    // Re-emitting empty snapshot during undo window preserves optimistic state
    emitSnapshot([]);
    expect(document.getElementById('undo-toast')).toHaveTextContent(firstMedName);
    expect(document.getElementById('dose-medication-name')?.textContent).not.toBe(firstMedName);
  });
});
