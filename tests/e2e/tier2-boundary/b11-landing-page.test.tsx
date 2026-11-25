import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertContrast,
  checkAriaCompliance,
  checkTouchTarget,
} from '@harness/index';
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

describe('Tier 2 — B11: Public Landing Page & Routing Boundaries (R1)', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue(makeAuthValue({ authenticated: false }));
  });

  it.runIf(hasLanding)(
    'T2-F11-01: Strictly omits pricing sections, subscription tiers, trial CTAs, and medical-judgement adherence percentages',
    () => {
      window.history.pushState({}, '', '/');
      render(<App />);

      expect(document.getElementById('pricing')).toBeNull();
      expect(screen.queryByText(/pricing|free trial|per month|subscription|\$\d+|₹\d+/i)).toBeNull();
      expect(screen.queryByText(/\d+%\s*(adherence|compliance|score)/i)).toBeNull();
      expect(screen.queryByText(/never miss a dose|guaranteed health|WhatsApp/i)).toBeNull();
    }
  );

  it.runIf(hasLanding)(
    'T2-F11-02: Auth isLoading state at / renders LoadingScreen without flashing LandingPage; null userProfile defaults to /app/today',
    () => {
      vi.mocked(useAuth).mockReturnValue(makeAuthValue({ isLoading: true }));
      window.history.pushState({}, '', '/');
      const { unmount } = render(<App />);

      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
      unmount();

      vi.mocked(useAuth).mockReturnValue(
        makeAuthValue({ authenticated: true, role: 'elderly', nullProfile: true })
      );
      window.history.pushState({}, '', '/');
      render(<App />);
      expect(window.location.pathname).toBe('/app/today');
    }
  );

  it.runIf(hasLanding)(
    'T2-F11-03: Mobile navigation menu toggle updates aria-expanded, controls mobile nav drawer, and closes on Escape',
    () => {
      window.history.pushState({}, '', '/');
      render(<App />);

      const toggle = screen.getByRole('button', { name: /navigation menu/i });
      const navId = toggle.getAttribute('aria-controls');
      expect(navId).toBeTruthy();
      const drawer = document.getElementById(navId!);
      expect(drawer).not.toBeNull();

      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(drawer).toHaveAttribute('hidden');
      expect(checkTouchTarget(toggle, 44).passed).toBe(true);

      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(drawer).not.toHaveAttribute('hidden');

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(drawer).toHaveAttribute('hidden');
    }
  );

  it.runIf(hasLanding)(
    'T2-F11-04: All interactive controls on LandingPage meet >=44x44px touch targets, ARIA compliance, and DESIGN.md contrast ratios',
    () => {
      window.history.pushState({}, '', '/');
      render(<App />);

      const controls = [
        ...screen.getAllByRole('button'),
        ...screen.getAllByRole('link'),
      ];
      expect(controls.length).toBeGreaterThan(5);

      for (const el of controls) {
        const aria = checkAriaCompliance(el);
        expect(aria.passed, `ARIA failed on "${el.textContent}": ${aria.missing.join(', ')}`).toBe(true);

        const target = checkTouchTarget(el, 44);
        expect(target.passed, `Touch target failed on "${el.textContent}": ${target.reason}`).toBe(true);
      }

      // DESIGN.md §4 contrast tokens used across LandingPage
      expect(assertContrast('#0F172A', '#F8FAFC', 7.0, 'Primary text on canvas')).toBeGreaterThanOrEqual(7.0);
      expect(assertContrast('#FFFFFF', '#115E59', 4.5, 'CTA text on brand-teal')).toBeGreaterThanOrEqual(4.5);
      expect(assertContrast('#FFFFFF', '#166534', 7.0, 'Taken CTA on green')).toBeGreaterThanOrEqual(7.0);
    }
  );

  it.runIf(hasLanding)(
    'T2-F11-05: Toggling multiple FAQ accordion items updates aria-expanded and region visibility cleanly',
    () => {
      window.history.pushState({}, '', '/');
      render(<App />);

      const faqSection = document.getElementById('faqs');
      expect(faqSection).not.toBeNull();
      const triggers = within(faqSection!).getAllByRole('button');
      expect(triggers.length).toBeGreaterThanOrEqual(3);

      const t0 = triggers[0];
      const t1 = triggers[1];
      const p0 = document.getElementById(t0.getAttribute('aria-controls')!);
      const p1 = document.getElementById(t1.getAttribute('aria-controls')!);
      expect(p0).not.toBeNull();
      expect(p1).not.toBeNull();

      fireEvent.click(t0);
      expect(t0).toHaveAttribute('aria-expanded', 'true');
      expect(p0).not.toHaveAttribute('hidden');

      fireEvent.click(t1);
      expect(t1).toHaveAttribute('aria-expanded', 'true');
      expect(p1).not.toHaveAttribute('hidden');
      expect(t0).toHaveAttribute('aria-expanded', 'false');
      expect(p0).toHaveAttribute('hidden');

      fireEvent.click(t1);
      expect(t1).toHaveAttribute('aria-expanded', 'false');
      expect(p1).toHaveAttribute('hidden');
    }
  );
});
