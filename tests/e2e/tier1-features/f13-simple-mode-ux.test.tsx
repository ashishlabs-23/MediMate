import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { MockFirestoreDb, createDoseLogFixture, seedPatientCareCircleScenario, type FirestoreRecord } from '@harness/index';
import {
  PROJECT_ROOT,
  createMockFirestoreAdapter,
  hasProjectFile,
  loadOptionalModule,
  localTodayISO,
  makeAuthValue,
  stubAudioContext,
} from '@harness/reactTestHelper';
import type { DoseLogDocument } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'patient_ramesh', role: 'elderly' as const };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);
const updateDoseLogSpy = vi.fn(bridge.updateDoseLog);

vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: {},
  db: {},
  getMessagingInstance: vi.fn(async () => null),
  VAPID_KEY: undefined,
}));

vi.mock('@/lib/firestore', () => ({
  subscribeToDoseLogs: (...args: Parameters<typeof bridge.subscribeToDoseLogs>) =>
    bridge.subscribeToDoseLogs(...args),
  updateDoseLog: (...args: Parameters<typeof bridge.updateDoseLog>) =>
    updateDoseLogSpy(...args),
  getDoseLog: vi.fn(async () => null),
  getUserDocument: vi.fn(async () => null),
  upsertUserDocument: vi.fn(async () => {}),
  subscribeToCareCircle: vi.fn((_id: string, cb: (c: null) => void) => {
    cb(null);
    return () => {};
  }),
  getActiveMedications: vi.fn(async () => []),
  getMedications: vi.fn(async () => []),
  subscribeToMedications: vi.fn((_id: string, cb: (m: never[]) => void) => {
    cb([]);
    return () => {};
  }),
  getDoseLogsForDateRange: vi.fn(async () => []),
  createMedication: vi.fn(async () => ({})),
  updateMedication: vi.fn(async () => {}),
  setMedicationActive: vi.fn(async () => {}),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: vi.fn(async () => 0),
}));

vi.mock('@/hooks/useReminderScheduler', () => ({
  useReminderScheduler: vi.fn(),
}));

import { TodayView } from '@/pages/TodayView';

const hasMeals =
  hasProjectFile('src/domain/meals.ts') &&
  hasProjectFile('src/components/dose/MealBadge.tsx');
const hasSound = hasProjectFile('src/lib/sound.ts');
const hasM3Undo =
  hasProjectFile('tests/unit/todayViewUndo.test.tsx') ||
  fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/TodayView.tsx'), 'utf-8').includes('Undo');

function renderTodayView() {
  return render(
    <MemoryRouter>
      <AuthProvider value={makeAuthValue({ authenticated: true, role: 'elderly' })}>
        <TodayView />
      </AuthProvider>
    </MemoryRouter>
  );
}

function seedDueBreakfastDose(dateStr: string): string {
  const { doseLog } = seedPatientCareCircleScenario(mockDb, { doseStatus: 'due' });
  const [y, m, d] = dateStr.split('-').map(Number);
  const doseId = `patient_ramesh_med_metformin_${dateStr}_0800`;
  mockDb.seedDoc('dose_logs', doseId, {
    ...doseLog,
    id: doseId,
    scheduledDate: dateStr,
    scheduledTime: new Date(y, m - 1, d, 8, 0, 0),
    status: 'due',
  });
  return doseId;
}

