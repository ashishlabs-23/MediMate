import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { useAuth } from '../../src/hooks/useAuth';
import type { AccessibilityPreferences, UserDocument } from '../../src/types/firestore';

type AuthCallback = (user: User | null) => void | Promise<void>;

const {
  mockAuthState,
  mockOnAuthStateChanged,
  mockFirebaseSignOut,
  mockGetUserDocument,
  mockUpdateUserAccessibilityPreferences,
} = vi.hoisted(() => ({
  mockAuthState: {
    name: 'mock-auth',
    currentUser: null as User | null,
  },
  mockOnAuthStateChanged: vi.fn<
    (auth: unknown, onNext: AuthCallback, onError?: (err: Error) => void) => () => void
  >(),
  mockFirebaseSignOut: vi.fn<() => Promise<void>>(),
  mockGetUserDocument: vi.fn<(uid: string) => Promise<UserDocument | null>>(),
  mockUpdateUserAccessibilityPreferences: vi.fn<
    (uid: string, prefs: AccessibilityPreferences) => Promise<void>
  >(),
}));

vi.mock('../../src/lib/firebase', () => ({
  auth: mockAuthState,
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

function makeProfile(overrides?: Partial<UserDocument>): UserDocument {
  const now = Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0));
  return {
    uid: 'user-1',
    email: 'user1@medimate.local',
    displayName: 'Kamala Iyer',
    role: 'elderly',
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('useAuth', () => {
  beforeEach(() => {
    localStorage.clear();
    mockAuthState.currentUser = null;
    mockFirebaseSignOut.mockResolvedValue(undefined);
    mockGetUserDocument.mockResolvedValue(null);
    mockUpdateUserAccessibilityPreferences.mockResolvedValue(undefined);
    mockOnAuthStateChanged.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('starts in loading state and resolves via safety timeout if Firebase Auth never emits', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAuth());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.firebaseUser).toBeUndefined();
    expect(result.current.userProfile).toBeNull();
    expect(result.current.isDemo).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(result.current.isLoading).toBe(false);
  });

  it('hydrates profile onAuthStateChanged, merges stored localStorage preferences, and handles null profile', async () => {
    let authCb: AuthCallback | null = null;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      authCb = cb;
      return vi.fn();
    });

    localStorage.setItem(
      'medimate_a11y_prefs_uid-hydrate-1',
      JSON.stringify({ highContrast: true, soundEnabled: false })
    );

    mockGetUserDocument.mockResolvedValueOnce(
      makeProfile({
        uid: 'uid-hydrate-1',
        role: 'caregiver',
        accessibilityPreferences: {
          highContrast: false,
          largeText: true,
          hapticFeedback: true,
          soundEnabled: true,
        },
      })
    );

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await authCb?.({ uid: 'uid-hydrate-1', email: 'c@medimate.local' } as unknown as User);
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isDemo).toBe(false);
    expect(result.current.userProfile?.uid).toBe('uid-hydrate-1');
    expect(result.current.userProfile?.role).toBe('caregiver');
    expect(result.current.userProfile?.accessibilityPreferences).toEqual({
      highContrast: true,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: false,
    });

    // Missing profile resolves cleanly to null
    mockGetUserDocument.mockResolvedValueOnce(null);
    await act(async () => {
      await authCb?.({ uid: 'uid-missing-doc', email: 'new@medimate.local' } as unknown as User);
    });

    expect(result.current.firebaseUser?.uid).toBe('uid-missing-doc');
    expect(result.current.userProfile).toBeNull();
  });

  it('refreshUserProfile hydrates from auth.currentUser fallback and skips demo sessions', async () => {
    mockOnAuthStateChanged.mockImplementation(() => vi.fn());
    const { result } = renderHook(() => useAuth());

    // Without user -> no-op
    await act(async () => {
      await result.current.refreshUserProfile?.();
    });
    expect(mockGetUserDocument).not.toHaveBeenCalled();

    // With auth.currentUser set right after signup (before onAuthStateChanged fires)
    const createdUser = { uid: 'uid-signup-1', email: 's@medimate.local' } as unknown as User;
    mockAuthState.currentUser = createdUser;
    mockGetUserDocument.mockResolvedValueOnce(
      makeProfile({ uid: 'uid-signup-1', role: 'caregiver', displayName: 'Priya' })
    );

    await act(async () => {
      await result.current.refreshUserProfile?.();
    });

    expect(mockGetUserDocument).toHaveBeenCalledWith('uid-signup-1');
    expect(result.current.firebaseUser?.uid).toBe('uid-signup-1');
    expect(result.current.userProfile?.role).toBe('caregiver');
    expect(result.current.userProfile?.displayName).toBe('Priya');

    // Demo session -> refreshUserProfile skips Firestore fetch
    mockGetUserDocument.mockClear();
    act(() => {
      result.current.loginAsDemo?.('elderly');
    });
    await act(async () => {
      await result.current.refreshUserProfile?.();
    });
    expect(mockGetUserDocument).not.toHaveBeenCalled();
  });

  it('prevents stale null onAuthStateChanged fetch from overwriting newer refreshUserProfile hydration', async () => {
    let authCb: AuthCallback | null = null;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      authCb = cb;
      return vi.fn();
    });

    let resolveStaleAuthFetch: ((val: UserDocument | null) => void) | null = null;
    const stalePromise = new Promise<UserDocument | null>((resolve) => {
      resolveStaleAuthFetch = resolve;
    });

    const freshProfile = makeProfile({
      uid: 'uid-race-1',
      role: 'caregiver',
      displayName: 'Fresh Caregiver',
    });

    mockGetUserDocument
      .mockReturnValueOnce(stalePromise)
      .mockResolvedValueOnce(freshProfile);

    const { result } = renderHook(() => useAuth());
    const userObj = { uid: 'uid-race-1', email: 'race@medimate.local' } as unknown as User;

    // 1. onAuthStateChanged fires immediately on signup while Firestore write is still in flight
    let authFetchDone: Promise<void> | undefined;
    act(() => {
      authFetchDone = Promise.resolve(authCb?.(userObj));
    });

    // 2. Signup completes upsertUserDocument and calls refreshUserProfile, which resolves first
    await act(async () => {
      await result.current.refreshUserProfile?.();
    });

    expect(result.current.userProfile?.role).toBe('caregiver');
    expect(result.current.userProfile?.displayName).toBe('Fresh Caregiver');

    // 3. The older onAuthStateChanged fetch now resolves with null -> MUST be ignored!
    await act(async () => {
      resolveStaleAuthFetch?.(null);
      await authFetchDone;
    });

    expect(result.current.userProfile?.role).toBe('caregiver');
    expect(result.current.userProfile?.displayName).toBe('Fresh Caregiver');
  });

  it('ignores out-of-order earlier refreshUserProfile calls and clears state on signOut', async () => {
    let authCb: AuthCallback | null = null;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      authCb = cb;
      return vi.fn();
    });

    let resolveFirstRefresh: ((val: UserDocument | null) => void) | null = null;
    const firstRefreshPromise = new Promise<UserDocument | null>((resolve) => {
      resolveFirstRefresh = resolve;
    });

    const initialProfile = makeProfile({ uid: 'uid-order-1', displayName: 'Initial' });
    const olderProfile = makeProfile({ uid: 'uid-order-1', displayName: 'Older Stale' });
    const latestProfile = makeProfile({ uid: 'uid-order-1', displayName: 'Latest Profile' });

    mockGetUserDocument
      .mockResolvedValueOnce(initialProfile)
      .mockReturnValueOnce(firstRefreshPromise)
      .mockResolvedValueOnce(latestProfile);

    const { result } = renderHook(() => useAuth());
    await act(async () => {
      await authCb?.({ uid: 'uid-order-1' } as unknown as User);
    });
    expect(result.current.userProfile?.displayName).toBe('Initial');

    let p1: Promise<void> | undefined;
    act(() => {
      p1 = result.current.refreshUserProfile?.();
    });

    await act(async () => {
      await result.current.refreshUserProfile?.();
    });
    expect(result.current.userProfile?.displayName).toBe('Latest Profile');

    await act(async () => {
      resolveFirstRefresh?.(olderProfile);
      await p1;
    });
    expect(result.current.userProfile?.displayName).toBe('Latest Profile');

    await act(async () => {
      await result.current.signOut();
    });

    expect(mockFirebaseSignOut).toHaveBeenCalledTimes(1);
    expect(result.current.firebaseUser).toBeNull();
    expect(result.current.userProfile).toBeNull();
    expect(result.current.isDemo).toBe(false);
  });

  it('exits demo mode and hydrates new real auth.currentUser on refreshUserProfile before onAuthStateChanged fires', async () => {
    mockOnAuthStateChanged.mockImplementation(() => vi.fn());
    const { result } = renderHook(() => useAuth());

    act(() => {
      result.current.loginAsDemo?.('elderly');
    });
    expect(result.current.isDemo).toBe(true);
    expect(result.current.userProfile?.uid).toBe('patient_ramesh');

    mockAuthState.currentUser = {
      uid: 'real-after-demo',
      email: 'real@medimate.local',
    } as unknown as User;
    mockGetUserDocument.mockResolvedValueOnce(
      makeProfile({
        uid: 'real-after-demo',
        role: 'caregiver',
        displayName: 'Real Caregiver',
      })
    );

    await act(async () => {
      await result.current.refreshUserProfile?.();
    });

    expect(mockGetUserDocument).toHaveBeenCalledWith('real-after-demo');
    expect(result.current.isDemo).toBe(false);
    expect(result.current.firebaseUser?.uid).toBe('real-after-demo');
    expect(result.current.userProfile?.uid).toBe('real-after-demo');
    expect(result.current.userProfile?.role).toBe('caregiver');
    expect(result.current.userProfile?.displayName).toBe('Real Caregiver');
  });

  it('switches to new auth.currentUser on refreshUserProfile and clears prior userProfile if new doc is missing or fails', async () => {
    let authCb: AuthCallback | null = null;
    mockOnAuthStateChanged.mockImplementation((_auth, cb) => {
      authCb = cb;
      return vi.fn();
    });

    mockGetUserDocument.mockResolvedValueOnce(
      makeProfile({ uid: 'user-A', role: 'elderly', displayName: 'User A' })
    );

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await authCb?.({ uid: 'user-A', email: 'a@medimate.local' } as unknown as User);
    });
    expect(result.current.userProfile?.uid).toBe('user-A');

    // Switch to user-B before onAuthStateChanged emits
    mockAuthState.currentUser = {
      uid: 'user-B',
      email: 'b@medimate.local',
    } as unknown as User;
    mockGetUserDocument.mockResolvedValueOnce(
      makeProfile({ uid: 'user-B', role: 'caregiver', displayName: 'User B' })
    );

    await act(async () => {
      await result.current.refreshUserProfile?.();
    });

    expect(mockGetUserDocument).toHaveBeenLastCalledWith('user-B');
    expect(result.current.firebaseUser?.uid).toBe('user-B');
    expect(result.current.userProfile?.uid).toBe('user-B');
    expect(result.current.userProfile?.role).toBe('caregiver');

    // Switch to user-C whose Firestore doc is missing -> must NOT retain user-B's profile
    mockAuthState.currentUser = {
      uid: 'user-C',
      email: 'c@medimate.local',
    } as unknown as User;
    mockGetUserDocument.mockResolvedValueOnce(null);

    await act(async () => {
      await result.current.refreshUserProfile?.();
    });

    expect(mockGetUserDocument).toHaveBeenLastCalledWith('user-C');
    expect(result.current.firebaseUser?.uid).toBe('user-C');
    expect(result.current.userProfile).toBeNull();

    // Switch to user-D whose getUserDocument rejects -> must NOT retain a prior profile
    mockAuthState.currentUser = {
      uid: 'user-B',
      email: 'b@medimate.local',
    } as unknown as User;
    mockGetUserDocument.mockResolvedValueOnce(
      makeProfile({ uid: 'user-B', role: 'caregiver', displayName: 'User B' })
    );
    await act(async () => {
      await result.current.refreshUserProfile?.();
    });
    expect(result.current.userProfile?.uid).toBe('user-B');

    mockAuthState.currentUser = {
      uid: 'user-D',
      email: 'd@medimate.local',
    } as unknown as User;
    mockGetUserDocument.mockRejectedValueOnce(new Error('network unavailable'));

    await act(async () => {
      await result.current.refreshUserProfile?.();
    });

    expect(mockGetUserDocument).toHaveBeenLastCalledWith('user-D');
    expect(result.current.firebaseUser?.uid).toBe('user-D');
    expect(result.current.userProfile).toBeNull();
  });
});
