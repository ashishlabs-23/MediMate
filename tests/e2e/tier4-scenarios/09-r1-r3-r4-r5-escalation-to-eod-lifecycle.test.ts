import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MockAdminFirestore,
  createMockAdminMessaging,
} from '@harness/mockAdminFirestore';
import {
  PROJECT_ROOT,
  hasProjectFile,
  hasServerRuntimeReady,
  loadOptionalModule,
} from '@harness/reactTestHelper';
import { Timestamp } from 'firebase/firestore';
import type { DoseLogDocument } from '@/types/firestore';

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: unknown, handler: unknown) => handler),
}));

vi.mock('firebase-functions', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const getDoseLogMock = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
const updateDoseLogSpy = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});

vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: {},
  db: {},
  getMessagingInstance: vi.fn(async () => null),
  VAPID_KEY: undefined,
}));

vi.mock('@/lib/firestore', () => ({
  getDoseLog: (...args: unknown[]) => getDoseLogMock(...args),
  updateDoseLog: (...args: unknown[]) => updateDoseLogSpy(...args),
}));

import { useReminderScheduler } from '@/hooks/useReminderScheduler';

interface ExpressLikeApp {
  (req: http.IncomingMessage, res: http.ServerResponse): void;
}

async function startTestServer(app: ExpressLikeApp): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to bind ephemeral port');
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}

const serverIndexSrc = hasProjectFile('server/src/index.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/index.ts'), 'utf-8')
  : '';
const serverEscSrc = hasProjectFile('server/src/jobs/dueDosesEscalation.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/jobs/dueDosesEscalation.ts'), 'utf-8')
  : '';
const fnDailySrc = hasProjectFile('functions/src/generateDailyDoseLogs.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'functions/src/generateDailyDoseLogs.ts'), 'utf-8')
  : '';
const schedulerSrc = hasProjectFile('src/hooks/useReminderScheduler.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/hooks/useReminderScheduler.ts'), 'utf-8')
  : '';

const hasM1Lifecycle =
  hasServerRuntimeReady() &&
  hasProjectFile('server/src/jobs/eodMissedCloseout.ts') &&
  serverIndexSrc.includes('/ping') &&
  serverIndexSrc.includes('/api/jobs/close-missed-doses') &&
  serverEscSrc.includes('!data.escalationAlertSent') &&
  fnDailySrc.includes('computeScheduledTimestampInTimezone');

const hasM3ClientEscalation =
  schedulerSrc.includes("status: 'unconfirmed'") &&
  !schedulerSrc.includes('escalationAlertSent: true');

