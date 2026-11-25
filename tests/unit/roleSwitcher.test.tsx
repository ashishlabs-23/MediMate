import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { AppShell } from '../../src/components/layout/AppShell';
import { AuthProvider, type AuthContextValue } from '../../src/contexts/AuthContext';
import type { UserDocument, UserRole } from '../../src/types/firestore';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-route">{location.pathname}</div>;
}

function makeAuthContext(options: {
  uid: string;
  role: UserRole;
  isDemo?: boolean;
  signOut?: () => Promise<void>;
}): AuthContextValue {
  const now = Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0));
  const userProfile: UserDocument = {
    uid: options.uid,
    email: `${options.uid}@medimate.local`,
    displayName: options.role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma',
    role: options.role,
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: false,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    firebaseUser: { uid: options.uid } as unknown as User,
    userProfile,
    isLoading: false,
    isDemo: options.isDemo ?? false,
    signOut: options.signOut ?? vi.fn().mockResolvedValue(undefined),
    updateAccessibilityPreferences: vi.fn().mockResolvedValue(undefined),
  };
}

function renderRoutedShell(authValue: AuthContextValue, initialPath = '/app/today') {
  return render(
    <AuthProvider value={authValue}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route
            path="/app/today"
            element={
              <AppShell>
                <LocationProbe />
                <div>Today View Content</div>
              </AppShell>
            }
          />
          <Route
            path="/app/caregiver"
            element={
              <AppShell>
                <LocationProbe />
                <div>Caregiver View Content</div>
              </AppShell>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
}

describe('AppShell Dual Role Switcher', () => {
  afterEach(() => {
    cleanup();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-high-contrast');
    document.documentElement.removeAttribute('data-large-text');
    vi.clearAllMocks();
  });

  it('renders switcher for dual-role users and navigates between /app/today and /app/caregiver without calling signOut', () => {
    const signOut = vi.fn().mockResolvedValue(undefined);
    renderRoutedShell(
      makeAuthContext({ uid: 'dual-user-1', role: 'dual', isDemo: false, signOut }),
      '/app/today'
    );

    const group = screen.getByRole('group', { name: 'Switch view mode' });
    expect(group).toBeInTheDocument();

    const simpleBtn = screen.getByRole('button', { name: 'Simple Mode' });
    const caregiverBtn = screen.getByRole('button', { name: 'Caregiver View' });

    expect(simpleBtn).toHaveClass('min-h-touch', 'min-w-touch');
    expect(caregiverBtn).toHaveClass('min-h-touch', 'min-w-touch');
    expect(simpleBtn).toHaveAttribute('aria-pressed', 'true');
    expect(caregiverBtn).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('current-route')).toHaveTextContent('/app/today');

    // Switch to Caregiver View
    fireEvent.click(caregiverBtn);
    expect(screen.getByTestId('current-route')).toHaveTextContent('/app/caregiver');
    expect(screen.getByRole('button', { name: 'Caregiver View' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getByRole('button', { name: 'Simple Mode' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(signOut).not.toHaveBeenCalled();

    // Switch back to Simple Mode
    fireEvent.click(screen.getByRole('button', { name: 'Simple Mode' }));
    expect(screen.getByTestId('current-route')).toHaveTextContent('/app/today');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('renders switcher for demo users (patient_ramesh, caregiver_priya, and explicit isDemo=true)', () => {
    // 1. Demo elderly (patient_ramesh)
    const rameshView = renderRoutedShell(
      makeAuthContext({ uid: 'patient_ramesh', role: 'elderly' }),
      '/app/today'
    );
    expect(screen.getByRole('group', { name: 'Switch view mode' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Caregiver View' }));
    expect(screen.getByTestId('current-route')).toHaveTextContent('/app/caregiver');
    rameshView.unmount();

    // 2. Demo caregiver (caregiver_priya) starting on /app/caregiver
    const priyaView = renderRoutedShell(
      makeAuthContext({ uid: 'caregiver_priya', role: 'caregiver' }),
      '/app/caregiver'
    );
    expect(screen.getByRole('button', { name: 'Caregiver View' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Simple Mode' }));
    expect(screen.getByTestId('current-route')).toHaveTextContent('/app/today');
    priyaView.unmount();

    // 3. Explicit isDemo: true with custom uid
    renderRoutedShell(
      makeAuthContext({ uid: 'sandbox-user-99', role: 'elderly', isDemo: true }),
      '/app/today'
    );
    expect(screen.getByRole('group', { name: 'Switch view mode' })).toBeInTheDocument();
  });

  it('does NOT render switcher for single-role non-demo elderly or caregiver users', () => {
    const elderlyView = renderRoutedShell(
      makeAuthContext({ uid: 'real-elderly-1', role: 'elderly', isDemo: false }),
      '/app/today'
    );
    expect(screen.queryByRole('group', { name: 'Switch view mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Caregiver View' })).not.toBeInTheDocument();
    elderlyView.unmount();

    renderRoutedShell(
      makeAuthContext({ uid: 'real-caregiver-1', role: 'caregiver', isDemo: false }),
      '/app/caregiver'
    );
    expect(screen.queryByRole('group', { name: 'Switch view mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Simple Mode' })).not.toBeInTheDocument();
  });

  it('renders safely outside a Router and with partial AuthContext mocks (regression safety)', () => {
    const partialDemoAuth = {
      firebaseUser: { uid: 'caregiver_priya' },
      userProfile: { role: 'caregiver', displayName: 'Priya Sharma' },
      isLoading: false,
      signOut: vi.fn().mockResolvedValue(undefined),
    } as unknown as AuthContextValue;

    render(
      <AuthProvider value={partialDemoAuth}>
        <AppShell>
          <div>Routerless Content</div>
        </AppShell>
      </AuthProvider>
    );

    expect(screen.getByText('Routerless Content')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings and Accessibility' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Switch view mode' })).not.toBeInTheDocument();
  });
});
