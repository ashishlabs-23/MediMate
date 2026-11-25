import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { SettingsModal } from '../../src/components/settings/SettingsModal';
import { AppShell } from '../../src/components/layout/AppShell';
import { DoseCard } from '../../src/components/dose/DoseCard';
import { AuthProvider, type AuthContextValue } from '../../src/contexts/AuthContext';
import { useAuth } from '../../src/hooks/useAuth';
import type {
  AccessibilityPreferences,
  DoseLogDocument,
  UserDocument,
  UserRole,
} from '../../src/types/firestore';

type AuthCallback = (user: User | null) => void | Promise<void>;

const {
  mockOnAuthStateChanged,
  mockFirebaseSignOut,
  mockGetUserDocument,
  mockUpdateUserAccessibilityPreferences,
  mockRegisterFcmToken,
} = vi.hoisted(() => ({
  mockOnAuthStateChanged: vi.fn<
    (auth: unknown, onNext: AuthCallback, onError?: (err: Error) => void) => () => void
  >(),
  mockFirebaseSignOut: vi.fn<() => Promise<void>>(),
  mockGetUserDocument: vi.fn<(uid: string) => Promise<UserDocument | null>>(),
  mockUpdateUserAccessibilityPreferences: vi.fn<
    (uid: string, prefs: AccessibilityPreferences) => Promise<void>
  >(),
  mockRegisterFcmToken: vi.fn().mockResolvedValue('mock-fcm-token'),
}));

vi.mock('../../src/lib/firebase', () => ({
  auth: { name: 'mock-auth' },
  registerFcmToken: (...args: unknown[]) => mockRegisterFcmToken(...args),
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (
    authObj: unknown,
    onNext: AuthCallback,
    onError?: (err: Error) => void
  ) => mockOnAuthStateChanged(authObj, onNext, onError),
  signOut: () => mockFirebaseSignOut(),
}));

vi.mock('../../src/lib/firestore', () => ({
  getUserDocument: (uid: string) => mockGetUserDocument(uid),
  updateUserAccessibilityPreferences: (uid: string, prefs: AccessibilityPreferences) =>
    mockUpdateUserAccessibilityPreferences(uid, prefs),
}));

const DEFAULT_PREFS: AccessibilityPreferences = {
  highContrast: false,
  largeText: false,
  hapticFeedback: true,
  soundEnabled: true,
};

const originalNotificationDescriptor = Object.getOwnPropertyDescriptor(window, 'Notification');
const originalVibrateDescriptor = Object.getOwnPropertyDescriptor(navigator, 'vibrate');

function setMockNotification(
  permission: NotificationPermission,
  requestImpl?: () => Promise<NotificationPermission>
) {
  const requestPermission = vi.fn(requestImpl ?? (async () => permission));
  Object.defineProperty(window, 'Notification', {
    configurable: true,
    writable: true,
    value: {
      permission,
      requestPermission,
    },
  });
  return requestPermission;
}

function removeNotificationSupport() {
  // Remove Notification from window so `'Notification' in window` evaluates to false
  Reflect.deleteProperty(window, 'Notification');
}

function restoreWindowGlobals() {
  if (originalNotificationDescriptor) {
    Object.defineProperty(window, 'Notification', originalNotificationDescriptor);
  } else {
    Reflect.deleteProperty(window, 'Notification');
  }
  if (originalVibrateDescriptor) {
    Object.defineProperty(navigator, 'vibrate', originalVibrateDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'vibrate');
  }
}

