import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario } from '@harness/index';
import {
  createMockFirestoreAdapter,
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
  stubAudioContext,
} from '@harness/reactTestHelper';
import type { AccessibilityPreferences, UserRole } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'patient_ramesh', role: 'elderly' as UserRole };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);
const updateUserAccessibilityPreferencesSpy = vi.fn<
  (uid: string, prefs: AccessibilityPreferences) => Promise<void>
>(async () => {});

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

import { AppShell } from '@/components/layout/AppShell';
import { TodayView } from '@/pages/TodayView';

type Phase4AuthValue = AuthContextValue & {
  isDemo?: boolean;
  updateAccessibilityPreferences?: (patch: Partial<AccessibilityPreferences>) => Promise<void>;
};

function StatefulAuthHarness({
  role = 'elderly',
  uid = 'real_elderly_1',
  isDemo = false,
  initialPrefs,
  children,
}: {
  role?: UserRole;
  uid?: string;
  isDemo?: boolean;
  initialPrefs?: AccessibilityPreferences;
  children: React.ReactNode;
}) {
  const defaultPrefs: AccessibilityPreferences = initialPrefs ?? {
    highContrast: false,
    largeText: true,
    hapticFeedback: true,
    soundEnabled: true,
  };

  const [prefs, setPrefs] = useState<AccessibilityPreferences>(() => {
    const raw = localStorage.getItem(`medimate_a11y_prefs_${uid}`);
    if (raw) {
      try {
        return { ...defaultPrefs, ...(JSON.parse(raw) as Partial<AccessibilityPreferences>) };
      } catch {
        return defaultPrefs;
      }
    }
    return defaultPrefs;
  });

  const base = makeAuthValue({ authenticated: true, role, uid });
  const profile = makeUserProfile(role, { uid, accessibilityPreferences: prefs });

  const value: Phase4AuthValue = {
    ...base,
    userProfile: profile,
    isDemo,
    updateAccessibilityPreferences: async (patch: Partial<AccessibilityPreferences>) => {
      const next: AccessibilityPreferences = { ...prefs, ...patch };
      setPrefs(next);
      localStorage.setItem(`medimate_a11y_prefs_${uid}`, JSON.stringify(next));
      await updateUserAccessibilityPreferencesSpy(uid, next);
    },
  };

  return (
    <MemoryRouter>
      <AuthProvider value={value}>{children}</AuthProvider>
    </MemoryRouter>
  );
}

function seedDueDoseForActor(uid: string) {
  const today = localTodayISO();
  const { doseLog } = seedPatientCareCircleScenario(mockDb, { doseStatus: 'due' });
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
}

function findAccessibilityControl(dialog: HTMLElement, nameRegex: RegExp): HTMLElement {
  return (
    within(dialog).queryByRole('switch', { name: nameRegex }) ??
    within(dialog).queryByRole('checkbox', { name: nameRegex }) ??
    within(dialog).getByRole('button', { name: nameRegex })
  );
}

function resetDomAndBrowserGlobals(
  origNotificationDescriptor: PropertyDescriptor | undefined
) {
  document.documentElement.classList.remove('high-contrast', 'large-text');
  document.documentElement.removeAttribute('data-high-contrast');
  document.documentElement.removeAttribute('data-large-text');
  localStorage.clear();
  if (origNotificationDescriptor) {
    Object.defineProperty(window, 'Notification', origNotificationDescriptor);
  } else {
    delete (window as unknown as Record<string, unknown>).Notification;
  }
}

