import http from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MockAdminFirestore,
  createMockAdminMessaging,
} from '@harness/mockAdminFirestore';
import {
  hasProjectFile,
  hasServerRuntimeReady,
  loadOptionalModule,
} from '@harness/reactTestHelper';

const hasServer =
  hasServerRuntimeReady() &&
  hasProjectFile('server/src/firebaseAdmin.ts') &&
  hasProjectFile('server/src/jobs/dailyDoseLogs.ts') &&
  hasProjectFile('server/src/jobs/dueDosesEscalation.ts');

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
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

describe('Tier 2 — B12: Render Backend Boundaries & Error Handling (R2)', () => {
  const originalEnv = { ...process.env };
  let activeClose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (activeClose) {
      await activeClose();
      activeClose = null;
    }
    process.env = { ...originalEnv };
  });

  it.runIf(hasServer)(
    'T2-F12-01: Missing, wrong, or unconfigured CRON_SECRET rejects both cron endpoints with 401',
    async () => {
      const indexMod = await loadOptionalModule<{
        createApp?: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');
      if (typeof indexMod.createApp !== 'function') return;

      process.env.CRON_SECRET = 'expected_secret';
      const srv = await startTestServer(
        indexMod.createApp({ db: new MockAdminFirestore(), messaging: null, isInitialized: true, jobsActive: false })
      );
      activeClose = srv.close;

      for (const endpoint of ['/api/jobs/generate-daily-logs', '/api/jobs/check-due-doses']) {
        const missingRes = await fetch(`${srv.baseUrl}${endpoint}`, { method: 'POST' });
        expect(missingRes.status).toBe(401);

        const wrongRes = await fetch(`${srv.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: { 'x-cron-secret': 'wrong_secret' },
        });
        expect(wrongRes.status).toBe(401);
      }

      delete process.env.CRON_SECRET;
      const unsetRes = await fetch(`${srv.baseUrl}/api/jobs/generate-daily-logs`, {
        method: 'POST',
        headers: { 'x-cron-secret': '' },
      });
      expect(unsetRes.status).toBe(401);
    }
  );

  it.runIf(hasServer)(
    'T2-F12-02: Job endpoints return 503 when Firestore is uninitialized and 400 on invalid targetDate (e.g. 2026-02-30)',
    async () => {
      const indexMod = await loadOptionalModule<{
        createApp?: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');
      const jobsMod = await loadOptionalModule<{
        generateForDate: (db: unknown, targetDate: string) => Promise<unknown>;
      }>('server/src/jobs/dailyDoseLogs.ts');

      const adminDb = new MockAdminFirestore();
      await expect(jobsMod.generateForDate(adminDb, '2026-02-30')).rejects.toThrow();

      if (typeof indexMod.createApp === 'function') {
        process.env.CRON_SECRET = 'sec';
        const uninitSrv = await startTestServer(
          indexMod.createApp({ db: null, messaging: null, isInitialized: false, jobsActive: false })
        );
        const res503 = await fetch(`${uninitSrv.baseUrl}/api/jobs/generate-daily-logs`, {
          method: 'POST',
          headers: { 'x-cron-secret': 'sec' },
        });
        expect(res503.status).toBe(503);
        await uninitSrv.close();

        const initSrv = await startTestServer(
          indexMod.createApp({ db: adminDb, messaging: null, isInitialized: true, jobsActive: false })
        );
        activeClose = initSrv.close;
        const res400 = await fetch(`${initSrv.baseUrl}/api/jobs/generate-daily-logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': 'sec' },
          body: JSON.stringify({ targetDate: '2026-02-30' }),
        });
        expect(res400.status).toBe(400);
      }
    }
  );

  it.runIf(hasServer)(
    'T2-F12-03: Idempotent re-run skips existing logs, IST 18:30 UTC rolls over to next IST day, and >500 ops chunk into multiple batches',
    async () => {
      const jobsMod = await loadOptionalModule<{
        computeISTDateString: (now?: Date) => string;
        computeISTScheduledTimestamp: (dateStr: string, hhmm: string) => Date;
        generateForDate: (db: unknown, targetDate: string) => Promise<{ createdCount: number; skippedCount: number }>;
      }>('server/src/jobs/dailyDoseLogs.ts');

      // 18:30 UTC on 2026-11-25 === 00:00 IST on 2026-11-26
      const istMidnight = new Date('2026-11-25T18:30:00.000Z');
      expect(jobsMod.computeISTDateString(istMidnight)).toBe('2026-11-26');

      // 08:00 IST on 2026-11-26 === 02:30 UTC on 2026-11-26
      const scheduledUtc = jobsMod.computeISTScheduledTimestamp('2026-11-26', '08:00');
      expect(scheduledUtc.toISOString()).toBe('2026-11-26T02:30:00.000Z');

      const adminDb = new MockAdminFirestore();
      // Seed 505 medications to force > 500 write batch chunking
      for (let i = 1; i <= 505; i++) {
        adminDb.seed('medications', `med_${i}`, {
          patientId: `patient_${i}`,
          name: `Med ${i}`,
          dosage: '10 mg',
          instructions: '',
          schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
          color: '#0D9488',
          shape: 'round',
          active: true,
        });
      }

      const firstRun = await jobsMod.generateForDate(adminDb, '2026-11-26');
      expect(firstRun.createdCount).toBe(505);
      expect(firstRun.skippedCount).toBe(0);
      expect(adminDb.batchCommits).toBeGreaterThanOrEqual(2);

      const secondRun = await jobsMod.generateForDate(adminDb, '2026-11-26');
      expect(secondRun.createdCount).toBe(0);
      expect(secondRun.skippedCount).toBe(505);
    }
  );

  it.runIf(hasServer)(
    'T2-F12-04: T+15m gentle reminder is suppressed while actively snoozed, while T+30m escalation overrides active snooze',
    async () => {
      const escMod = await loadOptionalModule<{
        processDueDoses: (db: unknown, now: Date, messaging?: unknown) => Promise<{
          escalatedIds: string[];
          gentleReminderIds: string[];
        }>;
      }>('server/src/jobs/dueDosesEscalation.ts');

      const adminDb = new MockAdminFirestore();
      const { messaging } = createMockAdminMessaging();
      const baseMs = new Date('2026-11-25T08:00:00.000Z').getTime();

      adminDb.seed('dose_logs', 'dose_active_snooze_15m', {
        patientId: 'p1',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledTime: new Date(baseMs),
        status: 'snoozed',
        snoozeCount: 1,
        snoozeUntil: new Date(baseMs + 20 * 60 * 1000),
        followUpSent: false,
        escalationAlertSent: false,
      });

      const at15 = await escMod.processDueDoses(adminDb, new Date(baseMs + 15 * 60 * 1000), messaging);
      expect(at15.gentleReminderIds).not.toContain('dose_active_snooze_15m');

      adminDb.seed('dose_logs', 'dose_late_snooze_30m', {
        patientId: 'p1',
        medicationName: 'Warfarin',
        dosage: '5 mg',
        scheduledTime: new Date(baseMs),
        status: 'snoozed',
        snoozeCount: 1,
        snoozeUntil: new Date(baseMs + 35 * 60 * 1000),
        followUpSent: true,
        escalationAlertSent: false,
      });

      const at30 = await escMod.processDueDoses(adminDb, new Date(baseMs + 30 * 60 * 1000), messaging);
      expect(at30.escalatedIds).toContain('dose_late_snooze_30m');
      expect(adminDb.inspect('dose_logs', 'dose_late_snooze_30m')?.status).toBe('unconfirmed');
    }
  );

  it.runIf(hasServer)(
    'T2-F12-05: Re-running check-due-doses at T+35m does not duplicate escalation alerts when escalationAlertSent is true',
    async () => {
      const escMod = await loadOptionalModule<{
        processDueDoses: (db: unknown, now: Date, messaging?: unknown) => Promise<{
          escalatedIds: string[];
        }>;
      }>('server/src/jobs/dueDosesEscalation.ts');

      const adminDb = new MockAdminFirestore();
      const { messaging, sendEachForMulticast } = createMockAdminMessaging();
      const baseMs = new Date('2026-11-25T08:00:00.000Z').getTime();

      adminDb.seed('users', 'p1', { uid: 'p1', fcmTokens: ['t1'] });
      adminDb.seed('dose_logs', 'dose_already_escalated', {
        patientId: 'p1',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledTime: new Date(baseMs),
        status: 'unconfirmed',
        snoozeCount: 0,
        snoozeUntil: null,
        followUpSent: true,
        escalationAlertSent: true,
      });

      const res = await escMod.processDueDoses(adminDb, new Date(baseMs + 35 * 60 * 1000), messaging);
      expect(res.escalatedIds).toEqual([]);
      expect(sendEachForMulticast).not.toHaveBeenCalled();
    }
  );

  it.runIf(hasServer)(
    'T2-F12-06: Missing FCM tokens fail gracefully without fabricating success; unregistered FCM tokens trigger token cleanup',
    async () => {
      const escMod = await loadOptionalModule<{
        processDueDoses: (db: unknown, now: Date, messaging?: unknown) => Promise<{
          fcmResults: Array<{ doseId: string; success: boolean }>;
        }>;
      }>('server/src/jobs/dueDosesEscalation.ts');

      const adminDb = new MockAdminFirestore();
      const { messaging } = createMockAdminMessaging({
        stale_tok: { success: false, errorCode: 'messaging/registration-token-not-registered' },
        valid_tok: { success: true },
      });
      const baseMs = new Date('2026-11-25T08:00:00.000Z').getTime();

      adminDb.seed('users', 'p_notok', { uid: 'p_notok', fcmTokens: [] });
      adminDb.seed('dose_logs', 'dose_notok', {
        patientId: 'p_notok',
        medicationName: 'Aspirin',
        dosage: '75 mg',
        scheduledTime: new Date(baseMs),
        status: 'scheduled',
        snoozeCount: 0,
        followUpSent: false,
        escalationAlertSent: false,
      });

      adminDb.seed('users', 'p_stale', { uid: 'p_stale', fcmTokens: ['stale_tok', 'valid_tok'] });
      adminDb.seed('dose_logs', 'dose_stale', {
        patientId: 'p_stale',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledTime: new Date(baseMs),
        status: 'scheduled',
        snoozeCount: 0,
        followUpSent: false,
        escalationAlertSent: false,
      });

      const res = await escMod.processDueDoses(adminDb, new Date(baseMs), messaging);
      const noTokResult = res.fcmResults.find((r) => r.doseId === 'dose_notok');
      expect(noTokResult?.success).toBe(false);

      const cleanedTokens = adminDb.inspect('users', 'p_stale')?.fcmTokens as string[];
      expect(cleanedTokens).not.toContain('stale_tok');
      expect(cleanedTokens).toContain('valid_tok');
    }
  );
});
