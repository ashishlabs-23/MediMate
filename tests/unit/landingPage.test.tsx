import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { User } from 'firebase/auth';
import { Timestamp } from 'firebase/firestore';
import { AuthProvider, type AuthContextValue } from '@/contexts/AuthContext';
import type { UserDocument, UserRole } from '@/types/firestore';
import { LandingPage } from '@/pages/LandingPage';
import { checkAriaCompliance, checkTouchTarget } from '../e2e/harness/accessibilityHelper';

vi.mock('@/hooks/useAuth', () => ({
  useAuth: vi.fn(),
}));

vi.mock('@/pages/TodayView', () => ({
  TodayView: () => <div data-testid="today-view">TodayView</div>,
}));

vi.mock('@/pages/CaregiverDashboard', () => ({
  CaregiverDashboard: () => <div data-testid="caregiver-dashboard">CaregiverDashboard</div>,
}));

vi.mock('@/components/auth/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen">LoginScreen</div>,
}));

import { AppRoutes } from '@/App';

function makeUserProfile(role: UserRole): UserDocument {
  return {
    uid: role === 'caregiver' ? 'caregiver_priya' : 'patient_ramesh',
    email: `${role}@medimate.local`,
    displayName: role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma',
    role,
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: Timestamp.fromMillis(1_700_000_000_000),
    updatedAt: Timestamp.fromMillis(1_700_000_000_000),
  };
}

function makeAuthValue(options: {
  isLoading?: boolean;
  authenticated?: boolean;
  role?: UserRole;
}): AuthContextValue {
  const isLoading = options.isLoading ?? false;
  const authenticated = options.authenticated ?? false;
  const role = options.role ?? 'elderly';

  const firebaseUser: User | null | undefined = isLoading
    ? undefined
    : authenticated
      ? ({
          uid: role === 'caregiver' ? 'caregiver_priya' : 'patient_ramesh',
          email: `${role}@medimate.local`,
          displayName: role === 'caregiver' ? 'Priya Sharma' : 'Ramesh Sharma',
        } as unknown as User)
      : null;

  return {
    firebaseUser,
    userProfile: authenticated ? makeUserProfile(role) : null,
    isLoading,
    signOut: vi.fn(async () => {}),
  };
}

function renderLanding() {
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>
  );
}

