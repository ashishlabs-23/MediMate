import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
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

const serverDailySrc = hasProjectFile('server/src/jobs/dailyDoseLogs.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'server/src/jobs/dailyDoseLogs.ts'), 'utf-8')
  : '';
const fnDailySrc = hasProjectFile('functions/src/generateDailyDoseLogs.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'functions/src/generateDailyDoseLogs.ts'), 'utf-8')
  : '';

const hasMultiTzServer =
  hasServerRuntimeReady() && serverDailySrc.includes('computeScheduledTimestampInTimezone');
const hasMultiTzFunctions =
  hasProjectFile('functions/src/generateDailyDoseLogs.ts') &&
  fnDailySrc.includes('computeScheduledTimestampInTimezone');

interface DailyJobsContract {
  resolveValidTimezone: (tz?: unknown, fallback?: string) => string;
  computeDateStringInTimezone: (now?: Date, tz?: string) => string;
  computeScheduledTimestampInTimezone: (dateStr: string, hhmm: string, tz?: string) => Date;
  computeISTDateString: (now?: Date) => string;
  computeISTScheduledTimestamp: (dateStr: string, hhmm: string) => Date;
  isMidnightHourInTimezone?: (date: Date, tz?: string) => boolean;
  generateForDate: (
    db: unknown,
    targetDate: string,
    options?: { targetTimezones?: Set<string> }
  ) => Promise<{ createdCount: number; skippedCount: number }>;
  runMidnightTimezoneCycle?: (
    db: unknown,
    now?: Date
  ) => Promise<{ midnightTimezones: string[]; createdCount: number }>;
}

describe('Tier 1 — F20: Multi-Timezone IANA Scheduling & UTC Shift Fix (R4)', () => {
  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T1-F20-01: Pure-JS IANA helpers accurately convert wall-clock 08:00 across Asia/Kolkata, America/New_York (EST & EDT), and UTC',
    async () => {
      const serverJobs = await loadOptionalModule<DailyJobsContract>(
        'server/src/jobs/dailyDoseLogs.ts'
      );
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      for (const mod of [serverJobs, fnJobs]) {
        expect(mod.resolveValidTimezone('America/New_York')).toBe('America/New_York');
        expect(
          mod.computeScheduledTimestampInTimezone('2026-11-25', '08:00', 'Asia/Kolkata').toISOString()
        ).toBe('2026-11-25T02:30:00.000Z');
        expect(
          mod
            .computeScheduledTimestampInTimezone('2026-11-25', '08:00', 'America/New_York')
            .toISOString()
        ).toBe('2026-11-25T13:00:00.000Z');
        expect(
          mod
            .computeScheduledTimestampInTimezone('2026-07-15', '08:00', 'America/New_York')
            .toISOString()
        ).toBe('2026-07-15T12:00:00.000Z');
        expect(
          mod.computeScheduledTimestampInTimezone('2026-11-25', '08:00', 'UTC').toISOString()
        ).toBe('2026-11-25T08:00:00.000Z');
      }
    }
  );

  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T1-F20-02: functions/src/generateDailyDoseLogs.ts writes scheduledTime without +5.5h UTC shift and matches server/ to the millisecond',
    async () => {
      const serverJobs = await loadOptionalModule<DailyJobsContract>(
        'server/src/jobs/dailyDoseLogs.ts'
      );
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      const seedDb = (db: MockAdminFirestore) => {
        db.seed('users', 'p_ist', { uid: 'p_ist', timezone: 'Asia/Kolkata' });
        db.seed('medications', 'med_ist', {
          patientId: 'p_ist',
          name: 'Metformin',
          dosage: '500 mg',
          instructions: 'After breakfast',
          schedule: {
            times: ['08:00'],
            frequency: 'daily',
            startDate: '2026-01-01',
            endDate: null,
          },
          active: true,
        });
      };

      const serverDb = new MockAdminFirestore();
      const fnDb = new MockAdminFirestore();
      seedDb(serverDb);
      seedDb(fnDb);

      await serverJobs.generateForDate(serverDb, '2026-11-25');
      await fnJobs.generateForDate(fnDb, '2026-11-25');

      const docId = 'p_ist_med_ist_2026-11-25_0800';
      const srvTime = (
        serverDb.inspect('dose_logs', docId)?.scheduledTime as { toDate: () => Date }
      ).toDate();
      const fnTime = (
        fnDb.inspect('dose_logs', docId)?.scheduledTime as { toDate: () => Date }
      ).toDate();

      expect(fnTime.getTime()).toBe(srvTime.getTime());
      expect(fnTime.toISOString()).toBe('2026-11-25T02:30:00.000Z');
    }
  );

  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T1-F20-03: Per-patient midnight cycle at 05:00Z generates logs ONLY for America/New_York (00:00 EST) and skips Asia/Kolkata',
    async () => {
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );
      const serverIndex = await loadOptionalModule<{
        runMidnightTimezoneCycle?: (
          db: unknown,
          now?: Date
        ) => Promise<{ midnightTimezones: string[]; createdCount: number }>;
      }>('server/src/index.ts');

      const seedMultiTz = (db: MockAdminFirestore) => {
        db.seed('users', 'p_ny', { uid: 'p_ny', timezone: 'America/New_York' });
        db.seed('users', 'p_ist', { uid: 'p_ist', timezone: 'Asia/Kolkata' });
        db.seed('medications', 'med_ny', {
          patientId: 'p_ny',
          name: 'Lisinopril',
          dosage: '10 mg',
          schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
          active: true,
        });
        db.seed('medications', 'med_ist', {
          patientId: 'p_ist',
          name: 'Metformin',
          dosage: '500 mg',
          schedule: { times: ['08:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
          active: true,
        });
      };

      const nyMidnightUtc = new Date('2026-11-26T05:00:00.000Z');

      const fnDb = new MockAdminFirestore();
      seedMultiTz(fnDb);
      const fnCycle = await fnJobs.runMidnightTimezoneCycle!(fnDb, nyMidnightUtc);

      expect(fnCycle.midnightTimezones).toEqual(['America/New_York']);
      expect(fnCycle.createdCount).toBe(1);
      expect(fnDb.inspect('dose_logs', 'p_ny_med_ny_2026-11-26_0800')).not.toBeNull();
      expect(fnDb.inspect('dose_logs', 'p_ist_med_ist_2026-11-26_0800')).toBeNull();

      if (typeof serverIndex.runMidnightTimezoneCycle === 'function') {
        const srvDb = new MockAdminFirestore();
        seedMultiTz(srvDb);
        const srvCycle = await serverIndex.runMidnightTimezoneCycle(srvDb, nyMidnightUtc);
        expect(srvCycle.midnightTimezones).toEqual(['America/New_York']);
        expect(srvCycle.createdCount).toBe(1);
      }
    }
  );

  it.runIf(hasMultiTzFunctions)(
    'T1-F20-04: Non-whole-hour timezone Asia/Kathmandu (UTC+05:45) triggers in the :30 UTC slot (18:30Z -> 00:15 local hour 00)',
    async () => {
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      const db = new MockAdminFirestore();
      db.seed('users', 'p_ktm', { uid: 'p_ktm', timezone: 'Asia/Kathmandu' });
      db.seed('medications', 'med_ktm', {
        patientId: 'p_ktm',
        name: 'Aspirin',
        dosage: '75 mg',
        schedule: { times: ['09:00'], frequency: 'daily', startDate: '2026-01-01', endDate: null },
        active: true,
      });

      const slot30Utc = new Date('2026-11-25T18:30:00.000Z'); // 00:15 in Asia/Kathmandu on 2026-11-26
      expect(fnJobs.isMidnightHourInTimezone?.(slot30Utc, 'Asia/Kathmandu')).toBe(true);

      const res = await fnJobs.runMidnightTimezoneCycle!(db, slot30Utc);
      expect(res.midnightTimezones).toContain('Asia/Kathmandu');
      expect(db.inspect('dose_logs', 'p_ktm_med_ktm_2026-11-26_0900')).not.toBeNull();
    }
  );

  it.runIf(hasMultiTzServer && hasMultiTzFunctions)(
    'T1-F20-05: Backwards-compatible computeISTDateString and computeISTScheduledTimestamp wrappers preserve IST behavior',
    async () => {
      const serverJobs = await loadOptionalModule<DailyJobsContract>(
        'server/src/jobs/dailyDoseLogs.ts'
      );
      const fnJobs = await loadOptionalModule<DailyJobsContract>(
        'functions/src/generateDailyDoseLogs.ts'
      );

      const istMidnight = new Date('2026-11-25T18:30:00.000Z');
      for (const mod of [serverJobs, fnJobs]) {
        expect(mod.computeISTDateString(istMidnight)).toBe('2026-11-26');
        expect(mod.computeISTScheduledTimestamp('2026-11-26', '08:00').toISOString()).toBe(
          '2026-11-26T02:30:00.000Z'
        );
      }
    }
  );
});
