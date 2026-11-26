import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario, type FirestoreRecord } from '@harness/index';
import {
  PROJECT_ROOT,
  createBeforeInstallPromptEvent,
  createMockFirestoreAdapter,
  hasProjectFile,
  loadOptionalModule,
  localTodayISO,
  makeAuthValue,
  stubMatchMedia,
} from '@harness/reactTestHelper';
import type { DoseLogDocument, MedicationDocument } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'caregiver_priya', role: 'caregiver' as const };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);

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
  subscribeToCareCircle: (...args: Parameters<typeof bridge.subscribeToCareCircle>) =>
    bridge.subscribeToCareCircle(...args),
  updateDoseLog: (...args: Parameters<typeof bridge.updateDoseLog>) =>
    bridge.updateDoseLog(...args),
  getMedications: (...args: Parameters<typeof bridge.getMedications>) =>
    bridge.getMedications(...args),
  subscribeToMedications: (...args: Parameters<typeof bridge.subscribeToMedications>) =>
    bridge.subscribeToMedications(...args),
  createMedication: (...args: Parameters<typeof bridge.createMedication>) =>
    bridge.createMedication(...args),
  updateMedication: (...args: Parameters<typeof bridge.updateMedication>) =>
    bridge.updateMedication(...args),
  setMedicationActive: (...args: Parameters<typeof bridge.setMedicationActive>) =>
    bridge.setMedicationActive(...args),
  getDoseLogsForDateRange: (...args: Parameters<typeof bridge.getDoseLogsForDateRange>) =>
    bridge.getDoseLogsForDateRange(...args),
  getActiveMedications: vi.fn(async () => []),
  getDoseLog: vi.fn(async () => null),
  getUserDocument: vi.fn(async () => null),
  upsertUserDocument: vi.fn(async () => {}),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: (...args: Parameters<typeof bridge.generateTodayLogsForMedication>) =>
    bridge.generateTodayLogsForMedication(...args),
}));

import { CaregiverDashboard } from '@/pages/CaregiverDashboard';

const hasAddMedModal = hasProjectFile('src/components/caregiver/AddMedicationModal.tsx');
const hasAdherenceHistory = hasProjectFile('src/components/caregiver/AdherenceHistory.tsx');
const hasInstallBanner = hasProjectFile('src/components/pwa/InstallPromptBanner.tsx');
const hasM4Dashboard =
  hasAddMedModal &&
  hasAdherenceHistory &&
  fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/CaregiverDashboard.tsx'), 'utf-8').includes('AddMedicationModal');
const hasM4OfflinePersistence =
  fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/lib/firebase.ts'), 'utf-8').includes('persistentLocalCache');

