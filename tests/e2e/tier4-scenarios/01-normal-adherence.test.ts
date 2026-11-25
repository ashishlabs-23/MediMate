import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertContrast,
  assertTouchTarget,
  checkAriaCompliance,
  createCareCircleFixture,
  createDoseService,
  createMedicationFixture,
  createUserProfile,
  DoseLogDocument,
  evaluateDoseState,
  generateDailyDoseLogs,
  MEDIMATE_COLOR_TOKENS,
  MockFirestoreDb,
  renderCaregiverDashboard,
  renderElderlySimpleMode,
  TimeTravelController,
} from '../harness/index.ts';

describe('Tier 4 — Scenario 1: Normal Daily Adherence (F4, F8, F9)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Elderly Eleanor takes morning Amlodipine 5mg at T+2m15s and Caregiver Sarah sees instant green update', async () => {
    const scheduledT = new Date('2026-11-25T08:00:00.000Z');
    const timeTravel = new TimeTravelController(new Date('2026-11-25T07:59:00.000Z'));
    const db = new MockFirestoreDb();

    // Actors: Eleanor (elderly) & Sarah (caregiver)
    const eleanor = createUserProfile({
      uid: 'eleanor_1',
      email: 'eleanor@medimate.test',
      displayName: 'Eleanor Vance',
      role: 'elderly',
    });
    const sarah = createUserProfile({
      uid: 'sarah_2',
      email: 'sarah@medimate.test',
      displayName: 'Sarah Vance',
      role: 'caregiver',
    });
    const circle = createCareCircleFixture({
      id: eleanor.uid,
      patientId: eleanor.uid,
      patientName: eleanor.displayName,
      caregiverIds: [sarah.uid],
      members: [
        {
          userId: sarah.uid,
          displayName: sarah.displayName,
          email: sarah.email,
          role: 'primary',
          permissions: ['read', 'write_schedule', 'receive_alerts'],
          status: 'active',
          invitedAt: timeTravel.getCurrentTime(),
          joinedAt: timeTravel.getCurrentTime(),
        },
      ],
    });
    const amlodipine = createMedicationFixture({
      id: 'med_amlodipine',
      patientId: eleanor.uid,
      name: 'Amlodipine',
      dosage: '5 mg',
      instructions: 'Take 1 tablet by mouth every morning',
      schedule: {
        times: ['08:00'],
        frequency: 'daily',
        startDate: '2026-11-01',
        endDate: null,
      },
      createdBy: sarah.uid,
    });

    db.seedDoc('users', eleanor.uid, eleanor);
    db.seedDoc('users', sarah.uid, sarah);
    db.seedDoc('care_circles', circle.id, circle);
    db.seedDoc('medications', amlodipine.id, amlodipine);

    const generated = generateDailyDoseLogs(db, '2026-11-25', timeTravel.getCurrentTime());
    expect(generated.createdCount).toBe(1);
    const doseId = generated.createdIds[0];

    const eleanorService = createDoseService(db, () => ({ uid: eleanor.uid, role: 'elderly' }));
    const sarahService = createDoseService(db, () => ({ uid: sarah.uid, role: 'caregiver' }));

    const caregiverContainer = document.createElement('div');
    const elderlyContainer = document.createElement('div');
    const vibrateSpy = vi.spyOn(navigator, 'vibrate');

    const unsubscribe = sarahService.subscribeToDoseLogs(eleanor.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(caregiverContainer, doses, circle, eleanor.displayName);
    });

    // Step 1: T - 1m (07:59:00Z) — Scheduled state
    const scheduledDose = db.inspectDoc<DoseLogDocument>('dose_logs', doseId)!;
    expect(scheduledDose.status).toBe('scheduled');
    renderElderlySimpleMode(elderlyContainer, {
      dose: scheduledDose,
      patientName: eleanor.displayName,
    });
    expect(elderlyContainer.querySelector('#dose-medication-name')?.textContent).toBe('Amlodipine');
    expect(caregiverContainer.querySelector('#badge-scheduled')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('1');

    // Step 2: T (08:00:00Z) — Transitions to due, initial chime / UI active
    timeTravel.advanceToDue(scheduledT);
    const dueEval = evaluateDoseState({
      currentStatus: scheduledDose.status,
      scheduledTime: scheduledT,
      currentTime: timeTravel.getCurrentTime(),
      snoozeCount: scheduledDose.snoozeCount,
    });
    expect(dueEval.nextStatus).toBe('due');
    expect(dueEval.sendInitialReminder).toBe(true);

    const dueDose = db.updateDoc<DoseLogDocument>(
      'dose_logs',
      doseId,
      { status: dueEval.nextStatus, updatedAt: timeTravel.getCurrentTime() },
      { uid: eleanor.uid, role: 'elderly' }
    );

    expect(
      caregiverContainer.querySelector(`[data-dose-id="${doseId}"]`)?.getAttribute('data-status')
    ).toBe('due');

    const uiAtDue = renderElderlySimpleMode(elderlyContainer, {
      dose: dueDose,
      patientName: eleanor.displayName,
      onConfirmTaken: async (id) => {
        await eleanorService.confirmDoseTaken(id, eleanor.uid, timeTravel.getCurrentTime());
      },
    });

    assertTouchTarget(uiAtDue.takenButton!, 44);
    assertTouchTarget(uiAtDue.snoozeButton!, 44);
    expect(checkAriaCompliance(uiAtDue.takenButton!).passed).toBe(true);
    assertContrast(MEDIMATE_COLOR_TOKENS.takenBtnText, MEDIMATE_COLOR_TOKENS.takenBtnBg, 4.5);

    // Step 3: T + 2m15s (08:02:15Z) — Eleanor taps "Taken"
    timeTravel.advanceBySeconds(2 * 60 + 15);
    uiAtDue.takenButton!.click();
    await Promise.resolve();

    expect(vibrateSpy).toHaveBeenCalledWith([40, 60, 40]);
    expect(uiAtDue.takenButton!.disabled).toBe(true);
    expect(uiAtDue.takenButton!.textContent).toContain('Recorded');
    expect(uiAtDue.snoozeButton!.disabled).toBe(true);

    const takenDoc = db.inspectDoc<DoseLogDocument>('dose_logs', doseId)!;
    expect(takenDoc.status).toBe('taken');
    expect(takenDoc.takenBy).toBe(eleanor.uid);
    expect(new Date(takenDoc.takenAt!).getTime()).toBe(
      new Date('2026-11-25T08:02:15.000Z').getTime()
    );

    // Step 4: Caregiver Sarah's dashboard reflects instant completion with zero alerts
    expect(
      caregiverContainer.querySelector(`[data-dose-id="${doseId}"]`)?.getAttribute('data-status')
    ).toBe('taken');
    expect(caregiverContainer.querySelector('#badge-scheduled')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();

    unsubscribe();
    timeTravel.reset();
  });
});
