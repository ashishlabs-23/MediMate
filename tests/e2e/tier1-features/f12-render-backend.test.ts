import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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

const hasRenderYaml = hasProjectFile('render.yaml');
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

describe('Tier 1 — F12: Render-Ready Backend Service & Blueprint (R2)', () => {
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
    'T1-F12-01: GET /health returns 200 { status: "ok", uptime, jobsActive } via live HTTP request',
    async () => {
      process.env.CRON_SECRET = 'test_secret_123';
      process.env.ENABLE_INTERNAL_CRON = 'false';

      const indexMod = await loadOptionalModule<{
        createApp?: (deps?: Record<string, unknown>) => ExpressLikeApp;
        app?: ExpressLikeApp;
        default?: ExpressLikeApp;
      }>('server/src/index.ts');

      const app =
        typeof indexMod.createApp === 'function'
          ? indexMod.createApp({ db: null, messaging: null, isInitialized: false, jobsActive: false })
          : indexMod.app ?? indexMod.default;
      expect(app).toBeDefined();

      const srv = await startTestServer(app!);
      activeClose = srv.close;

      const res = await fetch(`${srv.baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; uptime: number; jobsActive: boolean };
      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
      expect(typeof body.jobsActive).toBe('boolean');
    }
  );

  it.runIf(hasServer)(
    'T1-F12-02: POST /api/jobs/generate-daily-logs with valid x-cron-secret creates IST dose logs and returns counts',
    async () => {
      process.env.CRON_SECRET = 'cron_secret_ok';
      const adminDb = new MockAdminFirestore();
      adminDb.seed('medications', 'med_1', {
        patientId: 'patient_ramesh',
        name: 'Metformin',
        dosage: '500 mg',
        instructions: 'Take after breakfast',
        schedule: {
          times: ['08:00'],
          frequency: 'daily',
          startDate: '2026-01-01',
          endDate: null,
        },
        color: '#2563EB',
        shape: 'capsule',
        active: true,
      });

      const jobsMod = await loadOptionalModule<{
        generateForDate: (db: unknown, targetDate: string) => Promise<{ createdCount: number; skippedCount: number }>;
      }>('server/src/jobs/dailyDoseLogs.ts');

      const indexMod = await loadOptionalModule<{
        createApp?: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');

      if (typeof indexMod.createApp === 'function') {
        const app = indexMod.createApp({ db: adminDb, messaging: null, isInitialized: true, jobsActive: false });
        const srv = await startTestServer(app);
        activeClose = srv.close;

        const res = await fetch(`${srv.baseUrl}/api/jobs/generate-daily-logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': 'cron_secret_ok',
          },
          body: JSON.stringify({ targetDate: '2026-11-25' }),
        });
        expect(res.status).toBe(200);
        const json = (await res.json()) as { targetDate: string; createdCount: number; skippedCount: number };
        expect(json.targetDate).toBe('2026-11-25');
        expect(json.createdCount).toBe(1);
        expect(json.skippedCount).toBe(0);
      } else {
        const result = await jobsMod.generateForDate(adminDb, '2026-11-25');
        expect(result).toEqual({ createdCount: 1, skippedCount: 0 });
      }

      const created = adminDb.inspect('dose_logs', 'patient_ramesh_med_1_2026-11-25_0800');
      expect(created).not.toBeNull();
      expect(created?.status).toBe('scheduled');
    }
  );

  it.runIf(hasServer)(
    'T1-F12-03: POST /api/jobs/check-due-doses transitions scheduled -> due, T+15m gentle, and T+30m -> unconfirmed',
    async () => {
      process.env.CRON_SECRET = 'cron_secret_ok';
      const adminDb = new MockAdminFirestore();
      const { messaging } = createMockAdminMessaging();

      adminDb.seed('users', 'patient_ramesh', { uid: 'patient_ramesh', fcmTokens: ['tok_p'] });
      adminDb.seed('users', 'caregiver_priya', { uid: 'caregiver_priya', fcmTokens: ['tok_cg'] });
      adminDb.seed('care_circles', 'patient_ramesh', {
        patientId: 'patient_ramesh',
        caregiverIds: ['caregiver_priya'],
      });

      const baseMs = new Date('2026-11-25T08:00:00.000Z').getTime();
      adminDb.seed('dose_logs', 'dose_due', {
        patientId: 'patient_ramesh',
        medicationName: 'Metformin',
        dosage: '500 mg',
        scheduledTime: new Date(baseMs),
        status: 'scheduled',
        snoozeCount: 0,
        snoozeUntil: null,
        followUpSent: false,
        escalationAlertSent: false,
      });
      adminDb.seed('dose_logs', 'dose_gentle', {
        patientId: 'patient_ramesh',
        medicationName: 'Amlodipine',
        dosage: '5 mg',
        scheduledTime: new Date(baseMs - 15 * 60 * 1000),
        status: 'due',
        snoozeCount: 0,
        snoozeUntil: null,
        followUpSent: false,
        escalationAlertSent: false,
      });
      adminDb.seed('dose_logs', 'dose_escalate', {
        patientId: 'patient_ramesh',
        medicationName: 'Atorvastatin',
        dosage: '20 mg',
        scheduledTime: new Date(baseMs - 30 * 60 * 1000),
        status: 'due',
        snoozeCount: 0,
        snoozeUntil: null,
        followUpSent: true,
        escalationAlertSent: false,
      });

      const escMod = await loadOptionalModule<{
        processDueDoses: (
          db: unknown,
          now: Date,
          messaging?: unknown
        ) => Promise<{
          escalatedIds: string[];
          gentleReminderIds: string[];
          initialReminderIds: string[];
          fcmResults: unknown[];
        }>;
      }>('server/src/jobs/dueDosesEscalation.ts');

      const result = await escMod.processDueDoses(adminDb, new Date(baseMs), messaging);
      expect(result.initialReminderIds).toContain('dose_due');
      expect(result.gentleReminderIds).toContain('dose_gentle');
      expect(result.escalatedIds).toContain('dose_escalate');

      expect(adminDb.inspect('dose_logs', 'dose_due')?.status).toBe('due');
      expect(adminDb.inspect('dose_logs', 'dose_gentle')?.followUpSent).toBe(true);
      expect(adminDb.inspect('dose_logs', 'dose_escalate')?.status).toBe('unconfirmed');
      expect(adminDb.inspect('dose_logs', 'dose_escalate')?.escalationAlertSent).toBe(true);
    }
  );

  it.runIf(hasServer)(
    'T1-F12-04: firebaseAdmin initializes gracefully without credentials (isInitialized: false) without crashing process',
    async () => {
      delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const fbMod = await loadOptionalModule<{
        initializeFirebaseAdmin: () => { db: unknown; messaging: unknown; isInitialized: boolean };
      }>('server/src/firebaseAdmin.ts');

      const result = fbMod.initializeFirebaseAdmin();
      expect(result.isInitialized).toBe(false);
      expect(result.db).toBeNull();
    }
  );

  it.runIf(hasRenderYaml)(
    'T1-F12-05: render.yaml defines medimate-backend service with healthCheckPath /health, env placeholders, and no committed secrets',
    () => {
      const yaml = fs.readFileSync(path.resolve(PROJECT_ROOT, 'render.yaml'), 'utf-8');
      expect(yaml).toMatch(/name:\s*medimate-backend/);
      expect(yaml).toMatch(/runtime:\s*node/);
      expect(yaml).toMatch(/rootDir:\s*server/);
      expect(yaml).toMatch(/healthCheckPath:\s*\/health/);
      expect(yaml).toContain('CRON_SECRET');
      expect(yaml).toContain('FIREBASE_SERVICE_ACCOUNT_JSON');
      expect(yaml).toContain('ENABLE_INTERNAL_CRON');
      expect(yaml).not.toMatch(/PRIVATE KEY-----/);

      const eslintCfg = fs.readFileSync(path.resolve(PROJECT_ROOT, 'eslint.config.js'), 'utf-8');
      expect(eslintCfg).toMatch(/['"]server['"]/);
    }
  );
});
