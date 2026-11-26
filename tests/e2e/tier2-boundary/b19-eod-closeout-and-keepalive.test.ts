import http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MockAdminFirestore,
  createMockAdminMessaging,
} from '@harness/mockAdminFirestore';
import {
  hasProjectFile,
  hasServerRuntimeReady,
  loadOptionalModule,
} from '@harness/reactTestHelper';

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

const hasServerEod =
  hasServerRuntimeReady() &&
  hasProjectFile('server/src/jobs/eodMissedCloseout.ts') &&
  hasProjectFile('server/src/jobs/dueDosesEscalation.ts');
const hasFunctionsEod =
  hasProjectFile('functions/src/closeMissedDoses.ts') &&
  hasProjectFile('functions/src/checkDueDosesAndEscalate.ts');

describe('Tier 2 — B19: EOD Missed Closeout, Bounded Escalation & Keep-Alive Boundaries (R1-BE, R3, R5)', () => {
  const originalEnv = { ...process.env };
  let activeClose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (activeClose) {
      await activeClose();
      activeClose = null;
    }
    process.env = { ...originalEnv };
  });

  it.runIf(hasServerEod)(
    'T2-B19-01: POST /api/jobs/close-missed-doses returns 401 on invalid/missing secret, 503 when uninitialized, and 200 when valid',
    async () => {
      const indexMod = await loadOptionalModule<{
        createApp: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');

      process.env.CRON_SECRET = 'eod_secret_123';

      const uninitSrv = await startTestServer(
        indexMod.createApp({
          db: null,
          messaging: null,
          isInitialized: false,
          jobsActive: false,
        })
      );

      // Missing secret -> 401
      const noSecretRes = await fetch(`${uninitSrv.baseUrl}/api/jobs/close-missed-doses`, {
        method: 'POST',
      });
      expect(noSecretRes.status).toBe(401);

      // Wrong secret -> 401
      const wrongSecretRes = await fetch(`${uninitSrv.baseUrl}/api/jobs/close-missed-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'wrong_secret' },
      });
      expect(wrongSecretRes.status).toBe(401);

      // Valid secret but uninitialized Firestore -> 503
      const res503 = await fetch(`${uninitSrv.baseUrl}/api/jobs/close-missed-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'eod_secret_123' },
      });
      expect(res503.status).toBe(503);
      await uninitSrv.close();

      // Unset CRON_SECRET -> 401 even with empty header
      delete process.env.CRON_SECRET;
      const adminDb = new MockAdminFirestore();
      const initSrv = await startTestServer(
        indexMod.createApp({
          db: adminDb,
          messaging: null,
          isInitialized: true,
          jobsActive: false,
        })
      );
      activeClose = initSrv.close;

      const unsetRes = await fetch(`${initSrv.baseUrl}/api/jobs/close-missed-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': '' },
      });
      expect(unsetRes.status).toBe(401);

      // Valid CRON_SECRET + initialized Firestore -> 200
      process.env.CRON_SECRET = 'eod_secret_123';
      const res200 = await fetch(`${initSrv.baseUrl}/api/jobs/close-missed-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'eod_secret_123' },
      });
      expect(res200.status).toBe(200);
      const body = (await res200.json()) as {
        closedCount: number;
        skippedCount: number;
        missedIds: string[];
      };
      expect(body.closedCount).toBe(0);
      expect(body.missedIds).toEqual([]);
    }
  );

  it.runIf(hasServerEod && hasFunctionsEod)(
    'T2-B19-02: EOD closeout leaves taken, already-missed, and today active doses untouched while closing past-midnight doses',
    async () => {
      const serverEod = await loadOptionalModule<{
        closeMissedDoses: (
          db: unknown,
          now: Date
        ) => Promise<{ closedCount: number; skippedCount: number; missedIds: string[] }>;
      }>('server/src/jobs/eodMissedCloseout.ts');
      const fnEod = await loadOptionalModule<{
        processMissedDoses: (
          db: unknown,
          now: Date
        ) => Promise<{ closedCount: number; skippedCount: number; missedIds: string[] }>;
      }>('functions/src/closeMissedDoses.ts');

      const now = new Date('2026-11-26T00:05:00.000Z'); // UTC today = 2026-11-26

      const seedBoundarySet = (db: MockAdminFirestore) => {
        db.seed('users', 'p_utc', { uid: 'p_utc', timezone: 'UTC' });
        db.seed('dose_logs', 'yesterday_taken', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T08:00:00.000Z'),
          status: 'taken',
          takenAt: new Date('2026-11-25T08:04:00.000Z'),
        });
        db.seed('dose_logs', 'yesterday_already_missed', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T10:00:00.000Z'),
          status: 'missed',
          missedAt: new Date('2026-11-25T23:59:00.000Z'),
        });
        db.seed('dose_logs', 'today_scheduled', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-26',
          scheduledTime: new Date('2026-11-26T08:00:00.000Z'),
          status: 'scheduled',
        });
        db.seed('dose_logs', 'today_due_just_now', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-26',
          scheduledTime: new Date('2026-11-26T00:01:00.000Z'),
          status: 'due',
        });
        db.seed('dose_logs', 'yesterday_due_unresolved', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T22:00:00.000Z'),
          status: 'due',
        });
      };

      const srvDb = new MockAdminFirestore();
      const fnDb = new MockAdminFirestore();
      seedBoundarySet(srvDb);
      seedBoundarySet(fnDb);

      const srvRes = await serverEod.closeMissedDoses(srvDb, now);
      const fnRes = await fnEod.processMissedDoses(fnDb, now);

      for (const [res, db] of [
        [srvRes, srvDb],
        [fnRes, fnDb],
      ] as const) {
        expect(res.closedCount).toBe(1);
        expect(res.missedIds).toEqual(['yesterday_due_unresolved']);
        expect(db.inspect('dose_logs', 'yesterday_taken')?.status).toBe('taken');
        expect(db.inspect('dose_logs', 'yesterday_already_missed')?.status).toBe('missed');
        expect(db.inspect('dose_logs', 'today_scheduled')?.status).toBe('scheduled');
        expect(db.inspect('dose_logs', 'today_due_just_now')?.status).toBe('due');
        expect(db.inspect('dose_logs', 'yesterday_due_unresolved')?.status).toBe('missed');
      }
    }
  );

  it.runIf(hasServerEod)(
    'T2-B19-03: EOD closeout chunks >500 unresolved doses (520) across multiple Firestore batches cleanly',
    async () => {
      const serverEod = await loadOptionalModule<{
        closeMissedDoses: (
          db: unknown,
          now: Date
        ) => Promise<{ closedCount: number; skippedCount: number; missedIds: string[] }>;
      }>('server/src/jobs/eodMissedCloseout.ts');

      const adminDb = new MockAdminFirestore();
      adminDb.seed('users', 'p_bulk', { uid: 'p_bulk', timezone: 'UTC' });

      for (let i = 1; i <= 520; i++) {
        adminDb.seed('dose_logs', `stale_${i}`, {
          patientId: 'p_bulk',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T09:00:00.000Z'),
          status: i % 2 === 0 ? 'unconfirmed' : 'due',
        });
      }

      const now = new Date('2026-11-26T00:10:00.000Z');
      const res = await serverEod.closeMissedDoses(adminDb, now);

      expect(res.closedCount).toBe(520);
      expect(res.missedIds).toHaveLength(520);
      expect(adminDb.batchCommits).toBeGreaterThanOrEqual(2);
      expect(adminDb.inspect('dose_logs', 'stale_1')?.status).toBe('missed');
      expect(adminDb.inspect('dose_logs', 'stale_520')?.status).toBe('missed');
    }
  );

  it.runIf(hasServerEod && hasFunctionsEod)(
    'T2-B19-04: Bounded 48h escalation query skips >48h stale doses while escalating <48h doses even when scheduledDate is omitted',
    async () => {
      const serverEsc = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[] }>;
      }>('server/src/jobs/dueDosesEscalation.ts');
      const fnEsc = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[] }>;
      }>('functions/src/checkDueDosesAndEscalate.ts');

      const now = new Date('2026-11-26T12:00:00.000Z');

      const runWith = async (
        runner: (db: unknown, now: Date, msg: unknown) => Promise<{ escalatedIds: string[] }>
      ) => {
        const db = new MockAdminFirestore();
        const { messaging } = createMockAdminMessaging();
        db.seed('users', 'p1', { uid: 'p1', fcmTokens: ['tok_1'] });

        // 48h + 1ms ago -> outside bounded lookback
        db.seed('dose_logs', 'outside_48h', {
          patientId: 'p1',
          medicationName: 'OldMed',
          dosage: '10 mg',
          scheduledTime: new Date(now.getTime() - 48 * 60 * 60 * 1000 - 1000),
          status: 'due',
          snoozeCount: 0,
          followUpSent: true,
          escalationAlertSent: false,
        });

        // 47h ago without scheduledDate field -> inside bounded lookback
        db.seed('dose_logs', 'inside_47h_no_date', {
          patientId: 'p1',
          medicationName: 'RecentMed',
          dosage: '20 mg',
          scheduledTime: new Date(now.getTime() - 47 * 60 * 60 * 1000),
          status: 'due',
          snoozeCount: 0,
          followUpSent: true,
          escalationAlertSent: false,
        });

        const res = await runner(db, now, messaging);
        return { db, res };
      };

      const srv = await runWith(serverEsc.processDueDoses);
      const fn = await runWith(fnEsc.processDueDoses);

      for (const out of [srv, fn]) {
        expect(out.res.escalatedIds).toEqual(['inside_47h_no_date']);
        expect(out.db.inspect('dose_logs', 'outside_48h')?.status).toBe('due');
        expect(out.db.inspect('dose_logs', 'inside_47h_no_date')?.status).toBe('unconfirmed');
      }
    }
  );

  it.runIf(hasServerEod && hasFunctionsEod)(
    'T2-B19-05: Idempotent re-run on { status: "unconfirmed", escalationAlertSent: true } emits 0 FCM sends and 0 duplicate escalations',
    async () => {
      const serverEsc = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[]; fcmResults: unknown[] }>;
      }>('server/src/jobs/dueDosesEscalation.ts');
      const fnEsc = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[]; fcmResults: unknown[] }>;
      }>('functions/src/checkDueDosesAndEscalate.ts');

      const now = new Date('2026-11-26T09:00:00.000Z');

      for (const runner of [serverEsc.processDueDoses, fnEsc.processDueDoses]) {
        const db = new MockAdminFirestore();
        const { messaging, sendEachForMulticast } = createMockAdminMessaging();
        db.seed('users', 'p1', { uid: 'p1', fcmTokens: ['pat_tok'] });
        db.seed('users', 'cg1', { uid: 'cg1', fcmTokens: ['cg_tok'] });
        db.seed('care_circles', 'p1', { patientId: 'p1', caregiverIds: ['cg1'] });
        db.seed('dose_logs', 'already_escalated', {
          patientId: 'p1',
          medicationName: 'Metformin',
          dosage: '500 mg',
          scheduledTime: new Date('2026-11-26T08:00:00.000Z'),
          status: 'unconfirmed',
          snoozeCount: 0,
          snoozeUntil: null,
          followUpSent: true,
          escalationAlertSent: true,
        });

        const res = await runner(db, now, messaging);
        expect(res.escalatedIds).toEqual([]);
        expect(res.fcmResults).toEqual([]);
        expect(sendEachForMulticast).not.toHaveBeenCalled();
      }
    }
  );

  it.runIf(hasServerEod)(
    'T2-B19-06: Escalation with >500 due doses and caregiver FCM fallback when patient has no tokens chunks batches and notifies caregivers',
    async () => {
      const serverEsc = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[] }>;
      }>('server/src/jobs/dueDosesEscalation.ts');

      const db = new MockAdminFirestore();
      const { messaging, sentMessages } = createMockAdminMessaging();
      const now = new Date('2026-11-26T09:00:00.000Z');
      const scheduled = new Date('2026-11-26T08:00:00.000Z');

      // Patient has zero FCM tokens, caregiver has token
      db.seed('users', 'p_no_tok', { uid: 'p_no_tok', fcmTokens: [] });
      db.seed('users', 'cg_fallback', { uid: 'cg_fallback', fcmTokens: ['cg_fallback_tok'] });
      db.seed('care_circles', 'p_no_tok', {
        patientId: 'p_no_tok',
        caregiverIds: ['cg_fallback'],
      });

      for (let i = 1; i <= 505; i++) {
        db.seed('dose_logs', `bulk_esc_${i}`, {
          patientId: 'p_no_tok',
          medicationName: `Med ${i}`,
          dosage: '10 mg',
          scheduledTime: scheduled,
          status: 'due',
          snoozeCount: 0,
          followUpSent: true,
          escalationAlertSent: false,
        });
      }

      const res = await serverEsc.processDueDoses(db, now, messaging);
      expect(res.escalatedIds).toHaveLength(505);
      expect(db.batchCommits).toBeGreaterThanOrEqual(2);
      expect(sentMessages.length).toBe(505);
      expect(sentMessages[0].tokens).toEqual(['cg_fallback_tok']);
    }
  );
});
