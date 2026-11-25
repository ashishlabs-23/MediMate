import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import * as admin from 'firebase-admin';
import type { FirebaseAdminContext } from '../src/firebaseAdmin';
import {
  BATCH_LIMIT as DAILY_BATCH_LIMIT,
  computeISTDateString,
  computeISTScheduledTimestamp,
  generateForDate,
  parseValidatedDateString,
} from '../src/jobs/dailyDoseLogs';
import {
  BATCH_LIMIT as ESCALATION_BATCH_LIMIT,
  processDueDoses,
} from '../src/jobs/dueDosesEscalation';
import { createApp, startInternalCron } from '../src/index';

type StoreMap = Map<string, Record<string, unknown>>;

function isServerTimestampSentinel(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  const ctorName = (val as { constructor?: { name?: string } }).constructor?.name;
  return ctorName === 'ServerTimestampTransform';
}

function extractArrayRemoveElements(val: unknown): unknown[] | null {
  if (!val || typeof val !== 'object') return null;
  const ctorName = (val as { constructor?: { name?: string } }).constructor?.name;
  if (ctorName === 'ArrayRemoveTransform' && 'elements' in val) {
    const elements = (val as { elements?: unknown }).elements;
    return Array.isArray(elements) ? elements : null;
  }
  return null;
}

class MockDocSnapshot {
  constructor(
    public readonly id: string,
    public readonly ref: MockDocRef,
    private readonly _data: Record<string, unknown> | undefined
  ) {}

  get exists(): boolean {
    return this._data !== undefined;
  }

  data(): Record<string, unknown> | undefined {
    return this._data ? { ...this._data } : undefined;
  }
}

class MockDocRef {
  constructor(
    public readonly id: string,
    private readonly store: StoreMap,
    private readonly nowProvider: () => Date
  ) {}

  async get(): Promise<MockDocSnapshot> {
    return new MockDocSnapshot(this.id, this, this.store.get(this.id));
  }

  async set(data: Record<string, unknown>): Promise<void> {
    this.store.set(this.id, this.resolveTransforms(data));
  }

  async update(patch: Record<string, unknown>): Promise<void> {
    const existing = this.store.get(this.id);
    if (!existing) {
      throw new Error(`Document ${this.id} does not exist`);
    }
    this.store.set(this.id, this.applyPatch(existing, patch));
  }