function makeUserProfile(overrides?: Partial<UserDocument>): UserDocument {
  const now = Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0));
  return {
    uid: 'user-real-1',
    email: 'user@medimate.local',
    displayName: 'Asha Verma',
    role: 'elderly',
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: { ...DEFAULT_PREFS },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAuthValue(options?: {
  uid?: string;
  role?: UserRole;
  isDemo?: boolean;
  prefs?: AccessibilityPreferences;
  updateAccessibilityPreferences?: (patch: Partial<AccessibilityPreferences>) => Promise<void>;
}): AuthContextValue {
  const uid = options?.uid ?? 'user-real-1';
  const profile = makeUserProfile({
    uid,
    role: options?.role ?? 'elderly',
    accessibilityPreferences: options?.prefs ?? { ...DEFAULT_PREFS },
  });

  return {
    firebaseUser: { uid } as unknown as User,
    userProfile: profile,
    isLoading: false,
    isDemo: options?.isDemo ?? false,
    signOut: vi.fn().mockResolvedValue(undefined),
    updateAccessibilityPreferences:
      options?.updateAccessibilityPreferences ?? vi.fn().mockResolvedValue(undefined),
  };
}

function makeDose(overrides?: Partial<DoseLogDocument>): DoseLogDocument {
  const ts = Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0));
  return {
    id: 'dose-haptic-1',
    patientId: 'patient-1',
    medicationId: 'med-1',
    medicationName: 'Metformin',
    dosage: '500mg',
    instructions: 'Take with water',
    color: '#0D9488',
    shape: 'round',
    scheduledDate: '2026-11-25',
    scheduledTime: ts,
    status: 'due',
    snoozeCount: 0,
    followUpSent: false,
    escalationAlertSent: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe('SettingsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    setMockNotification('default');
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
    restoreWindowGlobals();
    vi.clearAllMocks();
  });

  it('renders nothing when closed and renders accessible dialog with 44px controls when open', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <SettingsModal
        isOpen={false}
        onClose={onClose}
        preferences={DEFAULT_PREFS}
        onUpdatePreferences={vi.fn()}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <SettingsModal
        isOpen={true}
        onClose={onClose}
        preferences={DEFAULT_PREFS}
        onUpdatePreferences={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const titleId = dialog.getAttribute('aria-labelledby');
    expect(titleId).toBeTruthy();
    expect(document.getElementById(titleId as string)).toHaveTextContent(
      'Settings & Accessibility'
    );

    const closeBtn = screen.getByRole('button', { name: 'Close settings' });
    await waitFor(() => {
      expect(closeBtn).toHaveFocus();
    });

    const interactiveButtons = within(dialog).getAllByRole('button');
    const switches = within(dialog).getAllByRole('switch');
    expect(switches).toHaveLength(4);

    for (const control of [...interactiveButtons, ...switches]) {
      expect(control).toHaveClass('min-h-touch', 'min-w-touch');
    }
  });

  it('closes on Escape and backdrop click (but not inside card click), traps Tab/Shift+Tab, and restores focus', async () => {
    function TriggerHost() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open Settings Trigger
          </button>
          <SettingsModal
            isOpen={open}
            onClose={() => setOpen(false)}
            preferences={DEFAULT_PREFS}
            onUpdatePreferences={vi.fn()}
          />
        </div>
      );
    }

    render(<TriggerHost />);

    const trigger = screen.getByRole('button', { name: 'Open Settings Trigger' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    const closeBtn = screen.getByRole('button', { name: 'Close settings' });
    const doneBtn = screen.getByRole('button', { name: 'Done' });

    await waitFor(() => {
      expect(closeBtn).toHaveFocus();
    });

    // Shift+Tab from first focusable wraps to last (Done)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(doneBtn).toHaveFocus();

    // Tab from last focusable wraps back to first (Close settings)
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(closeBtn).toHaveFocus();

    // Clicking inside the dialog does NOT close
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Clicking backdrop closes and restores focus to trigger
    const backdrop = screen.getByRole('presentation');
    fireEvent.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    // Re-open and close with Escape
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Close settings' })).toHaveFocus();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('toggles all 4 accessibility switches and announces changes politely', () => {
    const onUpdatePreferences = vi.fn();

    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        preferences={{
          soundEnabled: true,
          hapticFeedback: true,
          highContrast: false,
          largeText: false,
        }}
        onUpdatePreferences={onUpdatePreferences}
      />
    );

    const soundSwitch = screen.getByRole('switch', { name: /Sound Effects/i });
    const hapticSwitch = screen.getByRole('switch', { name: /Haptic Feedback/i });
    const contrastSwitch = screen.getByRole('switch', { name: /High-Contrast Mode/i });
    const largeTextSwitch = screen.getByRole('switch', { name: /Large Text/i });

    expect(soundSwitch).toHaveAttribute('aria-checked', 'true');
    expect(hapticSwitch).toHaveAttribute('aria-checked', 'true');
    expect(contrastSwitch).toHaveAttribute('aria-checked', 'false');
    expect(largeTextSwitch).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(soundSwitch);
    expect(onUpdatePreferences).toHaveBeenNthCalledWith(1, { soundEnabled: false });
    expect(screen.getByRole('status')).toHaveTextContent('Sound Effects turned off.');

    fireEvent.click(hapticSwitch);
    expect(onUpdatePreferences).toHaveBeenNthCalledWith(2, { hapticFeedback: false });
    expect(screen.getByRole('status')).toHaveTextContent('Haptic Feedback turned off.');

    fireEvent.click(contrastSwitch);
    expect(onUpdatePreferences).toHaveBeenNthCalledWith(3, { highContrast: true });
    expect(screen.getByRole('status')).toHaveTextContent('High-Contrast Mode turned on.');

    fireEvent.click(largeTextSwitch);
    expect(onUpdatePreferences).toHaveBeenNthCalledWith(4, { largeText: true });
    expect(screen.getByRole('status')).toHaveTextContent('Large Text turned on.');
  });

  it('displays granted, denied, default, and unsupported notification states and handles permission request', async () => {
    // 1. Default -> requestPermission() resolves granted
    let resolvePerm: ((value: NotificationPermission) => void) | null = null;
    const requestMock = setMockNotification(
      'default',
      () =>
        new Promise<NotificationPermission>((resolve) => {
          resolvePerm = resolve;
        })
    );

    const { unmount } = render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        preferences={DEFAULT_PREFS}
        onUpdatePreferences={vi.fn()}
      />
    );

    expect(screen.getByTestId('notification-status-badge')).toHaveTextContent('Not Enabled');
    expect(screen.getByText(/client-side while MediMate stays open/i)).toBeInTheDocument();

    const enableBtn = screen.getByRole('button', { name: 'Enable Browser Notifications' });
    fireEvent.click(enableBtn);

    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(enableBtn).toBeDisabled();
    expect(enableBtn).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      resolvePerm?.('granted');
    });

    await waitFor(() => {
      expect(screen.getByTestId('notification-status-badge')).toHaveTextContent('Allowed');
    });
    expect(
      screen.queryByRole('button', { name: 'Enable Browser Notifications' })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Browser notifications enabled.');
    unmount();

    // 2. Granted
    setMockNotification('granted');
    const grantedView = render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        preferences={DEFAULT_PREFS}
        onUpdatePreferences={vi.fn()}
      />
    );
    expect(screen.getByTestId('notification-status-badge')).toHaveTextContent('Allowed');
    expect(
      screen.queryByRole('button', { name: 'Enable Browser Notifications' })
    ).not.toBeInTheDocument();
    grantedView.unmount();

    // 3. Denied
    setMockNotification('denied');
    const deniedView = render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        preferences={DEFAULT_PREFS}
        onUpdatePreferences={vi.fn()}
      />
    );
    expect(screen.getByTestId('notification-status-badge')).toHaveTextContent('Blocked');
    expect(screen.getByText(/blocked by your browser/i)).toBeInTheDocument();
    deniedView.unmount();

    // 4. Unsupported
    removeNotificationSupport();
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        preferences={DEFAULT_PREFS}
        onUpdatePreferences={vi.fn()}
      />
    );
    expect(screen.getByTestId('notification-status-badge')).toHaveTextContent('Unsupported');
    expect(screen.getByText(/does not support Web Notifications/i)).toBeInTheDocument();

    // 5. Registers FCM token when userId is provided and permission is granted
    mockRegisterFcmToken.mockClear();
    setMockNotification('default', async () => 'granted');
    render(
      <SettingsModal
        isOpen={true}
        onClose={vi.fn()}
        preferences={DEFAULT_PREFS}
        onUpdatePreferences={vi.fn()}
        userId="user-test-fcm-uid"
      />
    );
    const triggerBtn = screen.getByRole('button', { name: 'Enable Browser Notifications' });
    fireEvent.click(triggerBtn);
    await waitFor(() => {
      expect(mockRegisterFcmToken).toHaveBeenCalledWith('user-test-fcm-uid');
    });
  });
});

