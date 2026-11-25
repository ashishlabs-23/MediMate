import { vi } from 'vitest';

export interface AdminTimestampLike {
  toDate: () => Date;
  toMillis: () => number;
  seconds: number;
  nanoseconds: number;
}

export function makeAdminTimestamp(date: Date): AdminTimestampLike {
  const ms = date.getTime();
  return {
    toDate: () => new Date(ms),
    toMillis: () => ms,
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1_000_000,
  };
}

function normalizeValue(val: unknown): unknown {
  if (val instanceof Date) {
    return makeAdminTimestamp(val);
  }
  if (val && typeof val === 'object') {
    const rec = val as Record<string, unknown>;
    if (rec._methodName === 'serverTimestamp' || rec.constructor?.name === 'ServerTimestampTransform') {
      return makeAdminTimestamp(new Date());
    }
    if (Array.isArray(val)) {
      return val.map(normalizeValue);
    }
    if ('toDate' in rec && typeof rec.toDate === 'function') {
      return val;
    }
  }
  return val;
}

function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...target };
  for (const [k, rawVal] of Object.entries(patch)) {
    if (
      rawVal &&
      typeof rawVal === 'object' &&
      'elements' in (rawVal as Record<string, unknown>) &&
      Array.isArray((rawVal as { elements: unknown[] }).elements) &&
      String((rawVal as Record<string, unknown>)._methodName ?? '').includes('arrayRemove')
    ) {
      const toRemove = new Set((rawVal as { elements: unknown[] }).elements);
      const existingArr = Array.isArray(next[k]) ? (next[k] as unknown[]) : [];
      next[k] = existingArr.filter((item) => !toRemove.has(item));
    } else {
      next[k] = normalizeValue(rawVal);
    }
  }
  return next;
}

interface FilterClause {
  field: string;
  op: string;
  value: unknown;
}

export class MockAdminFirestore {
  private collections = new Map<string, Map<string, Record<string, unknown>>>();
  public batchCommits = 0;

  private ensureCollection(name: string): Map<string, Record<string, unknown>> {
    let map = this.collections.get(name);
    if (!map) {
      map = new Map();
      this.collections.set(name, map);
    }
    return map;
  }

  public seed(collectionName: string, docId: string, data: Record<string, unknown>): void {
    const col = this.ensureCollection(collectionName);
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      normalized[k] = normalizeValue(v);
    }
    col.set(docId, normalized);
  }

  public inspect(collectionName: string, docId: string): Record<string, unknown> | null {
    return this.collections.get(collectionName)?.get(docId) ?? null;
  }

  public inspectAll(collectionName: string): Array<{ id: string; data: Record<string, unknown> }> {
    const col = this.ensureCollection(collectionName);
    return Array.from(col.entries()).map(([id, data]) => ({ id, data }));
  }

  private makeDocRef(collectionName: string, docId: string) {
    const col = this.ensureCollection(collectionName);
    const ref = {
      id: docId,
      path: `${collectionName}/${docId}`,
      get: async () => {
        const data = col.get(docId);
        return {
          exists: data !== undefined,
          id: docId,
          ref,
          data: () => (data ? { ...data } : undefined),
        };
      },
      set: async (data: Record<string, unknown>) => {
        this.seed(collectionName, docId, data);
      },
      update: async (patch: Record<string, unknown>) => {
        const existing = col.get(docId) ?? {};
        col.set(docId, applyPatch(existing, patch));
      },
    };
    return ref;
  }

  private makeQuery(collectionName: string, filters: FilterClause[]) {
    return {
      where: (field: string, op: string, value: unknown) =>
        this.makeQuery(collectionName, [...filters, { field, op, value }]),
      get: async () => {
        const col = this.ensureCollection(collectionName);
        const docs = Array.from(col.entries())
          .filter(([, data]) =>
            filters.every(({ field, op, value }) => {
              const actual = data[field];
              if (op === '==') return actual === value;
              if (op === '!=') return actual !== value;
              if (op === 'not-in' && Array.isArray(value)) return !value.includes(actual);
              if (op === 'in' && Array.isArray(value)) return value.includes(actual);
              return true;
            })
          )
          .map(([id, data]) => {
            const ref = this.makeDocRef(collectionName, id);
            return {
              id,
              exists: true,
              ref,
              data: () => ({ ...data }),
            };
          });
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs,
        };
      },
    };
  }

  public collection(collectionName: string) {
    return {
      doc: (docId: string) => this.makeDocRef(collectionName, docId),
      where: (field: string, op: string, value: unknown) =>
        this.makeQuery(collectionName, [{ field, op, value }]),
      get: () => this.makeQuery(collectionName, []).get(),
    };
  }

  public batch() {
    const ops: Array<() => Promise<void>> = [];
    return {
      set: (ref: { set: (d: Record<string, unknown>) => Promise<void> }, data: Record<string, unknown>) => {
        ops.push(() => ref.set(data));
      },
      update: (ref: { update: (p: Record<string, unknown>) => Promise<void> }, patch: Record<string, unknown>) => {
        ops.push(() => ref.update(patch));
      },
      commit: async () => {
        this.batchCommits += 1;
        for (const op of ops) {
          await op();
        }
      },
    };
  }
}

export function createMockAdminMessaging(
  tokenOutcomes: Record<string, { success: boolean; errorCode?: string }> = {}
) {
  const sentMessages: Array<{
    tokens: string[];
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }> = [];

  const sendEachForMulticast = vi.fn(
    async (message: {
      tokens: string[];
      notification?: { title?: string; body?: string };
      data?: Record<string, string>;
    }) => {
      sentMessages.push(message);
      const responses = message.tokens.map((token) => {
        const override = tokenOutcomes[token];
        if (override && !override.success) {
          return {
            success: false,
            error: {
              code: override.errorCode ?? 'messaging/registration-token-not-registered',
              message: 'Requested entity was not found.',
            },
          };
        }
        return { success: true, messageId: `msg_${token}` };
      });
      const successCount = responses.filter((r) => r.success).length;
      return {
        responses,
        successCount,
        failureCount: responses.length - successCount,
      };
    }
  );

  return {
    messaging: { sendEachForMulticast },
    sentMessages,
    sendEachForMulticast,
  };
}