  applyPatch(
    existing: Record<string, unknown>,
    patch: Record<string, unknown>
  ): Record<string, unknown> {
    const next: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(patch)) {
      const removeElements = extractArrayRemoveElements(value);
      if (removeElements !== null) {
        const currentArr = Array.isArray(next[key]) ? (next[key] as unknown[]) : [];
        next[key] = currentArr.filter((item) => !removeElements.includes(item));
      } else if (isServerTimestampSentinel(value)) {
        next[key] = admin.firestore.Timestamp.fromDate(this.nowProvider());
      } else {
        next[key] = value;
      }
    }
    return next;
  }

  resolveTransforms(data: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (isServerTimestampSentinel(value)) {
        out[key] = admin.firestore.Timestamp.fromDate(this.nowProvider());
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  writeRawSet(data: Record<string, unknown>): void {
    this.store.set(this.id, this.resolveTransforms(data));
  }

  writeRawUpdate(patch: Record<string, unknown>): void {
    const existing = this.store.get(this.id) ?? {};
    this.store.set(this.id, this.applyPatch(existing, patch));
  }
}

class MockCollectionRef {
  constructor(
    private readonly store: StoreMap,
    private readonly nowProvider: () => Date
  ) {}

  doc(id: string): MockDocRef {
    return new MockDocRef(id, this.store, this.nowProvider);
  }

  where(field: string, op: string, value: unknown): { get: () => Promise<{ docs: MockDocSnapshot[] }> } {
    return {
      get: async () => {
        const docs: MockDocSnapshot[] = [];
        for (const [id, data] of this.store.entries()) {
          const fieldVal = data[field];
          let matches = false;
          if (op === '==') {
            matches = fieldVal === value;
          } else if (op === 'not-in' && Array.isArray(value)) {
            matches = !value.includes(fieldVal);
          }
          if (matches) {
            docs.push(new MockDocSnapshot(id, this.doc(id), data));
          }
        }
        return { docs };
      },
    };
  }
}

class MockAdminFirestore {
  public readonly collections = new Map<string, StoreMap>();
  public readonly batchCommitSizes: number[] = [];
  private currentNow = new Date('2026-11-25T08:00:00.000Z');

  setNow(now: Date): void {
    this.currentNow = now;
  }

  seed(collectionName: string, docId: string, data: Record<string, unknown>): void {
    this.getStore(collectionName).set(docId, { ...data });
  }

  getDocData(collectionName: string, docId: string): Record<string, unknown> | undefined {
    return this.getStore(collectionName).get(docId);
  }

  getAllDocs(collectionName: string): Array<{ id: string; data: Record<string, unknown> }> {
    return Array.from(this.getStore(collectionName).entries()).map(([id, data]) => ({
      id,
      data: { ...data },
    }));
  }

  private getStore(name: string): StoreMap {
    let store = this.collections.get(name);
    if (!store) {
      store = new Map();
      this.collections.set(name, store);
    }
    return store;
  }

  collection(name: string): MockCollectionRef {
    return new MockCollectionRef(this.getStore(name), () => this.currentNow);
  }

  batch() {
    const ops: Array<() => void> = [];
    return {
      set: (ref: MockDocRef, data: Record<string, unknown>) => {
        ops.push(() => ref.writeRawSet(data));
      },
      update: (ref: MockDocRef, patch: Record<string, unknown>) => {
        ops.push(() => ref.writeRawUpdate(patch));
      },
      commit: async () => {
        if (ops.length > 500) {
          throw new Error(`Firestore batch limit exceeded: ${ops.length} > 500`);
        }
        this.batchCommitSizes.push(ops.length);
        for (const op of ops) {
          op();
        }
      },
    };
  }
}

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const addr = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
}

describe('IST Date & Timestamp Helpers', () => {
  it('computes IST calendar date across the 18:30 UTC midnight boundary', () => {
    // 18:29:59 UTC on Nov 25 = 23:59:59 IST on Nov 25
    expect(computeISTDateString(new Date('2026-11-25T18:29:59.000Z'))).toBe('2026-11-25');
    // 18:30:00 UTC on Nov 25 = 00:00:00 IST on Nov 26
    expect(computeISTDateString(new Date('2026-11-25T18:30:00.000Z'))).toBe('2026-11-26');
  });

  it('converts IST wall-clock HH:mm to true UTC instant (UTC = IST - 05:30)', () => {
    const morning = computeISTScheduledTimestamp('2026-11-25', '08:00');
    expect(morning.toISOString()).toBe('2026-11-25T02:30:00.000Z');

    const midnight = computeISTScheduledTimestamp('2026-11-26', '00:00');
    expect(midnight.toISOString()).toBe('2026-11-25T18:30:00.000Z');

    const night = computeISTScheduledTimestamp('2026-11-25', '21:30');
    expect(night.toISOString()).toBe('2026-11-25T16:00:00.000Z');
  });

  it('rejects malformed strings and non-existent calendar rollovers', () => {
    expect(() => parseValidatedDateString('2026-02-30')).toThrow(/non-existent calendar date/i);
    expect(() => parseValidatedDateString('2025-02-29')).toThrow(/non-existent calendar date/i);
    expect(() => parseValidatedDateString('2026-13-01')).toThrow(/non-existent calendar date/i);
    expect(() => parseValidatedDateString('2026/11/25')).toThrow(/expected YYYY-MM-DD/i);
    expect(() => computeISTScheduledTimestamp('2026-11-25', '25:00')).toThrow(/Invalid time/i);
  });
});