describe('LandingPage & R1 Public Routing', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders header navigation, UN SDG 3 badge, hero Today mockup, and /login CTAs', () => {
    renderLanding();

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();

    const headingsLevel1 = screen.getAllByRole('heading', { level: 1 });
    expect(headingsLevel1).toHaveLength(1);
    expect(headingsLevel1[0]).toHaveTextContent(/calm daily medicine reminders/i);

    expect(screen.getAllByText(/UN SDG 3/i).length).toBeGreaterThanOrEqual(1);

    const signInLinks = screen.getAllByRole('link', { name: /sign in/i });
    const getStartedLinks = screen.getAllByRole('link', { name: /get started/i });
    expect(signInLinks.length).toBeGreaterThanOrEqual(1);
    expect(getStartedLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of [...signInLinks, ...getStartedLinks]) {
      expect(link).toHaveAttribute('href', '/login');
    }

    const howItWorksCta = screen.getByRole('link', { name: /see how it works/i });
    expect(howItWorksCta).toHaveAttribute('href', '#how-it-works');

    const hero = document.getElementById('hero');
    expect(hero).not.toBeNull();
    if (hero) {
      expect(within(hero).getByText('Metformin')).toBeInTheDocument();
      expect(within(hero).getByText('500 mg')).toBeInTheDocument();
      expect(within(hero).getByRole('button', { name: /taken/i })).toBeInTheDocument();
    }
  });

  it('renders all required sections including Daily Worry, How It Works, Dual Previews, Features, Safety & Boundary, FAQs, and Footer', () => {
    renderLanding();

    expect(document.getElementById('daily-worry')).toBeInTheDocument();
    expect(document.getElementById('how-it-works')).toBeInTheDocument();
    expect(document.getElementById('experiences')).toBeInTheDocument();
    expect(document.getElementById('features')).toBeInTheDocument();
    expect(document.getElementById('safety')).toBeInTheDocument();
    expect(document.getElementById('faqs')).toBeInTheDocument();

    // Daily Worry 3 cards
    expect(screen.getByText(/keeping track of multiple daily times/i)).toBeInTheDocument();
    expect(screen.getByText(/wondering whether a dose was already taken/i)).toBeInTheDocument();
    expect(screen.getByText(/reassuring family without constant phone calls/i)).toBeInTheDocument();

    // 3-step How It Works with qualified web push support
    expect(screen.getByText(/where browser support and permission allow/i)).toBeInTheDocument();

    // Older Adult & Caregiver previews without medical-judgement adherence %
    expect(screen.getByText(/Caregiver Dashboard · Monitoring: Ramesh Sharma/i)).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getAllByText('Unconfirmed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Confirmed at 08:04 AM by Ramesh \(Self\)/i)).toBeInTheDocument();

    // Non-Medical-Advice boundary notice
    expect(screen.getByText(/Non-Medical-Advice Boundary Notice/i)).toBeInTheDocument();
    expect(
      screen.getByText(/does not diagnose medical conditions, prescribe treatments/i)
    ).toBeInTheDocument();
  });

  it('omits pricing, medical-judgement adherence percentages, and unsupported claims', () => {
    renderLanding();

    expect(screen.queryByText(/pricing|free trial|subscription|\$\d+|₹\d+/i)).toBeNull();
    expect(screen.queryByText(/\d+%\s*(adherence|compliance|score)/i)).toBeNull();
    expect(screen.queryByText(/never miss a dose|WhatsApp|HIPAA|GDPR/i)).toBeNull();
  });

  it('meets WCAG 2.2 AA touch target (>= 44x44px) and ARIA compliance on all interactive controls', () => {
    renderLanding();

    const interactiveElements = [
      ...screen.getAllByRole('button'),
      ...screen.getAllByRole('link'),
    ];

    expect(interactiveElements.length).toBeGreaterThan(0);
    for (const el of interactiveElements) {
      const ariaResult = checkAriaCompliance(el);
      expect(ariaResult.passed, `ARIA failed on ${el.textContent}: ${ariaResult.missing.join(', ')}`).toBe(true);

      const touchResult = checkTouchTarget(el, 44);
      expect(touchResult.passed, `Touch target failed on ${el.textContent}: ${touchResult.reason}`).toBe(true);
    }
  });

  it('toggles mobile navigation menu via button click, link click, and Escape key', () => {
    renderLanding();

    const toggleButton = screen.getByRole('button', { name: /open navigation menu/i });
    const mobileNavId = toggleButton.getAttribute('aria-controls');
    expect(mobileNavId).toBe('mobile-landing-nav');

    const mobileNav = document.getElementById('mobile-landing-nav');
    expect(mobileNav).not.toBeNull();
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(mobileNav).toHaveAttribute('hidden');

    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    expect(mobileNav).not.toHaveAttribute('hidden');

    // Escape closes the mobile menu
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(mobileNav).toHaveAttribute('hidden');

    // Reopen and click a link inside mobile nav -> closes
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
    if (mobileNav) {
      const mobileFeaturesLink = within(mobileNav).getByRole('link', { name: 'Features' });
      fireEvent.click(mobileFeaturesLink);
    }
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
    expect(mobileNav).toHaveAttribute('hidden');
  });

  it('toggles Hero Today next-dose interactive preview between due, snoozed, and taken states', () => {
    renderLanding();

    const hero = document.getElementById('hero');
    expect(hero).not.toBeNull();
    if (!hero) return;

    const snoozeBtn = within(hero).getByRole('button', { name: /remind me later \(10 min\)/i });
    fireEvent.click(snoozeBtn);
    expect(within(hero).getByText(/snooze active \(10 min delay\)/i)).toBeInTheDocument();

    const takenBtn = within(hero).getByRole('button', { name: /taken/i });
    fireEvent.click(takenBtn);
    expect(within(hero).getByText(/recorded! good job\./i)).toBeInTheDocument();

    const resetBtn = within(hero).getByRole('button', { name: /reset preview/i });
    fireEvent.click(resetBtn);
    expect(within(hero).getByRole('button', { name: /taken/i })).toBeInTheDocument();
  });

  it('toggles FAQ accordion items with accessible aria-expanded and aria-controls regions', () => {
    renderLanding();

    const faqSection = document.getElementById('faqs');
    expect(faqSection).not.toBeNull();
    if (!faqSection) return;

    const faqTriggers = within(faqSection).getAllByRole('button');
    expect(faqTriggers).toHaveLength(6);

    for (const trigger of faqTriggers) {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      const panelId = trigger.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      if (panelId) {
        const panel = document.getElementById(panelId);
        expect(panel).not.toBeNull();
        expect(panel).toHaveAttribute('role', 'region');
        expect(panel).toHaveAttribute('aria-labelledby', trigger.id);
        expect(panel).toHaveAttribute('hidden');
      }
    }

    const firstTrigger = faqTriggers[0];
    const firstPanelId = firstTrigger.getAttribute('aria-controls');
    expect(firstPanelId).toBeTruthy();
    const firstPanel = firstPanelId ? document.getElementById(firstPanelId) : null;

    fireEvent.click(firstTrigger);
    expect(firstTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(firstPanel).not.toHaveAttribute('hidden');

    // Keyboard activation (Enter keyDown / click behavior on native button)
    const secondTrigger = faqTriggers[1];
    const secondPanelId = secondTrigger.getAttribute('aria-controls');
    const secondPanel = secondPanelId ? document.getElementById(secondPanelId) : null;

    fireEvent.click(secondTrigger);
    expect(secondTrigger).toHaveAttribute('aria-expanded', 'true');
    expect(secondPanel).not.toHaveAttribute('hidden');
    expect(firstTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(firstPanel).toHaveAttribute('hidden');

    fireEvent.click(secondTrigger);
    expect(secondTrigger).toHaveAttribute('aria-expanded', 'false');
    expect(secondPanel).toHaveAttribute('hidden');
  });

  describe('AppRoutes role-aware landing and /welcome routing', () => {
    it('renders LoadingScreen at / while auth state is loading', () => {
      render(
        <AuthProvider value={makeAuthValue({ isLoading: true })}>
          <MemoryRouter initialEntries={['/']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByText(/loading medimate/i)).toBeInTheDocument();
    });

    it('renders LandingPage at / when unauthenticated', () => {
      render(
        <AuthProvider value={makeAuthValue({ authenticated: false })}>
          <MemoryRouter initialEntries={['/']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        /calm daily medicine reminders/i
      );
      expect(screen.queryByTestId('login-screen')).toBeNull();
    });

    it('redirects authenticated elderly and dual users at / to /app/today', () => {
      for (const role of ['elderly', 'dual'] as const) {
        const { unmount } = render(
          <AuthProvider value={makeAuthValue({ authenticated: true, role })}>
            <MemoryRouter initialEntries={['/']}>
              <AppRoutes />
            </MemoryRouter>
          </AuthProvider>
        );

        expect(screen.getByTestId('today-view')).toBeInTheDocument();
        unmount();
      }
    });

    it('redirects authenticated caregiver users at / to /app/caregiver', () => {
      render(
        <AuthProvider value={makeAuthValue({ authenticated: true, role: 'caregiver' })}>
          <MemoryRouter initialEntries={['/']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByTestId('caregiver-dashboard')).toBeInTheDocument();
    });

    it('renders LandingPage unconditionally at /welcome for both unauthenticated and authenticated users', () => {
      const authStates = [
        makeAuthValue({ authenticated: false }),
        makeAuthValue({ authenticated: true, role: 'elderly' }),
        makeAuthValue({ authenticated: true, role: 'caregiver' }),
      ];

      for (const authState of authStates) {
        const { unmount } = render(
          <AuthProvider value={authState}>
            <MemoryRouter initialEntries={['/welcome']}>
              <AppRoutes />
            </MemoryRouter>
          </AuthProvider>
        );

        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
          /calm daily medicine reminders/i
        );
        expect(screen.queryByTestId('today-view')).toBeNull();
        expect(screen.queryByTestId('caregiver-dashboard')).toBeNull();
        unmount();
      }
    });

    it('redirects unknown routes (*) to / where unauthenticated users see LandingPage', () => {
      render(
        <AuthProvider value={makeAuthValue({ authenticated: false })}>
          <MemoryRouter initialEntries={['/nonexistent-route']}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      );

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        /calm daily medicine reminders/i
      );
    });
  });
});
