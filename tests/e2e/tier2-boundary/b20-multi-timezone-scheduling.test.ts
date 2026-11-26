import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockAdminFirestore } from '@harness/mockAdminFirestore';
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

interface DailyJobsContract {
  resolveValidTimezone: (tz?: unknown, fallback?: string) => string;
  computeDateStringInTimezone: (now?: Date, tz?: string) => string;
  computeScheduledTimestampInTimezone: (dateStr: string, hhmm: string, tz?: string) => Date;
  generateForDate: (
    db: unknown,
    targetDate: string,
    options?: { targetTimezones?: Set<string> }
  ) => Promise<{ createdCount: number; skippedCount: number }>;
  runMidnightTimezoneCycle?: (
    db: unknown,
    now?: Date
  ) => Promise<{
    midnightTimezones: string[];
    closedCount?: number;
    createdCount: number;
  }>;
}

const serverDailySrc = hasProjectFile('server/src/jobs/dailyDoseLogs.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/jobs/dailyDoseLogs.ts'), 'utf-8')
  : '';
const fnDailySrc = hasProjectFile('functions/src/generateDailyDoseLogs.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'functions/src/generateDailyDoseLogs.ts'), 'utf-8')
  : '';

const hasMultiTzServer =
  hasServerRuntimeReady() &&
  serverDailySrc.includes('computeScheduledTimestampInTimezone') &&
  hasProjectFile('server/src/jobs/eodMissedCloseout.ts');
const hasMultiTzFunctions =
  hasProjectFile('functions/src/generateDailyDoseLogs.ts') &&
  fnDailySrc.includes('computeScheduledTimestampInTimezone') &&
  hasProjectFile('functions/src/closeMissedDoses.ts');

describe('Tier 2 — B20: Multi-Timezone IANA Scheduling & DST Boundaries (R4)', () => {
  const originalEnv = { ...process.env };
  let activeClose: (() => Promise<void>) | null = null;

  afterEach(async () => {
    if (activeClose) {
      await activeClose();
      activeClose = null;
    }
    process.env = { ...originalEnv };
  });

  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T2-B20-01: Invalid, empty, or missing user timezone falls back safely to Asia/Kolkata without throwing RangeError',
    async () => {
      const serverJobs = await loadOptionalModule<DailyJobsContract>(
        'server/src/jobs/dailyDoseLogs.ts'
      );
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      for (const mod of [serverJobs, fnJobs]) {
        expect(mod.resolveValidTimezone('Mars/Olympus')).toBe('Asia/Kolkata');
        expect(mod.resolveValidTimezone('')).toBe('Asia/Kolkata');
        expect(mod.resolveValidTimezone('   ')).toBe('Asia/Kolkata');
        expect(mod.resolveValidTimezone(undefined)).toBe('Asia/Kolkata');
        expect(mod.resolveValidTimezone(null)).toBe('Asia/Kolkata');
        expect(mod.resolveValidTimezone(12345)).toBe('Asia/Kolkata');

        const db = new MockAdminFirestore();
        db.seed('users', 'p_bad_tz', { uid: 'p_bad_tz', timezone: 'Mars/Olympus' });
        db.seed('users', 'p_missing_tz', { uid: 'p_missing_tz' });
        db.seed('medications', 'med_bad', {
          patientId: 'p_bad_tz',
          name: 'Metformin',
          dosage: '500 mg',
          schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
          active: true,
        });
        db.seed('medications', 'med_missing', {
          patientId: 'p_missing_tz',
          name: 'Aspirin',
          dosage: '75 mg',
          schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
          active: true,
        });

        const res = await mod.generateForDate(db, '2026-11-25');
        expect(res.createdCount).toBe(2);

        const badTime = (
          db.inspect('dose_logs', 'p_bad_tz_med_bad_2026-11-25_0800')?.scheduledTime as {
            toDate: () => Date;
          }
        ).toDate();
        // Fallback Asia/Kolkata (UTC+05:30): 08:00 IST == 02:30Z
        expect(badTime.toISOString()).toBe('2026-11-25T02:30:00.000Z');
      }
    }
  );

  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T2-B20-02: Midnight boundary 23:59:59 vs 00:00:00 in America/Los_Angeles resolves local calendar date across UTC date change',
    async () => {
      const serverJobs = await loadOptionalModule<DailyJobsContract>(
        'server/src/jobs/dailyDoseLogs.ts'
      );
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      // In America/Los_Angeles (PST = UTC-8 on Nov 25):
      // 2026-11-26T07:59:59Z === 2026-11-25 23:59:59 PST
      // 2026-11-26T08:00:00Z === 2026-11-26 00:00:00 PST
      const justBeforeMidnightLA = new Date('2026-11-26T07:59:59.000Z');
      const exactMidnightLA = new Date('2026-11-26T08:00:00.000Z');

      for (const mod of [serverJobs, fnJobs]) {
        expect(mod.computeDateStringInTimezone(justBeforeMidnightLA, 'America/Los_Angeles')).toBe(
          '2026-11-25'
        );
        expect(mod.computeDateStringInTimezone(exactMidnightLA, 'America/Los_Angeles')).toBe(
          '2026-11-26'
        );
      }
    }
  );

  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T2-B20-03: DST spring-forward (2026-03-08 02:00) and fall-back (2026-11-01) in America/New_York resolve deterministically without NaN',
    async () => {
      const serverJobs = await loadOptionalModule<DailyJobsContract>(
        'server/src/jobs/dailyDoseLogs.ts'
      );
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      for (const mod of [serverJobs, fnJobs]) {
        const springForwardGap = mod.computeScheduledTimestampInTimezone(
          '2026-03-08',
          '02:00',
          'America/New_York'
        );
        const springMorning = mod.computeScheduledTimestampInTimezone(
          '2026-03-08',
          '08:00',
          'America/New_York'
        );
        const fallBackAmbiguous = mod.computeScheduledTimestampInTimezone(
          '2026-11-01',
          '01:30',
          'America/New_York'
        );
        const fallBackMorning = mod.computeScheduledTimestampInTimezone(
          '2026-11-01',
          '08:00',
          'America/New_York'
        );

        expect(Number.isNaN(springForwardGap.getTime())).toBe(false);
        expect(springMorning.toISOString()).toBe('2026-03-08T12:00:00.000Z'); // EDT (UTC-4)
        expect(Number.isNaN(fallBackAmbiguous.getTime())).toBe(false);
        expect(fallBackMorning.toISOString()).toBe('2026-11-01T13:00:00.000Z'); // EST (UTC-5)
      }
    }
  );

  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T2-B20-04: Multi-TZ EOD closeout at 00:15 Tokyo (15:15 London same day) closes Tokyo dose only and spares London evening dose',
    async () => {
      const serverIndex = await loadOptionalModule<{
        runMidnightTimezoneCycle: (
          db: unknown,
          now?: Date
        ) => Promise<{ midnightTimezones: string[]; closedCount: number }>;
      }>('server/src/index.ts');
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      // 2026-11-25T15:15:00Z = 2026-11-26 00:15 in Asia/Tokyo (UTC+9), 2026-11-25 15:15 in Europe/London (UTC+0)
      const tokyoMidnightUtc = new Date('2026-11-25T15:15:00.000Z');

      const seedMulti = (db: MockAdminFirestore) => {
        db.seed('users', 'p_tokyo', { uid: 'p_tokyo', timezone: 'Asia/Tokyo' });
        db.seed('users', 'p_london', { uid: 'p_london', timezone: 'Europe/London' });
        db.seed('dose_logs', 'tokyo_nov25', {
          patientId: 'p_tokyo',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T11:00:00.000Z'), // 20:00 Tokyo
          status: 'unconfirmed',
        });
        db.seed('dose_logs', 'london_nov25', {
          patientId: 'p_london',
          scheduledDate: '2026-11-25',
          scheduledTime: new Date('2026-11-25T14:00:00.000Z'), // 14:00 London
          status: 'due',
        });
      };

      const srvDb = new MockAdminFirestore();
      const fnDb = new MockAdminFirestore();
      seedMulti(srvDb);
      seedMulti(fnDb);

      const srvCycle = await serverIndex.runMidnightTimezoneCycle(srvDb, tokyoMidnightUtc);
      const fnCycle = await fnJobs.runMidnightTimezoneCycle!(fnDb, tokyoMidnightUtc);

      for (const [cycle, db] of [
        [srvCycle, srvDb],
        [fnCycle, fnDb],
      ] as const) {
        expect(cycle.midnightTimezones).toEqual(['Asia/Tokyo']);
        expect(cycle.closedCount).toBe(1);
        expect(db.inspect('dose_logs', 'tokyo_nov25')?.status).toBe('missed');
        expect(db.inspect('dose_logs', 'london_nov25')?.status).toBe('due');
      }
    }
  );

  it.runIf(hasMultiTzServer)(
    'T2-B20-05: POST /api/jobs/generate-daily-logs rejects invalid targetDate (2026-02-30, non-string) with HTTP 400 and invalid TZ never crashes generation',
    async () => {
      process.env.CRON_SECRET = 'tz_boundary_secret';
      const indexMod = await loadOptionalModule<{
        createApp: (deps?: Record<string, unknown>) => ExpressLikeApp;
      }>('server/src/index.ts');
      const serverJobs = await loadOptionalModule<DailyJobsContract>(
        'server/src/jobs/dailyDoseLogs.ts'
      );

      const adminDb = new MockAdminFirestore();
      const srv = await startTestServer(
        indexMod.createApp({
          db: adminDb,
          messaging: null,
          isInitialized: true,
          jobsActive: false,
        })
      );
      activeClose = srv.close;

      for (const badBody of [{ targetDate: '2026-02-30' }, { targetDate: 20261125 }]) {
        const res = await fetch(`${srv.baseUrl}/api/jobs/generate-daily-logs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-cron-secret': 'tz_boundary_secret',
          },
          body: JSON.stringify(badBody),
        });
        expect(res.status).toBe(400);
      }

      // Invalid timezone falls back cleanly without throwing
      expect(() =>
        serverJobs.computeScheduledTimestampInTimezone('2026-11-25', '08:00', 'Invalid/Zone')
      ).not.toThrow();
    }
  );
});