describe('dailyDoseLogs job (generateForDate)', () => {
  it('filters active/startDate/endDate/specific_days, stores IST->UTC timestamp, and is idempotent', async () => {
    const mockDb = new MockAdminFirestore();
    const db = mockDb as unknown as admin.firestore.Firestore;

    // 2026-11-25 is Wednesday (UTC day = 3)
    mockDb.seed('medications', 'med_active_daily', {
      patientId: 'patient_1',
      name: 'Metformin',
      dosage: '500mg',
      instructions: 'After breakfast',
      color: '#0D9488',
      shape: 'oval',
      active: true,
      schedule: {
        times: ['08:00', '20:00'],
        frequency: 'daily',
        startDate: '2026-11-01',
        endDate: null,
      },
    });
    mockDb.seed('medications', 'med_specific_wed', {
      patientId: 'patient_1',
      name: 'Vitamin D',
      dosage: '1000 IU',
      active: true,
      schedule: {
        times: ['09:00'],
        frequency: 'specific_days',
        daysOfWeek: [3],
        startDate: '2026-11-01',
      },
    });
    mockDb.seed('medications', 'med_specific_thu', {
      patientId: 'patient_1',
      name: 'Calcium',
      dosage: '500mg',
      active: true,
      schedule: {
        times: ['09:00'],
        frequency: 'specific_days',
        daysOfWeek: [4],
        startDate: '2026-11-01',
      },
    });
    mockDb.seed('medications', 'med_inactive', {
      patientId: 'patient_1',
      name: 'Old Med',
      dosage: '10mg',
      active: false,
      schedule: {
        times: ['08:00'],
        frequency: 'daily',
        startDate: '2026-11-01',
      },
    });
    mockDb.seed('medications', 'med_future', {
      patientId: 'patient_1',
      name: 'Future Med',
      dosage: '10mg',
      active: true,
      schedule: {
        times: ['08:00'],
        frequency: 'daily',
        startDate: '2026-12-01',
      },
    });
    mockDb.seed('medications', 'med_expired', {
      patientId: 'patient_1',
      name: 'Expired Med',
      dosage: '10mg',
      active: true,
      schedule: {
        times: ['08:00'],
        frequency: 'daily',
        startDate: '2026-10-01',
        endDate: '2026-11-24',
      },
    });

    const first = await generateForDate(db, '2026-11-25');
    expect(first).toEqual({
      targetDate: '2026-11-25',
      createdCount: 3,
      skippedCount: 0,
    });

    const morningDose = mockDb.getDocData(
      'dose_logs',
      'patient_1_med_active_daily_2026-11-25_0800'
    );
    expect(morningDose).toBeDefined();
    expect(morningDose?.status).toBe('scheduled');
    expect(morningDose?.snoozeCount).toBe(0);
    const ts = morningDose?.scheduledTime as admin.firestore.Timestamp;
    expect(ts.toDate().toISOString()).toBe('2026-11-25T02:30:00.000Z');

    // Second run on same date is completely idempotent
    const second = await generateForDate(db, '2026-11-25');
    expect(second).toEqual({
      targetDate: '2026-11-25',
      createdCount: 0,
      skippedCount: 3,
    });
  });

  it('chunks Firestore batch writes at <= 500 ops when > 500 doses are generated', async () => {
    expect(DAILY_BATCH_LIMIT).toBe(500);
    const mockDb = new MockAdminFirestore();
    const db = mockDb as unknown as admin.firestore.Firestore;

    for (let i = 0; i < 550; i++) {
      mockDb.seed('medications', `med_${i}`, {
        patientId: 'patient_bulk',
        name: `Med ${i}`,
        dosage: '10mg',
        active: true,
        schedule: {
          times: ['08:00'],
          frequency: 'daily',
          startDate: '2026-11-01',
        },
      });
    }

    const result = await generateForDate(db, '2026-11-25');
    expect(result.createdCount).toBe(550);
    expect(result.skippedCount).toBe(0);
    expect(mockDb.batchCommitSizes).toEqual([500, 50]);
  });
});