describe('useAuth accessibility preference persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    mockFirebaseSignOut.mockResolvedValue(undefined);
    mockGetUserDocument.mockResolvedValue(null);
    mockUpdateUserAccessibilityPreferences.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('persists demo user preferences in localStorage without Firestore writes and prevents auth-null clobbering', async () => {
    let authCb: AuthCallback | null = null;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      authCb = cb;
      return vi.fn();
    });

    const { result, unmount } = renderHook(() => useAuth());

    act(() => {
      result.current.loginAsDemo?.('elderly');
    });

    expect(result.current.isDemo).toBe(true);
    expect(result.current.userProfile?.uid).toBe('patient_ramesh');

    // Late onAuthStateChanged(null) must not clobber active demo session
    await act(async () => {
      await authCb?.(null);
    });
    expect(result.current.isDemo).toBe(true);
    expect(result.current.userProfile?.uid).toBe('patient_ramesh');

    // Rapid consecutive preference updates preserve both fields
    await act(async () => {
      await Promise.all([
        result.current.updateAccessibilityPreferences?.({ highContrast: true }),
        result.current.updateAccessibilityPreferences?.({ hapticFeedback: false }),
      ]);
    });

    expect(result.current.userProfile?.accessibilityPreferences).toEqual({
      highContrast: true,
      largeText: true,
      hapticFeedback: false,
      soundEnabled: true,
    });
    expect(mockUpdateUserAccessibilityPreferences).not.toHaveBeenCalled();

    const stored = JSON.parse(
      localStorage.getItem('medimate_a11y_prefs_patient_ramesh') ?? '{}'
    ) as AccessibilityPreferences;
    expect(stored.highContrast).toBe(true);
    expect(stored.hapticFeedback).toBe(false);

    unmount();

    // Fresh hook instance merges saved localStorage prefs when logging into demo again
    const { result: reloaded } = renderHook(() => useAuth());
    act(() => {
      reloaded.current.loginAsDemo?.('elderly');
    });
    expect(reloaded.current.userProfile?.accessibilityPreferences).toEqual({
      highContrast: true,
      largeText: true,
      hapticFeedback: false,
      soundEnabled: true,
    });
  });

  it('persists real authenticated user preferences to localStorage and Firestore and survives Firestore errors', async () => {
    let authCb: AuthCallback | null = null;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      authCb = cb;
      return vi.fn();
    });

    const realProfile = makeUserProfile({
      uid: 'real-uid-42',
      role: 'elderly',
      accessibilityPreferences: {
        highContrast: false,
        largeText: true,
        hapticFeedback: true,
        soundEnabled: true,
      },
    });
    mockGetUserDocument.mockResolvedValue(realProfile);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await authCb?.({ uid: 'real-uid-42', email: 'real@medimate.local' } as unknown as User);
    });

    expect(result.current.isDemo).toBe(false);
    expect(result.current.userProfile?.uid).toBe('real-uid-42');

    // Successful Firestore update
    await act(async () => {
      await result.current.updateAccessibilityPreferences?.({ soundEnabled: false });
    });

    expect(mockUpdateUserAccessibilityPreferences).toHaveBeenCalledWith('real-uid-42', {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: false,
    });
    expect(result.current.userProfile?.accessibilityPreferences.soundEnabled).toBe(false);

    // Firestore rejection does not throw or revert optimistic state/localStorage
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockUpdateUserAccessibilityPreferences.mockRejectedValueOnce(new Error('offline'));

    await act(async () => {
      await result.current.updateAccessibilityPreferences?.({ largeText: false });
    });

    expect(result.current.userProfile?.accessibilityPreferences.largeText).toBe(false);
    const stored = JSON.parse(
      localStorage.getItem('medimate_a11y_prefs_real-uid-42') ?? '{}'
    ) as AccessibilityPreferences;
    expect(stored.largeText).toBe(false);
    expect(stored.soundEnabled).toBe(false);
    warnSpy.mockRestore();
  });
});

