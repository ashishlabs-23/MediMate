import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario } from '@harness/index';
import {
  createMockFirestoreAdapter,
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
} from '@harness/reactTestHelper';
import type { AccessibilityPreferences, UserRole } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'dual_nirmala', role: 'dual' as UserRole };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);

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
  updateUserAccessibilityPreferences: vi.fn(async () => {}),
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

function makePhase4AuthValue(options: {
  role: UserRole;
  uid: string;
  displayName: string;
  isDemo: boolean;
  signOut: () => Promise<void>;
}): Phase4AuthValue {
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
    }),
    isDemo: options.isDemo,
    updateAccessibilityPreferences: vi.fn(async () => {}),
  };
}

function findSwitcherControl(container: HTMLElement, nameRegex: RegExp): HTMLElement {
  return (
    within(container).queryByRole('button', { name: nameRegex }) ??
    within(container).queryByRole('link', { name: nameRegex }) ??
    within(container).getByRole('tab', { name: nameRegex })
  );
}

describe('Tier 1 — F17: Dual Role Switcher in AppShell Navbar (Phase 4C / R3)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    localStorage.clear();
    seedPatientCareCircleScenario(mockDb, { doseStatus: 'due' });
    seedPatientCareCircleScenario(mockDb, {
      patientId: 'dual_nirmala',
      caregiverId: 'dual_nirmala',
      doseStatus: 'due',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    document.documentElement.classList.remove('high-contrast', 'large-text');
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
  });

  it('T1-F17-01: Dual-role user on /app/today sees Dual Role Switcher controls in AppShell header', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'dual_nirmala', role: 'dual' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'dual',
        uid: 'dual_nirmala',
        displayName: 'Nirmala Devi',
        isDemo: false,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    expect(findSwitcherControl(banner, /simple mode/i)).toBeInTheDocument();
    expect(findSwitcherControl(banner, /caregiver view|caregiver/i)).toBeInTheDocument();
  });

  it('T1-F17-02: Clicking Caregiver View switches from /app/today to /app/caregiver without calling signOut', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'dual_nirmala', role: 'dual' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'dual',
        uid: 'dual_nirmala',
        displayName: 'Nirmala Devi',
        isDemo: false,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: /hello,/i })).toBeInTheDocument();

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    fireEvent.click(findSwitcherControl(banner, /caregiver view|caregiver/i));

    expect(window.location.pathname).toBe('/app/caregiver');
    expect(
      screen.getByRole('heading', { level: 1, name: /caregiver dashboard/i })
    ).toBeInTheDocument();
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('T1-F17-03: Clicking Simple Mode switches from /app/caregiver back to /app/today without logging out', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'dual_nirmala', role: 'dual' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'dual',
        uid: 'dual_nirmala',
        displayName: 'Nirmala Devi',
        isDemo: false,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/caregiver');
    render(<App />);

    expect(
      screen.getByRole('heading', { level: 1, name: /caregiver dashboard/i })
    ).toBeInTheDocument();

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    fireEvent.click(findSwitcherControl(banner, /simple mode/i));

    expect(window.location.pathname).toBe('/app/today');
    expect(screen.getByRole('heading', { level: 1, name: /hello,/i })).toBeInTheDocument();
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('T1-F17-04: Demo elderly persona (patient_ramesh) can switch seamlessly to /app/caregiver and back', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'patient_ramesh', role: 'elderly' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'elderly',
        uid: 'patient_ramesh',
        displayName: 'Ramesh Sharma',
        isDemo: true,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    fireEvent.click(findSwitcherControl(banner, /caregiver view|caregiver/i));
    expect(window.location.pathname).toBe('/app/caregiver');
    expect(
      screen.getByRole('heading', { level: 1, name: /caregiver dashboard/i })
    ).toBeInTheDocument();

    fireEvent.click(findSwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /simple mode/i));
    expect(window.location.pathname).toBe('/app/today');
    expect(signOutSpy).not.toHaveBeenCalled();
  });

  it('T1-F17-05: Demo caregiver persona (caregiver_priya) on /app/caregiver can switch to /app/today without logout', () => {
    const signOutSpy = vi.fn(async () => {});
    currentActor = { uid: 'caregiver_priya', role: 'caregiver' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'caregiver',
        uid: 'caregiver_priya',
        displayName: 'Priya Sharma',
        isDemo: true,
        signOut: signOutSpy,
      })
    );

    window.history.pushState({}, '', '/app/caregiver');
    render(<App />);

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    fireEvent.click(findSwitcherControl(banner, /simple mode/i));

    expect(window.location.pathname).toBe('/app/today');
    expect(screen.getByRole('heading', { level: 1, name: /hello,/i })).toBeInTheDocument();
    expect(signOutSpy).not.toHaveBeenCalled();
  });
});
