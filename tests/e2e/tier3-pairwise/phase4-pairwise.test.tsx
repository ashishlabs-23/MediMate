import fs from 'node:fs';
import path from 'node:path';
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario, type FirestoreRecord } from '@harness/index';
import {
  PROJECT_ROOT,
  createMockFirestoreAdapter,
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
  stubAudioContext,
} from '@harness/reactTestHelper';
import type { AccessibilityPreferences, CareCircleDocument, CareCircleMember, UserRole } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'dual_nirmala', role: 'dual' as UserRole };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);

const updateUserAccessibilityPreferencesSpy = vi.fn(
  async (_uid: string, _prefs: AccessibilityPreferences) => {}
);
const inviteCareCircleMemberSpy = vi.fn(
  async (patientId: string, member: CareCircleMember) => {
    const existing = mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', patientId);
    if (!existing) throw new Error('Care circle missing');
    mockDb.updateDoc(
      'care_circles',
      patientId,
      { members: [...(existing.members ?? []), member], updatedAt: new Date() },
      currentActor
    );
  }
);

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
  inviteCareCircleMember: (patientId: string, member: CareCircleMember) =>
    inviteCareCircleMemberSpy(patientId, member),
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

function seedDueDoseFor(uid: string) {
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
}

function findSwitcherControl(container: HTMLElement, nameRegex: RegExp): HTMLElement {
  return (
    within(container).queryByRole('button', { name: nameRegex }) ??
    within(container).queryByRole('link', { name: nameRegex }) ??
    within(container).getByRole('tab', { name: nameRegex })
  );
}

describe('Tier 3 — Pairwise Interactions Across Phases 4A–4D', () => {
  let audioStub: ReturnType<typeof stubAudioContext> | null = null;
  let alertSpy: ReturnType<typeof vi.spyOn>;
  let origNotificationDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    origNotificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
    mockDb.clearAll();
    localStorage.clear();
    document.documentElement.classList.remove('high-contrast', 'large-text');
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
    updateUserAccessibilityPreferencesSpy.mockClear();
    inviteCareCircleMemberSpy.mockClear();
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
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

  it('T3-P4-01: [4B High-Contrast + Large-Text] applies both DOM modes simultaneously without breaking TodayView Taken/Snooze', () => {
    vi.useFakeTimers();
    audioStub = stubAudioContext();
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

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: /high[- ]?contrast/i }));
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(document.documentElement.classList.contains('large-text')).toBe(true);
    expect(document.documentElement.getAttribute('data-high-contrast')).toBe('true');
    expect(document.documentElement.getAttribute('data-large-text')).toBe('true');

    fireEvent.click(within(dialog).getAllByRole('button', { name: /close|done/i })[0]);

    fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
    expect(screen.getByRole('button', { name: /undo/i })).toBeInTheDocument();
  });

  it('T3-P4-02: [4B Sound OFF + Haptics OFF] suppresses chime and vibrate while preserving TodayView 5s Undo flow', () => {
    vi.useFakeTimers();
    audioStub = stubAudioContext();
    const vibrateSpy = vi.spyOn(navigator, 'vibrate').mockImplementation(() => true);
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

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: /sound/i }));
    fireEvent.click(within(dialog).getByRole('switch', { name: /haptic/i }));
    fireEvent.click(within(dialog).getAllByRole('button', { name: /close|done/i })[0]);

    fireEvent.click(screen.getByRole('button', { name: /mark metformin as taken/i }));
    expect(audioStub.constructCount).toBe(0);
    expect(vibrateSpy).not.toHaveBeenCalled();

    const undoBtn = screen.getByRole('button', { name: /undo/i });
    fireEvent.click(undoBtn);
    expect(screen.getByRole('button', { name: /mark metformin as taken/i })).not.toBeDisabled();
  });

  it('T3-P4-03: [4C Dual Role Switcher + 4B Persistence] switching between TodayView and CaregiverDashboard preserves html preferences and session', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'dual_nirmala', role: 'dual' };
    seedDueDoseFor('dual_nirmala');

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
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('switch', { name: /high[- ]?contrast/i }));
    fireEvent.click(within(dialog).getAllByRole('button', { name: /close|done/i })[0]);

    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);

    fireEvent.click(findSwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /caregiver view|caregiver/i));
    expect(window.location.pathname).toBe('/app/caregiver');
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(signOutSpy).not.toHaveBeenCalled();

    // Verify switch state stayed checked when reopening Settings on /app/caregiver
    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    expect(
      within(screen.getByRole('dialog')).getByRole('switch', { name: /high[- ]?contrast/i })
    ).toHaveAttribute('aria-checked', 'true');
  });

  it('T3-P4-04: [4C Demo Persona + 4D Care Circle Invite] demo user switches from Simple Mode to Caregiver View and opens Care Circle Invite Modal', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'patient_ramesh', role: 'elderly' };
    seedDueDoseFor('patient_ramesh');

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

    fireEvent.click(findSwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /caregiver view|caregiver/i));
    expect(window.location.pathname).toBe('/app/caregiver');
    expect(signOutSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('T3-P4-05: [4B Settings Modal + 4D Invite Modal] opening and closing both modals sequentially leaves zero dialog collision', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'caregiver_priya', role: 'caregiver' };
    seedPatientCareCircleScenario(mockDb, { doseStatus: 'due' });

    vi.mocked(useAuth).mockImplementation(() =>
      useStatefulTestAuth({
        role: 'caregiver',
        uid: 'caregiver_priya',
        displayName: 'Priya Sharma',
        isDemo: false,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/caregiver');
    render(<App />);

    // Open & close Settings
    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();

    // Open & close Care Circle Invite Modal
    fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(alertSpy).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('T3-P4-06: [4B Notification Permission + 4A Manifest Icon] granting notification permission pairs with valid 192x192 PNG manifest asset', async () => {
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

    const manifest = JSON.parse(
      fs.readFileSync(path.resolve(PROJECT_ROOT, 'public/manifest.json'), 'utf-8')
    ) as { icons: Array<{ src: string; sizes: string }> };
    const icon192 = manifest.icons.find((i) => i.sizes === '192x192');
    expect(icon192).toBeDefined();
    const iconBuf = fs.readFileSync(
      path.resolve(PROJECT_ROOT, 'public', icon192!.src.replace(/^\/+/, ''))
    );
    expect(iconBuf.length).toBeGreaterThan(500);

    currentActor = { uid: 'real_elderly_1', role: 'elderly' };
    seedDueDoseFor('real_elderly_1');
    vi.mocked(useAuth).mockImplementation(() =>
      useStatefulTestAuth({
        role: 'elderly',
        uid: 'real_elderly_1',
        displayName: 'Kamala Iyer',
        isDemo: false,
        signOut: vi.fn(async () => {}),
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: /settings|accessibility/i }));
    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: /enable|request|allow|notification|permission|turn on/i,
        })
      );
    });

    expect(requestPermissionMock).toHaveBeenCalledTimes(1);
    expect(
      within(dialog).getAllByText(/granted|enabled|allowed/i).length
    ).toBeGreaterThanOrEqual(1);
  });
});
