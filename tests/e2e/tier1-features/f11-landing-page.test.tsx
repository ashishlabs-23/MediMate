import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hasProjectFile,
  makeAuthValue,
} from '@harness/reactTestHelper';

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
  getUserDocument: vi.fn(async () => null),
  upsertUserDocument: vi.fn(async () => {}),
  getCareCircle: vi.fn(async () => null),
  subscribeToCareCircle: vi.fn((_id: string, cb: (c: null) => void) => {
    cb(null);
    return () => {};
  }),
  getActiveMedications: vi.fn(async () => []),
  getMedications: vi.fn(async () => []),
  subscribeToMedications: vi.fn((_id: string, cb: (m: never[]) => void) => {
    cb([]);
    return () => {};
  }),
  subscribeToDoseLogs: vi.fn((_id: string, _d: string, cb: (d: never[]) => void) => {
    cb([]);
    return () => {};
  }),
  updateDoseLog: vi.fn(async () => {}),
  getDoseLog: vi.fn(async () => null),
  getDoseLogsForDateRange: vi.fn(async () => []),
  createMedication: vi.fn(async () => ({})),
  updateMedication: vi.fn(async () => {}),
  setMedicationActive: vi.fn(async () => {}),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => '2026-11-25',
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: vi.fn(async () => 0),
}));

import { App } from '@/App';
import { useAuth } from '@/hooks/useAuth';

const hasLanding = hasProjectFile('src/pages/LandingPage.tsx');

