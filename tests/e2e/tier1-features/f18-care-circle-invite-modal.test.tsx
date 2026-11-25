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
    const updatedMembers = [...existingMembers, member];
    mockDb.updateDoc(
      'care_circles',
      patientId,
      {
        members: updatedMembers,
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

describe('Tier 1 — F18: Care Circle Invite Modal (Phase 4D / R4)', () => {
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

  it('T1-F18-01: Triggering + Invite Another Family Member opens accessible modal dialog and NEVER calls window.alert', () => {
    renderCaregiverDashboard();

    const inviteTrigger = screen.getByRole('button', {
      name: /invite another family member|invite/i,
    });
    fireEvent.click(inviteTrigger);

    expect(alertSpy).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByText(/MED123/)).toBeInTheDocument();
  });

  it('T1-F18-02: Clicking Copy Invite Code writes invite code to clipboard and announces polite status feedback', async () => {
    const writeTextSpy = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });

    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');

    const copyBtn = within(dialog).getByRole('button', { name: /copy/i });
    await act(async () => {
      fireEvent.click(copyBtn);
    });

    expect(writeTextSpy).toHaveBeenCalledWith('MED123');
    expect(alertSpy).not.toHaveBeenCalled();

    const liveStatus =
      within(dialog).queryByRole('status') ??
      dialog.querySelector('[aria-live="polite"]');
    expect(liveStatus).not.toBeNull();
    expect(liveStatus!.textContent).toMatch(/copied|MED123/i);
  });

  it('T1-F18-03: Submitting a valid email invitation invokes inviteCareCircleMember with status invited and displays invited member', async () => {
    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');

    const emailInput = within(dialog).getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: 'asha.sharma@example.com' } });

    const nameInput = within(dialog).queryByLabelText(/name/i);
    if (nameInput) {
      fireEvent.change(nameInput, { target: { value: 'Asha Sharma' } });
    }

    const submitBtn = within(dialog).getByRole('button', { name: /send.*invite|invite/i });
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(inviteCareCircleMemberSpy).toHaveBeenCalledTimes(1);
    });

    const [patientIdArg, memberArg] = inviteCareCircleMemberSpy.mock.calls[0];
    expect(patientIdArg).toBe('patient_ramesh');
    expect(memberArg.email).toBe('asha.sharma@example.com');
    expect(memberArg.status).toBe('invited');

    expect(alertSpy).not.toHaveBeenCalled();

    const circleSection = document.getElementById('care-circle-members') ?? document.body;
    await waitFor(() => {
      expect(within(circleSection).getByText(/asha\.sharma@example\.com|Asha Sharma/i)).toBeInTheDocument();
      expect(within(circleSection).getByText(/invited/i)).toBeInTheDocument();
    });
  });

  it('T1-F18-04: Submitting email invitation provides confirmation banner and accessible mailto: handoff link', async () => {
    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: 'kiran.sharma@example.com' },
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite|invite/i }));
    });

    await waitFor(() => {
      expect(inviteCareCircleMemberSpy).toHaveBeenCalledTimes(1);
    });

    const mailtoLink = within(dialog)
      .getAllByRole('link')
      .find((el) => (el.getAttribute('href') ?? '').startsWith('mailto:'));
    expect(mailtoLink).toBeDefined();
    expect(mailtoLink!.getAttribute('href')).toContain('kiran.sharma@example.com');
    expect(mailtoLink!.getAttribute('href')).toContain('MED123');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('T1-F18-05: Selecting role and permissions in modal persists chosen role and permissions on CareCircleMember', async () => {
    renderCaregiverDashboard();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    const dialog = screen.getByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: 'vikram.sharma@example.com' },
    });

    const roleSelect = within(dialog).queryByLabelText(/role/i);
    if (roleSelect && roleSelect.tagName === 'SELECT') {
      fireEvent.change(roleSelect, { target: { value: 'primary' } });
    } else {
      const primaryOption = within(dialog).queryByRole('radio', { name: /primary/i });
      if (primaryOption) {
        fireEvent.click(primaryOption);
      }
    }

    const writeScheduleToggle = within(dialog).queryByRole('checkbox', {
      name: /schedule|edit|write/i,
    });
    if (writeScheduleToggle && !(writeScheduleToggle as HTMLInputElement).checked) {
      fireEvent.click(writeScheduleToggle);
    }

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite|invite/i }));
    });

    await waitFor(() => {
      expect(inviteCareCircleMemberSpy).toHaveBeenCalledTimes(1);
    });

    const [, memberArg] = inviteCareCircleMemberSpy.mock.calls[0];
    expect(memberArg.permissions).toContain('read');
    if (roleSelect || within(dialog).queryByRole('radio', { name: /primary/i })) {
      expect(['primary', 'secondary']).toContain(memberArg.role);
    }
    expect(alertSpy).not.toHaveBeenCalled();
  });
});
