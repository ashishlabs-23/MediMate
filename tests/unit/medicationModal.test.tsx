import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import { AddMedicationModal } from '../../src/components/caregiver/AddMedicationModal';
import { CaregiverDashboard } from '../../src/pages/CaregiverDashboard';
import type { MedicationDocument } from '../../src/types/firestore';

const mockCreateMedication = vi.fn();
const mockUpdateMedication = vi.fn();
const mockSetMedicationActive = vi.fn();
const mockGenerateTodayLogsForMedication = vi.fn();

vi.mock('../../src/contexts/AuthContext', () => ({
  useAuthContext: () => ({
    userProfile: { role: 'caregiver', displayName: 'Priya Sharma' },
    firebaseUser: { uid: 'caregiver_priya' },
    signOut: vi.fn(),
  }),
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
    cb: (circle: unknown) => void
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
  getDoseLogsForDateRange: vi.fn().mockResolvedValue([]),
  updateDoseLog: vi.fn().mockResolvedValue(undefined),
  createMedication: (...args: unknown[]) => mockCreateMedication(...args),
  updateMedication: (...args: unknown[]) => mockUpdateMedication(...args),
  setMedicationActive: (...args: unknown[]) => mockSetMedicationActive(...args),
}));

vi.mock('../../src/lib/generateTodayLogs', () => ({
  generateTodayLogs: vi.fn().mockResolvedValue({ created: 0, skipped: 0 }),
  generateTodayLogsForMedication: (...args: unknown[]) =>
    mockGenerateTodayLogsForMedication(...args),
}));

