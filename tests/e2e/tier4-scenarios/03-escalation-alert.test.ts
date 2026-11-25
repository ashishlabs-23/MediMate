import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertContrast,
  checkDoseEscalations,
  createCareCircleFixture,
  createDoseLogFixture,
  createDoseService,
  createUserProfile,
  DoseLogDocument,
  MEDIMATE_COLOR_TOKENS,
  MockFirestoreDb,
  renderCaregiverDashboard,
  TimeTravelController,
} from '../harness/index.ts';

describe('Tier 4 — Scenario 3: Escalation & Caregiver Alert (F4, F6, F9)', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('Patient Mary misses reminders through T+15m and T+30m; Caregiver James receives urgent alert banner', () => {
    const scheduledT = new Date('2026-11-25T09:00:00.000Z');
    const timeTravel = new TimeTravelController(scheduledT);
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
    const lisinopril = createDoseLogFixture({
      id: 'mary_1_med_lisinopril_2026-11-25_0900',
      patientId: mary.uid,
      medicationId: 'med_lisinopril',
      medicationName: 'Lisinopril',
      dosage: '10 mg',
      scheduledTime: scheduledT,
      status: 'due',
      snoozeCount: 0,
      followUpSent: false,
      escalationAlertSent: false,
    });

    db.seedDoc('users', mary.uid, mary);
    db.seedDoc('users', james.uid, james);
    db.seedDoc('care_circles', circle.id, circle);
    db.seedDoc('dose_logs', lisinopril.id, lisinopril);

    const jamesService = createDoseService(db, () => ({ uid: james.uid, role: 'caregiver' }));
    const caregiverContainer = document.createElement('div');
    const unsubscribe = jamesService.subscribeToDoseLogs(mary.uid, '2026-11-25', (doses) => {
      renderCaregiverDashboard(caregiverContainer, doses, circle, mary.displayName);
    });

    // Step 1: T (09:00:00Z) — Dose is due, no alert banner
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();
    expect(caregiverContainer.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('1');

    // Step 2: T + 15m (09:15:00Z) — Gentle follow-up reminder sent; status remains due; NO caregiver alert
    timeTravel.advanceToGentleReminder(scheduledT);
    const gentleSweep = checkDoseEscalations(db, timeTravel.getCurrentTime());
    expect(gentleSweep.gentleReminderIds).toEqual([lisinopril.id]);
    expect(gentleSweep.escalatedIds).toEqual([]);

    const docAt15m = db.inspectDoc<DoseLogDocument>('dose_logs', lisinopril.id)!;
    expect(docAt15m.status).toBe('due');
    expect(docAt15m.followUpSent).toBe(true);
    expect(docAt15m.escalationAlertSent).toBe(false);
    expect(caregiverContainer.querySelector('#unconfirmed-alert-banner')).toBeNull();

    // Step 3: T + 30m (09:30:00Z) — Cloud Function escalation sweep updates Firestore via adminUpdateDoc
    // and automatically notifies Caregiver James's active snapshot listener
    timeTravel.advanceToEscalation(scheduledT);
    const escalationSweep = checkDoseEscalations(db, timeTravel.getCurrentTime());
    expect(escalationSweep.escalatedIds).toEqual([lisinopril.id]);

    const docAt30m = db.inspectDoc<DoseLogDocument>('dose_logs', lisinopril.id)!;
    expect(docAt30m.status).toBe('unconfirmed');
    expect(docAt30m.escalationAlertSent).toBe(true);
    expect(new Date(docAt30m.escalatedAt!).getTime()).toBe(
      new Date('2026-11-25T09:30:00.000Z').getTime()
    );

    // Step 4: Caregiver dashboard mounts high-visibility urgent alert banner
    const banner = caregiverContainer.querySelector('#unconfirmed-alert-banner') as HTMLElement | null;
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('alert');
    expect(banner?.getAttribute('aria-live')).toBe('assertive');
    expect(banner?.textContent).toContain('URGENT');
    expect(banner?.textContent).toContain('Mary Johnson');
    expect(banner?.textContent).toContain('Lisinopril');
    expect(banner?.textContent).toContain('10 mg');

    assertContrast(
      MEDIMATE_COLOR_TOKENS.alertBannerText,
      MEDIMATE_COLOR_TOKENS.alertBannerBg,
      4.5,
      'Caregiver urgent alert banner'
    );

    expect(caregiverContainer.querySelector('#badge-unconfirmed')?.getAttribute('data-count')).toBe('1');
    expect(caregiverContainer.querySelector('#badge-taken')?.getAttribute('data-count')).toBe('0');
    expect(caregiverContainer.querySelector('#badge-pending')?.getAttribute('data-count')).toBe('0');

    unsubscribe();
    timeTravel.reset();
  });
});
