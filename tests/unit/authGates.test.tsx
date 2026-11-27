import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { AuthProvider, type AuthContextValue } from '../../src/contexts/AuthContext';
import { CompleteProfileGate, EmailVerificationGate } from '../../src/components/auth/AuthGates';
import type { UserDocument } from '../../src/types/firestore';
import { Timestamp } from 'firebase/firestore';

const {
  mockReload,
  mockSendEmailVerification,
  mockGetUserDocument,
  mockSaveUserProfileWithUsername,
} = vi.hoisted(() => ({
  mockReload: vi.fn(),
  mockSendEmailVerification: vi.fn(),
  mockGetUserDocument: vi.fn(),
  mockSaveUserProfileWithUsername: vi.fn(),
}));

vi.mock('firebase/auth', () => ({
  reload: (...args: unknown[]) => mockReload(...args),
  sendEmailVerification: (...args: unknown[]) => mockSendEmailVerification(...args),
}));

vi.mock('../../src/lib/firebase', () => ({ auth: {} }));

vi.mock('../../src/lib/firestore', () => ({
  getUserDocument: (...args: unknown[]) => mockGetUserDocument(...args),
  saveUserProfileWithUsername: (...args: unknown[]) => mockSaveUserProfileWithUsername(...args),
}));

function makeProfile(overrides?: Partial<UserDocument>): UserDocument {
  const timestamp = Timestamp.fromDate(new Date(2026, 10, 25));
  return {
    uid: 'user-1',
    email: 'user@example.com',
    displayName: 'Sample User',
    role: 'elderly',
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function renderGate(
  route: '/verify-email' | '/complete-profile',
  user: User,
  initialState?: unknown
) {
  const refreshUserProfile = vi.fn().mockResolvedValue(undefined);
  const value: AuthContextValue = {
    firebaseUser: user,
    userProfile: null,
    isLoading: false,
    isDemo: false,
    signOut: vi.fn().mockResolvedValue(undefined),
    refreshUserProfile,
  };

  render(
    <AuthProvider value={value}>
      <MemoryRouter initialEntries={[{ pathname: route, state: initialState }]}>
        <Routes>
          <Route path="/verify-email" element={<EmailVerificationGate />} />
          <Route path="/complete-profile" element={<CompleteProfileGate />} />
          <Route path="/app/today" element={<div data-testid="route-today">Today</div>} />
          <Route path="/app/caregiver" element={<div data-testid="route-caregiver">Caregiver</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
  return { refreshUserProfile };
}

describe('authentication onboarding gates', () => {
  beforeEach(() => {
    sessionStorage.clear();
    mockReload.mockReset();
    mockSendEmailVerification.mockReset().mockResolvedValue(undefined);
    mockGetUserDocument.mockReset();
    mockSaveUserProfileWithUsername.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('resends verification with a 60-second cooldown and routes after refresh confirms verification', async () => {
    const user = {
      uid: 'unverified-1',
      email: 'user@example.com',
      emailVerified: false,
      providerData: [{ providerId: 'password' }],
    } as unknown as User;
    mockReload.mockImplementation(async () => {
      (user as { emailVerified: boolean }).emailVerified = true;
    });
    mockGetUserDocument.mockResolvedValue(makeProfile({ uid: user.uid, username: 'verified_user' }));

    const { refreshUserProfile } = renderGate('/verify-email', user);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    });
    expect(mockSendEmailVerification).toHaveBeenCalledWith(user);
    expect(screen.getByRole('button', { name: /Resend available in 60s/i })).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /I verified my email/i }));
    });
    expect(mockReload).toHaveBeenCalledWith(user);
    expect(refreshUserProfile).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByTestId('route-today')).toBeInTheDocument());
  });

  it('requires a valid username and saves the selected onboarding role before app entry', async () => {
    const user = {
      uid: 'google-first-user',
      email: 'new@example.com',
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    } as unknown as User;
    mockGetUserDocument.mockResolvedValue(makeProfile({
      uid: user.uid,
      email: user.email ?? '',
      username: 'new_member',
      role: 'caregiver',
    }));

    renderGate('/complete-profile', user, { onboardingRole: 'caregiver' });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'New Member' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save username and continue' }));
    });

    expect(mockSaveUserProfileWithUsername).toHaveBeenCalledWith(
      user.uid,
      'New Member',
      expect.objectContaining({ role: 'caregiver', email: 'new@example.com' })
    );
    await waitFor(() => expect(screen.getByTestId('route-caregiver')).toBeInTheDocument());
  });

  it('ignores an external redirect value after profile completion', async () => {
    const user = {
      uid: 'google-first-user',
      email: 'new@example.com',
      emailVerified: true,
      providerData: [{ providerId: 'google.com' }],
    } as unknown as User;
    mockGetUserDocument.mockResolvedValue(makeProfile({
      uid: user.uid,
      email: user.email ?? '',
      username: 'new_member',
      role: 'caregiver',
    }));

    renderGate('/complete-profile', user, {
      onboardingRole: 'caregiver',
      redirectTo: '//example.com',
    });
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'New Member' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save username and continue' }));
    });

    await waitFor(() => expect(screen.getByTestId('route-caregiver')).toBeInTheDocument());
    expect(window.location.pathname).not.toContain('example.com');
  });
});