describe('Tier 1 — F11: Public Landing Page & Role-Aware Routing (R1)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(makeAuthValue({ authenticated: false }));
  });

  it.runIf(hasLanding)(
    'T1-F11-01: Unauthenticated visitor at / renders real <App /> LandingPage with UN SDG 3 hero and Today mockup',
    () => {
      window.history.pushState({}, '', '/');
      render(<App />);

      expect(window.location.pathname).toBe('/');
      expect(screen.getByRole('banner')).toBeInTheDocument();
      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getByRole('contentinfo')).toBeInTheDocument();

      const h1 = screen.getByRole('heading', { level: 1 });
      expect(h1).toBeInTheDocument();
      expect(screen.getAllByText(/UN SDG 3/i).length).toBeGreaterThanOrEqual(1);

      const hero = document.getElementById('hero') ?? screen.getByRole('main');
      expect(within(hero).getByRole('button', { name: /taken/i })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /sign in/i })).toBeNull();
    }
  );

  it.runIf(hasLanding)(
    'T1-F11-02: /welcome renders LandingPage unconditionally for both unauthenticated and authenticated users',
    () => {
      for (const state of [
        makeAuthValue({ authenticated: false }),
        makeAuthValue({ authenticated: true, role: 'elderly' }),
        makeAuthValue({ authenticated: true, role: 'caregiver' }),
        makeAuthValue({ authenticated: true, role: 'dual' }),
      ]) {
        vi.mocked(useAuth).mockReturnValue(state);
        window.history.pushState({}, '', '/welcome');
        const { unmount } = render(<App />);

        expect(window.location.pathname).toBe('/welcome');
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
        expect(document.getElementById('faqs')).toBeInTheDocument();
        expect(screen.queryByText(/Caregiver Dashboard/i, { selector: 'h1' })).toBeNull();
        unmount();
      }
    }
  );

  it.runIf(hasLanding)(
    'T1-F11-03: Authenticated elderly/dual visiting / redirects to /app/today; caregiver redirects to /app/caregiver',
    () => {
      for (const role of ['elderly', 'dual'] as const) {
        vi.mocked(useAuth).mockReturnValue(makeAuthValue({ authenticated: true, role }));
        window.history.pushState({}, '', '/');
        const { unmount } = render(<App />);

        expect(window.location.pathname).toBe('/app/today');
        expect(screen.getByRole('heading', { level: 1, name: /hello,/i })).toBeInTheDocument();
        unmount();
      }

      vi.mocked(useAuth).mockReturnValue(makeAuthValue({ authenticated: true, role: 'caregiver' }));
      window.history.pushState({}, '', '/');
      render(<App />);

      expect(window.location.pathname).toBe('/app/caregiver');
      expect(screen.getByRole('heading', { level: 1, name: /caregiver dashboard/i })).toBeInTheDocument();
    }
  );

  it.runIf(hasLanding)(
    'T1-F11-04: Renders header navigation, Daily Worry cards, 3-step How It Works, and Elderly & Caregiver previews',
    () => {
      window.history.pushState({}, '', '/');
      render(<App />);

      const banner = screen.getByRole('banner');
      expect(within(banner).getAllByRole('link', { name: /how it works/i }).length).toBeGreaterThanOrEqual(1);
      expect(within(banner).getAllByRole('link', { name: /features/i }).length).toBeGreaterThanOrEqual(1);
      expect(within(banner).getAllByRole('link', { name: /safety/i }).length).toBeGreaterThanOrEqual(1);
      expect(within(banner).getAllByRole('link', { name: /faqs/i }).length).toBeGreaterThanOrEqual(1);

      const dailyWorry = document.getElementById('daily-worry');
      expect(dailyWorry).not.toBeNull();
      expect(dailyWorry!.querySelectorAll('article').length).toBe(3);

      const howItWorks = document.getElementById('how-it-works');
      expect(howItWorks).not.toBeNull();
      expect(howItWorks!.querySelectorAll('li').length).toBe(3);
      expect(within(howItWorks!).getByText(/browser support|permission/i)).toBeInTheDocument();

      const experiences = document.getElementById('experiences');
      expect(experiences).not.toBeNull();
      expect(within(experiences!).getByText(/Simple Mode/i)).toBeInTheDocument();
      expect(within(experiences!).getByText(/Caregiver Dashboard/i)).toBeInTheDocument();
    }
  );

  it.runIf(hasLanding)(
    'T1-F11-05: Create Account opens signup while Sign In and demo links preserve their login paths',
    () => {
      window.history.pushState({}, '', '/');
      const { unmount } = render(<App />);

      const createAccountLinks = screen.getAllByRole('link', { name: /create account/i });
      expect(createAccountLinks.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(createAccountLinks[0]);

      expect(window.location.pathname).toBe('/login');
      expect(window.location.search).toBe('?mode=signup');
      expect(screen.getByRole('tab', { name: /create new account/i })).toHaveAttribute(
        'aria-selected',
        'true'
      );
      expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
      unmount();

      window.history.pushState({}, '', '/');
      render(<App />);
      fireEvent.click(screen.getByRole('link', { name: /try the demo/i }));

      expect(window.location.pathname).toBe('/login');
      expect(window.location.search).toBe('');
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try older adult demo/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /try caregiver demo/i })).toBeInTheDocument();
    }
  );

  it.runIf(hasLanding)(
    'T1-F11-06: Renders Caregiver consent, Non-Medical-Advice Boundary Notice, academic footer, and working FAQ accordion',
    () => {
      window.history.pushState({}, '', '/');
      render(<App />);

      const safety = document.getElementById('safety');
      expect(safety).not.toBeNull();
      expect(within(safety!).getByText(/consent/i)).toBeInTheDocument();
      expect(within(safety!).getByText(/does not diagnose/i)).toBeInTheDocument();

      const footer = screen.getByRole('contentinfo');
      expect(within(footer).getByText(/UN SDG 3/i)).toBeInTheDocument();

      const faqSection = document.getElementById('faqs');
      expect(faqSection).not.toBeNull();
      const triggers = within(faqSection!).getAllByRole('button');
      expect(triggers.length).toBeGreaterThanOrEqual(4);

      const first = triggers[0];
      const panelId = first.getAttribute('aria-controls');
      expect(panelId).toBeTruthy();
      const panel = document.getElementById(panelId!);
      expect(panel).not.toBeNull();
      expect(first).toHaveAttribute('aria-expanded', 'false');
      expect(panel).toHaveAttribute('hidden');

      fireEvent.click(first);
      expect(first).toHaveAttribute('aria-expanded', 'true');
      expect(panel).not.toHaveAttribute('hidden');

      fireEvent.click(first);
      expect(first).toHaveAttribute('aria-expanded', 'false');
      expect(panel).toHaveAttribute('hidden');
    }
  );
});
