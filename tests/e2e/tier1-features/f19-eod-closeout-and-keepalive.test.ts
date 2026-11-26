import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

const serverIndexSrc = hasProjectFile('server/src/index.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/index.ts'), 'utf-8')
  : '';
const serverEscSrc = hasProjectFile('server/src/jobs/dueDosesEscalation.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/jobs/dueDosesEscalation.ts'), 'utf-8')
  : '';
const fnEscSrc = hasProjectFile('functions/src/checkDueDosesAndEscalate.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'functions/src/checkDueDosesAndEscalate.ts'), 'utf-8')
  : '';

const hasServerPing = hasServerRuntimeReady() && serverIndexSrc.includes('/ping');
const hasServerEod =
  hasServerRuntimeReady() &&
  hasProjectFile('server/src/jobs/eodMissedCloseout.ts') &&
  serverIndexSrc.includes('/api/jobs/close-missed-doses');
const hasFunctionsEod =
  hasProjectFile('functions/src/closeMissedDoses.ts') &&
  hasProjectFile('functions/src/generateDailyDoseLogs.ts');
const hasR1BackendEscalation =
  hasServerRuntimeReady() &&
  serverEscSrc.includes("!data.escalationAlertSent") &&
  fnEscSrc.includes("!data.escalationAlertSent");
const hasBoundedEscalation =
  hasServerRuntimeReady() &&
  serverEscSrc.includes('ESCALATION_LOOKBACK_MS') &&
  hasProjectFile('firestore.indexes.json');
const hasKeepAliveDocs =
  hasProjectFile('docs/DEPLOYMENT.md') &&
  hasProjectFile('README.md') &&
  fs.readFileSync(path.resolve(PROJECT_ROOT, 'docs/DEPLOYMENT.md'), 'utf-8').includes('/ping');

describe('Tier 1 — F19: EOD Missed Closeout, Bounded Escalation & Render Keep-Alive (R1-BE, R3, R5)', () => {
  const originalEnv = { ...process.env };
  let activeClose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (activeClose) {
      await activeClose();
      activeClose = null;
    }
    process.env = { ...originalEnv };
  });

  it.runIf(hasServerPing)(
    'T1-F19-01: GET /ping returns HTTP 200 JSON { ok: true, timestamp } without requiring x-cron-secret',
    async () => {
      process.env.CRON_SECRET = 'secret_ping_test';
      const indexMod = await loadOptionalModule<{
        createApp: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');

      const app = indexMod.createApp({
        db: null,
        messaging: null,
        isInitialized: false,
        jobsActive: false,
      });
      const srv = await startTestServer(app);
      activeClose = srv.close;

      const res = await fetch(`${srv.baseUrl}/ping`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; timestamp: string };
      expect(body.ok).toBe(true);
      expect(typeof body.timestamp).toBe('string');
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    }
  );

  it.runIf(hasServerEod)(
    'T1-F19-02: POST /api/jobs/close-missed-doses closes past-midnight scheduled, due, snoozed, and unconfirmed doses to missed with missedAt',
    async () => {
      process.env.CRON_SECRET = 'cron_secret_eod';
      const adminDb = new MockAdminFirestore();
      adminDb.seed('users', 'patient_ist', {
        uid: 'patient_ist',
        timezone: 'Asia/Kolkata',
      });

      const yesterdayUtc = new Date(Date.now() - 36 * 60 * 60 * 1000);
      const y = yesterdayUtc.getUTCFullYear();
      const m = String(yesterdayUtc.getUTCMonth() + 1).padStart(2, '0');
      const d = String(yesterdayUtc.getUTCDate()).padStart(2, '0');
      const pastDate = `${y}-${m}-${d}`;

      for (const status of ['scheduled', 'due', 'snoozed', 'unconfirmed'] as const) {
        adminDb.seed('dose_logs', `dose_${status}`, {
          patientId: 'patient_ist',
          medicationName: 'Metformin',
          dosage: '500 mg',
          scheduledDate: pastDate,
          scheduledTime: yesterdayUtc,
          status,
          snoozeUntil: status === 'snoozed' ? new Date(yesterdayUtc.getTime() + 600_000) : null,
          followUpSent: false,
          escalationAlertSent: status === 'unconfirmed',
        });
      }

      const indexMod = await loadOptionalModule<{
        createApp: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');

      const app = indexMod.createApp({
        db: adminDb,
        messaging: null,
        isInitialized: true,
        jobsActive: false,
      });
      const srv = await startTestServer(app);
      activeClose = srv.close;

      const res = await fetch(`${srv.baseUrl}/api/jobs/close-missed-doses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-cron-secret': 'cron_secret_eod',
        },
      });
      expect(res.status).toBe(200);
      const json = (await res.json()) as {
        closedCount: number;
        skippedCount: number;
        missedIds: string[];
      };

      expect(json.closedCount).toBe(4);
      expect(json.missedIds).toHaveLength(4);

      for (const status of ['scheduled', 'due', 'snoozed', 'unconfirmed'] as const) {
        const updated = adminDb.inspect('dose_logs', `dose_${status}`);
        expect(updated?.status).toBe('missed');
        expect(updated?.missedAt).toBeDefined();
        expect(updated?.snoozeUntil).toBeNull();
        expect(updated?.updatedAt).toBeDefined();
      }
    }
  );

  it.runIf(hasServerEod && hasFunctionsEod)(
    'T1-F19-03: functions/src/closeMissedDoses.ts matches server/src/jobs/eodMissedCloseout.ts on identical MockAdminFirestore dataset',
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

      const now = new Date('2026-11-26T00:15:00.000Z');
      const seedDataset = (db: MockAdminFirestore) => {
        db.seed('users', 'p_utc', { uid: 'p_utc', timezone: 'UTC' });
        db.seed('dose_logs', 'past_due', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T20:00:00.000Z'),
          status: 'unconfirmed',
        });
        db.seed('dose_logs', 'today_active', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-26',
          scheduledTime: new Date('2026-11-26T08:00:00.000Z'),
          status: 'scheduled',
        });
        db.seed('dose_logs', 'past_taken', {
          patientId: 'p_utc',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T08:00:00.000Z'),
          status: 'taken',
        });
      };

      const serverDb = new MockAdminFirestore();
      const fnDb = new MockAdminFirestore();
      seedDataset(serverDb);
      seedDataset(fnDb);

      const serverResult = await serverEod.closeMissedDoses(serverDb, now);
      const fnResult = await fnEod.processMissedDoses(fnDb, now);

      expect(serverResult.closedCount).toBe(1);
      expect(fnResult.closedCount).toBe(serverResult.closedCount);
      expect(fnResult.missedIds).toEqual(serverResult.missedIds);
      expect(fnDb.inspect('dose_logs', 'past_due')?.status).toBe('missed');
      expect(fnDb.inspect('dose_logs', 'today_active')?.status).toBe('scheduled');
      expect(fnDb.inspect('dose_logs', 'past_taken')?.status).toBe('taken');
    }
  );

  it.runIf(hasR1BackendEscalation)(
    'T1-F19-04: R1 handoff parity — server & functions escalate client-marked unconfirmed dose (escalationAlertSent: false) and dispatch caregiver FCM',
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

      const scheduledAt = new Date('2026-11-25T08:00:00.000Z');
      const runAt = new Date('2026-11-25T08:32:00.000Z');

      const runWith = async (
        runner: (db: unknown, now: Date, msg: unknown) => Promise<{ escalatedIds: string[] }>
      ) => {
        const db = new MockAdminFirestore();
        const { messaging, sentMessages } = createMockAdminMessaging();
        db.seed('users', 'patient_a', { uid: 'patient_a', fcmTokens: ['pat_tok'] });
        db.seed('users', 'cg_a', { uid: 'cg_a', fcmTokens: ['cg_tok_1'] });
        db.seed('care_circles', 'patient_a', {
          patientId: 'patient_a',
          caregiverIds: ['cg_a'],
        });
        db.seed('dose_logs', 'dose_client_unconfirmed', {
          patientId: 'patient_a',
          medicationName: 'Metformin',
          dosage: '500 mg',
          scheduledTime: scheduledAt,
          status: 'unconfirmed',
          snoozeCount: 0,
          snoozeUntil: null,
          followUpSent: true,
          escalationAlertSent: false,
        });

        const res = await runner(db, runAt, messaging);
        return { db, sentMessages, res };
      };

      const srvOut = await runWith(serverEsc.processDueDoses);
      const fnOut = await runWith(fnEsc.processDueDoses);

      for (const out of [srvOut, fnOut]) {
        expect(out.res.escalatedIds).toEqual(['dose_client_unconfirmed']);
        expect(out.sentMessages).toHaveLength(1);
        expect(out.sentMessages[0].tokens).toContain('cg_tok_1');
        expect(out.sentMessages[0].tokens).toContain('pat_tok');
        const updated = out.db.inspect('dose_logs', 'dose_client_unconfirmed');
        expect(updated?.status).toBe('unconfirmed');
        expect(updated?.escalationAlertSent).toBe(true);
        expect(updated?.escalatedAt).toBeDefined();
      }
    }
  );

  it.runIf(hasBoundedEscalation)(
    'T1-F19-05: firestore.indexes.json defines dose_logs (status ASC, scheduledTime ASC) composite index and dueDosesEscalation uses bounded 48h query',
    async () => {
      const indexJson = JSON.parse(
        fs.readFileSync(path.resolve(PROJECT_ROOT, 'firestore.indexes.json'), 'utf-8')
      ) as {
        indexes: Array<{
          collectionGroup: string;
          fields: Array<{ fieldPath: string; order: string }>;
        }>;
      };

      const doseLogIndex = indexJson.indexes.find((idx) => idx.collectionGroup === 'dose_logs');
      expect(doseLogIndex).toBeDefined();
      expect(doseLogIndex!.fields).toEqual([
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'scheduledTime', order: 'ASCENDING' },
      ]);

      const escMod = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{ escalatedIds: string[] }>;
      }>('server/src/jobs/dueDosesEscalation.ts');

      const adminDb = new MockAdminFirestore();
      const { messaging } = createMockAdminMessaging();
      const now = new Date('2026-11-26T10:00:00.000Z');

      adminDb.seed('users', 'p1', { uid: 'p1', fcmTokens: ['t1'] });
      adminDb.seed('dose_logs', 'stale_50h', {
        patientId: 'p1',
        medicationName: 'OldMed',
        dosage: '10 mg',
        scheduledTime: new Date(now.getTime() - 50 * 60 * 60 * 1000),
        status: 'due',
        snoozeCount: 0,
        followUpSent: true,
        escalationAlertSent: false,
      });
      adminDb.seed('dose_logs', 'recent_2h', {
        patientId: 'p1',
        medicationName: 'RecentMed',
        dosage: '20 mg',
        scheduledTime: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        status: 'due',
        snoozeCount: 0,
        followUpSent: true,
        escalationAlertSent: false,
      });

      const res = await escMod.processDueDoses(adminDb, now, messaging);
      expect(res.escalatedIds).toEqual(['recent_2h']);
      expect(adminDb.inspect('dose_logs', 'stale_50h')?.status).toBe('due');
      expect(adminDb.inspect('dose_logs', 'recent_2h')?.status).toBe('unconfirmed');
    }
  );

  it.runIf(hasKeepAliveDocs)(
    'T1-F19-06: README.md and docs/DEPLOYMENT.md document Render /ping keep-alive and /api/jobs/close-missed-doses Cloud Scheduler setup',
    () => {
      const deploymentMd = fs.readFileSync(
        path.resolve(PROJECT_ROOT, 'docs/DEPLOYMENT.md'),
        'utf-8'
      );
      const readmeMd = fs.readFileSync(path.resolve(PROJECT_ROOT, 'README.md'), 'utf-8');

      expect(deploymentMd).toContain('/ping');
      expect(deploymentMd).toContain('/api/jobs/close-missed-doses');
      expect(deploymentMd).toMatch(/gcloud scheduler|UptimeRobot|keep-alive/i);
      expect(readmeMd).toContain('docs/DEPLOYMENT.md');
      expect(readmeMd).toContain('closeMissedDoses');
    }
  );
});
