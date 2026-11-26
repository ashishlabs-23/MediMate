import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertContrast,
  assertTouchTarget,
  canSnooze,
  checkAriaCompliance,
  checkDoseEscalations,
  checkTouchTargetSeparation,
  createCareCircleFixture,
  createDoseLogFixture,
  createDoseService,
  createUserFixture,
  createUserProfile,
  DoseLogDocument,
  DoseStateMachineSimulator,
  evaluateDoseState,
  MEDIMATE_COLOR_TOKENS,
  MockFirestoreDb,
  PermissionDeniedError,
  renderCaregiverDashboard,
  renderElderlySimpleMode,
  resolveViewForRole,
  seedPatientCareCircleScenario,
  TimeTravelController,
} from '../harness/index.ts';

describe('Tier 3 — Cross-Feature Pairwise Interactions (T3-PAIR-01 .. T3-PAIR-12)', () => {
  const scheduledT = new Date('2026-11-25T08:00:00.000Z');

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (typeof navigator !== 'undefined') {
      Object.defineProperty(navigator, 'onLine', {
        value: true,
        writable: true,
        configurable: true,
      });
    }
  });

  it('T3-PAIR-01: Snooze at T+5m preserves hard T+30m escalation deadline (F4 + F5 + F6)', () => {
    const timeTravel = new TimeTravelController(new Date('2026-11-25T07:55:00.000Z'));
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_pair_01',
        patientId: 'patient_p',
        medicationName: 'Amlodipine',
        scheduledTime: scheduledT,
        status: 'scheduled',
        snoozeCount: 0,
        escalationAlertSent: false,
        followUpSent: false,
      },
      timeTravel
    );

    // 1. Advance to T (08:00:00Z) -> due
    timeTravel.advanceToDue(scheduledT);
    const dueResult = sim.tick();
    expect(dueResult.nextStatus).toBe('due');
    expect(dueResult.sendInitialReminder).toBe(true);

    // 2. Advance to T+5m (08:05:00Z) -> tapSnooze
    timeTravel.advanceByMinutes(5);
    const snoozed = sim.tapSnooze();
    expect(snoozed).toBe(true);
    expect(sim.getDose().status).toBe('snoozed');
    expect(sim.getDose().snoozeCount).toBe(1);
    expect(sim.getDose().snoozeUntil?.getTime()).toBe(
      new Date('2026-11-25T08:15:00.000Z').getTime()
    );

    // 3. Advance to T+15m (08:15:00Z) -> snooze expires, transitions back to due
    timeTravel.advanceToGentleReminder(scheduledT);
    const reDueResult = sim.tick();
    expect(reDueResult.nextStatus).toBe('due');
    expect(reDueResult.sendGentleReminder).toBe(true);
    expect(sim.getDose().snoozeCount).toBe(1);

    // 4. Advance to T+30m (08:30:00Z) without taken action -> client marks unconfirmed without escalationAlertSent (R1)
    timeTravel.advanceToEscalation(scheduledT);
    const escalationResult = sim.tick();
    expect(escalationResult.nextStatus).toBe('unconfirmed');
    expect(escalationResult.sendEscalationAlert).toBe(true);
    expect(sim.getDose().status).toBe('unconfirmed');
    expect(sim.getDose().snoozeUntil).toBeNull();
    expect(sim.getDose().escalationAlertSent).toBe(false);
    expect(sim.getDose().escalatedAt).toBeNull();

    timeTravel.reset();
  });

  it('T3-PAIR-02: Single-tap Taken in Simple Mode disables all actions and blocks duplicate taps (F4 + F7 + F8)', async () => {
    const timeTravel = new TimeTravelController(new Date('2026-11-25T08:02:00.000Z'));
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));

    const confirmSpy = vi.fn(async (id: string) => {
      await service.confirmDoseTaken(id, patient.uid, timeTravel.getCurrentTime());
    });
    const snoozeSpy = vi.fn(async (id: string) => {
      await service.snoozeDose(id, timeTravel.getCurrentTime());
    });

    const container = document.createElement('div');
    const { takenButton, snoozeButton, statusRegion } = renderElderlySimpleMode(container, {
      dose: doseLog,
      patientName: patient.displayName,
      onConfirmTaken: confirmSpy,
      onSnooze: snoozeSpy,
    });

    expect(takenButton).not.toBeNull();
    expect(snoozeButton).not.toBeNull();

    // 1. Verify WCAG touch target >= 44x44px (and Taken button >= 56px height)
    const takenTarget = assertTouchTarget(takenButton!, 44);
    expect(takenTarget.passed).toBe(true);
    expect(takenTarget.height).toBeGreaterThanOrEqual(56);
    assertTouchTarget(snoozeButton!, 44);

    // 2. First tap on Taken
    takenButton!.click();

    // 3. Simulate duplicate tap within 100ms + attempted snooze tap
    timeTravel.advanceByMs(50);
    takenButton!.click();
    snoozeButton!.click();
    await Promise.resolve();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(snoozeSpy).not.toHaveBeenCalled();

    // UI immediately reflects disabled/confirmed state
    expect(takenButton!.disabled).toBe(true);
    expect(takenButton!.getAttribute('aria-disabled')).toBe('true');
    expect(takenButton!.textContent).toContain('Recorded');
    expect(snoozeButton!.disabled).toBe(true);
    expect(snoozeButton!.getAttribute('aria-disabled')).toBe('true');
    expect(statusRegion?.textContent).toContain('marked as taken');

    // Firestore record updated once with exact tap timestamp
    const stored = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(stored?.status).toBe('taken');
    expect(new Date(stored!.takenAt!).getTime()).toBe(
      new Date('2026-11-25T08:02:00.000Z').getTime()
    );

    timeTravel.reset();
  });

  it('T3-PAIR-03: Real-time caregiver timeline sync on Taken confirmation (F8 + F9)', async () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });

    const patientService = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const caregiverContainer = document.createElement('div');
    let snapshotCount = 0;

    const unsubscribe = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      snapshotCount += 1;
      renderCaregiverDashboard(caregiverContainer, doses, circle, patient.displayName);
    });

    expect(snapshotCount).toBe(1);
    const initialTimelineItem = caregiverContainer.querySelector(`[data-dose-id="${doseLog.id}"]`);
    expect(initialTimelineItem?.getAttribute('data-status')).toBe('due');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('1');

    // Patient marks dose as taken
    const tapTime = new Date('2026-11-25T08:04:00.000Z');
    await patientService.confirmDoseTaken(doseLog.id, patient.uid, tapTime);

    // Caregiver snapshot updates timeline and compliance badges immediately
    expect(snapshotCount).toBe(2);
    const updatedTimelineItem = caregiverContainer.querySelector(`[data-dose-id="${doseLog.id}"]`);
    expect(updatedTimelineItem?.getAttribute('data-status')).toBe('taken');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('0');

    unsubscribe();
  });

  it('T3-PAIR-04: Multi-role security isolation across patient, linked caregiver, and unlinked user (F2 + F3)', () => {
    const db = new MockFirestoreDb();

    const patientA = createUserProfile({
      uid: 'patient_a',
      email: 'patient_a@medimate.test',
      displayName: 'Patient A',
      role: 'elderly',
    });
    const caregiverB = createUserProfile({
      uid: 'caregiver_b',
      email: 'caregiver_b@medimate.test',
      displayName: 'Caregiver B',
      role: 'caregiver',
    });
    const caregiverC = createUserProfile({
      uid: 'caregiver_c',
      email: 'caregiver_c@medimate.test',
      displayName: 'Caregiver C',
      role: 'caregiver',
    });

    const circleA = createCareCircleFixture({
      id: 'patient_a',
      patientId: 'patient_a',
      patientName: 'Patient A',
      caregiverIds: ['caregiver_b'],
    });
    const doseA = createDoseLogFixture({
      id: 'dose_a',
      patientId: 'patient_a',
      status: 'due',
    });

    db.seedDoc('users', patientA.uid, patientA);
    db.seedDoc('users', caregiverB.uid, caregiverB);
    db.seedDoc('users', caregiverC.uid, caregiverC);
    db.seedDoc('care_circles', circleA.id, circleA);
    db.seedDoc('dose_logs', doseA.id, doseA);

    const authA = { uid: 'patient_a', role: 'elderly' as const };
    const authB = { uid: 'caregiver_b', role: 'caregiver' as const };
    const authC = { uid: 'caregiver_c', role: 'caregiver' as const };

    // 1. Patient A read/write: PERMITTED
    expect(db.getDoc<DoseLogDocument>('dose_logs', 'dose_a', authA)?.id).toBe('dose_a');
    const updatedByPatient = db.updateDoc<DoseLogDocument>(
      'dose_logs',
      'dose_a',
      { status: 'snoozed', snoozeCount: 1 },
      authA
    );
    expect(updatedByPatient.status).toBe('snoozed');

    // 2. Linked Caregiver B read: PERMITTED
    expect(db.getDoc<DoseLogDocument>('dose_logs', 'dose_a', authB)?.status).toBe('snoozed');

    // 3. Unlinked Caregiver C read: DENIED
    expect(() => db.getDoc('dose_logs', 'dose_a', authC)).toThrow(PermissionDeniedError);
    expect(() =>
      db.queryDocs('dose_logs', (d) => d.patientId === 'patient_a', authC, 'patient_a')
    ).toThrow(PermissionDeniedError);

    // 4. Unlinked Caregiver C write: DENIED
    expect(() =>
      db.updateDoc('dose_logs', 'dose_a', { status: 'taken' }, authC)
    ).toThrow(PermissionDeniedError);
    expect(() =>
      db.setDoc(
        'dose_logs',
        'dose_forged',
        createDoseLogFixture({ id: 'dose_forged', patientId: 'patient_a' }),
        authC
      )
    ).toThrow(PermissionDeniedError);
  });

  it('T3-PAIR-05: Snooze exhaustion disables Snooze control in Simple Mode UI (F5 + F7)', async () => {
    const timeTravel = new TimeTravelController(scheduledT);
    const db = new MockFirestoreDb();
    const { patient, doseLog } = seedPatientCareCircleScenario(db, { doseStatus: 'due' });
    const service = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));

    const snoozeSpy = vi.fn(async (id: string) => {
      await service.snoozeDose(id, timeTravel.getCurrentTime());
    });

    // 1. Elderly taps "Remind Me Later" when snoozeCount == 0
    const container = document.createElement('div');
    const initialUi = renderElderlySimpleMode(container, {
      dose: doseLog,
      patientName: patient.displayName,
      onSnooze: snoozeSpy,
    });
    expect(initialUi.snoozeButton?.disabled).toBe(false);

    initialUi.snoozeButton!.click();
    await Promise.resolve();
    expect(snoozeSpy).toHaveBeenCalledTimes(1);

    const snoozedDoc = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)!;
    expect(snoozedDoc.status).toBe('snoozed');
    expect(snoozedDoc.snoozeCount).toBe(1);

    // 2. Advance 10 minutes -> snooze expires back to due with snoozeCount == 1
    timeTravel.advanceByMinutes(10);
    const expiredEval = evaluateDoseState({
      currentStatus: snoozedDoc.status,
      scheduledTime: new Date(snoozedDoc.scheduledTime),
      currentTime: timeTravel.getCurrentTime(),
      snoozeCount: snoozedDoc.snoozeCount,
      snoozeUntil: snoozedDoc.snoozeUntil ? new Date(snoozedDoc.snoozeUntil) : null,
    });
    expect(expiredEval.nextStatus).toBe('due');

    const reDueDoc = db.updateDoc<DoseLogDocument>(
      'dose_logs',
      doseLog.id,
      { status: expiredEval.nextStatus, snoozeUntil: null, updatedAt: timeTravel.getCurrentTime() },
      { uid: patient.uid, role: 'elderly' }
    );

    // 3. Re-render Simple Mode with snoozeCount == 1
    const exhaustedUi = renderElderlySimpleMode(container, {
      dose: reDueDoc,
      patientName: patient.displayName,
      onSnooze: snoozeSpy,
    });

    expect(exhaustedUi.snoozeButton?.disabled).toBe(true);
    expect(exhaustedUi.snoozeButton?.getAttribute('aria-disabled')).toBe('true');
    expect(exhaustedUi.snoozeButton?.textContent).toBe('Snooze limit reached');

    // Attempted click & domain call produce zero transitions
    exhaustedUi.snoozeButton!.click();
    await Promise.resolve();
    expect(snoozeSpy).toHaveBeenCalledTimes(1);
    expect(canSnooze(1, 'due')).toBe(false);
    await expect(service.snoozeDose(doseLog.id, timeTravel.getCurrentTime())).rejects.toThrow(
      /snooze disallowed/i
    );

    timeTravel.reset();
  });

  it('T3-PAIR-06: T+30m escalation triggers Caregiver urgent alert banner with WCAG AA contrast (F6 + F9)', () => {
    const timeTravel = new TimeTravelController(scheduledT);
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });

    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const caregiverContainer = document.createElement('div');
    const unsubscribe = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(caregiverContainer, doses, circle, patient.displayName);
    });

    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();

    // 1. Advance to T+15m (08:15Z) -> gentle reminder only, banner remains hidden
    timeTravel.advanceToGentleReminder(scheduledT);
    const gentleEval = evaluateDoseState({
      currentStatus: 'due',
      scheduledTime: scheduledT,
      currentTime: timeTravel.getCurrentTime(),
      snoozeCount: 0,
    });
    expect(gentleEval.nextStatus).toBe('due');
    expect(gentleEval.sendGentleReminder).toBe(true);
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();

    // 2. Advance to T+30m (08:30Z) -> Cloud Function sweep escalates to unconfirmed and triggers caregiver snapshot
    timeTravel.advanceToEscalation(scheduledT);
    const escalationSweep = checkDoseEscalations(db, timeTravel.getCurrentTime());
    expect(escalationSweep.escalatedIds).toEqual([doseLog.id]);

    const banner = caregiverContainer.querySelector('#unconfirmed-alert-banner') as HTMLElement | null;
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.getAttribute('aria-live')).toBe('assertive');
    expect(banner?.textContent).toContain('URGENT');
    expect(banner?.textContent).toContain(patient.displayName);
    expect(banner?.textContent).toContain(doseLog.medicationName);
    expect(banner?.textContent).toContain(doseLog.dosage);

    // Verify WCAG AAA/AA contrast on Red-800 (#991B1B) on Red-50 (#FEF2F2) per DESIGN.md § 4.1
    const contrast = assertContrast(
      MEDIMATE_COLOR_TOKENS.alertBannerText,
      MEDIMATE_COLOR_TOKENS.alertBannerBg,
      4.5,
      'Urgent alert banner'
    );
    expect(contrast).toBeGreaterThanOrEqual(7.0);

    unsubscribe();
    timeTravel.reset();
  });

  it('T3-PAIR-07: Late confirmation at T+45m dismisses Caregiver alert immediately (F6 + F8 + F9)', async () => {
    const timeTravel = new TimeTravelController(new Date('2026-11-25T08:30:00.000Z'));
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'unconfirmed',
    });
    db.seedDoc('dose_logs', doseLog.id, {
      ...doseLog,
      escalatedAt: new Date('2026-11-25T08:30:00.000Z'),
      escalationAlertSent: true,
    });

    const patientService = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const caregiverContainer = document.createElement('div');
    const unsubscribe = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(caregiverContainer, doses, circle, patient.displayName);
    });

    // Pre-condition: alert banner visible, unconfirmed=1, taken=0
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).not.toBeNull();
    expect(caregiverContainer.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('0');

    // Advance to T+45m (08:45Z) and elderly taps Taken in Simple Mode
    timeTravel.advancePastEscalation(scheduledT, 15);
    const elderlyContainer = document.createElement('div');
    const { takenButton } = renderElderlySimpleMode(elderlyContainer, {
      dose: db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id),
      patientName: patient.displayName,
      onConfirmTaken: async (id) => {
        await patientService.confirmDoseTaken(id, patient.uid, timeTravel.getCurrentTime());
      },
    });

    takenButton!.click();
    await Promise.resolve();

    // Alert banner dismisses immediately and badges update
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();
    expect(
      caregiverContainer.querySelector(`[data-dose-id="${doseLog.id}"]`)?.getAttribute('data-status')
    ).toBe('taken');
    expect(caregiverContainer.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('1');

    const stored = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id);
    expect(new Date(stored!.takenAt!).getTime()).toBe(
      new Date('2026-11-25T08:45:00.000Z').getTime()
    );

    unsubscribe();
    timeTravel.reset();
  });

  it('T3-PAIR-08: Scheduled Cloud Function escalation runner conforms to schema and thresholds (F4 + F10 + F1)', () => {
    const db = new MockFirestoreDb();
    const runTime = new Date('2026-11-25T08:35:00.000Z');

    const dose1 = createDoseLogFixture({
      id: 'dose_1_overdue',
      patientId: 'patient_1',
      scheduledTime: new Date('2026-11-25T08:00:00.000Z'), // T+35m
      status: 'due',
      escalationAlertSent: false,
      followUpSent: false,
    });
    const dose2 = createDoseLogFixture({
      id: 'dose_2_within_window',
      patientId: 'patient_1',
      scheduledTime: new Date('2026-11-25T08:20:00.000Z'), // T+15m
      status: 'due',
      escalationAlertSent: false,
      followUpSent: false,
    });
    const dose3 = createDoseLogFixture({
      id: 'dose_3_already_taken',
      patientId: 'patient_1',
      scheduledTime: new Date('2026-11-25T08:00:00.000Z'),
      status: 'taken',
      takenAt: new Date('2026-11-25T08:03:00.000Z'),
      escalationAlertSent: false,
    });

    db.seedDoc('dose_logs', dose1.id, dose1);
    db.seedDoc('dose_logs', dose2.id, dose2);
    db.seedDoc('dose_logs', dose3.id, dose3);

    const sweep = checkDoseEscalations(db, runTime);

    expect(sweep.escalatedIds).toEqual(['dose_1_overdue']);
    expect(sweep.gentleReminderIds).toEqual(['dose_2_within_window']);

    const updated1 = db.inspectDoc<DoseLogDocument>('dose_logs', 'dose_1_overdue')!;
    expect(updated1.status).toBe('unconfirmed');
    expect(updated1.escalationAlertSent).toBe(true);
    expect(updated1.escalatedAt).toBeInstanceOf(Date);
    expect(updated1.updatedAt.getTime()).toBe(runTime.getTime());
    // Schema fields preserved per DoseLogDocument contract
    expect(typeof updated1.patientId).toBe('string');
    expect(typeof updated1.medicationId).toBe('string');
    expect(typeof updated1.snoozeCount).toBe('number');

    const updated2 = db.inspectDoc<DoseLogDocument>('dose_logs', 'dose_2_within_window')!;
    expect(updated2.status).toBe('due');
    expect(updated2.escalationAlertSent).toBe(false);
    expect(updated2.followUpSent).toBe(true);

    const updated3 = db.inspectDoc<DoseLogDocument>('dose_logs', 'dose_3_already_taken')!;
    expect(updated3.status).toBe('taken');
    expect(updated3.escalationAlertSent).toBe(false);
  });

  it('T3-PAIR-09: Offline Taken confirmation queues locally and syncs to Caregiver on reconnect (F7 + F8 + Network)', async () => {
    const timeTravel = new TimeTravelController(new Date('2026-11-25T08:06:00.000Z'));
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });

    const patientService = createDoseService(db, () => ({ uid: patient.uid, role: 'elderly' }));
    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const caregiverContainer = document.createElement('div');
    const unsubscribe = caregiverService.subscribeToDoseLogs(patient.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(caregiverContainer, doses, circle, patient.displayName);
    });

    // Offline mutation queue model
    const pendingMutations: Array<{ doseId: string; userId: string; takenAt: Date }> = [];
    const flushQueue = async () => {
      while (pendingMutations.length > 0) {
        const next = pendingMutations.shift()!;
        await patientService.confirmDoseTaken(next.doseId, next.userId, next.takenAt);
      }
    };
    const onlineListener = () => {
      void flushQueue();
    };
    window.addEventListener('online', onlineListener);

    // 1. Go offline
    Object.defineProperty(navigator, 'onLine', {
      value: false,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('offline'));

    const elderlyContainer = document.createElement('div');
    const offlineTapTime = timeTravel.getCurrentTime();
    const { takenButton, statusRegion } = renderElderlySimpleMode(elderlyContainer, {
      dose: doseLog,
      patientName: patient.displayName,
      onConfirmTaken: async (id) => {
        if (!navigator.onLine) {
          pendingMutations.push({ doseId: id, userId: patient.uid, takenAt: offlineTapTime });
          if (statusRegion) {
            statusRegion.textContent = `${doseLog.medicationName} marked as taken. Saved offline.`;
          }
          return;
        }
        await patientService.confirmDoseTaken(id, patient.uid, timeTravel.getCurrentTime());
      },
    });

    // 2. Tap Taken while offline -> optimistic UI + queued mutation, Firestore unchanged yet
    takenButton!.click();
    await Promise.resolve();

    expect(takenButton?.disabled).toBe(true);
    expect(takenButton?.textContent).toContain('Recorded');
    expect(statusRegion?.textContent).toContain('Saved offline');
    expect(pendingMutations).toHaveLength(1);
    expect(db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)?.status).toBe('due');

    // 3. Advance 4 minutes, then reconnect -> pending mutation flushes with original offline takenAt
    timeTravel.advanceByMinutes(4);
    Object.defineProperty(navigator, 'onLine', {
      value: true,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    await Promise.resolve();

    expect(pendingMutations).toHaveLength(0);
    const syncedDoc = db.inspectDoc<DoseLogDocument>('dose_logs', doseLog.id)!;
    expect(syncedDoc.status).toBe('taken');
    expect(new Date(syncedDoc.takenAt!).getTime()).toBe(offlineTapTime.getTime());
    expect(
      caregiverContainer.querySelector(`[data-dose-id="${doseLog.id}"]`)?.getAttribute('data-status')
    ).toBe('taken');

    window.removeEventListener('online', onlineListener);
    unsubscribe();
    timeTravel.reset();
  });

  it('T3-PAIR-10: Role-aware view routing enforces Simple Mode accessibility and Dashboard layout (F2 + F7 + F9)', () => {
    const elderlyProfile = createUserProfile({
      uid: 'user_e',
      email: 'elderly@medimate.test',
      displayName: 'Eleanor',
      role: 'elderly',
    });
    const caregiverProfile = createUserProfile({
      uid: 'user_c',
      email: 'caregiver@medimate.test',
      displayName: 'Sarah',
      role: 'caregiver',
    });
    const dualProfile = createUserProfile({
      uid: 'user_d',
      email: 'dual@medimate.test',
      displayName: 'Nirmala',
      role: 'dual',
    });

    // 1. Elderly routes to ElderlySimpleView with >=44px touch targets & ARIA compliance
    expect(resolveViewForRole(elderlyProfile.role)).toBe('ElderlySimpleView');
    const elderlyContainer = document.createElement('div');
    const dueDose = createDoseLogFixture({ status: 'due', snoozeCount: 0 });
    const { takenButton, snoozeButton } = renderElderlySimpleMode(elderlyContainer, {
      dose: dueDose,
      patientName: elderlyProfile.displayName,
    });
    assertTouchTarget(takenButton!, 44);
    assertTouchTarget(snoozeButton!, 44);
    expect(checkAriaCompliance(takenButton!).passed).toBe(true);
    expect(checkAriaCompliance(snoozeButton!).passed).toBe(true);
    expect(checkTouchTargetSeparation(takenButton!, snoozeButton!, 8).passed).toBe(true);

    // 2. Caregiver routes to CaregiverDashboardView with timeline & care circle sections
    expect(resolveViewForRole(caregiverProfile.role)).toBe('CaregiverDashboardView');
    const caregiverContainer = document.createElement('div');
    const circle = createCareCircleFixture({ patientName: elderlyProfile.displayName });
    renderCaregiverDashboard(caregiverContainer, [dueDose], circle, elderlyProfile.displayName);
    expect(caregiverContainer.querySelector('#dose-timeline')).not.toBeNull();
    expect(caregiverContainer.querySelector('#compliance-summary-badges')).not.toBeNull();
    expect(caregiverContainer.querySelector('#care-circle-members')).not.toBeNull();

    // 3. Dual routes to DualViewSwitcher with accessible >=44px switcher button
    expect(resolveViewForRole(dualProfile.role)).toBe('DualViewSwitcher');
    const switcherBtn = document.createElement('button') as HTMLButtonElement;
    switcherBtn.id = 'role-view-switcher';
    switcherBtn.className = 'min-w-[44px] min-h-[44px] h-12';
    switcherBtn.style.minWidth = '48px';
    switcherBtn.style.minHeight = '48px';
    switcherBtn.setAttribute('aria-label', 'Switch between Simple Mode and Caregiver Dashboard');
    switcherBtn.textContent = 'Switch View';
    assertTouchTarget(switcherBtn, 44);
    expect(checkAriaCompliance(switcherBtn).passed).toBe(true);
  });

  it('T3-PAIR-11: Care circle member removal immediately revokes active Caregiver live stream (F3 + F9)', () => {
    const db = new MockFirestoreDb();
    const { patient, caregiver, circle, doseLog } = seedPatientCareCircleScenario(db, {
      doseStatus: 'due',
    });

    const caregiverService = createDoseService(db, () => ({
      uid: caregiver.uid,
      role: 'caregiver',
    }));

    const caregiverContainer = document.createElement('div');
    const receivedSnapshots: DoseLogDocument[][] = [];
    let streamError: Error | null = null;

    const unsubscribe = caregiverService.subscribeToDoseLogs(
      patient.uid,
      '2026-11-25',
      (doses) => {
        receivedSnapshots.push(doses);
        renderCaregiverDashboard(caregiverContainer, doses, circle, patient.displayName);
      },
      (err) => {
        streamError = err;
        caregiverContainer.innerHTML = '';
        const revokedBanner = document.createElement('div');
        revokedBanner.id = 'access-revoked-banner';
        revokedBanner.setAttribute('role', 'alert');
        revokedBanner.textContent = 'Access revoked: you are no longer in this care circle.';
        caregiverContainer.appendChild(revokedBanner);
      }
    );

    expect(receivedSnapshots).toHaveLength(1);
    expect(caregiverContainer.querySelector('#dose-timeline')).not.toBeNull();

    // Patient removes Caregiver B from care_circles.caregiverIds
    db.updateDoc(
      'care_circles',
      circle.id,
      { caregiverIds: [], members: [] },
      { uid: patient.uid, role: 'elderly' }
    );

    // Active stream triggers onError with PERMISSION_DENIED and dashboard unmounts patient data
    expect(streamError).toBeInstanceOf(PermissionDeniedError);
    expect((streamError as unknown as PermissionDeniedError).code).toBe('permission-denied');
    expect(caregiverContainer.querySelector('#dose-timeline')).toBeNull();
    expect(caregiverContainer.querySelector('#access-revoked-banner')).not.toBeNull();

    // Subsequent direct read by removed caregiver is denied
    expect(() =>
      db.getDoc('dose_logs', doseLog.id, { uid: caregiver.uid, role: 'caregiver' })
    ).toThrow(PermissionDeniedError);

    unsubscribe();
  });

  it('T3-PAIR-12: Late snooze at T+25m cannot defer T+30m clinical safety escalation (F5 + F6)', () => {
    const timeTravel = new TimeTravelController(new Date('2026-11-25T08:25:00.000Z'));
    const sim = new DoseStateMachineSimulator(
      {
        id: 'dose_pair_12',
        patientId: 'patient_p',
        medicationName: 'Warfarin',
        scheduledTime: scheduledT,
        status: 'due',
        snoozeCount: 0,
        escalationAlertSent: false,
        followUpSent: true,
      },
      timeTravel
    );

    // 1. At T+25m (08:25:00Z), user triggers tapSnooze -> snoozeUntil would be 08:35:00Z
    const snoozed = sim.tapSnooze();
    expect(snoozed).toBe(true);
    expect(sim.getDose().status).toBe('snoozed');
    expect(sim.getDose().snoozeUntil?.getTime()).toBe(
      new Date('2026-11-25T08:35:00.000Z').getTime()
    );

    // 2. At T+30m (08:30:00Z), clinical escalation deadline arrives before snoozeUntil (08:35Z)
    timeTravel.advanceToEscalation(scheduledT);
    const result = sim.tick();

    // Safety invariant: T+30m escalation overrides remaining snooze window;
    // R1: client marks status: 'unconfirmed' with snoozeUntil: null without setting escalationAlertSent: true
    expect(result.nextStatus).toBe('unconfirmed');
    expect(result.sendEscalationAlert).toBe(true);
    expect(sim.getDose().status).toBe('unconfirmed');
    expect(sim.getDose().escalationAlertSent).toBe(false);
    expect(sim.getDose().escalatedAt).toBeNull();
    expect(sim.getDose().snoozeUntil).toBeNull();

    timeTravel.reset();
  });
});
