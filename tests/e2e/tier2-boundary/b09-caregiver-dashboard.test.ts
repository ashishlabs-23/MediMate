import { describe, expect, it } from 'vitest';
import {
  computeComplianceSummary,
  createCareCircleFixture,
  createDoseLogFixture,
  createDoseService,
  DoseLogDocument,
  DoseStatus,
  MockFirestoreDb,
  renderCaregiverDashboard,
  seedPatientCareCircleScenario,
} from '../harness';

describe('Tier 2 (Boundary) — F09: Caregiver Dashboard Timeline & Unconfirmed Alerts', () => {
  it('T2-F09-01: Midnight Date Rollover Transition', () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle } = seedPatientCareCircleScenario(db, {
      doseStatus: 'taken',
    });

    const nextDayDose = createDoseLogFixture({
      id: `${patient.uid}_med_metformin_2026-11-26_0800`,
      patientId: patient.uid,
      medicationName: 'Metformin',
      scheduledDate: '2026-11-26',
      scheduledTime: new Date('2026-11-26T08:00:00.000Z'),
      status: 'scheduled',
    });
    db.seedDoc('dose_logs', nextDayDose.id, nextDayDose);

    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const container = document.createElement('div');
    const unsubDay1 = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(container, doses, circle);
    });
    expect(container.querySelectorAll('[data-dose-id]')).toHaveLength(1);
    expect(container.querySelector('[data-dose-id]')?.getAttribute('data-status')).toBe('taken');
    unsubDay1();

    // Midnight 00:00:00 rollover switches date subscription cleanly to 2026-11-26
    const unsubDay2 = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-26', (doses) => {
      renderCaregiverDashboard(container, doses, circle);
    });
    const renderedDay2 = container.querySelectorAll('[data-dose-id]');
    expect(renderedDay2).toHaveLength(1);
    expect(renderedDay2[0].getAttribute('data-dose-id')).toBe(nextDayDose.id);
    expect(renderedDay2[0].getAttribute('data-status')).toBe('scheduled');
    unsubDay2();
  });

  it('T2-F09-02: Zero Scheduled Doses Empty State', () => {
    const container = document.createElement('div');
    const circle = createCareCircleFixture();

    const { summary, alertBanner, timelineItems } = renderCaregiverDashboard(container, [], circle);

    expect(summary).toEqual({
      scheduled: 0,
      taken: 0,
      pending: 0,
      unconfirmed: 0,
    });
    expect(alertBanner).toBeNull();
    expect(timelineItems).toHaveLength(0);
    expect(container.querySelector('#badge-scheduled')?.getAttribute('data-count')).toBe('0');
    expect(container.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('0');
    expect(container.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('0');
    expect(container.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('0');
  });

  it('T2-F09-03: High-Volume Dose Timeline Stress (25 Doses)', () => {
    const statuses: DoseStatus[] = ['taken', 'due', 'scheduled', 'snoozed', 'unconfirmed'];
    const doses: DoseLogDocument[] = [];
    for (let i = 24; i >= 0; i -= 1) {
      doses.push(
        createDoseLogFixture({
          id: `dose_stress_${String(i).padStart(2, '0')}`,
          medicationName: `Medication-${i}`,
          scheduledTime: new Date(Date.UTC(2026, 10, 25, 6, i * 30, 0)),
          status: statuses[i % statuses.length],
        })
      );
    }

    const container = document.createElement('div');
    const { summary, timelineItems } = renderCaregiverDashboard(
      container,
      doses,
      createCareCircleFixture()
    );

    expect(timelineItems).toHaveLength(25);
    // Ascending chronological sort verified
    expect(timelineItems[0].getAttribute('data-dose-id')).toBe('dose_stress_00');
    expect(timelineItems[24].getAttribute('data-dose-id')).toBe('dose_stress_24');

    expect(summary).toEqual({
      scheduled: 25,
      taken: 5,
      pending: 15, // due (5) + scheduled (5) + snoozed (5)
      unconfirmed: 5,
    });
    expect(computeComplianceSummary(doses)).toEqual(summary);
  });

  it('T2-F09-04: Multiple Concurrent Unconfirmed Doses Stacking', () => {
    const container = document.createElement('div');
    const circle = createCareCircleFixture({ patientName: 'Ramesh Sharma' });
    const doses: DoseLogDocument[] = [
      createDoseLogFixture({
        id: 'u1',
        medicationName: 'Metformin',
        dosage: '500 mg',
        status: 'unconfirmed',
      }),
      createDoseLogFixture({
        id: 'u2',
        medicationName: 'Amlodipine',
        dosage: '5 mg',
        status: 'unconfirmed',
      }),
      createDoseLogFixture({
        id: 'u3',
        medicationName: 'Atorvastatin',
        dosage: '20 mg',
        status: 'unconfirmed',
      }),
    ];

    const { summary, alertBanner } = renderCaregiverDashboard(container, doses, circle);

    expect(summary.unconfirmed).toBe(3);
    expect(alertBanner).not.toBeNull();
    expect(alertBanner?.getAttribute('role')).toBe('alert');
    expect(alertBanner?.textContent).toContain('Metformin (500 mg)');
    expect(alertBanner?.textContent).toContain('Amlodipine (5 mg)');
    expect(alertBanner?.textContent).toContain('Atorvastatin (20 mg)');
  });

  it('T2-F09-05: Zero-Latency Alert Banner Unmount on Sync', async () => {
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
    let renderCount = 0;
    const unsub = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      renderCount += 1;
      renderCaregiverDashboard(container, doses, circle);
    });

    expect(renderCount).toBe(1);
    expect(container.querySelector('#unconfirmed-alert-banner')).not.toBeNull();
    expect(container.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('1');

    await patientService.confirmDoseTaken(
      doseLog.id,
      patient.uid,
      new Date('2026-11-25T08:42:00.000Z')
    );

    // Unmounted synchronously within the single listener notification render frame
    expect(renderCount).toBe(2);
    expect(container.querySelector('#unconfirmed-alert-banner')).toBeNull();
    expect(container.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('0');
    expect(container.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('1');
    unsub();
  });
});
