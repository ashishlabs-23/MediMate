import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertTouchTarget,
  createCareCircleFixture,
  createDoseLogFixture,
  createDoseService,
  createUserProfile,
  DoseLogDocument,
  MockFirestoreDb,
  renderCaregiverDashboard,
  renderElderlySimpleMode,
  TimeTravelController,
} from '../harness/index.ts';

describe('Tier 4 — Scenario 4: Late Confirmation after Escalation (F4, F6, F8, F9)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Patient Mary confirms overdue Lisinopril at T+45m; Caregiver James alert banner clears instantaneously', async () => {
    const scheduledT = new Date('2026-11-25T09:00:00.000Z');
    const escalatedAt = new Date('2026-11-25T09:30:00.000Z');
    const timeTravel = new TimeTravelController(new Date('2026-11-25T09:35:00.000Z'));
    const db = new MockFirestoreDb();

    const mary = createUserProfile({
      uid: 'mary_1',
      email: 'mary@medimate.test',
      displayName: 'Mary Johnson',
      role: 'elderly',
    });
    const james = createUserProfile({
      uid: 'james_2',
      email: 'james@medimate.test',
      displayName: 'James Johnson',
      role: 'caregiver',
    });
    const circle = createCareCircleFixture({
      id: mary.uid,
      patientId: mary.uid,
      patientName: mary.displayName,
      caregiverIds: [james.uid],
      members: [
        {
          userId: james.uid,
          displayName: james.displayName,
          email: james.email,
          role: 'primary',
          permissions: ['read', 'write_schedule', 'receive_alerts'],
          status: 'active',
          invitedAt: scheduledT,
          joinedAt: scheduledT,
        },
      ],
    });
    const overdueDose = createDoseLogFixture({
      id: 'mary_1_med_lisinopril_2026-11-25_0900',
      patientId: mary.uid,
      medicationId: 'med_lisinopril',
      medicationName: 'Lisinopril',
      dosage: '10 mg',
      scheduledTime: scheduledT,
      status: 'unconfirmed',
      snoozeCount: 0,
      escalatedAt,
      followUpSent: true,
      escalationAlertSent: true,
    });

    db.seedDoc('users', mary.uid, mary);
    db.seedDoc('users', james.uid, james);
    db.seedDoc('care_circles', circle.id, circle);
    db.seedDoc('dose_logs', overdueDose.id, overdueDose);

    const maryService = createDoseService(db, () => ({ uid: mary.uid, role: 'elderly' }));
    const jamesService = createDoseService(db, () => ({ uid: james.uid, role: 'caregiver' }));

    const caregiverContainer = document.createElement('div');
    const elderlyContainer = document.createElement('div');

    const unsubscribe = jamesService.subscribeToDoseLogs(mary.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(caregiverContainer, doses, circle, mary.displayName);
    });

    // Step 1: T + 35m (09:35:00Z) — Urgent alert banner is active on James's dashboard
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).not.toBeNull();
    expect(caregiverContainer.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('0');

    // Step 2: T + 45m (09:45:00Z) — Mary opens Simple Mode; Taken button remains accessible
    timeTravel.advancePastEscalation(scheduledT, 15);
    const { takenButton, statusRegion } = renderElderlySimpleMode(elderlyContainer, {
      dose: overdueDose,
      patientName: mary.displayName,
      onConfirmTaken: async (id) => {
        await maryService.confirmDoseTaken(id, mary.uid, timeTravel.getCurrentTime());
      },
    });

    expect(takenButton).not.toBeNull();
    expect(takenButton!.disabled).toBe(false);
    assertTouchTarget(takenButton!, 44);

    // Step 3: Mary taps Taken -> state transitions unconfirmed -> taken
    takenButton!.click();
    await Promise.resolve();

    expect(takenButton!.disabled).toBe(true);
    expect(takenButton!.textContent).toContain('Recorded');
    expect(statusRegion?.textContent).toContain('marked as taken');

    const updated = db.inspectDoc<DoseLogDocument>('dose_logs', overdueDose.id)!;
    expect(updated.status).toBe('taken');
    expect(updated.takenBy).toBe(mary.uid);
    expect(new Date(updated.takenAt!).getTime()).toBe(
      new Date('2026-11-25T09:45:00.000Z').getTime()
    );

    // Step 4: Instantaneous caregiver resolution via snapshot listener
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();
    expect(
      caregiverContainer.querySelector(`[data-dose-id="${overdueDose.id}"]`)?.getAttribute('data-status')
    ).toBe('taken');
    expect(caregiverContainer.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('1');

    unsubscribe();
    timeTravel.reset();
  });
});
