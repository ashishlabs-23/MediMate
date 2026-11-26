import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { AppShell } from '../../src/components/layout/AppShell';
import { AuthProvider, type AuthContextValue } from '../../src/contexts/AuthContext';
import type { UserDocument, UserRole } from '../../src/types/firestore';

function makeAuthValue(options: {
  uid: string;
  role: UserRole;
  isDemo?: boolean;
  signOut?: () => Promise<void>;
  highContrast?: boolean;
}): AuthContextValue {
  const now = Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0));
  const profile: UserDocument = {
    uid: options.uid,
    email: `${options.uid}@medimate.local`,
    displayName: options.role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma',
    role: options.role,
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: options.highContrast ?? false,
      largeText: false,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    firebaseUser: { uid: options.uid } as unknown as User,
    userProfile: profile,
    isLoading: false,
    ...(options.isDemo !== undefined ? { isDemo: options.isDemo } : {}),
    signOut: options.signOut ?? vi.fn().mockResolvedValue(undefined),
    updateAccessibilityPreferences: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AppShell Trial Mode Banner & Layout', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
    vi.clearAllMocks();
  });

  it('renders Trial Mode banner inside <header> below <nav> when isDemo is true', () => {
    render(
      <AuthProvider value={makeAuthValue({ uid: 'patient_ramesh', role: 'elderly', isDemo: true })}>
        <MemoryRouter initialEntries={['/app/today']}>
          <AppShell>
            <div>Main Body</div>
          </AppShell>
        </MemoryRouter>
      </AuthProvider>
    );

    const header = screen.getByRole('banner');
    const nav = screen.getByRole('navigation', { name: 'Main navigation' });
    const trialBanner = screen.getByTestId('trial-mode-banner');
    const main = screen.getByRole('main');

    expect(header).toContainElement(trialBanner);
    expect(trialBanner).toHaveAttribute('role', 'note');
    expect(trialBanner).toHaveTextContent(/Trial Mode · Sample Data/i);
    expect(trialBanner).toHaveTextContent(/not saved to a personal account/i);

    // Order: <nav> -> trialBanner -> <main>
    expect(nav.compareDocumentPosition(trialBanner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(trialBanner.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Preserves role="status" uniqueness (banner does NOT use role="status")
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('infers demo session from demo UIDs even when isDemo flag is omitted and renders safely outside Router', () => {
    for (const uid of ['patient_ramesh', 'caregiver_priya', 'demo_guest_1']) {
      const { unmount } = render(
        <AuthProvider value={makeAuthValue({ uid, role: 'elderly' })}>
          <AppShell>
            <div>Routerless Demo</div>
          </AppShell>
        </AuthProvider>
      );

      expect(screen.getByTestId('trial-mode-banner')).toBeInTheDocument();
      unmount();
    }
  });

  it('does NOT render Trial Mode banner for real authenticated users', () => {
    render(
      <AuthProvider value={makeAuthValue({ uid: 'real-firebase-uid', role: 'caregiver', isDemo: false })}>
        <MemoryRouter initialEntries={['/app/caregiver']}>
          <AppShell>
            <div>Real User Dashboard</div>
          </AppShell>
        </MemoryRouter>
      </AuthProvider>
    );

    expect(screen.queryByTestId('trial-mode-banner')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Role: Caregiver')).toBeInTheDocument();
  });

  it('calls signOut when Sign out button is clicked and applies high-contrast CSS tokens cleanly', () => {
    const signOutSpy = vi.fn().mockResolvedValue(undefined);
    render(
      <AuthProvider
        value={makeAuthValue({
          uid: 'patient_ramesh',
          role: 'elderly',
          isDemo: true,
          highContrast: true,
          signOut: signOutSpy,
        })}
      >
        <AppShell>
          <div>Demo High Contrast</div>
        </AppShell>
      </AuthProvider>
    );

    const trialBanner = screen.getByTestId('trial-mode-banner');
    expect(trialBanner).toHaveClass('bg-brand-teal-dark', 'text-white');
    expect(document.documentElement).toHaveClass('high-contrast');

    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });
});