describe('dueDosesEscalation job (processDueDoses)', () => {
  it('handles scheduled -> due -> T+15m gentle -> snooze suppression -> snoozed -> due expiry -> T+30m escalation override', async () => {
    const mockDb = new MockAdminFirestore();
    const db = mockDb as unknown as admin.firestore.Firestore;

    const T = new Date('2026-11-25T02:30:00.000Z'); // 08:00 IST
    const scheduledTs = admin.firestore.Timestamp.fromDate(T);

    mockDb.seed('users', 'patient_1', {
      fcmTokens: ['patient-tok-1'],
    });
    mockDb.seed('users', 'cg_1', {
      fcmTokens: ['cg-tok-1'],
    });
    mockDb.seed('care_circles', 'patient_1', {
      patientId: 'patient_1',
      caregiverIds: ['cg_1'],
    });

    // 1. Future dose (not yet due)
    mockDb.seed('dose_logs', 'dose_future', {
      patientId: 'patient_1',
      medicationName: 'Future',
      dosage: '10mg',
      scheduledTime: admin.firestore.Timestamp.fromDate(new Date(T.getTime() + 60 * 60 * 1000)),
      status: 'scheduled',
      snoozeCount: 0,
      followUpSent: false,
      escalationAlertSent: false,
    });

    // 2. Dose at T (becomes due)
    mockDb.seed('dose_logs', 'dose_due_now', {
      patientId: 'patient_1',
      medicationName: 'Metformin',
      dosage: '500mg',
      scheduledTime: scheduledTs,
      status: 'scheduled',
      snoozeCount: 0,
      followUpSent: false,
      escalationAlertSent: false,
    });

    // 3. Dose already due reaching T+15m
    mockDb.seed('dose_logs', 'dose_gentle', {
      patientId: 'patient_1',
      medicationName: 'Amlodipine',
      dosage: '5mg',
      scheduledTime: admin.firestore.Timestamp.fromDate(new Date(T.getTime() - 16 * 60 * 1000)),
      status: 'due',
      snoozeCount: 0,
      followUpSent: false,
      escalationAlertSent: false,
    });

    // 4. Actively snoozed dose at T+16m (snoozeUntil = T+20m) -> suppressed
    mockDb.seed('dose_logs', 'dose_snoozed_active', {
      patientId: 'patient_1',
      medicationName: 'Aspirin',
      dosage: '75mg',
      scheduledTime: admin.firestore.Timestamp.fromDate(new Date(T.getTime() - 16 * 60 * 1000)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozeUntil: admin.firestore.Timestamp.fromDate(new Date(T.getTime() + 4 * 60 * 1000)),
      followUpSent: false,
      escalationAlertSent: false,
    });

    // 5. Snoozed dose expired BEFORE T+15m (scheduled T-12m, snoozeUntil T-2m) -> snoozed -> due + initial
    mockDb.seed('dose_logs', 'dose_snoozed_expired_early', {
      patientId: 'patient_1',
      medicationName: 'Atorvastatin',
      dosage: '10mg',
      scheduledTime: admin.firestore.Timestamp.fromDate(new Date(T.getTime() - 12 * 60 * 1000)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozeUntil: admin.firestore.Timestamp.fromDate(new Date(T.getTime() - 2 * 60 * 1000)),
      followUpSent: false,
      escalationAlertSent: false,
    });

    // 6. Snoozed dose expired AFTER T+15m (scheduled T-18m, snoozeUntil T-1m) -> snoozed -> due + gentle
    mockDb.seed('dose_logs', 'dose_snoozed_expired_late', {
      patientId: 'patient_1',
      medicationName: 'Losartan',
      dosage: '50mg',
      scheduledTime: admin.firestore.Timestamp.fromDate(new Date(T.getTime() - 18 * 60 * 1000)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozeUntil: admin.firestore.Timestamp.fromDate(new Date(T.getTime() - 1 * 60 * 1000)),
      followUpSent: false,
      escalationAlertSent: false,
    });

    // 7. Actively snoozed dose past T+30m -> escalation overrides active snooze!
    mockDb.seed('dose_logs', 'dose_escalate_override', {
      patientId: 'patient_1',
      medicationName: 'Insulin',
      dosage: '10 units',
      scheduledTime: admin.firestore.Timestamp.fromDate(new Date(T.getTime() - 31 * 60 * 1000)),
      status: 'snoozed',
      snoozeCount: 1,
      snoozeUntil: admin.firestore.Timestamp.fromDate(new Date(T.getTime() + 5 * 60 * 1000)),
      followUpSent: false,
      escalationAlertSent: false,
    });

    const sentMessages: admin.messaging.MulticastMessage[] = [];
    const mockMessaging = {
      sendEachForMulticast: vi.fn(async (message: admin.messaging.MulticastMessage) => {
        sentMessages.push(message);
        return {
          successCount: message.tokens.length,
          failureCount: 0,
          responses: message.tokens.map(() => ({ success: true })),
        };
      }),
    } as unknown as admin.messaging.Messaging;

    mockDb.setNow(T);
    const result = await processDueDoses(db, T, mockMessaging);

    expect(result.initialReminderIds).toEqual(
      expect.arrayContaining(['dose_due_now', 'dose_snoozed_expired_early'])
    );
    expect(result.initialReminderIds).toHaveLength(2);

    expect(result.gentleReminderIds).toEqual(
      expect.arrayContaining(['dose_gentle', 'dose_snoozed_expired_late'])
    );
    expect(result.gentleReminderIds).toHaveLength(2);

    expect(result.escalatedIds).toEqual(['dose_escalate_override']);

    // Verify stored doc states
    expect(mockDb.getDocData('dose_logs', 'dose_future')?.status).toBe('scheduled');
    expect(mockDb.getDocData('dose_logs', 'dose_due_now')?.status).toBe('due');
    expect(mockDb.getDocData('dose_logs', 'dose_gentle')?.followUpSent).toBe(true);
    expect(mockDb.getDocData('dose_logs', 'dose_snoozed_active')?.status).toBe('snoozed');
    expect(mockDb.getDocData('dose_logs', 'dose_snoozed_active')?.followUpSent).toBe(false);

    const earlyExpired = mockDb.getDocData('dose_logs', 'dose_snoozed_expired_early');
    expect(earlyExpired?.status).toBe('due');
    expect(earlyExpired?.snoozeUntil).toBeNull();
    expect(earlyExpired?.snoozeCount).toBe(1);
    expect(earlyExpired?.followUpSent).toBe(false);

    const lateExpired = mockDb.getDocData('dose_logs', 'dose_snoozed_expired_late');
    expect(lateExpired?.status).toBe('due');
    expect(lateExpired?.snoozeUntil).toBeNull();
    expect(lateExpired?.snoozeCount).toBe(1);
    expect(lateExpired?.followUpSent).toBe(true);

    const escalated = mockDb.getDocData('dose_logs', 'dose_escalate_override');
    expect(escalated?.status).toBe('unconfirmed');
    expect(escalated?.snoozeUntil).toBeNull();
    expect(escalated?.escalationAlertSent).toBe(true);
    expect(escalated?.escalatedAt).toBeDefined();

    // Escalation message must target both patient and caregiver
    const escalationMsg = sentMessages.find((m) => m.data?.type === 'escalation');
    expect(escalationMsg?.tokens).toEqual(['patient-tok-1', 'cg-tok-1']);

    // Idempotent re-run at same timestamp triggers zero new FCMs on already-processed docs
    // except dose_snoozed_expired_early (wait: T-12m is still < T+15m, so zero gentle)
    const rerun = await processDueDoses(db, T, mockMessaging);
    expect(rerun.initialReminderIds).toEqual([]);
    expect(rerun.gentleReminderIds).toEqual([]);
    expect(rerun.escalatedIds).toEqual([]);
  });

  it('chunks batch updates into slices <= 500 ops when > 500 doses transition', async () => {
    expect(ESCALATION_BATCH_LIMIT).toBe(500);
    const mockDb = new MockAdminFirestore();
    const db = mockDb as unknown as admin.firestore.Firestore;
    const now = new Date('2026-11-25T03:00:00.000Z');
    mockDb.setNow(now);

    for (let i = 0; i < 550; i++) {
      mockDb.seed('dose_logs', `bulk_dose_${i}`, {
        patientId: 'patient_bulk',
        medicationName: `Med ${i}`,
        dosage: '10mg',
        scheduledTime: admin.firestore.Timestamp.fromDate(now),
        status: 'scheduled',
        snoozeCount: 0,
        followUpSent: false,
        escalationAlertSent: false,
      });
    }

    const result = await processDueDoses(db, now, null);
    expect(result.initialReminderIds).toHaveLength(550);
    expect(mockDb.batchCommitSizes).toEqual([500, 50]);
  });

  it('removes unregistered and invalid FCM tokens from patient and caregiver user docs while preserving valid tokens', async () => {
    const mockDb = new MockAdminFirestore();
    const db = mockDb as unknown as admin.firestore.Firestore;
    const now = new Date('2026-11-25T03:00:00.000Z');
    mockDb.setNow(now);

    mockDb.seed('users', 'patient_1', {
      fcmTokens: ['valid-p', 'stale-p', 'transient-err-p'],
    });
    mockDb.seed('users', 'cg_1', {
      fcmTokens: ['invalid-cg', 'valid-cg'],
    });
    mockDb.seed('care_circles', 'patient_1', {
      patientId: 'patient_1',
      caregiverIds: ['cg_1'],
    });
    mockDb.seed('dose_logs', 'dose_esc', {
      patientId: 'patient_1',
      medicationName: 'Metformin',
      dosage: '500mg',
      scheduledTime: admin.firestore.Timestamp.fromDate(
        new Date(now.getTime() - 35 * 60 * 1000)
      ),
      status: 'due',
      snoozeCount: 0,
      followUpSent: true,
      escalationAlertSent: false,
    });

    const mockMessaging = {
      sendEachForMulticast: vi.fn(async (message: admin.messaging.MulticastMessage) => ({
        successCount: 2,
        failureCount: 3,
        responses: message.tokens.map((tok) => {
          if (tok === 'stale-p') {
            return {
              success: false,
              error: { code: 'messaging/registration-token-not-registered', message: 'Not registered' },
            };
          }
          if (tok === 'invalid-cg') {
            return {
              success: false,
              error: { code: 'messaging/invalid-registration-token', message: 'Invalid token' },
            };
          }
          if (tok === 'transient-err-p') {
            return {
              success: false,
              error: { code: 'messaging/internal-error', message: 'Transient error' },
            };
          }
          return { success: true };
        }),
      })),
    } as unknown as admin.messaging.Messaging;

    const result = await processDueDoses(db, now, mockMessaging);
    expect(result.escalatedIds).toEqual(['dose_esc']);
    expect(result.fcmResults[0]).toMatchObject({
      doseId: 'dose_esc',
      type: 'escalation',
      success: true,
    });

    expect(mockDb.getDocData('users', 'patient_1')?.fcmTokens).toEqual([
      'valid-p',
      'transient-err-p',
    ]);
    expect(mockDb.getDocData('users', 'cg_1')?.fcmTokens).toEqual(['valid-cg']);
  });
});

describe('HTTP Express endpoints & x-cron-secret auth guard', () => {
  const originalCronSecret = process.env.CRON_SECRET;

  afterEach(() => {
    if (originalCronSecret === undefined) {
      delete process.env.CRON_SECRET;
    } else {
      process.env.CRON_SECRET = originalCronSecret;
    }
  });

  it('GET /health returns 200 { status: "ok", uptime, jobsActive } even without Firebase', async () => {
    const adminContext: FirebaseAdminContext = {
      app: null,
      db: null,
      messaging: null,
      isInitialized: false,
      error: 'No credentials',
    };

    const app = createApp({ adminContext, jobsActive: false });
    await withServer(app, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        uptime: number;
        jobsActive: boolean;
      };
      expect(body.status).toBe('ok');
      expect(typeof body.uptime).toBe('number');
      expect(body.jobsActive).toBe(false);
    });
  });

  it('rejects job endpoints with 401 when CRON_SECRET is missing/unset or x-cron-secret is invalid', async () => {
    const mockDb = new MockAdminFirestore() as unknown as admin.firestore.Firestore;
    const adminContext: FirebaseAdminContext = {
      app: null,
      db: mockDb,
      messaging: null,
      isInitialized: true,
    };

    // Case 1: CRON_SECRET unset
    delete process.env.CRON_SECRET;
    const appNoSecret = createApp({ adminContext, jobsActive: false });
    await withServer(appNoSecret, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/jobs/generate-daily-logs`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'anything' },
      });
      expect(res.status).toBe(401);
    });

    // Case 2: CRON_SECRET set, header missing or wrong
    const appWithSecret = createApp({
      adminContext,
      jobsActive: false,
      cronSecret: 'super-secret-123',
    });
    await withServer(appWithSecret, async (baseUrl) => {
      const missingRes = await fetch(`${baseUrl}/api/jobs/check-due-doses`, {
        method: 'POST',
      });
      expect(missingRes.status).toBe(401);

      const wrongLenRes = await fetch(`${baseUrl}/api/jobs/check-due-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'wrong' },
      });
      expect(wrongLenRes.status).toBe(401);

      const sameLenWrongRes = await fetch(`${baseUrl}/api/jobs/generate-daily-logs`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'super-secret-999' },
      });
      expect(sameLenWrongRes.status).toBe(401);
    });
  });

  it('returns 503 when authorized but Firestore is uninitialized, 400 on invalid targetDate, and 200 on valid job execution', async () => {
    const uninitContext: FirebaseAdminContext = {
      app: null,
      db: null,
      messaging: null,
      isInitialized: false,
    };
    const appUninit = createApp({
      adminContext: uninitContext,
      cronSecret: 'test-secret',
    });

    await withServer(appUninit, async (baseUrl) => {
      const res1 = await fetch(`${baseUrl}/api/jobs/generate-daily-logs`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-secret' },
      });
      expect(res1.status).toBe(503);

      const res2 = await fetch(`${baseUrl}/api/jobs/check-due-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-secret' },
      });
      expect(res2.status).toBe(503);
    });

    const mockDb = new MockAdminFirestore();
    mockDb.seed('medications', 'm1', {
      patientId: 'p1',
      name: 'Metformin',
      dosage: '500mg',
      active: true,
      schedule: {
        times: ['08:00'],
        frequency: 'daily',
        startDate: '2026-11-01',
      },
    });
    const initContext: FirebaseAdminContext = {
      app: null,
      db: mockDb as unknown as admin.firestore.Firestore,
      messaging: null,
      isInitialized: true,
    };
    const appInit = createApp({
      adminContext: initContext,
      jobsActive: true,
      cronSecret: 'test-secret',
    });

    await withServer(appInit, async (baseUrl) => {
      const invalidDateRes = await fetch(`${baseUrl}/api/jobs/generate-daily-logs`, {
        method: 'POST',
        headers: {
          'x-cron-secret': 'test-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetDate: '2026-02-30' }),
      });
      expect(invalidDateRes.status).toBe(400);

      const validDailyRes = await fetch(`${baseUrl}/api/jobs/generate-daily-logs`, {
        method: 'POST',
        headers: {
          'x-cron-secret': 'test-secret',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ targetDate: '2026-11-25' }),
      });
      expect(validDailyRes.status).toBe(200);
      expect(await validDailyRes.json()).toEqual({
        targetDate: '2026-11-25',
        createdCount: 1,
        skippedCount: 0,
      });

      const dueRes = await fetch(`${baseUrl}/api/jobs/check-due-doses`, {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-secret' },
      });
      expect(dueRes.status).toBe(200);
      const dueBody = (await dueRes.json()) as {
        escalatedIds: string[];
        gentleReminderIds: string[];
        initialReminderIds: string[];
      };
      expect(Array.isArray(dueBody.escalatedIds)).toBe(true);
      expect(Array.isArray(dueBody.gentleReminderIds)).toBe(true);
      expect(Array.isArray(dueBody.initialReminderIds)).toBe(true);
    });
  });

  it('registers internal node-cron tasks for 30 18 * * * and */5 * * * * UTC', () => {
    const adminContext: FirebaseAdminContext = {
      app: null,
      db: null,
      messaging: null,
      isInitialized: false,
    };
    const tasks = startInternalCron(adminContext);
    expect(tasks).toHaveLength(2);
    for (const task of tasks) {
      task.stop();
    }
  });
});

describe('firebaseAdmin initialization fallback & credential modes', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.USE_ADC;
  });

  afterEach(() => {
    vi.doUnmock('firebase-admin');
    vi.resetModules();
    process.env = { ...savedEnv };
  });

  it('falls back gracefully without crashing when no credentials are configured', async () => {
    vi.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: vi.fn(),
      firestore: vi.fn(),
      messaging: vi.fn(),
      credential: { cert: vi.fn(), applicationDefault: vi.fn() },
    }));

    const { initializeFirebaseAdmin } = await import('../src/firebaseAdmin');
    const ctx = initializeFirebaseAdmin();
    expect(ctx.isInitialized).toBe(false);
    expect(ctx.app).toBeNull();
    expect(ctx.db).toBeNull();
    expect(ctx.messaging).toBeNull();
  });

  it('falls back gracefully on malformed FIREBASE_SERVICE_ACCOUNT_JSON without crashing or logging secret', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: vi.fn(),
      firestore: vi.fn(),
      messaging: vi.fn(),
      credential: { cert: vi.fn(), applicationDefault: vi.fn() },
    }));

    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = '{not-valid-json-SECRET_MARKER';
    const { initializeFirebaseAdmin } = await import('../src/firebaseAdmin');
    const ctx1 = initializeFirebaseAdmin();
    expect(ctx1.isInitialized).toBe(false);
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('SECRET_MARKER');

    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ hello: 'world' });
    const ctx2 = initializeFirebaseAdmin();
    expect(ctx2.isInitialized).toBe(false);
    warnSpy.mockRestore();
  });

  it('initializes with cert() when valid FIREBASE_SERVICE_ACCOUNT_JSON is provided', async () => {
    const mockApp = { name: '[DEFAULT]' };
    const mockDb = { tag: 'db' };
    const mockMessaging = { tag: 'messaging' };
    const certMock = vi.fn(() => 'cert-cred');
    const initAppMock = vi.fn(() => mockApp);

    vi.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: initAppMock,
      firestore: vi.fn(() => mockDb),
      messaging: vi.fn(() => mockMessaging),
      credential: { cert: certMock, applicationDefault: vi.fn() },
    }));

    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
      type: 'service_account',
      project_id: 'medimate-test',
      client_email: 'bot@medimate-test.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----\n',
    });

    const { initializeFirebaseAdmin } = await import('../src/firebaseAdmin');
    const ctx = initializeFirebaseAdmin();
    expect(ctx.isInitialized).toBe(true);
    expect(ctx.app).toBe(mockApp);
    expect(ctx.db).toBe(mockDb);
    expect(ctx.messaging).toBe(mockMessaging);
    expect(certMock).toHaveBeenCalledTimes(1);
    expect(initAppMock).toHaveBeenCalledTimes(1);
  });

  it('initializes with applicationDefault() when GOOGLE_APPLICATION_CREDENTIALS or USE_ADC=true is set', async () => {
    const mockApp = { name: '[DEFAULT]' };
    const adcMock = vi.fn(() => 'adc-cred');
    const initAppMock = vi.fn(() => mockApp);

    vi.doMock('firebase-admin', () => ({
      apps: [],
      initializeApp: initAppMock,
      firestore: vi.fn(() => ({ tag: 'db' })),
      messaging: vi.fn(() => ({ tag: 'messaging' })),
      credential: { cert: vi.fn(), applicationDefault: adcMock },
    }));

    process.env.GOOGLE_APPLICATION_CREDENTIALS = '/tmp/nonexistent-test-sa.json';
    const { initializeFirebaseAdmin } = await import('../src/firebaseAdmin');
    const ctx = initializeFirebaseAdmin();
    expect(ctx.isInitialized).toBe(true);
    expect(adcMock).toHaveBeenCalledTimes(1);
  });
});
