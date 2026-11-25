import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { CareCircleInviteModal } from '../../src/components/caregiver/CareCircleInviteModal';
import type { AuthContextValue } from '../../src/contexts/AuthContext';
import type {
  CareCircleDocument,
  CareCircleMember,
  MedicationDocument,
  UserDocument,
} from '../../src/types/firestore';

const {
  mockInviteCareCircleMember,
  mockGetDoc,
  mockUpdateDoc,
  mockSetDoc,
} = vi.hoisted(() => ({
  mockInviteCareCircleMember: vi.fn<
    (patientId: string, member: CareCircleMember) => Promise<void>
  >(),
  mockGetDoc: vi.fn(),
  mockUpdateDoc: vi.fn(async () => {}),
  mockSetDoc: vi.fn(async () => {}),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
    updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
    setDoc: (...args: unknown[]) => mockSetDoc(...args),
  };
});

const mockAuthState: AuthContextValue = {
  firebaseUser: { uid: 'caregiver_priya' } as unknown as User,
  userProfile: {
    uid: 'caregiver_priya',
    email: 'priya@medimate.local',
    displayName: 'Priya Sharma',
    role: 'caregiver',
    timezone: 'Asia/Kolkata',
    fcmTokens: [],
    accessibilityPreferences: {
      highContrast: false,
      largeText: false,
      hapticFeedback: true,
      soundEnabled: true,
    },
    createdAt: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0)),
    updatedAt: Timestamp.fromDate(new Date(2026, 10, 25, 8, 0, 0)),
  } as UserDocument,
  isLoading: false,
  isDemo: false,
  signOut: vi.fn(async () => {}),
};

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuthContext: () => mockAuthState,
}));

vi.mock('../../src/lib/firestore', () => ({
  subscribeToDoseLogs: (
    _patientId: string,
    _date: string,
    cb: (doses: unknown[]) => void
  ) => {
    cb([]);
    return vi.fn();
  },
  subscribeToCareCircle: (
    _patientId: string,
    cb: (circle: CareCircleDocument | null) => void
  ) => {
    cb(null);
    return vi.fn();
  },
  subscribeToMedications: (
    _patientId: string,
    cb: (meds: MedicationDocument[]) => void
  ) => {
    cb([]);
    return vi.fn();
  },
  getDoseLogsForDateRange: () => Promise.resolve([]),
  updateDoseLog: () => Promise.resolve(undefined),
  createMedication: vi.fn(),
  updateMedication: () => Promise.resolve(undefined),
  setMedicationActive: () => Promise.resolve(undefined),
  inviteCareCircleMember: (patientId: string, member: CareCircleMember) =>
    mockInviteCareCircleMember(patientId, member),
}));

vi.mock('../../src/lib/generateTodayLogs', () => ({
  generateTodayLogs: vi.fn().mockResolvedValue({ created: 0, skipped: 0 }),
  generateTodayLogsForMedication: vi.fn().mockResolvedValue(0),
}));

import { CaregiverDashboard } from '../../src/pages/CaregiverDashboard';

const origClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const origExecCommandDescriptor = Object.getOwnPropertyDescriptor(document, 'execCommand');

