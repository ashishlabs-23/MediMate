/**
 * useAuth — Firebase Auth state + Firestore user profile + Accessibility preference persistence.
 *
 * Returns:
 *   firebaseUser                 — undefined while loading, null when signed out, User when signed in.
 *   userProfile                  — Firestore UserDocument (null while loading or missing).
 *   isLoading                    — true until auth state is first resolved.
 *   isDemo                       — true when an in-app demo persona session is active.
 *   signOut                      — async function to sign out.
 *   loginAsDemo                  — immediate demo persona login with localStorage preference hydration.
 *   updateAccessibilityPreferences — optimistic + localStorage + best-effort Firestore preference updater.
 *   refreshUserProfile           — re-fetches and hydrates the current user's Firestore profile.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { auth } from '../lib/firebase';
import { getUserDocument, updateUserAccessibilityPreferences } from '../lib/firestore';
import type { AccessibilityPreferences, UserDocument, UserRole } from '../types/firestore';
import type { AuthContextValue } from '../contexts/AuthContext';

const DEFAULT_ACCESSIBILITY_PREFERENCES: AccessibilityPreferences = {
  highContrast: false,
  largeText: true,
  hapticFeedback: true,
  soundEnabled: true,
};

function a11yStorageKey(uid: string): string {
  return `medimate_a11y_prefs_${uid}`;
}

function isDemoUid(uid: string): boolean {
  return uid === 'patient_ramesh' || uid === 'caregiver_priya' || uid.startsWith('demo_');
}

function mergeStoredA11yPrefs(
  uid: string,
  base: AccessibilityPreferences
): AccessibilityPreferences {
  if (typeof localStorage === 'undefined') {
    return base;
  }
  try {
    const raw = localStorage.getItem(a11yStorageKey(uid));
    if (!raw) return base;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return base;
    }
    const candidate = parsed as Record<string, unknown>;
    return {
      highContrast:
        typeof candidate.highContrast === 'boolean' ? candidate.highContrast : base.highContrast,
      largeText:
        typeof candidate.largeText === 'boolean' ? candidate.largeText : base.largeText,
      hapticFeedback:
        typeof candidate.hapticFeedback === 'boolean'
          ? candidate.hapticFeedback
          : base.hapticFeedback,
      soundEnabled:
        typeof candidate.soundEnabled === 'boolean' ? candidate.soundEnabled : base.soundEnabled,
    };
  } catch {
    return base;
  }
}

function writeStoredA11yPrefs(uid: string, prefs: AccessibilityPreferences): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(a11yStorageKey(uid), JSON.stringify(prefs));
  } catch {
    // Ignore storage quota or private-browsing errors
  }
}

export function useAuth(): AuthContextValue {
  const [firebaseUser, setFirebaseUser] = useState<User | null | undefined>(undefined);
  const [userProfile, setUserProfile] = useState<UserDocument | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDemo, setIsDemo] = useState(false);

  const isMounted = useRef(true);
  const isDemoRef = useRef(false);
  const firebaseUserRef = useRef<User | null | undefined>(undefined);
  const userProfileRef = useRef<UserDocument | null>(null);
  const profileFetchSeqRef = useRef(0);

  useEffect(() => {
    isMounted.current = true;

    // Safety timeout: ensure loading state resolves even if Firebase Auth is unreachable or unconfigured
    const timeout = setTimeout(() => {
      if (isMounted.current) {
        setIsLoading(false);
      }
    }, 2000);

    let unsubscribe: () => void = () => {};

    try {
      unsubscribe = onAuthStateChanged(
        auth,
        async (user) => {
          if (!isMounted.current) return;

          if (user) {
            const demoSession = isDemoUid(user.uid);
            isDemoRef.current = demoSession;
            setIsDemo(demoSession);
            firebaseUserRef.current = user;
            setFirebaseUser(user);

            const seq = ++profileFetchSeqRef.current;
            try {
              const profile = await getUserDocument(user.uid);
              if (
                isMounted.current &&
                !isDemoRef.current &&
                firebaseUserRef.current?.uid === user.uid &&
                profileFetchSeqRef.current === seq
              ) {
                if (profile) {
                  const mergedPrefs = mergeStoredA11yPrefs(
                    user.uid,
                    profile.accessibilityPreferences ?? DEFAULT_ACCESSIBILITY_PREFERENCES
                  );
                  const hydratedProfile: UserDocument = {
                    ...profile,
                    accessibilityPreferences: mergedPrefs,
                  };
                  userProfileRef.current = hydratedProfile;
                  setUserProfile(hydratedProfile);
                } else {
                  userProfileRef.current = null;
                  setUserProfile(null);
                }
              }
            } catch {
              if (
                isMounted.current &&
                !isDemoRef.current &&
                firebaseUserRef.current?.uid === user.uid &&
                profileFetchSeqRef.current === seq
              ) {
                userProfileRef.current = null;
                setUserProfile(null);
              }
            }
          } else if (!isDemoRef.current) {
            profileFetchSeqRef.current += 1;
            isDemoRef.current = false;
            setIsDemo(false);
            firebaseUserRef.current = null;
            setFirebaseUser(null);
            userProfileRef.current = null;
            setUserProfile(null);
          }

          if (isMounted.current) {
            setIsLoading(false);
          }
        },
        (error) => {
          console.warn('Firebase onAuthStateChanged error:', error);
          if (isMounted.current) {
            setIsLoading(false);
          }
        }
      );
    } catch (err) {
      console.warn('Firebase auth initialization error:', err);
      if (isMounted.current) {
        setIsLoading(false);
      }
    }

    return () => {
      isMounted.current = false;
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    profileFetchSeqRef.current += 1;
    isDemoRef.current = false;
    setIsDemo(false);
    try {
      await firebaseSignOut(auth);
    } catch (err) {
      console.warn('Sign out error:', err);
    }
    firebaseUserRef.current = null;
    userProfileRef.current = null;
    setFirebaseUser(null);
    setUserProfile(null);
  }, []);

  const loginAsDemo = useCallback((role: UserRole): void => {
    profileFetchSeqRef.current += 1;
    const mockUid = role === 'caregiver' ? 'caregiver_priya' : 'patient_ramesh';
    const displayName = role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma';
    const mockUser = {
      uid: mockUid,
      email: `${mockUid}@medimate.local`,
      displayName,
    } as unknown as User;

    const mergedPrefs = mergeStoredA11yPrefs(mockUid, DEFAULT_ACCESSIBILITY_PREFERENCES);
    const demoProfile: UserDocument = {
      uid: mockUid,
      email: `${mockUid}@medimate.local`,
      displayName,
      role,
      timezone: 'Asia/Kolkata',
      fcmTokens: [],
      accessibilityPreferences: mergedPrefs,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    isDemoRef.current = true;
    setIsDemo(true);
    firebaseUserRef.current = mockUser;
    userProfileRef.current = demoProfile;
    setFirebaseUser(mockUser);
    setUserProfile(demoProfile);
    setIsLoading(false);
  }, []);

  const refreshUserProfile = useCallback(async (): Promise<void> => {
    const activeUser = firebaseUserRef.current ?? auth?.currentUser ?? null;
    if (!activeUser || isDemoRef.current || isDemoUid(activeUser.uid)) {
      return;
    }

    if (!firebaseUserRef.current) {
      firebaseUserRef.current = activeUser;
      if (isMounted.current) {
        setFirebaseUser(activeUser);
        setIsDemo(false);
        setIsLoading(false);
      }
    }

    const seq = ++profileFetchSeqRef.current;
    try {
      const profile = await getUserDocument(activeUser.uid);
      if (
        !isMounted.current ||
        isDemoRef.current ||
        firebaseUserRef.current?.uid !== activeUser.uid ||
        profileFetchSeqRef.current !== seq
      ) {
        return;
      }

      if (profile) {
        const mergedPrefs = mergeStoredA11yPrefs(
          activeUser.uid,
          profile.accessibilityPreferences ?? DEFAULT_ACCESSIBILITY_PREFERENCES
        );
        const hydratedProfile: UserDocument = {
          ...profile,
          accessibilityPreferences: mergedPrefs,
        };
        userProfileRef.current = hydratedProfile;
        setUserProfile(hydratedProfile);
      } else {
        userProfileRef.current = null;
        setUserProfile(null);
      }
    } catch (err) {
      console.warn('Failed to refresh user profile:', err);
    }
  }, []);

  const updateAccessibilityPreferences = useCallback(
    async (patch: Partial<AccessibilityPreferences>): Promise<void> => {
      profileFetchSeqRef.current += 1;
      const currentProfile = userProfileRef.current;
      const uid = currentProfile?.uid ?? firebaseUserRef.current?.uid ?? '';
      const base = currentProfile?.accessibilityPreferences ?? DEFAULT_ACCESSIBILITY_PREFERENCES;

      const mergedPrefs: AccessibilityPreferences = {
        highContrast:
          typeof patch.highContrast === 'boolean' ? patch.highContrast : base.highContrast,
        largeText: typeof patch.largeText === 'boolean' ? patch.largeText : base.largeText,
        hapticFeedback:
          typeof patch.hapticFeedback === 'boolean'
            ? patch.hapticFeedback
            : base.hapticFeedback,
        soundEnabled:
          typeof patch.soundEnabled === 'boolean' ? patch.soundEnabled : base.soundEnabled,
      };

      if (currentProfile) {
        const nextProfile: UserDocument = {
          ...currentProfile,
          accessibilityPreferences: mergedPrefs,
        };
        userProfileRef.current = nextProfile;
        setUserProfile(nextProfile);
      }

      if (uid) {
        writeStoredA11yPrefs(uid, mergedPrefs);
        if (!isDemoRef.current && !isDemoUid(uid)) {
          try {
            await updateUserAccessibilityPreferences(uid, mergedPrefs);
          } catch (err) {
            console.warn('Failed to persist accessibility preferences to Firestore:', err);
          }
        }
      }
    },
    []
  );

  return {
    firebaseUser,
    userProfile,
    isLoading,
    isDemo,
    signOut,
    loginAsDemo,
    updateAccessibilityPreferences,
    refreshUserProfile,
  };
}