describe('Tier 4 — Scenario 09: 24h Cross-Layer Escalation to EOD Closeout Lifecycle (R1, R3, R4, R5)', () => {
  const originalEnv = { ...process.env };
  let activeClose: (() => Promise<void>) | null = null;

  beforeEach(() => {
    getDoseLogMock.mockReset();
    getDoseLogMock.mockResolvedValue(null);
    updateDoseLogSpy.mockClear();
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (activeClose) {
      await activeClose();
      activeClose = null;
    }
    process.env = { ...originalEnv };
  });

  it.runIf(hasM1Lifecycle && hasM3ClientEscalation)(
    'T4-S09-01: Full 24h America/New_York lifecycle: generateDailyDoseLogs -> T+30m browser unconfirmed -> backend FCM escalation -> /ping -> midnight EOD missed closeout',
    async () => {
      const fnDaily = await loadOptionalModule<{
        generateForDate: (
          db: unknown,
          targetDate: string
        ) => Promise<{ createdCount: number }>;
      }>('functions/src/generateDailyDoseLogs.ts');
      const serverEsc = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[] }>;
      }>('server/src/jobs/dueDosesEscalation.ts');
      const serverIndex = await loadOptionalModule<{
        createApp: (deps?: Record<string, unknown>) => ExpressLikeApp;
        runMidnightTimezoneCycle: (
          db: unknown,
          now?: Date
        ) => Promise<{ midnightTimezones: string[]; closedCount: number; createdCount: number }>;
      }>('server/src/index.ts');

      const adminDb = new MockAdminFirestore();
      const { messaging, sentMessages } = createMockAdminMessaging();

      adminDb.seed('users', 'patient_ny', {
        uid: 'patient_ny',
        timezone: 'America/New_York',
        fcmTokens: ['ny_pat_tok'],
      });
      adminDb.seed('users', 'cg_ny', {
        uid: 'cg_ny',
        fcmTokens: ['ny_cg_tok'],
      });
      adminDb.seed('care_circles', 'patient_ny', {
        patientId: 'patient_ny',
        caregiverIds: ['cg_ny'],
      });
      adminDb.seed('medications', 'med_lisinopril', {
        patientId: 'patient_ny',
        name: 'Lisinopril',
        dosage: '10 mg',
        schedule: {
          times: ['08:00'],
          frequency: 'daily',
          startDate: '2026-01-01',
          endDate: null,
        },
        active: true,
      });

      // Step 1: Generate Nov 25 dose logs in America/New_York (08:00 EST = 13:00:00Z, no +5.5h shift)
      const genRes = await fnDaily.generateForDate(adminDb, '2026-11-25');
      expect(genRes.createdCount).toBe(1);

      const doseId = 'patient_ny_med_lisinopril_2026-11-25_0800';
      const generatedDoc = adminDb.inspect('dose_logs', doseId)!;
      const scheduledDate = (generatedDoc.scheduledTime as { toDate: () => Date }).toDate();
      expect(scheduledDate.toISOString()).toBe('2026-11-25T13:00:00.000Z');

      // Step 2: Patient browser scheduler fires at T+30m (13:30Z) and writes status: 'unconfirmed' ONLY
      vi.useFakeTimers();
      const mountNow = new Date('2026-11-25T12:59:59.000Z');
      vi.setSystemTime(mountNow);

      const clientDose: DoseLogDocument = {
        id: doseId,
        patientId: 'patient_ny',
        medicationId: 'med_lisinopril',
        medicationName: 'Lisinopril',
        dosage: '10 mg',
        scheduledDate: '2026-11-25',
        scheduledTime: Timestamp.fromDate(scheduledDate),
        status: 'scheduled',
        snoozeCount: 0,
        snoozedAt: null,
        snoozeUntil: null,
        takenAt: null,
        takenBy: null,
        escalatedAt: null,
        missedAt: null,
        followUpSent: false,
        escalationAlertSent: false,
        createdAt: Timestamp.fromDate(mountNow),
        updatedAt: Timestamp.fromDate(mountNow),
      };
      getDoseLogMock.mockResolvedValue({ ...clientDose, status: 'due', followUpSent: true });

      const { unmount } = renderHook(() => useReminderScheduler([clientDose], 'patient_ny'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30 * 60 * 1000 + 2000);
      });

      const calls = updateDoseLogSpy.mock.calls as unknown as Array<
        [string, Record<string, unknown>]
      >;
      const unconfirmedPatch = calls.find(
        ([id, p]) => id === doseId && p.status === 'unconfirmed'
      )?.[1];
      expect(unconfirmedPatch).toEqual({ status: 'unconfirmed' });
      unmount();
      vi.useRealTimers();

      await adminDb.collection('dose_logs').doc(doseId).update(unconfirmedPatch!);

      // Step 3: Backend dueDosesEscalation detects unconfirmed dose and dispatches caregiver FCM
      const escRes = await serverEsc.processDueDoses(
        adminDb,
        new Date('2026-11-25T13:35:00.000Z'),
        messaging
      );
      expect(escRes.escalatedIds).toEqual([doseId]);
      expect(sentMessages).toHaveLength(1);
      expect(sentMessages[0].tokens).toContain('ny_cg_tok');
      expect(adminDb.inspect('dose_logs', doseId)?.escalationAlertSent).toBe(true);

      // Step 4: Render /ping stays 200 OK and NY midnight cycle (05:00Z on Nov 26) closes dose to missed
      process.env.CRON_SECRET = 'lifecycle_secret';
      const srv = await startTestServer(
        serverIndex.createApp({
          db: adminDb,
          messaging,
          isInitialized: true,
          jobsActive: false,
        })
      );
      activeClose = srv.close;

      const pingRes = await fetch(`${srv.baseUrl}/ping`);
      expect(pingRes.status).toBe(200);

      const nyMidnightCycle = await serverIndex.runMidnightTimezoneCycle(
        adminDb,
        new Date('2026-11-26T05:00:00.000Z')
      );
      expect(nyMidnightCycle.midnightTimezones).toEqual(['America/New_York']);
      expect(nyMidnightCycle.closedCount).toBe(1);
      expect(nyMidnightCycle.createdCount).toBe(1);
      expect(adminDb.inspect('dose_logs', doseId)?.status).toBe('missed');
      expect(adminDb.inspect('dose_logs', doseId)?.missedAt).toBeDefined();
      expect(
        adminDb.inspect('dose_logs', 'patient_ny_med_lisinopril_2026-11-26_0800')
      ).not.toBeNull();
    }
  );

  it.runIf(hasM1Lifecycle)(
    'T4-S09-02: Multi-TZ 0,30 * * * * cron schedule keeps IST and NY patients isolated across midnight boundaries without duplicate escalations',
    async () => {
      const serverIndex = await loadOptionalModule<{
        runMidnightTimezoneCycle: (
          db: unknown,
          now?: Date
        ) => Promise<{ midnightTimezones: string[]; closedCount: number; createdCount: number }>;
      }>('server/src/index.ts');
      const serverEsc = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[] }>;
      }>('server/src/jobs/dueDosesEscalation.ts');

      const adminDb = new MockAdminFirestore();
      const { messaging } = createMockAdminMessaging();

      adminDb.seed('users', 'p_ist', { uid: 'p_ist', timezone: 'Asia/Kolkata', fcmTokens: ['t1'] });
      adminDb.seed('users', 'p_ny', { uid: 'p_ny', timezone: 'America/New_York', fcmTokens: ['t2'] });

      adminDb.seed('medications', 'm_ist', {
        patientId: 'p_ist',
        name: 'Metformin',
        dosage: '500 mg',
        schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
        active: true,
      });
      adminDb.seed('medications', 'm_ny', {
        patientId: 'p_ny',
        name: 'Amlodipine',
        dosage: '5 mg',
        schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
        active: true,
      });

      adminDb.seed('dose_logs', 'ist_nov25', {
        patientId: 'p_ist',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledDate: '2026-11-25',
        scheduledTime: new Date('2026-11-25T02:30:00.000Z'),
        status: 'unconfirmed',
        snoozeCount: 0,
        followUpSent: true,
        escalationAlertSent: true,
      });
      adminDb.seed('dose_logs', 'ny_nov25', {
        patientId: 'p_ny',
        medicationName: 'Amlodipine',
        dosage: '5 mg',
        scheduledDate: '2026-11-25',
        scheduledTime: new Date('2026-11-25T13:00:00.000Z'),
        status: 'due',
        snoozeCount: 0,
        followUpSent: true,
        escalationAlertSent: false,
      });

      // Tick 1: 18:30Z -> Midnight in IST only
      const tick1 = await serverIndex.runMidnightTimezoneCycle(
        adminDb,
        new Date('2026-11-25T18:30:00.000Z')
      );
      expect(tick1.midnightTimezones).toEqual(['Asia/Kolkata']);
      expect(adminDb.inspect('dose_logs', 'ist_nov25')?.status).toBe('missed');
      expect(adminDb.inspect('dose_logs', 'ny_nov25')?.status).toBe('due');

      // Escalation sweep at 19:00Z escalates NY dose only (IST already missed + escalationAlertSent: true)
      const esc = await serverEsc.processDueDoses(
        adminDb,
        new Date('2026-11-25T19:00:00.000Z'),
        messaging
      );
      expect(esc.escalatedIds).toEqual(['ny_nov25']);

      // Tick 2: 05:00Z Nov 26 -> Midnight in NY only
      const tick2 = await serverIndex.runMidnightTimezoneCycle(
        adminDb,
        new Date('2026-11-26T05:00:00.000Z')
      );
      expect(tick2.midnightTimezones).toEqual(['America/New_York']);
      expect(adminDb.inspect('dose_logs', 'ny_nov25')?.status).toBe('missed');
      expect(adminDb.inspect('dose_logs', 'p_ny_m_ny_2026-11-26_0800')).not.toBeNull();
    }
  );
});
