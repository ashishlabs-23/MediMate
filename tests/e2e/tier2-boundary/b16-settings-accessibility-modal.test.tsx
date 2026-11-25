import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import { createDoseLogFixture } from '@harness/index';
import {
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
  toDoseLogDocument,
} from '@harness/reactTestHelper';
import type { AccessibilityPreferences, UserRole } from '@/types/firestore';

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
  subscribeToDoseLogs: vi.fn((_id: string, _d: string, cb: (d: never[]) => void) => {
    cb([]);
    return () => {};
  }),
  subscribeToCareCircle: vi.fn((_id: string, cb: (c: null) => void) => {
    cb(null);
    return () => {};
  }),
  updateDoseLog: vi.fn(async () => {}),
  getMedications: vi.fn(async () => []),
  subscribeToMedications: vi.fn((_id: string, cb: (m: never[]) => void) => {
    cb([]);
    return () => {};
  }),
  createMedication: vi.fn(async () => ({})),
  updateMedication: vi.fn(async () => {}),
  setMedicationActive: vi.fn(async () => {}),
  getDoseLogsForDateRange: vi.fn(async () => []),
  getActiveMedications: vi.fn(async () => []),
  getDoseLog: vi.fn(async () => null),
  getUserDocument: vi.fn(async () => null),
  upsertUserDocument: vi.fn(async () => {}),
  getCareCircle: vi.fn(async () => null),
  updateUserAccessibilityPreferences: vi.fn(async () => {}),
  inviteCareCircleMember: vi.fn(async () => {}),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: vi.fn(async () => 0),
}));

import { AppShell } from '@/components/layout/AppShell';
import { DoseCard } from '@/components/dose/DoseCard';

type Phase4AuthValue = AuthContextValue & {
  isDemo?: boolean;
  updateAccessibilityPreferences?: (patch: Partial<AccessibilityPreferences>) => Promise<void>;
};

function StatefulShell({
  uid = 'real_elderly_1',
  role = 'elderly',
}: {
  uid?: string;
  role?: UserRole;
}) {
  const defaultPrefs: AccessibilityPreferences = {
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
  const value: Phase4AuthValue = {
    ...base,
    userProfile: makeUserProfile(role, { uid, accessibilityPreferences: prefs }),
    isDemo: false,
    updateAccessibilityPreferences: async (patch: Partial<AccessibilityPreferences>) => {
      const next = { ...prefs, ...patch };
      setPrefs(next);
      localStorage.setItem(`medimate_a11y_prefs_${uid}`, JSON.stringify(next));
    },
  };

  return (
    <AuthProvider value={value}>
      <AppShell>
        <div>Body</div>
      </AppShell>
    </AuthProvider>
  );
}

describe('Tier 2 — B16: Settings & Accessibility Modal Boundaries (Phase 4B)', () => {
  let origNotificationDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    origNotificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
    localStorage.clear();
    document.documentElement.classList.remove('high-contrast', 'large-text');
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
  });

  afterEach(() => {
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

  it('T2-B16-01: Pressing Escape closes SettingsModal cleanly and preserves applied html accessibility state', () => {
    render(
      <MemoryRouter>
        <StatefulShell />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: /high[- ]?contrast/i }));
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
  });

  it('T2-B16-02: Handles unsupported Notification API and denied permission state gracefully without auto-prompting', () => {
    delete (window as unknown as Record<string, unknown>).Notification;

    const { unmount } = render(
      <MemoryRouter>
        <StatefulShell />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    let dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getAllByText(/unsupported|not supported|unavailable/i).length
    ).toBeGreaterThanOrEqual(1);
    unmount();

    const requestSpy = vi.fn(async () => 'denied' as NotificationPermission);
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      writable: true,
      value: { permission: 'denied', requestPermission: requestSpy },
    });

    render(
      <MemoryRouter>
        <StatefulShell />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    dialog = screen.getByRole('dialog');
    expect(requestSpy).not.toHaveBeenCalled();
    expect(within(dialog).getAllByText(/denied|blocked/i).length).toBeGreaterThanOrEqual(1);
  });

  it('T2-B16-03: Corrupted JSON in localStorage medimate_a11y_prefs_<uid> does not crash and falls back safely', () => {
    localStorage.setItem('medimate_a11y_prefs_real_elderly_1', '{not-valid-json');

    render(
      <MemoryRouter>
        <StatefulShell uid="real_elderly_1" />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('switch', { name: /sound/i })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('T2-B16-04: Standalone <DoseCard /> without <AuthProvider> does not throw and keeps default haptic vibration enabled', () => {
    const vibrateSpy = vi.spyOn(navigator, 'vibrate').mockImplementation(() => true);
    const onTaken = vi.fn();
    const dose = toDoseLogDocument(
      createDoseLogFixture({
        id: 'standalone_dose_1',
        status: 'due',
        medicationName: 'Amlodipine',
        dosage: '5 mg',
      }) as unknown as Record<string, unknown>
    );

    render(<DoseCard dose={dose} onTaken={onTaken} />);

    fireEvent.click(screen.getByRole('button', { name: /mark amlodipine as taken/i }));
    expect(onTaken).toHaveBeenCalledWith('standalone_dose_1');
    expect(vibrateSpy).toHaveBeenCalledWith([40, 60, 40]);
  });

  it('T2-B16-05: <AppShell> rendered without a React Router ancestor works safely and still opens SettingsModal', () => {
    render(<StatefulShell />);

    const trigger = screen.getByRole('button', { name: /settings|accessibility/i });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });
});