describe('AddMedicationModal', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    render(
      <AddMedicationModal
        isOpen={false}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders accessible dialog in Create mode, focuses name input, and validates required fields', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();

    render(
      <AddMedicationModal
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
      />
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Add Medication' })).toBeInTheDocument();

    const nameInput = screen.getByLabelText('Medication Name');
    await waitFor(() => {
      expect(nameInput).toHaveFocus();
    });

    // Submit empty form -> shows validation alert
    fireEvent.click(screen.getByRole('button', { name: 'Save Medication' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Medication name is required.');
    expect(onSave).not.toHaveBeenCalled();

    // Fill name, leave dosage empty
    fireEvent.change(nameInput, { target: { value: 'Aspirin' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Medication' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Dosage is required.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('supports adding/removing times, specific days, pill shape/color, and submits normalized payload', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(
      <AddMedicationModal
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
      />
    );

    fireEvent.change(screen.getByLabelText('Medication Name'), { target: { value: '  Vitamin D3  ' } });
    fireEvent.change(screen.getByLabelText('Dosage'), { target: { value: ' 1000 IU ' } });
    fireEvent.change(screen.getByLabelText('Instructions'), { target: { value: 'Take with milk' } });

    // Initially 1 time -> no Remove button
    expect(screen.queryByRole('button', { name: /Remove time/i })).not.toBeInTheDocument();

    // Add a second and third time, then remove one
    fireEvent.click(screen.getByRole('button', { name: /Add Time/i }));
    const timeInputs = screen.getAllByLabelText(/Scheduled time/i);
    expect(timeInputs).toHaveLength(2);
    fireEvent.change(timeInputs[1], { target: { value: '20:30' } });

    fireEvent.click(screen.getByRole('button', { name: /Add Time/i }));
    expect(screen.getAllByLabelText(/Scheduled time/i)).toHaveLength(3);
    const removeButtons = screen.getAllByRole('button', { name: /Remove time/i });
    fireEvent.click(removeButtons[2]);
    expect(screen.getAllByLabelText(/Scheduled time/i)).toHaveLength(2);

    // Switch to Specific Days and clear all default days to verify validation
    fireEvent.click(screen.getByRole('button', { name: 'Specific Days' }));
    const monBtn = screen.getByRole('button', { name: 'Monday' });
    const tueBtn = screen.getByRole('button', { name: 'Tuesday' });
    const wedBtn = screen.getByRole('button', { name: 'Wednesday' });
    const thuBtn = screen.getByRole('button', { name: 'Thursday' });
    const friBtn = screen.getByRole('button', { name: 'Friday' });
    [monBtn, tueBtn, wedBtn, thuBtn, friBtn].forEach((b) => fireEvent.click(b));

    fireEvent.click(screen.getByRole('button', { name: 'Save Medication' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Please select at least one day of the week.'
    );

    // Select Sunday and Wednesday
    fireEvent.click(screen.getByRole('button', { name: 'Sunday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Wednesday' }));
    expect(screen.getByRole('button', { name: 'Sunday' })).toHaveAttribute('aria-pressed', 'true');

    // Select shape & color and confirm PillMarker preview updates
    fireEvent.click(screen.getByRole('button', { name: /Capsule/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Amber pill color' }));

    expect(
      screen.getByRole('img', { name: '#D97706 capsule-shaped pill – Vitamin D3 1000 IU' })
    ).toBeInTheDocument();

    // Touch target geometry check (>= 44px class)
    expect(screen.getByRole('button', { name: 'Save Medication' })).toHaveClass('min-h-touch');
    expect(screen.getByRole('button', { name: 'Close modal' })).toHaveClass('min-h-touch', 'min-w-touch');

    fireEvent.click(screen.getByRole('button', { name: 'Save Medication' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    expect(onSave).toHaveBeenCalledWith(
      {
        name: 'Vitamin D3',
        dosage: '1000 IU',
        instructions: 'Take with milk',
        times: ['08:00', '20:30'],
        frequency: 'specific_days',
        daysOfWeek: [0, 3],
        shape: 'capsule',
        color: '#D97706',
      },
      undefined
    );
  });

  it('pre-populates Edit mode, omits daysOfWeek when switched to daily, and closes on Escape', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();

    const existingMed: MedicationDocument = {
      id: 'med_existing_42',
      patientId: 'patient_ramesh',
      name: 'Atorvastatin',
      dosage: '20 mg',
      instructions: 'Take at night',
      schedule: {
        times: ['20:00'],
        frequency: 'specific_days',
        daysOfWeek: [1, 4],
        startDate: '2026-01-01',
        endDate: null,
      },
      color: '#7C3AED',
      shape: 'oval',
      active: true,
      createdBy: 'caregiver_priya',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    render(
      <AddMedicationModal
        isOpen={true}
        onClose={onClose}
        onSave={onSave}
        initialMedication={existingMed}
      />
    );

    expect(screen.getByRole('heading', { name: 'Edit Medication' })).toBeInTheDocument();
    expect(screen.getByLabelText('Medication Name')).toHaveValue('Atorvastatin');
    expect(screen.getByLabelText('Dosage')).toHaveValue('20 mg');

    // Escape closes modal
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    // Switch back to daily -> daysOfWeek omitted
    fireEvent.click(screen.getByRole('button', { name: 'Every Day' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        {
          name: 'Atorvastatin',
          dosage: '20 mg',
          instructions: 'Take at night',
          times: ['20:00'],
          frequency: 'daily',
          shape: 'oval',
          color: '#7C3AED',
        },
        'med_existing_42'
      );
    });
  });
});

describe('CaregiverDashboard prescription flows', () => {
  beforeEach(() => {
    mockCreateMedication.mockImplementation(async (data: Omit<MedicationDocument, 'id' | 'createdAt' | 'updatedAt'>) => ({
      ...data,
      id: 'created_med_1',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }));
    mockUpdateMedication.mockResolvedValue(undefined);
    mockSetMedicationActive.mockResolvedValue(undefined);
    mockGenerateTodayLogsForMedication.mockResolvedValue(1);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('adds, edits, pauses, and resumes medications while preserving existing dashboard landmarks', async () => {
    render(<CaregiverDashboard />);

    // Preserve existing E2E landmarks
    expect(document.querySelector('#unconfirmed-alert-banner')).toBeInTheDocument();
    expect(document.querySelector('#compliance-summary-badges')).toBeInTheDocument();
    expect(document.querySelector('#dose-timeline')).toBeInTheDocument();
    expect(document.querySelector('#care-circle-members')).toBeInTheDocument();

    // Prescriptions section shows demo medications
    const prescriptionsSection = document.querySelector('#prescriptions-section') as HTMLElement;
    expect(prescriptionsSection).toBeInTheDocument();
    expect(within(prescriptionsSection).getByText('Metformin')).toBeInTheDocument();

    // Add Medication flow
    fireEvent.click(screen.getByRole('button', { name: /Add Medication/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Medication Name'), {
      target: { value: 'Calcium' },
    });
    fireEvent.change(within(dialog).getByLabelText('Dosage'), {
      target: { value: '600 mg' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Medication' }));

    await waitFor(() => {
      expect(mockCreateMedication).toHaveBeenCalledTimes(1);
      expect(mockGenerateTodayLogsForMedication).toHaveBeenCalledTimes(1);
      expect(within(prescriptionsSection).getByText('Calcium')).toBeInTheDocument();
    });

    // Pause & Resume flow
    const pauseMetforminBtn = screen.getByRole('button', { name: 'Pause Metformin' });
    fireEvent.click(pauseMetforminBtn);

    await waitFor(() => {
      expect(mockSetMedicationActive).toHaveBeenCalledWith('patient_ramesh_med_metformin', false);
      expect(screen.getByRole('button', { name: 'Resume Metformin' })).toBeInTheDocument();
      expect(within(prescriptionsSection).getByText('Paused')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resume Metformin' }));
    await waitFor(() => {
      expect(mockSetMedicationActive).toHaveBeenCalledWith('patient_ramesh_med_metformin', true);
    });

    // Edit flow
    fireEvent.click(screen.getByRole('button', { name: 'Edit Metformin' }));
    const editDialog = await screen.findByRole('dialog');
    fireEvent.change(within(editDialog).getByLabelText('Dosage'), {
      target: { value: '850 mg' },
    });
    fireEvent.click(within(editDialog).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(mockUpdateMedication).toHaveBeenCalledWith(
        'patient_ramesh_med_metformin',
        expect.objectContaining({ dosage: '850 mg' })
      );
      expect(within(prescriptionsSection).getByText('(850 mg)')).toBeInTheDocument();
    });
  });
});