describe('DoseCard hapticFeedback gating & AppShell <html> DOM sync', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
    restoreWindowGlobals();
    vi.clearAllMocks();
  });

  it('triggers navigator.vibrate when hapticFeedback is true or AuthProvider is absent, and suppresses when false', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      writable: true,
      value: vibrateMock,
    });

    // 1. Without AuthProvider -> defaults hapticFeedback to true
    const standaloneOnTaken = vi.fn();
    const standaloneOnSnooze = vi.fn();
    const standalone = render(
      <DoseCard
        dose={makeDose()}
        onTaken={standaloneOnTaken}
        onSnooze={standaloneOnSnooze}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Mark Metformin as Taken/i }));
    expect(vibrateMock).toHaveBeenCalledWith([40, 60, 40]);
    fireEvent.click(screen.getByRole('button', { name: /Remind Me Later/i }));
    expect(vibrateMock).toHaveBeenCalledWith(80);
    standalone.unmount();
    vibrateMock.mockClear();

    // 2. With AuthProvider and hapticFeedback: true
    const enabledView = render(
      <AuthProvider value={makeAuthValue({ prefs: { ...DEFAULT_PREFS, hapticFeedback: true } })}>
        <DoseCard dose={makeDose()} onTaken={vi.fn()} onSnooze={vi.fn()} />
      </AuthProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Mark Metformin as Taken/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remind Me Later/i }));
    expect(vibrateMock).toHaveBeenCalledTimes(2);
    enabledView.unmount();
    vibrateMock.mockClear();

    // 3. With AuthProvider and hapticFeedback: false -> suppressed
    render(
      <AuthProvider value={makeAuthValue({ prefs: { ...DEFAULT_PREFS, hapticFeedback: false } })}>
        <DoseCard dose={makeDose()} onTaken={vi.fn()} onSnooze={vi.fn()} />
      </AuthProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: /Mark Metformin as Taken/i }));
    fireEvent.click(screen.getByRole('button', { name: /Remind Me Later/i }));
    expect(vibrateMock).not.toHaveBeenCalled();
  });

  it('syncs highContrast and largeText classes/attributes on document.documentElement and opens SettingsModal from AppShell', () => {
    const updateSpy = vi.fn().mockResolvedValue(undefined);

    const { rerender, unmount } = render(
      <AuthProvider
        value={makeAuthValue({
          prefs: {
            highContrast: true,
            largeText: true,
            hapticFeedback: true,
            soundEnabled: true,
          },
          updateAccessibilityPreferences: updateSpy,
        })}
      >
        <AppShell>
          <div>Main Content</div>
        </AppShell>
      </AuthProvider>
    );

    expect(document.documentElement).toHaveClass('high-contrast', 'large-text');
    expect(document.documentElement).toHaveAttribute('data-high-contrast', 'true');
    expect(document.documentElement).toHaveAttribute('data-large-text', 'true');

    // Open Settings modal from AppShell header trigger
    const settingsBtn = screen.getByRole('button', { name: 'Settings and Accessibility' });
    expect(settingsBtn).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(settingsBtn);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('switch', { name: /High-Contrast Mode/i }));
    expect(updateSpy).toHaveBeenCalledWith({ highContrast: false });

    // Re-render with both flags turned off -> classes and attributes removed
    rerender(
      <AuthProvider
        value={makeAuthValue({
          prefs: {
            highContrast: false,
            largeText: false,
            hapticFeedback: true,
            soundEnabled: true,
          },
          updateAccessibilityPreferences: updateSpy,
        })}
      >
        <AppShell>
          <div>Main Content</div>
        </AppShell>
      </AuthProvider>
    );

    expect(document.documentElement).not.toHaveClass('high-contrast');
    expect(document.documentElement).not.toHaveClass('large-text');
    expect(document.documentElement).not.toHaveAttribute('data-high-contrast');
    expect(document.documentElement).not.toHaveAttribute('data-large-text');

    unmount();
  });
});
