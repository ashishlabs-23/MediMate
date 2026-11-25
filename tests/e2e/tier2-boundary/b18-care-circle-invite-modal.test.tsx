import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario, type FirestoreRecord } from '@harness/index';
import {
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
    if (!existing) {
      throw new Error(`Care circle ${patientId} not found`);
    }
    const existingMembers = Array.isArray(existing.members) ? existing.members : [];
    mockDb.updateDoc(
      'care_circles',
      patientId,
      {
        members: [...existingMembers, member],
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

function renderCaregiverDashboard(uid = 'caregiver_priya') {
  const base = makeAuthValue({
    authenticated: true,
    role: 'caregiver',
    uid,
    displayName: uid === 'caregiver_priya' ? 'Priya Sharma' : 'Secondary Caregiver',
  });
  const value: Phase4AuthValue = {
    ...base,
    userProfile: makeUserProfile('caregiver', {
      uid,
      displayName: uid === 'caregiver_priya' ? 'Priya Sharma' : 'Secondary Caregiver',
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

describe('Tier 2 — B18: Care Circle Invite Modal Boundaries & Negative Paths (Phase 4D)', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let origClipboardDescriptor: PropertyDescriptor | undefined;
  let origExecCommandDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    mockDb.clearAll();
    currentActor = { uid: 'caregiver_priya', role: 'caregiver' };
    inviteCareCircleMemberSpy.mockClear();
    seedPatientCareCircleScenario(mockDb, { doseStatus: 'due' });

    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    origClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    origExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (origClipboardDescriptor) {
      Object.defineProperty(navigator, 'clipboard', origClipboardDescriptor);
    } else {
      delete (navigator as unknown as Record<string, unknown>).clipboard;
    }
    if (origExecCommandDescriptor) {
      Object.defineProperty(document, 'execCommand', origExecCommandDescriptor);
    } else {
      delete (document as unknown as Record<string, unknown>).execCommand;
    }
    localStorage.clear();
  });

  it('T2-B18-01: Rejects empty, whitespace-only, and malformed emails with accessible error feedback and zero alert()', async () => {
    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');
    const emailInput = within(dialog).getByLabelText(/email/i);
    const submitBtn = within(dialog).getByRole('button', { name: /send.*invite|invite/i });

    for (const badEmail of ['', '   ', 'not-an-email', 'missing@domain']) {
      fireEvent.change(emailInput, { target: { value: badEmail } });
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(inviteCareCircleMemberSpy).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();

      const errorEl =
        within(dialog).queryByRole('alert') ??
        (emailInput.getAttribute('aria-invalid') === 'true' ? emailInput : null);
      expect(errorEl).not.toBeNull();
    }
  });

  it('T2-B18-02: Rejects duplicate email already present in Care Circle members (case-insensitive)', async () => {
    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');
    const emailInput = within(dialog).getByLabelText(/email/i);
    const submitBtn = within(dialog).getByRole('button', { name: /send.*invite|invite/i });

    fireEvent.change(emailInput, { target: { value: 'CAREGIVER_PRIYA@medimate.test' } });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    expect(inviteCareCircleMemberSpy).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();
  });

  it('T2-B18-03: Falls back to document.execCommand("copy") when navigator.clipboard.writeText fails or is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('Clipboard permission denied');
        }),
      },
    });
    const execCommandSpy = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandSpy,
    });

    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /copy/i }));
    });

    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(alertSpy).not.toHaveBeenCalled();
    const status =
      within(dialog).queryByRole('status') ?? dialog.querySelector('[aria-live="polite"]');
    expect(status).not.toBeNull();
  });

  it('T2-B18-04: Falls back to MED-7892 when careCircle.inviteCode is missing and closes cleanly on Escape', () => {
    const circle = {
      ...mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', 'patient_ramesh')!,
    };
    delete circle.inviteCode;
    mockDb.seedDoc('care_circles', 'patient_ramesh', circle);

    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/MED-7892/)).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('T2-B18-05: Secondary caregiver attempting to invite a member hits Firestore permission error gracefully without alert()', async () => {
    const circle = mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', 'patient_ramesh')!;
    mockDb.seedDoc('care_circles', 'patient_ramesh', {
      ...circle,
      caregiverIds: ['caregiver_priya', 'caregiver_secondary'],
      members: [
        ...circle.members,
        {
          userId: 'caregiver_secondary',
          displayName: 'Secondary Caregiver',
          email: 'secondary@medimate.test',
          role: 'secondary',
          permissions: ['read'],
          status: 'active',
          invitedAt: circle.createdAt,
        },
      ],
    });

    currentActor = { uid: 'caregiver_secondary', role: 'caregiver' };
    renderCaregiverDashboard('caregiver_secondary');

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: 'unauthorized.invite@example.com' },
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite|invite/i }));
    });

    await waitFor(() => {
      expect(inviteCareCircleMemberSpy).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toBeInTheDocument();

    const persisted = mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', 'patient_ramesh')!;
    expect(persisted.members.some((m) => m.email === 'unauthorized.invite@example.com')).toBe(false);
  });
});
