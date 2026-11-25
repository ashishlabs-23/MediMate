import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { InstallPromptBanner } from '../../src/components/pwa/InstallPromptBanner';
import { AppShell } from '../../src/components/layout/AppShell';

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    userProfile: { role: 'caregiver', displayName: 'Priya Sharma' },
    signOut: vi.fn(),
  }),
}));

function setMatchMedia(standalone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)' ? standalone : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function dispatchBeforeInstallPrompt(
  promptFn = vi.fn().mockResolvedValue(undefined),
  outcome: 'accepted' | 'dismissed' = 'accepted'
) {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  };
  event.prompt = promptFn;
  event.userChoice = Promise.resolve({ outcome, platform: 'web' });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe('InstallPromptBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    setMatchMedia(false);
    Object.defineProperty(window.navigator, 'standalone', {
      writable: true,
      configurable: true,
      value: false,
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('remains hidden until beforeinstallprompt fires', () => {
    render(<InstallPromptBanner />);
    expect(screen.queryByRole('region', { name: 'Install MediMate app' })).not.toBeInTheDocument();
  });

  it('captures beforeinstallprompt, prevents default, and triggers prompt on Install App', async () => {
    render(<InstallPromptBanner />);

    const promptMock = vi.fn().mockResolvedValue(undefined);
    const event = dispatchBeforeInstallPrompt(promptMock, 'accepted');

    expect(event.defaultPrevented).toBe(true);

    const region = screen.getByRole('region', { name: 'Install MediMate app' });
    expect(region).toBeInTheDocument();

    const installBtn = screen.getByRole('button', { name: 'Install App' });
    const dismissBtn = screen.getByRole('button', { name: 'Dismiss' });
    expect(installBtn).toHaveClass('min-h-touch', 'min-w-touch');
    expect(dismissBtn).toHaveClass('min-h-touch', 'min-w-touch');

    fireEvent.click(installBtn);

    await waitFor(() => {
      expect(promptMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('region', { name: 'Install MediMate app' })).not.toBeInTheDocument();
    });
  });

  it('persists dismissal in localStorage and suppresses subsequent prompts', () => {
    const { unmount } = render(<InstallPromptBanner />);
    dispatchBeforeInstallPrompt();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(localStorage.getItem('medimate_pwa_install_dismissed')).toBe('true');
    expect(screen.queryByRole('region', { name: 'Install MediMate app' })).not.toBeInTheDocument();

    unmount();

    // Re-mount with localStorage dismissed flag still set
    render(<InstallPromptBanner />);
    dispatchBeforeInstallPrompt();
    expect(screen.queryByRole('region', { name: 'Install MediMate app' })).not.toBeInTheDocument();
  });

  it('suppresses banner when running in standalone mode and hides on appinstalled', () => {
    setMatchMedia(true);
    const { unmount } = render(<InstallPromptBanner />);
    dispatchBeforeInstallPrompt();
    expect(screen.queryByRole('region', { name: 'Install MediMate app' })).not.toBeInTheDocument();
    unmount();

    // Non-standalone -> visible, then hidden when appinstalled fires
    setMatchMedia(false);
    render(<InstallPromptBanner />);
    dispatchBeforeInstallPrompt();
    expect(screen.getByRole('region', { name: 'Install MediMate app' })).toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('region', { name: 'Install MediMate app' })).not.toBeInTheDocument();
  });

  it('is integrated inside AppShell between header and main landmark', () => {
    render(
      <AppShell>
        <div>Dashboard Content</div>
      </AppShell>
    );

    dispatchBeforeInstallPrompt();

    const banner = screen.getByRole('banner');
    const installRegion = screen.getByRole('region', { name: 'Install MediMate app' });
    const main = screen.getByRole('main');

    expect(banner.compareDocumentPosition(installRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(installRegion.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
