import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario, type FirestoreRecord } from '@harness/index';
import {
  createMockFirestoreAdapter,
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
  stubAudioContext,
} from '@harness/reactTestHelper';
import type { AccessibilityPreferences, DoseLogDocument, UserRole } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'dual_nirmala', role: 'dual' as UserRole };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);
const updateUserAccessibilityPreferencesSpy = vi.fn<
  (uid: string, prefs: AccessibilityPreferences) => Promise<void>
>(async () => {});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

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
  updateUserAccessibilityPreferences: (uid: string, prefs: AccessibilityPreferences) =>
    updateUserAccessibilityPreferencesSpy(uid, prefs),
  inviteCareCircleMember: vi.fn(async () => {}),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: vi.fn(async () => 0),
}));

vi.mock('@/hooks/useReminderScheduler', () => ({
  useReminderScheduler: vi.fn(),
}));

import { App } from '@/App';
import { useAuth } from '@/hooks/useAuth';

type Phase4AuthValue = AuthContextValue & {
  isDemo?: boolean;
  updateAccessibilityPreferences?: (patch: Partial<AccessibilityPreferences>) => Promise<void>;
};

function useStatefulTestAuth(options: {
  role: UserRole;
  uid: string;
  displayName: string;
  isDemo: boolean;
  signOut: () => Promise<void>;
}): Phase4AuthValue {
  const defaultPrefs: AccessibilityPreferences = {
    highContrast: false,
    largeText: true,
    hapticFeedback: true,
    soundEnabled: true,
  };
  const [prefs, setPrefs] = useState<AccessibilityPreferences>(() => {
    const raw = localStorage.getItem(`medimate_a11y_prefs_${options.uid}`);
    if (raw) {
      try {
        return { ...defaultPrefs, ...(JSON.parse(raw) as Partial<AccessibilityPreferences>) };
      } catch {
        return defaultPrefs;
      }
    }
    return defaultPrefs;
  });

  const base = makeAuthValue({
    authenticated: true,
    role: options.role,
    uid: options.uid,
    displayName: options.displayName,
    signOut: options.signOut,
  });

  return {
    ...base,
    userProfile: makeUserProfile(options.role, {
      uid: options.uid,
      displayName: options.displayName,
      accessibilityPreferences: prefs,
    }),
    isDemo: options.isDemo,
    updateAccessibilityPreferences: async (patch: Partial<AccessibilityPreferences>) => {
      const next = { ...prefs, ...patch };
      setPrefs(next);
      localStorage.setItem(`medimate_a11y_prefs_${options.uid}`, JSON.stringify(next));
      await updateUserAccessibilityPreferencesSpy(options.uid, next);
    },
  };
}

function seedDueDoseFor(uid: string): string {
  const today = localTodayISO();
  const { doseLog } = seedPatientCareCircleScenario(mockDb, {
    patientId: uid,
    caregiverId: uid,
    doseStatus: 'due',
  });
  const [y, m, d] = today.split('-').map(Number);
  const doseId = `${uid}_med_metformin_${today}_0800`;
  mockDb.seedDoc('dose_logs', doseId, {
    ...doseLog,
    id: doseId,
    patientId: uid,
    scheduledDate: today,
    scheduledTime: new Date(y, m - 1, d, 8, 0, 0),
    status: 'due',
  });
  return doseId;
}

function findSwitcherControl(container: HTMLElement, nameRegex: RegExp): HTMLElement | null {
  return (
    within(container).queryByRole('button', { name: nameRegex }) ??
    within(container).queryByRole('link', { name: nameRegex }) ??
    within(container).queryByRole('tab', { name: nameRegex })
  );
}