describe('Tier 1 — F16: Settings & Accessibility Modal in AppShell (Phase 4B / R2)', () => {
  let audioStub: ReturnType<typeof stubAudioContext> | null = null;
  let origNotificationDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    origNotificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
    mockDb.clearAll();
    currentActor = { uid: 'patient_ramesh', role: 'elderly' };
    updateUserAccessibilityPreferencesSpy.mockClear();
    localStorage.clear();
    document.documentElement.classList.remove('high-contrast', 'large-text');
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
  });

  afterEach(() => {
    audioStub?.restore();
    audioStub = null;
    vi.restoreAllMocks();
    resetDomAndBrowserGlobals(origNotificationDescriptor);
  });

  it('T1-F16-01: AppShell renders Settings trigger and opens accessible Settings & Accessibility dialog with all controls', () => {
    render(
      <StatefulAuthHarness>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </StatefulAuthHarness>
    );

    const trigger = screen.getByRole('button', { name: /settings|accessibility/i });
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');

    expect(findAccessibilityControl(dialog, /sound/i)).toBeInTheDocument();
    expect(findAccessibilityControl(dialog, /haptic/i)).toBeInTheDocument();
    expect(findAccessibilityControl(dialog, /high[- ]?contrast/i)).toBeInTheDocument();
    expect(findAccessibilityControl(dialog, /large[- ]?text|text size/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/notification/i).length).toBeGreaterThanOrEqual(1);
  });

  it('T1-F16-02: Toggling High-Contrast Mode updates switch state and toggles html.high-contrast / data-high-contrast', () => {
    render(
      <StatefulAuthHarness>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </StatefulAuthHarness>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    const hcSwitch = within(dialog).getByRole('switch', { name: /high[- ]?contrast/i });

    expect(hcSwitch).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);

    fireEvent.click(hcSwitch);

    expect(hcSwitch).toHaveAttribute('aria-checked', 'true');
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(document.documentElement.getAttribute('data-high-contrast')).toBe('true');

    fireEvent.click(hcSwitch);

    expect(hcSwitch).toHaveAttribute('aria-checked', 'false');
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
  });

  it('T1-F16-03: Toggling Text Size updates control state and toggles html.large-text / data-large-text', () => {
    render(
      <StatefulAuthHarness>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </StatefulAuthHarness>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    const textControl = findAccessibilityControl(dialog, /large[- ]?text|text size/i);

    expect(document.documentElement.classList.contains('large-text')).toBe(true);

    fireEvent.click(textControl);
    expect(document.documentElement.classList.contains('large-text')).toBe(false);

    fireEvent.click(textControl);
    expect(document.documentElement.classList.contains('large-text')).toBe(true);
    expect(document.documentElement.getAttribute('data-large-text')).toBe('true');
  });

  it('T1-F16-04: Toggling Sound Effects OFF silences TodayView confirmation chime and toggling ON plays chime', () => {
    vi.useFakeTimers();
    audioStub = stubAudioContext();
    seedDueDoseForActor('patient_ramesh');

    render(
      <StatefulAuthHarness uid="patient_ramesh" role="elderly">
        <TodayView />
      </StatefulAuthHarness>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    const soundSwitch = within(dialog).getByRole('switch', { name: /sound/i });
    expect(soundSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(soundSwitch);
    expect(soundSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(within(dialog).getAllByRole('button', { name: /close|done/i })[0]);
    fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
    expect(audioStub.constructCount).toBe(0);

    // Undo and re-enable sound
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const reopened = screen.getByRole('dialog');
    fireEvent.click(within(reopened).getByRole('switch', { name: /sound/i }));
    fireEvent.click(within(reopened).getAllByRole('button', { name: /close|done/i })[0]);

    fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
    expect(audioStub.constructCount).toBe(1);
  });

  it('T1-F16-05: Toggling Haptic Feedback OFF suppresses navigator.vibrate in TodayView/DoseCard and ON triggers vibration', () => {
    vi.useFakeTimers();
    audioStub = stubAudioContext();
    const vibrateSpy = vi.spyOn(navigator, 'vibrate').mockImplementation(() => true);
    seedDueDoseForActor('patient_ramesh');

    render(
      <StatefulAuthHarness uid="patient_ramesh" role="elderly">
        <TodayView />
      </StatefulAuthHarness>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    const hapticSwitch = within(dialog).getByRole('switch', { name: /haptic/i });
    expect(hapticSwitch).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(hapticSwitch);
    expect(hapticSwitch).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(within(dialog).getAllByRole('button', { name: /close|done/i })[0]);

    fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
    expect(vibrateSpy).not.toHaveBeenCalled();

    // Undo and re-enable haptics
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const reopened = screen.getByRole('dialog');
    fireEvent.click(within(reopened).getByRole('switch', { name: /haptic/i }));
    fireEvent.click(within(reopened).getAllByRole('button', { name: /close|done/i })[0]);

    fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
    expect(vibrateSpy).toHaveBeenCalledWith([40, 60, 40]);
  });

  it('T1-F16-06: Displays live Notification.permission status and requests permission via Notification.requestPermission()', async () => {
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

    render(
      <StatefulAuthHarness>
        <AppShell>
          <div>Content</div>
        </AppShell>
      </StatefulAuthHarness>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getAllByText(/not enabled|default|not set|not asked|prompt|ask/i).length
    ).toBeGreaterThanOrEqual(1);

    const enableBtn = within(dialog).getByRole('button', {
      name: /enable|request|allow|notification|permission|turn on/i,
    });
    await act(async () => {
      fireEvent.click(enableBtn);
    });

    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(within(dialog).getAllByText(/granted|enabled|allowed/i).length).toBeGreaterThanOrEqual(1);
  });
});