function restoreBrowserDescriptors() {
  if (origClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', origClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
  if (origExecCommandDescriptor) {
    Object.defineProperty(document, 'execCommand', origExecCommandDescriptor);
  } else {
    Reflect.deleteProperty(document, 'execCommand');
  }
}

describe('CareCircleInviteModal', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    restoreBrowserDescriptors();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('U-4D-01: renders null when closed and accessible dialog with 44px touch targets when open', () => {
    const { rerender } = render(
      <CareCircleInviteModal
        isOpen={false}
        onClose={vi.fn()}
        inviteCode="MED-7892"
        existingEmails={[]}
        onInviteMember={vi.fn()}
      />
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <CareCircleInviteModal
        isOpen={true}
        onClose={vi.fn()}
        inviteCode="MED-7892"
        existingEmails={[]}
        onInviteMember={vi.fn()}
        patientName="Ramesh Sharma"
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const labelledBy = dialog.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    expect(document.getElementById(labelledBy as string)).toHaveTextContent(
      /Invite to Care Circle/i
    );
    expect(within(dialog).getByText('MED-7892')).toBeInTheDocument();

    const buttons = within(dialog).getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(4);
    for (const button of buttons) {
      expect(button).toHaveClass('min-h-touch', 'min-w-touch');
    }
  });

  it('U-4D-02: manages focus on open, traps Tab/Shift+Tab, closes on backdrop and Escape, and restores focus', async () => {
    function TriggerHost() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Open Invite Trigger
          </button>
          <CareCircleInviteModal
            isOpen={open}
            onClose={() => setOpen(false)}
            inviteCode="MED-7892"
            existingEmails={[]}
            onInviteMember={vi.fn()}
          />
        </div>
      );
    }

    render(<TriggerHost />);

    const trigger = screen.getByRole('button', { name: 'Open Invite Trigger' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    const dismissBtn = within(dialog).getByRole('button', { name: 'Dismiss dialog' });
    const sendBtn = within(dialog).getByRole('button', { name: /Send Invite/i });

    await waitFor(() => {
      expect(dismissBtn).toHaveFocus();
    });

    // Shift+Tab from first focusable wraps to last (Send Invite)
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(sendBtn).toHaveFocus();

    // Tab from last focusable wraps to first (Dismiss dialog)
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(dismissBtn).toHaveFocus();

    // Clicking inside dialog does NOT close
    fireEvent.click(dialog);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Clicking backdrop closes and restores focus to trigger
    fireEvent.click(screen.getByRole('presentation'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    // Re-open and close with Escape on window
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dismiss dialog' })).toHaveFocus();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    // Re-open and close with Escape dispatched from document (bubbles to window)
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('U-4D-03: copies invite code via navigator.clipboard.writeText and announces polite status', async () => {
    const writeTextSpy = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextSpy },
    });

    render(
      <CareCircleInviteModal
        isOpen={true}
        onClose={vi.fn()}
        inviteCode="MED-7892"
        existingEmails={[]}
        onInviteMember={vi.fn()}
      />
    );

    const dialog = screen.getByRole('dialog');
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /copy/i }));
    });

    expect(writeTextSpy).toHaveBeenCalledWith('MED-7892');
    expect(alertSpy).not.toHaveBeenCalled();

    const statusEl = within(dialog).getByRole('status');
    expect(statusEl).toHaveAttribute('aria-live', 'polite');
    expect(statusEl).toHaveTextContent(/Invite code MED-7892 copied to clipboard/i);
  });

  it('U-4D-04: falls back to document.execCommand("copy") and manual copy guidance when clipboard API rejects or is unavailable', async () => {
    // (a) Clipboard writeText rejects -> execCommand('copy') succeeds
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error('Clipboard denied');
        }),
      },
    });
    const execCommandSpy = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommandSpy,
    });

    const firstRender = render(
      <CareCircleInviteModal
        isOpen={true}
        onClose={vi.fn()}
        inviteCode="MED-9991"
        existingEmails={[]}
        onInviteMember={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    });

    expect(execCommandSpy).toHaveBeenCalledWith('copy');
    expect(alertSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/MED-9991 copied to clipboard/i);
    firstRender.unmount();

    // (b) Both navigator.clipboard and execCommand unavailable/false -> manual guidance without throwing
    Reflect.deleteProperty(navigator, 'clipboard');
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => false),
    });

    render(
      <CareCircleInviteModal
        isOpen={true}
        onClose={vi.fn()}
        inviteCode="MED-4567"
        existingEmails={[]}
        onInviteMember={vi.fn()}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));
    });

    expect(alertSpy).not.toHaveBeenCalled();
    const statusEl = screen.getByRole('status');
    expect(statusEl).toHaveAttribute('aria-live', 'polite');
    expect(statusEl).toHaveTextContent(/copy code MED-4567 manually/i);
  });

  it('U-4D-05: validates empty, malformed, duplicate emails, and zero permissions, then recovers on valid input', async () => {
    const onInviteMember = vi.fn(async () => {});

    render(
      <CareCircleInviteModal
        isOpen={true}
        onClose={vi.fn()}
        inviteCode="MED-7892"
        existingEmails={['priya@medimate.local']}
        onInviteMember={onInviteMember}
      />
    );

    const dialog = screen.getByRole('dialog');
    const emailInput = within(dialog).getByLabelText(/email/i);
    const submitBtn = within(dialog).getByRole('button', { name: /send.*invite/i });

    for (const badEmail of ['', '   ', 'bad-email', 'a@b', 'PRIYA@MEDIMATE.LOCAL']) {
      fireEvent.change(emailInput, { target: { value: badEmail } });
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(onInviteMember).not.toHaveBeenCalled();
      expect(within(dialog).getByRole('alert')).toBeInTheDocument();
      expect(emailInput).toHaveAttribute('aria-invalid', 'true');
    }

    // Valid unique email, but zero permissions checked
    fireEvent.change(emailInput, { target: { value: 'asha@example.com' } });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();

    const readCheckbox = within(dialog).getByRole('checkbox', { name: /view dose schedule/i });
    const alertsCheckbox = within(dialog).getByRole('checkbox', { name: /receive missed-dose alerts/i });
    fireEvent.click(readCheckbox);
    fireEvent.click(alertsCheckbox);

    await act(async () => {
      fireEvent.click(submitBtn);
    });
    expect(onInviteMember).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/at least one permission/i);

    // Re-check read and submit cleanly
    fireEvent.click(readCheckbox);
    await act(async () => {
      fireEvent.click(submitBtn);
    });

    await waitFor(() => {
      expect(onInviteMember).toHaveBeenCalledTimes(1);
    });
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('U-4D-06: selects role and permissions and submits normalized CareCircleMember payload without joinedAt', async () => {
    const onInviteMember = vi.fn(async () => {});

    render(
      <CareCircleInviteModal
        isOpen={true}
        onClose={vi.fn()}
        inviteCode="MED-7892"
        existingEmails={[]}
        onInviteMember={onInviteMember}
      />
    );

    const dialog = screen.getByRole('dialog');
    const roleSelect = within(dialog).getByLabelText(/role/i) as HTMLSelectElement;
    expect(roleSelect.value).toBe('secondary');

    const readCheckbox = within(dialog).getByRole('checkbox', {
      name: /view dose schedule/i,
    }) as HTMLInputElement;
    const writeCheckbox = within(dialog).getByRole('checkbox', {
      name: /edit & write|write prescriptions/i,
    }) as HTMLInputElement;
    const alertsCheckbox = within(dialog).getByRole('checkbox', {
      name: /receive missed-dose alerts/i,
    }) as HTMLInputElement;

    expect(readCheckbox.checked).toBe(true);
    expect(writeCheckbox.checked).toBe(false);
    expect(alertsCheckbox.checked).toBe(true);

    // Change role to primary, enable write_schedule, disable receive_alerts
    fireEvent.change(roleSelect, { target: { value: 'primary' } });
    fireEvent.click(writeCheckbox);
    fireEvent.click(alertsCheckbox);

    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: '  Vikram.Sharma@Example.COM  ' },
    });
    fireEvent.change(within(dialog).getByLabelText(/name/i), {
      target: { value: '  Vikram Sharma  ' },
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite/i }));
    });

    await waitFor(() => {
      expect(onInviteMember).toHaveBeenCalledTimes(1);
    });

    const submitted = onInviteMember.mock.calls[0][0] as CareCircleMember;
    expect(submitted.email).toBe('vikram.sharma@example.com');
    expect(submitted.displayName).toBe('Vikram Sharma');
    expect(submitted.role).toBe('primary');
    expect(submitted.permissions).toEqual(['read', 'write_schedule']);
    expect(submitted.status).toBe('invited');
    expect(submitted.invitedAt).toBeInstanceOf(Timestamp);
    expect('joinedAt' in submitted).toBe(false);
  });

  it('U-4D-07: keeps modal open post-submit with confirmation banner, unencoded mailto: link, focus trap including link, and Done close', async () => {
    const onInviteMember = vi.fn(async () => {});
    const onClose = vi.fn();

    render(
      <CareCircleInviteModal
        isOpen={true}
        onClose={onClose}
        inviteCode="MED-7892"
        existingEmails={[]}
        onInviteMember={onInviteMember}
        patientName="Ramesh Sharma"
      />
    );

    const dialog = screen.getByRole('dialog');
    const emailInput = within(dialog).getByLabelText(/email/i) as HTMLInputElement;
    const nameInput = within(dialog).getByLabelText(/name/i) as HTMLInputElement;

    fireEvent.change(emailInput, { target: { value: 'kiran.sharma@example.com' } });
    fireEvent.change(nameInput, { target: { value: 'Kiran Sharma' } });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite/i }));
    });

    await waitFor(() => {
      expect(onInviteMember).toHaveBeenCalledTimes(1);
    });

    // Modal stays open and inputs are cleared
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(emailInput.value).toBe('');
    expect(nameInput.value).toBe('');

    const statusBanner = within(dialog).getByRole('status');
    expect(statusBanner).toHaveTextContent(/kiran\.sharma@example\.com/i);

    const mailtoLink = within(dialog).getByRole('link', { name: /kiran\.sharma@example\.com/i });
    const href = mailtoLink.getAttribute('href') ?? '';
    expect(href).toMatch(/^mailto:kiran\.sharma@example\.com\?subject=.*&body=/);
    expect(decodeURIComponent(href)).toContain('MED-7892');
    expect(mailtoLink).toHaveClass('min-h-touch', 'min-w-touch');

    // Focus trap includes dynamic mailto: link (Tab from last wraps to first)
    const dismissBtn = within(dialog).getByRole('button', { name: 'Dismiss dialog' });
    const sendBtn = within(dialog).getByRole('button', { name: /send.*invite/i });
    sendBtn.focus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(dismissBtn).toHaveFocus();

    // Clicking Done closes modal
    const doneBtn = within(dialog).getByRole('button', { name: /^Done$/i });
    fireEvent.click(doneBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('U-4D-08: displays role="alert" when onInviteMember rejects and keeps modal open without confirmation banner', async () => {
    const onInviteMember = vi.fn(async () => {
      throw new Error('Missing or insufficient permissions.');
    });

    render(
      <CareCircleInviteModal
        isOpen={true}
        onClose={vi.fn()}
        inviteCode="MED-7892"
        existingEmails={[]}
        onInviteMember={onInviteMember}
      />
    );

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: 'unauthorized@example.com' },
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite/i }));
    });

    const alertEl = await within(dialog).findByRole('alert');
    expect(alertEl).toHaveTextContent(/insufficient permissions/i);
    expect(within(dialog).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('CaregiverDashboard Care Circle Invite integration', () => {
  let alertSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockAuthState.isDemo = false;
    mockAuthState.firebaseUser = { uid: 'caregiver_priya' } as unknown as User;
    mockInviteCareCircleMember.mockResolvedValue(undefined);
    alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    restoreBrowserDescriptors();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('U-4D-09: opens modal without window.alert, does not invoke invite on mount, and renders Invited badge while preserving dashboard landmarks', async () => {
    render(<CaregiverDashboard />);

    expect(mockInviteCareCircleMember).not.toHaveBeenCalled();

    // Preserve dashboard landmarks & default Care Circle rows
    expect(document.querySelector('#unconfirmed-alert-banner')).toBeInTheDocument();
    expect(document.querySelector('#compliance-summary-badges')).toBeInTheDocument();
    expect(document.querySelector('#dose-timeline')).toBeInTheDocument();
    expect(document.querySelector('#prescriptions-section')).toBeInTheDocument();

    const circleMembers = document.querySelector('#care-circle-members') as HTMLElement;
    expect(circleMembers).toBeInTheDocument();
    expect(within(circleMembers).getByText('Priya Sharma')).toBeInTheDocument();
    expect(within(circleMembers).getByText('Ramesh Sharma')).toBeInTheDocument();

    fireEvent.click(
      within(circleMembers).getByRole('button', { name: /\+ Invite Another Family Member/i })
    );
    expect(alertSpy).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/email/i), {
      target: { value: 'asha.sharma@example.com' },
    });
    fireEvent.change(within(dialog).getByLabelText(/name/i), {
      target: { value: 'Asha Sharma' },
    });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: /send.*invite/i }));
    });

    await waitFor(() => {
      expect(mockInviteCareCircleMember).toHaveBeenCalledTimes(1);
    });
    expect(mockInviteCareCircleMember).toHaveBeenCalledWith(
      'patient_ramesh',
      expect.objectContaining({
        email: 'asha.sharma@example.com',
        displayName: 'Asha Sharma',
        status: 'invited',
      })
    );

    expect(within(circleMembers).getByText('Priya Sharma')).toBeInTheDocument();
    expect(within(circleMembers).getByText('Ramesh Sharma')).toBeInTheDocument();
    expect(within(circleMembers).getByText('Asha Sharma')).toBeInTheDocument();
    expect(within(circleMembers).getByText('Invited')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('U-4D-10: handles demo/offline fallback optimistically and rethrows non-demo permission-denied error without mutating Care Circle list', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // (a) Demo/offline network rejection -> optimistic update + confirmation banner, zero alert
    mockAuthState.isDemo = true;
    mockInviteCareCircleMember.mockRejectedValueOnce(new Error('Network offline'));

    const firstRender = render(<CaregiverDashboard />);
    const firstMembers = document.querySelector('#care-circle-members') as HTMLElement;

    fireEvent.click(
      within(firstMembers).getByRole('button', { name: /\+ Invite Another Family Member/i })
    );
    const demoDialog = screen.getByRole('dialog');
    fireEvent.change(within(demoDialog).getByLabelText(/email/i), {
      target: { value: 'demo.guest@example.com' },
    });

    await act(async () => {
      fireEvent.click(within(demoDialog).getByRole('button', { name: /send.*invite/i }));
    });

    await waitFor(() => {
      expect(within(demoDialog).getByRole('status')).toHaveTextContent(/demo\.guest@example\.com/i);
    });
    expect(within(firstMembers).getByText('Invited')).toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    firstRender.unmount();

    // (b) Non-demo permission-denied rejection -> role="alert" in dialog, no optimistic member added
    mockAuthState.isDemo = false;
    const permError = Object.assign(new Error('Missing or insufficient permissions'), {
      code: 'permission-denied',
    });
    mockInviteCareCircleMember.mockRejectedValueOnce(permError);

    render(<CaregiverDashboard />);
    const liveMembers = document.querySelector('#care-circle-members') as HTMLElement;

    fireEvent.click(
      within(liveMembers).getByRole('button', { name: /\+ Invite Another Family Member/i })
    );
    const liveDialog = screen.getByRole('dialog');
    fireEvent.change(within(liveDialog).getByLabelText(/email/i), {
      target: { value: 'blocked.invite@example.com' },
    });

    await act(async () => {
      fireEvent.click(within(liveDialog).getByRole('button', { name: /send.*invite/i }));
    });

    const alertEl = await within(liveDialog).findByRole('alert');
    expect(alertEl).toHaveTextContent(/insufficient permissions/i);
    expect(within(liveMembers).queryByText(/blocked\.invite@example\.com/i)).not.toBeInTheDocument();
    expect(within(liveMembers).queryByText('Invited')).not.toBeInTheDocument();
    expect(alertSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('inviteCareCircleMember Firestore helper', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('U-4D-11: updates existing care circle with email deduplication and initializes missing care circle via setDoc', async () => {
    const { inviteCareCircleMember } = await vi.importActual<typeof import('../../src/lib/firestore')>(
      '../../src/lib/firestore'
    );
    mockGetDoc.mockReset();
    mockUpdateDoc.mockReset();
    mockSetDoc.mockReset();

    const existingMember: CareCircleMember = {
      userId: 'caregiver_priya',
      displayName: 'Priya Sharma',
      email: 'priya@medimate.local',
      role: 'primary',
      permissions: ['read', 'write_schedule', 'receive_alerts'],
      status: 'active',
      invitedAt: Timestamp.now(),
    };

    const duplicateOldInvite: CareCircleMember = {
      userId: 'invited_old',
      displayName: 'Old Asha',
      email: 'ASHA@example.com',
      role: 'secondary',
      permissions: ['read'],
      status: 'invited',
      invitedAt: Timestamp.now(),
    };

    const newInvite: CareCircleMember = {
      userId: 'invited_new',
      displayName: 'Asha Sharma',
      email: 'asha@example.com',
      role: 'secondary',
      permissions: ['read', 'receive_alerts'],
      status: 'invited',
      invitedAt: Timestamp.now(),
    };

    // (a) Existing doc -> deduplicates email case-insensitively and calls updateDoc
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({
        id: 'patient_ramesh',
        patientId: 'patient_ramesh',
        patientName: 'Ramesh Sharma',
        caregiverIds: ['caregiver_priya'],
        members: [existingMember, duplicateOldInvite],
        inviteCode: 'MED-7892',
      }),
    });

    await inviteCareCircleMember('patient_ramesh', newInvite);

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'patient_ramesh' }),
      expect.objectContaining({
        members: [existingMember, newInvite],
        updatedAt: { _methodName: 'serverTimestamp' },
      })
    );
    expect(mockSetDoc).not.toHaveBeenCalled();

    // (b) Missing doc -> initializes CareCircleDocument via setDoc
    mockGetDoc.mockResolvedValueOnce({
      exists: () => false,
    });

    await inviteCareCircleMember('patient_ramesh', newInvite);

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockSetDoc).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'patient_ramesh' }),
      expect.objectContaining({
        id: 'patient_ramesh',
        patientId: 'patient_ramesh',
        patientName: 'Ramesh Sharma',
        caregiverIds: [],
        members: [newInvite],
        inviteCode: 'MED-7892',
        createdAt: { _methodName: 'serverTimestamp' },
        updatedAt: { _methodName: 'serverTimestamp' },
      })
    );
  });
});
