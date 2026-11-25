import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canSnooze,
  checkDoseEscalations,
  createCareCircleFixture,
  createDoseLogFixture,
  createDoseService,
  createUserProfile,
  DoseLogDocument,
  evaluateDoseState,
  MockFirestoreDb,
  renderCaregiverDashboard,
  renderElderlySimpleMode,
  TimeTravelController,
} from '../harness/index.ts';

describe('Tier 4 — Scenario 2: Busy Morning Snooze (F4, F5, F8, F9)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Elderly Robert snoozes Metformin 500mg at T+1m, re-receives chime at T+11m with snooze disabled, and confirms Taken at T+14m', async () => {
    const scheduledT = new Date('2026-11-25T08:00:00.000Z');
    const timeTravel = new TimeTravelController(scheduledT);
    const db = new MockFirestoreDb();

    const robert = createUserProfile({
      uid: 'robert_1',
      email: 'robert@medimate.test',
      displayName: 'Robert Chen',
      role: 'elderly',
    });
    const david = createUserProfile({
      uid: 'david_2',
      email: 'david@medimate.test',
      displayName: 'David Chen',
      role: 'caregiver',
    });
    const circle = createCareCircleFixture({
      id: robert.uid,
      patientId: robert.uid,
      patientName: robert.displayName,
      caregiverIds: [david.uid],
      members: [
        {
          userId: david.uid,
          displayName: david.displayName,
          email: david.email,
          role: 'primary',
          permissions: ['read', 'write_schedule', 'receive_alerts'],
          status: 'active',
          invitedAt: scheduledT,
          joinedAt: scheduledT,
        },
      ],
    });
    const dose = createDoseLogFixture({
      id: 'robert_1_med_metformin_2026-11-25_0800',
      patientId: robert.uid,
      medicationId: 'med_metformin',
      medicationName: 'Metformin',
      dosage: '500 mg',
      scheduledTime: scheduledT,
      status: 'due',
      snoozeCount: 0,
    });

    db.seedDoc('users', robert.uid, robert);
    db.seedDoc('users', david.uid, david);
    db.seedDoc('care_circles', circle.id, circle);
    db.seedDoc('dose_logs', dose.id, dose);

    const robertService = createDoseService(db, () => ({ uid: robert.uid, role: 'elderly' }));
    const davidService = createDoseService(db, () => ({ uid: david.uid, role: 'caregiver' }));

    const caregiverContainer = document.createElement('div');
    const elderlyContainer = document.createElement('div');

    const unsubscribe = davidService.subscribeToDoseLogs(robert.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(caregiverContainer, doses, circle, robert.displayName);
    });

    // Step 1: T (08:00:00Z) — Dose is due
    const uiAtT = renderElderlySimpleMode(elderlyContainer, {
      dose,
      patientName: robert.displayName,
      onSnooze: async (id) => {
        await robertService.snoozeDose(id, timeTravel.getCurrentTime());
      },
      onConfirmTaken: async (id) => {
        await robertService.confirmDoseTaken(id, robert.uid, timeTravel.getCurrentTime());
      },
    });
    expect(uiAtT.snoozeButton?.disabled).toBe(false);

    // Step 2: T + 1m (08:01:00Z) — Robert taps "Remind Me Later (10 min)"
    timeTravel.advanceByMinutes(1);
    uiAtT.snoozeButton!.click();
    await Promise.resolve();

    expect(uiAtT.snoozeButton?.disabled).toBe(true);
    expect(uiAtT.statusRegion?.textContent).toContain('snoozed for 10 minutes');

    const snoozedDoc = db.inspectDoc<DoseLogDocument>('dose_logs', dose.id)!;
    expect(snoozedDoc.status).toBe('snoozed');
    expect(snoozedDoc.snoozeCount).toBe(1);
    expect(new Date(snoozedDoc.snoozeUntil!).getTime()).toBe(
      new Date('2026-11-25T08:11:00.000Z').getTime()
    );
    expect(
      caregiverContainer.querySelector(`[data-dose-id="${dose.id}"]`)?.getAttribute('data-status')
    ).toBe('snoozed');

    // Step 3: T + 11m (08:11:00Z) — Snooze expires, transitions snoozed -> due
    timeTravel.advanceTo(new Date('2026-11-25T08:11:00.000Z'));
    const reDueEval = evaluateDoseState({
      currentStatus: snoozedDoc.status,
      scheduledTime: scheduledT,
      currentTime: timeTravel.getCurrentTime(),
      snoozeCount: snoozedDoc.snoozeCount,
      snoozeUntil: new Date(snoozedDoc.snoozeUntil!),
    });
    expect(reDueEval.nextStatus).toBe('due');
    expect(reDueEval.sendInitialReminder).toBe(true);

    const reDueDoc = db.updateDoc<DoseLogDocument>(
      'dose_logs',
      dose.id,
      { status: reDueEval.nextStatus, snoozeUntil: null, updatedAt: timeTravel.getCurrentTime() },
      { uid: robert.uid, role: 'elderly' }
    );

    const uiAfterSnooze = renderElderlySimpleMode(elderlyContainer, {
      dose: reDueDoc,
      patientName: robert.displayName,
      onConfirmTaken: async (id) => {
        await robertService.confirmDoseTaken(id, robert.uid, timeTravel.getCurrentTime());
      },
      onSnooze: async (id) => {
        await robertService.snoozeDose(id, timeTravel.getCurrentTime());
      },
    });
    expect(uiAfterSnooze.snoozeButton?.disabled).toBe(true);
    expect(uiAfterSnooze.snoozeButton?.getAttribute('aria-disabled')).toBe('true');
    expect(uiAfterSnooze.snoozeButton?.textContent).toBe('Snooze limit reached');
    expect(canSnooze(reDueDoc.snoozeCount, reDueDoc.status)).toBe(false);
    expect(uiAfterSnooze.takenButton?.disabled).toBe(false);

    // Step 4: T + 14m (08:14:00Z) — Robert taps Taken
    timeTravel.advanceTo(new Date('2026-11-25T08:14:00.000Z'));
    uiAfterSnooze.takenButton!.click();
    await Promise.resolve();

    const takenDoc = db.inspectDoc<DoseLogDocument>('dose_logs', dose.id)!;
    expect(takenDoc.status).toBe('taken');
    expect(new Date(takenDoc.takenAt!).getTime()).toBe(
      new Date('2026-11-25T08:14:00.000Z').getTime()
    );

    // Gentle reminder (T+15m) & Escalation (T+30m) are permanently disarmed
    timeTravel.advanceToGentleReminder(scheduledT);
    const sweepAt15m = checkDoseEscalations(db, timeTravel.getCurrentTime());
    expect(sweepAt15m.gentleReminderIds).toEqual([]);
    expect(sweepAt15m.escalatedIds).toEqual([]);

    timeTravel.advanceToEscalation(scheduledT);
    const sweepAt30m = checkDoseEscalations(db, timeTravel.getCurrentTime());
    expect(sweepAt30m.escalatedIds).toEqual([]);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', dose.id)?.status).toBe('taken');

    // David's dashboard shows completed dose with 0 alerts
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();

    unsubscribe();
    timeTravel.reset();
  });
});