describe('Tier 1 — F14: Prescription CRUD, 7-Day Adherence History & Offline PWA (R4)', () => {
  let restoreMatchMedia: (() => void) | null = null;

  beforeEach(() => {
    mockDb.clearAll();
    currentActor = { uid: 'caregiver_priya', role: 'caregiver' };
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    seedPatientCareCircleScenario(mockDb, { doseStatus: 'due' });
  });

  afterEach(() => {
    restoreMatchMedia?.();
    restoreMatchMedia = null;
  });

  it.runIf(hasM4Dashboard)(
    'T1-F14-01: Caregiver opens + Add Medication wizard, submits prescription, persists to /medications and generates today log',
    async () => {
      render(
        <MemoryRouter>
          <AuthProvider value={makeAuthValue({ authenticated: true, role: 'caregiver' })}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      const addBtn = screen.getByRole('button', { name: /\+?\s*add medication/i });
      fireEvent.click(addBtn);

      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAttribute('aria-modal', 'true');

      fireEvent.change(within(dialog).getByLabelText(/medication name/i), {
        target: { value: 'Vitamin D3' },
      });
      fireEvent.change(within(dialog).getByLabelText(/dosage/i), {
        target: { value: '1000 IU' },
      });
      const instructionsInput = within(dialog).queryByLabelText(/instructions/i);
      if (instructionsInput) {
        fireEvent.change(instructionsInput, {
          target: { value: 'Take after lunch' },
        });
      }

      const timeInputs = dialog.querySelectorAll('input[type="time"]');
      if (timeInputs.length > 0) {
        fireEvent.change(timeInputs[0], { target: { value: '13:30' } });
      }

      const submitBtn = within(dialog).getByRole('button', { name: /save|add medication/i });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        const meds = mockDb.inspectCollection<MedicationDocument & FirestoreRecord>('medications');
        expect(meds.some((m) => m.name === 'Vitamin D3' && m.dosage === '1000 IU')).toBe(true);
      });

      const logs = mockDb.inspectCollection<DoseLogDocument & FirestoreRecord>('dose_logs');
      expect(logs.some((l) => l.medicationName === 'Vitamin D3')).toBe(true);
    }
  );

  it.runIf(hasM4Dashboard)(
    'T1-F14-02: Caregiver edits an existing prescription via pre-populated modal',
    async () => {
      render(
        <MemoryRouter>
          <AuthProvider value={makeAuthValue({ authenticated: true, role: 'caregiver' })}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      const editBtn = await screen.findByRole('button', { name: /edit.*metformin|edit/i });
      fireEvent.click(editBtn);

      const dialog = screen.getByRole('dialog');
      const dosageInput = within(dialog).getByLabelText(/dosage/i) as HTMLInputElement;
      expect(dosageInput.value).toContain('500');

      fireEvent.change(dosageInput, { target: { value: '850 mg' } });
      fireEvent.click(within(dialog).getByRole('button', { name: /save|update/i }));

      await waitFor(() => {
        const updated = mockDb.inspectDoc<MedicationDocument & FirestoreRecord>('medications', 'med_metformin');
        expect(updated?.dosage).toBe('850 mg');
      });
    }
  );

  it.runIf(hasM4Dashboard)(
    'T1-F14-03: Caregiver pauses (active: false) and resumes (active: true) a prescription without deleting history',
    async () => {
      render(
        <MemoryRouter>
          <AuthProvider value={makeAuthValue({ authenticated: true, role: 'caregiver' })}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      const pauseBtn = await screen.findByRole('button', { name: /pause.*metformin|pause/i });
      fireEvent.click(pauseBtn);

      await waitFor(() => {
        const med = mockDb.inspectDoc<MedicationDocument & FirestoreRecord>('medications', 'med_metformin');
        expect(med?.active).toBe(false);
      });

      const resumeBtn = await screen.findByRole('button', { name: /resume.*metformin|resume/i });
      fireEvent.click(resumeBtn);

      await waitFor(() => {
        const med = mockDb.inspectDoc<MedicationDocument & FirestoreRecord>('medications', 'med_metformin');
        expect(med?.active).toBe(true);
      });
    }
  );

  it.runIf(hasAdherenceHistory)(
    'T1-F14-04: AdherenceHistory renders 7-day record-completion overview with non-medical-judgement framing',
    async () => {
      const mod = await loadOptionalModule<{
        AdherenceHistory: React.ComponentType<{
          patientId?: string;
          doses?: DoseLogDocument[];
        }>;
      }>('src/components/caregiver/AdherenceHistory.tsx');
      const { AdherenceHistory } = mod;

      render(
        <MemoryRouter>
          <AuthProvider value={makeAuthValue({ authenticated: true, role: 'caregiver' })}>
            <AdherenceHistory patientId="patient_ramesh" />
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText(/7-day|last 7 days|record completion/i)).toBeInTheDocument();
      });

      expect(screen.getByText(/not a medical judgement|record completion/i)).toBeInTheDocument();
    }
  );

  it.runIf(hasM4OfflinePersistence)(
    'T1-F14-05: firebase.ts configures persistentLocalCache with safe fallback in jsdom without throwing',
    async () => {
      const source = fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/lib/firebase.ts'), 'utf-8');
      expect(source).toContain('persistentLocalCache');
      expect(source).toContain('persistentMultipleTabManager');
      expect(source).toContain('getFirestore');

      // Also verify importing real firebase module in jsdom does not throw
      const actualFirebase = await vi.importActual<Record<string, unknown>>('@/lib/firebase');
      expect(actualFirebase.firebaseApp).toBeDefined();
      expect(actualFirebase.db).toBeDefined();
    }
  );

  it.runIf(hasInstallBanner)(
    'T1-F14-06: InstallPromptBanner captures beforeinstallprompt, displays Install App & Dismiss, and invokes prompt() on click',
    async () => {
      restoreMatchMedia = stubMatchMedia(false);
      const mod = await loadOptionalModule<{
        InstallPromptBanner: React.ComponentType;
      }>('src/components/pwa/InstallPromptBanner.tsx');
      const { InstallPromptBanner } = mod;

      render(<InstallPromptBanner />);
      const { event, promptSpy } = createBeforeInstallPromptEvent('accepted');

      act(() => {
        window.dispatchEvent(event);
      });

      const installBtn = await screen.findByRole('button', { name: /install/i });
      expect(screen.getByRole('button', { name: /dismiss|not now|close/i })).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(installBtn);
      });

      expect(promptSpy).toHaveBeenCalledTimes(1);
    }
  );
});
