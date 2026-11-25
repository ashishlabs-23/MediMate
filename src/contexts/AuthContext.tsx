/**
 * AuthContext — provides current Firebase Auth user and their Firestore profile.
 * Wraps useAuth hook for consumption throughout the component tree.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import type { AccessibilityPreferences, UserDocument, UserRole } from '../types/firestore';

export interface AuthContextValue {
  /** Firebase Auth user (null = not signed in, undefined = loading). */
  firebaseUser: User | null | undefined;
  /** Firestore user profile (null = not found/loading). */
  userProfile: UserDocument | null;
  /** Whether the auth state is still being determined. */
  isLoading: boolean;
  /** Whether the current session is a local demo session. */
  isDemo?: boolean | undefined;
  /** Sign-out helper (delegates to Firebase Auth). */
  signOut: () => Promise<void>;
  /** Fast demo persona switch for immediate UI evaluation. */
  loginAsDemo?: ((role: UserRole) => Promise<void> | void) | undefined;
  /** Optimistically updates accessibility preferences in state, localStorage, and Firestore. */
  updateAccessibilityPreferences?:
    | ((patch: Partial<AccessibilityPreferences>) => Promise<void>)
    | undefined;
}

// eslint-disable-next-line react-refresh/only-export-components
export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/** Must be called inside <AuthProvider>. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return ctx;
}

export function AuthProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: AuthContextValue;
}) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
