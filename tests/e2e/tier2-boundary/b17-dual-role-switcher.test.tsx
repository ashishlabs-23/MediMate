import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import { MockFirestoreDb, seedPatientCareCircleScenario } from '@harness/index';
import {
  createMockFirestoreAdapter,
  localTodayISO,
  makeAuthValue,
  makeUserProfile,
} from '@harness/reactTestHelper';
import type { AccessibilityPreferences, UserRole } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'real_elderly_1', role: 'elderly' as UserRole };
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
import { AppShell } from '@/components/layout/AppShell';
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
  nullProfile?: boolean;
  signOut?: () => Promise<void>;
}): Phase4AuthValue {
  const base = makeAuthValue({
    authenticated: true,
    role: options.role,
    uid: options.uid,
    displayName: options.displayName,
    ...(options.nullProfile ? { nullProfile: true } : {}),
    ...(options.signOut ? { signOut: options.signOut } : {}),
  });
  return {
    ...base,
    userProfile: options.nullProfile
      ? null
      : makeUserProfile(options.role, {
          uid: options.uid,
          displayName: options.displayName,
        }),
    isDemo: options.isDemo,
    updateAccessibilityPreferences: vi.fn(async () => {}),
  };
}

function querySwitcherControl(container: HTMLElement, nameRegex: RegExp): HTMLElement | null {
  return (
    within(container).queryByRole('button', { name: nameRegex }) ??
    within(container).queryByRole('link', { name: nameRegex }) ??
    within(container).queryByRole('tab', { name: nameRegex })
  );
}

describe('Tier 2 — B17: Dual Role Switcher Boundaries & Access Rules (Phase 4C)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    localStorage.clear();
    seedPatientCareCircleScenario(mockDb, {
      patientId: 'real_elderly_1',
      caregiverId: 'real_caregiver_1',
      doseStatus: 'due',
    });
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

  it('T2-B17-01: Single-role non-demo elderly user NEVER sees Dual Role Switcher controls in AppShell', () => {
    currentActor = { uid: 'real_elderly_1', role: 'elderly' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'elderly',
        uid: 'real_elderly_1',
        displayName: 'Kamala Iyer',
        isDemo: false,
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    expect(querySwitcherControl(banner, /caregiver view/i)).toBeNull();
    expect(querySwitcherControl(banner, /simple mode/i)).toBeNull();
    expect(within(banner).queryByRole('navigation', { name: /role|view/i })).toBeNull();
  });

  it('T2-B17-02: Single-role non-demo caregiver user NEVER sees Dual Role Switcher controls in AppShell', () => {
    currentActor = { uid: 'real_caregiver_1', role: 'caregiver' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'caregiver',
        uid: 'real_caregiver_1',
        displayName: 'Arjun Nair',
        isDemo: false,
      })
    );

    window.history.pushState({}, '', '/app/caregiver');
    render(<App />);

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    expect(querySwitcherControl(banner, /simple mode/i)).toBeNull();
    expect(querySwitcherControl(banner, /caregiver view/i)).toBeNull();
  });

  it('T2-B17-03: Authenticated user with null userProfile hides Dual Role Switcher without crashing', () => {
    currentActor = { uid: 'real_unknown_1', role: 'elderly' };
    vi.mocked(useAuth).mockReturnValue(
      makePhase4AuthValue({
        role: 'elderly',
        uid: 'real_unknown_1',
        displayName: 'Unknown User',
        isDemo: false,
        nullProfile: true,
      })
    );

    window.history.pushState({}, '', '/app/today');
    render(<App />);

    const banner = screen.getByRole('navigation', { name: /main navigation/i });
    expect(querySwitcherControl(banner, /caregiver view/i)).toBeNull();
    expect(querySwitcherControl(banner, /simple mode/i)).toBeNull();
  });

  it('T2-B17-04: Active route indicator reflects current view and clicking the already-active view is idempotent', () => {
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
    const simpleControl = querySwitcherControl(banner, /simple mode/i);
    const caregiverControl = querySwitcherControl(banner, /caregiver view|caregiver/i);
    expect(simpleControl).not.toBeNull();
    expect(caregiverControl).not.toBeNull();

    const simpleActive =
      simpleControl!.getAttribute('aria-current') === 'page' ||
      simpleControl!.getAttribute('aria-pressed') === 'true' ||
      simpleControl!.getAttribute('aria-selected') === 'true';
    expect(simpleActive).toBe(true);

    // Clicking active Simple Mode keeps user on /app/today without logging out
    fireEvent.click(simpleControl!);
    expect(window.location.pathname).toBe('/app/today');
    expect(signOutSpy).not.toHaveBeenCalled();

    // Switch to /app/caregiver and verify active indicator flips
    fireEvent.click(caregiverControl!);
    expect(window.location.pathname).toBe('/app/caregiver');
    const caregiverAfter = querySwitcherControl(screen.getByRole('navigation', { name: /main navigation/i }), /caregiver view|caregiver/i)!;
    const caregiverActive =
      caregiverAfter.getAttribute('aria-current') === 'page' ||
      caregiverAfter.getAttribute('aria-pressed') === 'true' ||
      caregiverAfter.getAttribute('aria-selected') === 'true';
    expect(caregiverActive).toBe(true);
  });

  it('T2-B17-05: <AppShell> rendered outside a React Router does not crash even for dual-role users', () => {
    const authValue = makePhase4AuthValue({
      role: 'dual',
      uid: 'dual_nirmala',
      displayName: 'Nirmala Devi',
      isDemo: false,
    });

    render(
      <AuthProvider value={authValue}>
        <AppShell>
          <div>Routerless body</div>
        </AppShell>
      </AuthProvider>
    );

    expect(screen.getByText('Routerless body')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /main navigation/i })).toBeInTheDocument();
  });
});
