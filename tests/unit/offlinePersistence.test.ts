import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import type { DoseLogDocument, MedicationDocument } from '../../src/types/firestore';

function localTodayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('Offline Persistence, Auto-Seed Guard & Date-Range Queries', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('initializes Firestore with persistentLocalCache and persistentMultipleTabManager', async () => {
    const mockApp = { name: '[DEFAULT]' };
    const mockDb = { type: 'firestore-persistent' };
    const mockTabManager = { kind: 'multi-tab' };
    const mockCache = { kind: 'persistent', tabManager: mockTabManager };

    const initializeFirestoreMock = vi.fn().mockReturnValue(mockDb);
    const getFirestoreMock = vi.fn();
    const persistentLocalCacheMock = vi.fn().mockReturnValue(mockCache);
    const persistentMultipleTabManagerMock = vi.fn().mockReturnValue(mockTabManager);

    vi.doMock('firebase/app', () => ({
      initializeApp: vi.fn().mockReturnValue(mockApp),
    }));
    vi.doMock('firebase/auth', () => ({
      getAuth: vi.fn().mockReturnValue({}),
    }));
    vi.doMock('firebase/messaging', () => ({
      getMessaging: vi.fn(),
      isSupported: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock('firebase/firestore', () => ({
      initializeFirestore: initializeFirestoreMock,
      getFirestore: getFirestoreMock,
      persistentLocalCache: persistentLocalCacheMock,
      persistentMultipleTabManager: persistentMultipleTabManagerMock,
    }));

    const { db } = await import('../../src/lib/firebase');

    expect(persistentMultipleTabManagerMock).toHaveBeenCalledTimes(1);
    expect(persistentLocalCacheMock).toHaveBeenCalledWith({
      tabManager: mockTabManager,
    });
    expect(initializeFirestoreMock).toHaveBeenCalledWith(mockApp, {
      localCache: mockCache,
    });
    expect(getFirestoreMock).not.toHaveBeenCalled();
    expect(db).toBe(mockDb);
  });

  it('falls back safely to getFirestore when initializeFirestore throws', async () => {
    const mockApp = { name: '[DEFAULT]' };
    const fallbackDb = { type: 'firestore-fallback' };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const initializeFirestoreMock = vi
      .fn()
      .mockImplementation(() => {
        throw new Error('IndexedDB unavailable');
      });
    const getFirestoreMock = vi.fn().mockReturnValue(fallbackDb);

    vi.doMock('firebase/app', () => ({
      initializeApp: vi.fn().mockReturnValue(mockApp),
    }));
    vi.doMock('firebase/auth', () => ({
      getAuth: vi.fn().mockReturnValue({}),
    }));
    vi.doMock('firebase/messaging', () => ({
      getMessaging: vi.fn(),
      isSupported: vi.fn().mockResolvedValue(false),
    }));
    vi.doMock('firebase/firestore', () => ({
      initializeFirestore: initializeFirestoreMock,
      getFirestore: getFirestoreMock,
      persistentLocalCache: vi.fn().mockReturnValue({}),
      persistentMultipleTabManager: vi.fn().mockReturnValue({}),
    }));

    const { db, createFirestoreInstance } = await import('../../src/lib/firebase');

    expect(initializeFirestoreMock).toHaveBeenCalled();
    expect(getFirestoreMock).toHaveBeenCalledWith(mockApp);
    expect(db).toBe(fallbackDb);
    expect(createFirestoreInstance()).toBe(fallbackDb);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('does NOT re-seed default medications when all patient medications are paused (active: false)', async () => {
    const whereCalls: Array<[string, string, unknown]> = [];
    const batchSetMock = vi.fn();
    const batchCommitMock = vi.fn().mockResolvedValue(undefined);
    const setDocMock = vi.fn().mockResolvedValue(undefined);

    // First getDocs (any medication limit(1)): non-empty (paused med exists)
    // Second getDocs (active == true): empty
    const getDocsMock = vi
      .fn()
      .mockResolvedValueOnce({ empty: false, docs: [{ id: 'paused_med' }] })
      .mockResolvedValueOnce({ empty: true, docs: [] });

    vi.doMock('../../src/lib/firebase', () => ({
      db: { type: 'mock-db' },
    }));
    vi.doMock('firebase/firestore', () => ({
      Timestamp,
      collection: vi.fn((_db: unknown, name: string) => ({ path: name })),
      doc: vi.fn((col: { path: string }, id?: string) => ({ path: `${col.path}/${id ?? 'auto'}` })),
      getDoc: vi.fn(),
      getDocs: getDocsMock,
      limit: vi.fn((n: number) => ({ type: 'limit', n })),
      query: vi.fn((col: unknown, ...constraints: unknown[]) => ({ col, constraints })),
      serverTimestamp: vi.fn(() => 'SERVER_TS'),
      setDoc: setDocMock,
      where: vi.fn((field: string, op: string, val: unknown) => {
        whereCalls.push([field, op, val]);
        return { field, op, val };
      }),
      writeBatch: vi.fn(() => ({
        set: batchSetMock,
        commit: batchCommitMock,
      })),
    }));

    const { generateTodayLogs } = await import('../../src/lib/generateTodayLogs');
    const result = await generateTodayLogs('patient_123');

    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(batchSetMock).not.toHaveBeenCalled();
    expect(setDocMock).not.toHaveBeenCalled();
    expect(getDocsMock).toHaveBeenCalledTimes(2);
    // First query checked patientId without active == true
    expect(whereCalls[0]).toEqual(['patientId', '==', 'patient_123']);
  });

  it('generateTodayLogsForMedication respects active, date range, specific_days, and idempotency', async () => {
    const today = localTodayStr();
    const [y, m, d] = today.split('-').map(Number);
    const todayDow = new Date(y, m - 1, d).getDay();
    const otherDow = (todayDow + 1) % 7;

    const batchSetMock = vi.fn();
    const batchCommitMock = vi.fn().mockResolvedValue(undefined);
    const getDocMock = vi
      .fn()
      // First time slot (08:00) does not exist yet
      .mockResolvedValueOnce({ exists: () => false })
      // Second time slot (20:00) already exists
      .mockResolvedValueOnce({ exists: () => true });

    vi.doMock('../../src/lib/firebase', () => ({
      db: { type: 'mock-db' },
    }));
    vi.doMock('firebase/firestore', () => ({
      Timestamp,
      collection: vi.fn((_db: unknown, name: string) => ({ path: name })),
      doc: vi.fn((col: { path: string }, id?: string) => ({
        id: id ?? 'auto',
        path: `${col.path}/${id ?? 'auto'}`,
      })),
      getDoc: getDocMock,
      getDocs: vi.fn(),
      limit: vi.fn(),
      query: vi.fn(),
      serverTimestamp: vi.fn(() => 'SERVER_TS'),
      setDoc: vi.fn(),
      where: vi.fn(),
      writeBatch: vi.fn(() => ({
        set: batchSetMock,
        commit: batchCommitMock,
      })),
    }));

    const { generateTodayLogsForMedication } = await import('../../src/lib/generateTodayLogs');

    const baseMed: MedicationDocument = {
      id: 'med_new_1',
      patientId: 'patient_ramesh',
      name: 'Vitamin D3',
      dosage: '1000 IU',
      instructions: 'After lunch',
      schedule: {
        times: ['08:00', '20:00'],
        frequency: 'daily',
        startDate: '2026-01-01',
        endDate: null,
      },
      color: '#0D9488',
      shape: 'round',
      active: true,
      createdBy: 'caregiver_priya',
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    // Paused med -> 0
    expect(await generateTodayLogsForMedication({ ...baseMed, active: false })).toBe(0);

    // Future startDate -> 0
    expect(
      await generateTodayLogsForMedication({
        ...baseMed,
        schedule: { ...baseMed.schedule, startDate: '2099-12-31' },
      })
    ).toBe(0);

    // Past endDate -> 0
    expect(
      await generateTodayLogsForMedication({
        ...baseMed,
        schedule: { ...baseMed.schedule, endDate: '2020-01-01' },
      })
    ).toBe(0);

    // specific_days not matching today -> 0
    expect(
      await generateTodayLogsForMedication({
        ...baseMed,
        schedule: {
          ...baseMed.schedule,
          frequency: 'specific_days',
          daysOfWeek: [otherDow],
        },
      })
    ).toBe(0);

    // Matching active med -> creates only missing deterministic doc (08:00)
    const createdCount = await generateTodayLogsForMedication({
      ...baseMed,
      schedule: {
        ...baseMed.schedule,
        frequency: 'specific_days',
        daysOfWeek: [todayDow],
      },
    });

    expect(createdCount).toBe(1);
    expect(batchSetMock).toHaveBeenCalledTimes(1);
    const [docRef, docData] = batchSetMock.mock.calls[0] as [
      { id: string },
      Omit<DoseLogDocument, 'id'>,
    ];
    expect(docRef.id).toBe(`patient_ramesh_med_new_1_${today}_0800`);
    expect(docData.snoozeCount).toBe(0);
    expect(docData.status).toBe('scheduled');
    expect(batchCommitMock).toHaveBeenCalledTimes(1);
  });

  it('getDoseLogsForDateRange uses per-date equality queries (no >= or <= range filters)', async () => {
    const whereCalls: Array<[string, string, unknown]> = [];
    const getDocsMock = vi.fn().mockImplementation((q: { constraints: Array<{ field: string; val: unknown }> }) => {
      const dateConstraint = q.constraints.find((c) => c.field === 'scheduledDate');
      const dateStr = String(dateConstraint?.val ?? '2026-11-25');
      const [yy, mm, dd] = dateStr.split('-').map(Number);
      return Promise.resolve({
        docs: [
          {
            id: `dose_${dateStr}`,
            data: () => ({
              id: `dose_${dateStr}`,
              patientId: 'patient_ramesh',
              medicationId: 'med_1',
              medicationName: 'Metformin',
              dosage: '500 mg',
              scheduledDate: dateStr,
              scheduledTime: Timestamp.fromDate(new Date(yy, mm - 1, dd, 8, 0, 0)),
              status: 'taken',
              snoozeCount: 0,
              followUpSent: false,
              escalationAlertSent: false,
              createdAt: Timestamp.now(),
              updatedAt: Timestamp.now(),
            }),
          },
        ],
      });
    });

    vi.doMock('../../src/lib/firebase', () => ({
      db: { type: 'mock-db' },
    }));
    vi.doMock('firebase/firestore', () => ({
      Timestamp,
      collection: vi.fn(() => ({
        withConverter: () => ({ path: 'dose_logs' }),
      })),
      doc: vi.fn(),
      getDoc: vi.fn(),
      getDocs: getDocsMock,
      onSnapshot: vi.fn(),
      query: vi.fn((col: unknown, ...constraints: unknown[]) => ({ col, constraints })),
      serverTimestamp: vi.fn(() => 'SERVER_TS'),
      setDoc: vi.fn(),
      updateDoc: vi.fn(),
      where: vi.fn((field: string, op: string, val: unknown) => {
        whereCalls.push([field, op, val]);
        return { field, op, val };
      }),
    }));

    const { getDoseLogsForDateRange } = await import('../../src/lib/firestore');

    const invalidRange = await getDoseLogsForDateRange('patient_ramesh', '2026-11-25', '2026-11-20');
    expect(invalidRange).toEqual([]);

    const logs = await getDoseLogsForDateRange('patient_ramesh', '2026-11-23', '2026-11-25');
    expect(logs).toHaveLength(3);
    expect(logs.map((l) => l.scheduledDate)).toEqual([
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ]);
    // Verify strictly == queries (no >=, <=, or in)
    expect(whereCalls.every(([, op]) => op === '==')).toBe(true);
    expect(getDocsMock).toHaveBeenCalledTimes(3);
  });
});
