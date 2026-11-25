import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario, type FirestoreRecord } from '@harness/index';
import {
  PROJECT_ROOT,
  createMockFirestoreAdapter,
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
} from '@harness/reactTestHelper';
import type {
  AccessibilityPreferences,
  CareCircleDocument,
  CareCircleMember,
  UserRole,
} from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'caregiver_priya', role: 'caregiver' as UserRole };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);

const inviteCareCircleMemberSpy = vi.fn(
  async (patientId: string, member: CareCircleMember) => {
    const existing = mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', patientId);
    if (!existing) throw new Error('Care circle not found');
    mockDb.updateDoc(
      'care_circles',
      patientId,
      {
        members: [...(existing.members ?? []), member],
        updatedAt: new Date(),
      },
      currentActor
    );
  }
);

vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: {},
  db: {},
  getMessagingInstance: vi.fn(async () => null),
  VAPID_KEY: undefined,
}));

vi.mock('@/lib/firestore', () => ({
  usersCol: vi.fn(),
  careCirclesCol: vi.fn(),
  medicationsCol: vi.fn(),
  doseLogsCol: vi.fn(),
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
  getCareCircle: vi.fn(async () => null),
  updateUserAccessibilityPreferences: vi.fn(async () => {}),
  inviteCareCircleMember: (patientId: string, member: CareCircleMember) =>
    inviteCareCircleMemberSpy(patientId, member),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: (...args: Parameters<typeof bridge.generateTodayLogsForMedication>) =>
    bridge.generateTodayLogsForMedication(...args),
}));

import { CaregiverDashboard } from '@/pages/CaregiverDashboard';

type Phase4AuthValue = AuthContextValue & {
  isDemo?: boolean;
  updateAccessibilityPreferences?: (patch: Partial<AccessibilityPreferences>) => Promise<void>;
};

function renderCaregiverDashboard() {
  const base = makeAuthValue({
    authenticated: true,
    role: 'caregiver',
    uid: 'caregiver_priya',
    displayName: 'Priya Sharma',
  });
  const value: Phase4AuthValue = {
    ...base,
    userProfile: makeUserProfile('caregiver', {
      uid: 'caregiver_priya',
      displayName: 'Priya Sharma',
    }),
    isDemo: false,
    updateAccessibilityPreferences: vi.fn(async () => {}),
  };
  return render(
    <MemoryRouter>
      <AuthProvider value={value}>
        <CaregiverDashboard />
      </AuthProvider>
    </MemoryRouter>
  );
}

describe('Tier 4 — Scenario 08: Care Circle Invite & Onboarding Journey', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let origClipboardDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    mockDb.clearAll();
    currentActor = { uid: 'caregiver_priya', role: 'caregiver' };
    inviteCareCircleMemberSpy.mockClear();
    seedPatientCareCircleScenario(mockDb, { doseStatus: 'due' });
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    origClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (origClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', origClipboardDescriptor);
    } else {
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
    localStorage.clear();
  });

  it('T4-S08-01: Primary caregiver copies invite code, sends secondary caregiver email invite, and sees persisted invited member + mailto handoff', async () => {
    const writeTextSpy = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });

    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');
    expect(alertSpy).not.toHaveBeenCalled();

    // Step 1: Copy invite code
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /copy/i }));
    });
    expect(writeTextSpy).toHaveBeenCalledWith('MED123');
    const liveStatus =
      within(dialog).queryByRole('status') ?? dialog.querySelector('[aria-live="polite"]');
    expect(liveStatus).not.toBeNull();

    // Step 2: Fill & submit email invite
    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: 'rohan.sharma@example.com' },
    });
    const nameInput = within(dialog).queryByLabelText(/name/i);
    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'Rohan Sharma' } });
    }

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite|invite/i }));
    });

    await waitFor(() => {
      expect(inviteCareCircleMemberSpy).toHaveBeenCalledTimes(1);
    });

    // Step 3: Verify mailto handoff, MockFirestoreDb persistence, and Care Circle UI list
    const mailtoLink = within(dialog)
      .getAllByRole('link')
      .find((a) => (a.getAttribute('href') ?? '').startsWith('mailto:'));
    expect(mailtoLink).toBeDefined();
    expect(mailtoLink!.getAttribute('href')).toContain('rohan.sharma@example.com');

    const persistedCircle = mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', 'patient_ramesh')!;
    expect(
      persistedCircle.members.some(
        (m) => m.email === 'rohan.sharma@example.com' && m.status === 'invited'
      )
    ).toBe(true);

    const circleCard = document.getElementById('care-circle-members') ?? document.body;
    expect(within(circleCard).getByText(/rohan\.sharma@example\.com|Rohan Sharma/i)).toBeInTheDocument();
    expect(within(circleCard).getByText(/invited/i)).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('T4-S08-02: Caregiver recovers from invalid email validation error to successfully invite a family member and close modal', async () => {
    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');
    const emailInput = within(dialog).getByLabelText(/email/i);
    const submitBtn = within(dialog).getByRole('button', { name: /send.*invite|invite/i });

    // Invalid attempt
    fireEvent.change(emailInput, { target: { value: 'bad-email' } });
    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
    expect(inviteCareCircleMemberSpy).not.toHaveBeenCalled();

    // Corrected attempt
    fireEvent.change(emailInput, { target: { value: 'meera.sharma@example.com' } });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(inviteCareCircleMemberSpy).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(within(dialog).getByRole('button', { name: /close|done|cancel/i }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('T4-S08-03: Caregiver dashboard onboarding pairs with valid PWA manifest & branded PNG installability assets', () => {
    renderCaregiverDashboard();
    expect(
      screen.getByRole('heading', { level: 1, name: /caregiver dashboard/i })
    ).toBeInTheDocument();

    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(PROJECT_ROOT, 'public/manifest.json'), 'utf-8')
    ) as {
      start_url: string;
      display: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.start_url).toBe('/app/today');
    expect(manifest.display).toBe('standalone');

    const html = fs.readFileSync(path.resolve(PROJECT_ROOT, 'index.html'), 'utf-8');
    expect(html).toContain('/manifest.json');
    expect(html).toContain('apple-touch-icon.png');

    for (const rel of [
      'public/icons/icon-192.png',
      'public/icons/icon-512.png',
      'public/icons/apple-touch-icon.png',
    ]) {
      const buf = fs.readFileSync(path.resolve(PROJECT_ROOT, rel));
      expect(buf.length, `${rel} must not be a placeholder`).toBeGreaterThan(500);
    }
  });
});