describe('Tier 1 — F13: Elderly Simple Mode UX & Multi-Sensory Safety (R3)', () => {
  let audioStub: ReturnType<typeof stubAudioContext> | null = null;

  beforeEach(() => {
    mockDb.clearAll();
    currentActor = { uid: 'patient_ramesh', role: 'elderly' };
    updateDoseLogSpy.mockClear();
  });

  afterEach(() => {
    audioStub?.restore();
    audioStub = null;
  });

  it.runIf(hasM3Undo)(
    'T1-F13-01: Tapping Taken ✓ in real <TodayView /> renders a 5-second Undo Toast with accessible status role and Undo button',
    () => {
      vi.useFakeTimers();
      audioStub = stubAudioContext();
      const today = localTodayISO();
      seedDueBreakfastDose(today);

      renderTodayView();

      const takenBtn = screen.getByRole('button', { name: /mark metformin as taken/i });
      fireEvent.click(takenBtn);

      const undoBtn = screen.getByRole('button', { name: /undo/i });
      expect(undoBtn).toBeInTheDocument();
      const toastContainer = undoBtn.closest('[role="status"], [aria-live]');
      expect(toastContainer).not.toBeNull();
    }
  );

  it.runIf(hasM3Undo)(
    'T1-F13-02: Clicking Undo within 5 seconds reverts dose back to due without calling updateDoseLog (respects firestore.rules taken-lock)',
    async () => {
      vi.useFakeTimers();
      audioStub = stubAudioContext();
      const today = localTodayISO();
      const doseId = seedDueBreakfastDose(today);

      renderTodayView();

      fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });

      expect(updateDoseLogSpy).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: /undo/i }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(updateDoseLogSpy).not.toHaveBeenCalled();
      expect(mockDb.inspectDoc<DoseLogDocument & FirestoreRecord>('dose_logs', doseId)?.status).toBe('due');
      expect(screen.getByRole('button', { name: /mark metformin as taken/i })).not.toBeDisabled();
    }
  );

  it.runIf(hasM3Undo)(
    'T1-F13-03: Letting the 5-second grace window elapse commits updateDoseLog with status: taken',
    async () => {
      vi.useFakeTimers();
      audioStub = stubAudioContext();
      const today = localTodayISO();
      const doseId = seedDueBreakfastDose(today);

      renderTodayView();

      fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
      expect(updateDoseLogSpy).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      expect(updateDoseLogSpy).toHaveBeenCalledTimes(1);
      expect(updateDoseLogSpy.mock.calls[0][0]).toBe(doseId);
      expect(updateDoseLogSpy.mock.calls[0][1]).toMatchObject({ status: 'taken' });
      expect(mockDb.inspectDoc<DoseLogDocument & FirestoreRecord>('dose_logs', doseId)?.status).toBe('taken');
    }
  );

  it.runIf(hasMeals)(
    'T1-F13-04: Meal Association Badges render Breakfast (08:00), Lunch (14:00), Dinner (19:30), and Bedtime (22:00) with icon + label',
    async () => {
      const mealBadgeMod = await loadOptionalModule<{
        MealBadge: React.ComponentType<{ scheduledTime: Date }>;
      }>('src/components/dose/MealBadge.tsx');
      const { MealBadge } = mealBadgeMod;

      const samples = [
        { hour: 8, min: 0, label: 'Breakfast', emoji: '🥣' },
        { hour: 14, min: 0, label: 'Lunch', emoji: '🥗' },
        { hour: 19, min: 30, label: 'Dinner', emoji: '🍽️' },
        { hour: 22, min: 0, label: 'Bedtime', emoji: '🌙' },
      ];

      const { unmount } = render(
        <div>
          {samples.map((s) => (
            <MealBadge
              key={s.label}
              scheduledTime={new Date(2026, 10, 25, s.hour, s.min, 0)}
            />
          ))}
        </div>
      );

      for (const s of samples) {
        expect(screen.getByText(s.label)).toBeInTheDocument();
        expect(screen.getByText(s.emoji)).toBeInTheDocument();
      }
      unmount();

      // Also verify createDoseLogFixture integration produces valid scheduledTime
      const fixture = createDoseLogFixture({ scheduledTime: new Date(2026, 10, 25, 8, 0, 0) });
      render(<MealBadge scheduledTime={new Date(fixture.scheduledTime)} />);
      expect(screen.getByText('Breakfast')).toBeInTheDocument();
    }
  );

  it.runIf(hasSound)(
    'T1-F13-05: playConfirmationChime() synthesizes gentle 440Hz -> 520Hz sine tones via Web Audio API',
    async () => {
      audioStub = stubAudioContext();
      const soundMod = await loadOptionalModule<{
        playConfirmationChime: () => void;
      }>('src/lib/sound.ts');

      soundMod.playConfirmationChime();

      expect(audioStub.constructCount).toBe(1);
      expect(audioStub.oscillators).toHaveLength(2);
      expect(audioStub.oscillators[0].type).toBe('sine');
      expect(audioStub.oscillators[1].type).toBe('sine');
      expect(audioStub.oscillators[0].frequencies.some((f) => f.value === 440)).toBe(true);
      expect(audioStub.oscillators[1].frequencies.some((f) => f.value === 520)).toBe(true);

      if (hasM3Undo) {
        vi.useFakeTimers();
        const today = localTodayISO();
        seedDueBreakfastDose(today);
        renderTodayView();
        fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
        expect(audioStub.constructCount).toBe(2);
      }
    }
  );
});