describe('Tier 4 — Scenario 07: Dual-Role Accessibility & Role-Switching Journey', () => {
  let audioStub: ReturnType<typeof stubAudioContext> | null = null;
  let origNotificationDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    origNotificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
    mockDb.clearAll();
    localStorage.clear();
    document.documentElement.classList.remove('high-contrast', 'large-text');
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
    updateUserAccessibilityPreferencesSpy.mockClear();
  });

  afterEach(() => {
    audioStub?.restore();
    audioStub = null;
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('high-contrast', 'large-text');
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
    if (origNotificationDescriptor) {
      Object.defineProperty(window, 'Notification', origNotificationDescriptor);
    } else {
      delete (window as unknown as Record<string, unknown>).Notification;
    }
  });

  it('T4-S07-01: Dual-role user customizes Settings & A11y, persists across remount, confirms dose silently, and switches to Caregiver Dashboard', async () => {
    vi.useFakeTimers();
    audioStub = stubAudioContext();
    const vibrateSpy = vi.spyOn(navigator, 'vibrate').mockImplementation(() => true);
    const requestPermissionMock = vi.fn(async () => {
      mockNotification.permission = 'granted';
      return 'granted' as NotificationPermission;
    });
    const mockNotification = {
      permission: 'default' as NotificationPermission,
      requestPermission: requestPermissionMock,
    };
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: mockNotification,
    });

    currentActor = { uid: 'dual_nirmala', role: 'dual' };
    const doseId = seedDueDoseFor('dual_nirmala');
    const signOutSpy = vi.fn(async () => {});

    vi.mocked(useAuth).mockImplementation(() =>
      useStatefulTestAuth({
        role: 'dual',
        uid: 'dual_nirmala',
        displayName: 'Nirmala Devi',
        isDemo: false,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/today');
    const firstRender = render(<App />);

    // Step 1: Open Settings modal and customize preferences
    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: /high[- ]?contrast/i }));
    fireEvent.click(within(dialog).getByRole('switch', { name: /sound/i }));
    fireEvent.click(within(dialog).getByRole('switch', { name: /haptic/i }));

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: /enable|request|allow|notification|permission|turn on/i,
        })
      );
    });
    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getAllByRole('button', { name: /close|done/i })[0]);

    // Step 2: Simulate page reload by unmounting and remounting <App />
    firstRender.unmount();
    document.documentElement.classList.remove('high-contrast', 'large-text');
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

    // Step 3: Confirm dose silently (no audio chime, no haptic vibrate) and let 5s undo commit
    fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
    expect(audioStub.constructCount).toBe(0);
    expect(vibrateSpy).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(mockDb.inspectDoc<DoseLogDocument & FirestoreRecord>('dose_logs', doseId)?.status).toBe('taken');

    // Step 4: Switch to Caregiver Dashboard via Dual Role Switcher without logout
    const caregiverControl = findSwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /caregiver view|caregiver/i);
    expect(caregiverControl).not.toBeNull();
    fireEvent.click(caregiverControl!);

    expect(window.location.pathname).toBe('/app/caregiver');
    expect(
      screen.getByRole('heading', { level: 1, name: /caregiver dashboard/i })
    ).toBeInTheDocument();
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('T4-S07-02: Demo persona switches between Simple Mode and Caregiver View while preserving a11y classes and session', () => {
    currentActor = { uid: 'patient_ramesh', role: 'elderly' };
    seedDueDoseFor('patient_ramesh');
    const signOutSpy = vi.fn(async () => {});

    vi.mocked(useAuth).mockImplementation(() =>
      useStatefulTestAuth({
        role: 'elderly',
        uid: 'patient_ramesh',
        displayName: 'Ramesh Sharma',
        isDemo: true,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('switch', { name: /high[- ]?contrast/i })
    );
    fireEvent.keyDown(document, { key: 'Escape' });

    const toCaregiver = findSwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /caregiver view|caregiver/i);
    expect(toCaregiver).not.toBeNull();
    fireEvent.click(toCaregiver!);
    expect(window.location.pathname).toBe('/app/caregiver');
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

    const toSimple = findSwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /simple mode/i);
    expect(toSimple).not.toBeNull();
    fireEvent.click(toSimple!);
    expect(window.location.pathname).toBe('/app/today');
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('T4-S07-03: Single-role non-demo elderly user configures Settings & Accessibility while Dual Role Switcher stays hidden', async () => {
    currentActor = { uid: 'real_elderly_1', role: 'elderly' };
    seedDueDoseFor('real_elderly_1');
    const signOutSpy = vi.fn(async () => {});

    vi.mocked(useAuth).mockImplementation(() =>
      useStatefulTestAuth({
        role: 'elderly',
        uid: 'real_elderly_1',
        displayName: 'Kamala Iyer',
        isDemo: false,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    expect(findSwitcherControl(banner, /caregiver view/i)).toBeNull();
    expect(findSwitcherControl(banner, /simple mode/i)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: /high[- ]?contrast/i }));

    await waitFor(() => {
      expect(updateUserAccessibilityPreferencesSpy).toHaveBeenCalledWith(
        'real_elderly_1',
        expect.objectContaining({ highContrast: true })
      );
    });

    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(findSwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /caregiver view/i)).toBeNull();
  });
});
