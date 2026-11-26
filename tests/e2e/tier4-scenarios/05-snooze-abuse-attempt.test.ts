import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canSnooze,
  createDoseLogFixture,
  createDoseService,
  createUserProfile,
  DoseLogDocument,
  DoseStateMachineSimulator,
  evaluateDoseState,
  MockFirestoreDb,
  PermissionDeniedError,
  renderElderlySimpleMode,
  TimeTravelController,
} from '../harness/index.ts';

describe('Tier 4 — Scenario 5: Snooze Abuse Attempt (F4, F5, F6)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Second snooze attempt at T+13m is blocked across UI, Domain, and Firestore layers and preserves T+30m escalation', async () => {
    const scheduledT = new Date('2026-11-25T10:00:00.000Z');
    const timeTravel = new TimeTravelController(scheduledT);
    const db = new MockFirestoreDb();

    const arthur = createUserProfile({
      uid: 'arthur_1',
      email: 'arthur@medimate.test',
      displayName: 'Arthur Pendelton',
      role: 'elderly',
    });
    const dose = createDoseLogFixture({
      id: 'arthur_1_med_donepezil_2026-11-25_1000',
      patientId: arthur.uid,
      medicationId: 'med_donepezil',
      medicationName: 'Donepezil',
      dosage: '5 mg',
      scheduledTime: scheduledT,
      status: 'due',
      snoozeCount: 0,
    });
    db.seedDoc('users', arthur.uid, arthur);
    db.seedDoc('dose_logs', dose.id, dose);

    const arthurService = createDoseService(db, () => ({ uid: arthur.uid, role: 'elderly' }));
    const sim = new DoseStateMachineSimulator(
      {
        id: dose.id,
        patientId: arthur.uid,
        medicationName: dose.medicationName,
        scheduledTime: scheduledT,
        status: 'due',
        snoozeCount: 0,
        escalationAlertSent: false,
        followUpSent: false,
      },
      timeTravel
    );

    // Step 1 & 2: T + 2m (10:02:00Z) — Arthur taps Remind Me Later (valid first snooze)
    timeTravel.advanceByMinutes(2);
    expect(sim.tapSnooze()).toBe(true);
    await arthurService.snoozeDose(dose.id, timeTravel.getCurrentTime());

    expect(sim.getDose().status).toBe('snoozed');
    expect(sim.getDose().snoozeCount).toBe(1);
    expect(sim.getDose().snoozeUntil?.getTime()).toBe(
      new Date('2026-11-25T10:12:00.000Z').getTime()
    );

    // Step 3: T + 12m (10:12:00Z) — Snooze expires -> transitions back to due
    timeTravel.advanceTo(new Date('2026-11-25T10:12:00.000Z'));
    const reDue = sim.tick();
    expect(reDue.nextStatus).toBe('due');
    expect(sim.getDose().snoozeCount).toBe(1);

    const reDueDoc = db.updateDoc<DoseLogDocument>(
      'dose_logs',
      dose.id,
      { status: 'due', snoozeUntil: null, updatedAt: timeTravel.getCurrentTime() },
      { uid: arthur.uid, role: 'elderly' }
    );

    // Step 4: T + 13m (10:13:00Z) — Abuse attempt (2nd snooze) blocked at all layers
    timeTravel.advanceByMinutes(1);
    const snoozeHandler = vi.fn();
    const container = document.createElement('div');
    const { snoozeButton } = renderElderlySimpleMode(container, {
      dose: reDueDoc,
      patientName: arthur.displayName,
      onSnooze: snoozeHandler,
    });

    // UI level
    expect(snoozeButton?.disabled).toBe(true);
    expect(snoozeButton?.getAttribute('aria-disabled')).toBe('true');
    snoozeButton?.click();
    expect(snoozeHandler).not.toHaveBeenCalled();

    // Domain & Simulator level
    expect(canSnooze(1, 'due')).toBe(false);
    expect(sim.tapSnooze()).toBe(false);
    expect(sim.getDose().status).toBe('due');
    expect(sim.getDose().snoozeUntil).toBeNull();
    expect(() =>
      evaluateDoseState({
        currentStatus: 'due',
        scheduledTime: scheduledT,
        currentTime: timeTravel.getCurrentTime(),
        snoozeCount: 1,
        action: 'tapSnooze',
      })
    ).toThrow(/snooze disallowed/i);

    // Service & Firestore security rule level
    await expect(arthurService.snoozeDose(dose.id, timeTravel.getCurrentTime())).rejects.toThrow(
      /snooze disallowed/i
    );
    expect(() =>
      db.updateDoc('dose_logs', dose.id, { snoozeCount: 2, status: 'snoozed' }, { uid: arthur.uid, role: 'elderly' })
    ).toThrow(PermissionDeniedError);

    // Step 5: T + 30m (10:30:00Z) — Escalation deadline preserved
    // R1: client T+30m transition marks status: 'unconfirmed' with snoozeUntil: null ONLY;
    // backend/Functions escalation sends caregiver FCM and sets escalationAlertSent: true / escalatedAt.
    timeTravel.advanceToEscalation(scheduledT);
    const escResult = sim.tick();
    expect(escResult.nextStatus).toBe('unconfirmed');
    expect(escResult.sendEscalationAlert).toBe(true);
    expect(sim.getDose().status).toBe('unconfirmed');
    expect(sim.getDose().snoozeUntil).toBeNull();
    expect(sim.getDose().escalationAlertSent).toBe(false);
    expect(sim.getDose().escalatedAt).toBeNull();

    timeTravel.reset();
  });
});
