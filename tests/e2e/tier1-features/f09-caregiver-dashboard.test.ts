import { describe, expect, it } from 'vitest';
import {
  computeComplianceSummary,
  createCareCircleFixture,
  createDoseLogFixture,
  createDoseService,
  DoseLogDocument,
  MockFirestoreDb,
  renderCaregiverDashboard,
  seedPatientCareCircleScenario,
} from '../harness';

describe('Tier 1 — F09: Caregiver Dashboard Timeline & Unconfirmed Alerts', () => {
  it('T1-F09-01: Chronological Timeline Display', () => {
    const container = document.createElement('div');
    const circle = createCareCircleFixture();

    const eveningDose = createDoseLogFixture({
      id: 'dose_2000',
      medicationName: 'Atorvastatin',
      scheduledTime: new Date('2026-11-25T20:00:00.000Z'),
      status: 'scheduled',
    });
    const morningDose = createDoseLogFixture({
      id: 'dose_0800',
      medicationName: 'Metformin',
      scheduledTime: new Date('2026-11-25T08:00:00.000Z'),
      status: 'taken',
    });
    const afternoonDose = createDoseLogFixture({
      id: 'dose_1300',
      medicationName: 'Calcium',
      scheduledTime: new Date('2026-11-25T13:00:00.000Z'),
      status: 'due',
    });

    // Pass unsorted doses; dashboard must render ascending chronologically
    const { timelineItems } = renderCaregiverDashboard(
      container,
      [eveningDose, afternoonDose, morningDose],
      circle
    );

    expect(timelineItems.map((el) => el.getAttribute('data-dose-id'))).toEqual([
      'dose_0800',
      'dose_1300',
      'dose_2000',
    ]);
  });

  it('T1-F09-02: Compliance Summary Badges Count Accuracy', () => {
    const doses: DoseLogDocument[] = [
      createDoseLogFixture({ id: 'd1', status: 'taken' }),
      createDoseLogFixture({ id: 'd2', status: 'taken' }),
      createDoseLogFixture({ id: 'd3', status: 'scheduled' }),
      createDoseLogFixture({ id: 'd4', status: 'due' }),
      createDoseLogFixture({ id: 'd5', status: 'snoozed' }),
      createDoseLogFixture({ id: 'd6', status: 'unconfirmed' }),
    ];

    const summary = computeComplianceSummary(doses);
    expect(summary).toEqual({
      scheduled: 6,
      taken: 2,
      pending: 3,
      unconfirmed: 1,
    });

    const container = document.createElement('div');
    renderCaregiverDashboard(container, doses, createCareCircleFixture());
    expect(container.querySelector('#badge-scheduled')?.getAttribute('data-count')).toBe('6');
    expect(container.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('2');
    expect(container.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('3');
    expect(container.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('1');
  });

  it('T1-F09-03: Unconfirmed Dose High-Visibility Alert Banner', () => {
    const container = document.createElement('div');
    const circle = createCareCircleFixture({ patientName: 'Ramesh Sharma' });
    const unconfirmedDose = createDoseLogFixture({
      medicationName: 'Amlodipine',
      dosage: '5 mg',
      status: 'unconfirmed',
    });

    const { alertBanner } = renderCaregiverDashboard(container, [unconfirmedDose], circle);

    expect(alertBanner).not.toBeNull();
    expect(alertBanner?.getAttribute('role')).toBe('alert');
    expect(alertBanner?.getAttribute('aria-live')).toBe('assertive');
    expect(alertBanner?.textContent).toContain('Ramesh Sharma');
    expect(alertBanner?.textContent).toContain('Amlodipine');
  });

  it('T1-F09-04: Alert Banner Dismissal on Resolution', async () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'unconfirmed',
    });

    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));
    const patientService = createDoseService(db, () => ({
      uid: patient.uid,
      role: 'elderly',
    }));

    const container = document.createElement('div');
    const unsubscribe = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(container, doses, circle);
    });

    expect(container.querySelector('#unconfirmed-alert-banner')).not.toBeNull();

    await patientService.confirmDoseTaken(
      doseLog.id,
      patient.uid,
      new Date('2026-11-25T08:40:00.000Z')
    );

    expect(container.querySelector('#unconfirmed-alert-banner')).toBeNull();
    unsubscribe();
  });

  it('T1-F09-05: Care Circle Member List Rendering', () => {
    const container = document.createElement('div');
    const circle = createCareCircleFixture({
      members: [
        {
          userId: 'cg_1',
          displayName: 'Priya Sharma',
          email: 'priya@medimate.test',
          role: 'primary',
          permissions: ['read', 'write_schedule', 'receive_alerts'],
          status: 'active',
          invitedAt: new Date(),
          joinedAt: new Date(),
        },
        {
          userId: 'cg_2',
          displayName: 'Arjun Sharma',
          email: 'arjun@medimate.test',
          role: 'secondary',
          permissions: ['read', 'receive_alerts'],
          status: 'active',
          invitedAt: new Date(),
          joinedAt: new Date(),
        },
      ],
    });

    const { memberItems } = renderCaregiverDashboard(container, [], circle);
    expect(memberItems).toHaveLength(2);
    expect(memberItems[0].textContent).toContain('Priya Sharma');
    expect(memberItems[0].textContent).toContain('primary');
    expect(memberItems[1].textContent).toContain('Arjun Sharma');
    expect(memberItems[1].textContent).toContain('secondary');
  });
});
