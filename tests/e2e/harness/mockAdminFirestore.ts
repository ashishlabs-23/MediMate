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

export function toComparableValue(v: unknown): unknown {
  if (v instanceof Date) {
    return v.getTime();
  }
  if (v && typeof v === 'object') {
    const rec = v as {
      toMillis?: unknown;
      toDate?: unknown;
      seconds?: unknown;
      nanoseconds?: unknown;
    };
    if (typeof rec.toMillis === 'function') {
      return (rec as { toMillis: () => number }).toMillis();
    }
    if (typeof rec.toDate === 'function') {
      const d = (rec as { toDate: () => Date }).toDate();
      return d instanceof Date ? d.getTime() : d;
    }
    if (typeof rec.seconds === 'number') {
      const nanos = typeof rec.nanoseconds === 'number' ? rec.nanoseconds : 0;
      return Math.floor(rec.seconds * 1000 + nanos / 1e6);
    }
  }
  return v;
}

type FieldTransform =
  | { kind: 'serverTimestamp' }
  | { kind: 'arrayRemove'; elements: unknown[] }
  | { kind: 'arrayUnion'; elements: unknown[] }
  | { kind: 'delete' };

function detectFieldTransform(val: unknown): FieldTransform | null {
  if (!val || typeof val !== 'object') {
    return null;
  }
  const rec = val as Record<string, unknown>;
  const method = typeof rec._methodName === 'string' ? rec._methodName : '';
  const ctorName = rec.constructor?.name ?? '';

  if (
    method === 'serverTimestamp' ||
    method.includes('serverTimestamp') ||
    ctorName === 'ServerTimestampTransform'
  ) {
    return { kind: 'serverTimestamp' };
  }
  if (method.includes('arrayRemove') || ctorName === 'ArrayRemoveTransform') {
    return {
      kind: 'arrayRemove',
      elements: Array.isArray(rec.elements) ? rec.elements : [],
    };
  }
  if (method.includes('arrayUnion') || ctorName === 'ArrayUnionTransform') {
    return {
      kind: 'arrayUnion',
      elements: Array.isArray(rec.elements) ? rec.elements : [],
    };
  }
  if (
    method === 'delete' ||
    method.includes('deleteField') ||
    ctorName === 'DeleteTransform'
  ) {
    return { kind: 'delete' };
  }
  return null;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  if (!val || typeof val !== 'object' || Array.isArray(val) || val instanceof Date) {
    return false;
  }
  const proto = Object.getPrototypeOf(val);
  return proto === Object.prototype || proto === null;
}

function normalizeValue(val: unknown): unknown {
  if (val instanceof Date) {
    return makeAdminTimestamp(val);
  }
  if (Array.isArray(val)) {
    return val.map(normalizeValue);
  }
  if (val && typeof val === 'object') {
    const transform = detectFieldTransform(val);
    if (transform?.kind === 'serverTimestamp') {
      return makeAdminTimestamp(new Date());
    }
    const rec = val as Record<string, unknown>;
    if ('toDate' in rec && typeof rec.toDate === 'function') {
      return val;
    }
    if (isPlainObject(val)) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(rec)) {
        const nestedTransform = detectFieldTransform(v);
        if (nestedTransform?.kind === 'delete') {
          continue;
        }
        out[k] = normalizeValue(v);
      }
      return out;
    }
  }
  return val;
}

function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const next = { ...target };
  for (const [k, rawVal] of Object.entries(patch)) {
    const transform = detectFieldTransform(rawVal);
    if (transform?.kind === 'delete') {
      delete next[k];
    } else if (transform?.kind === 'arrayRemove') {
      const toRemove = transform.elements.map(toComparableValue);
      const existingArr = Array.isArray(next[k]) ? (next[k] as unknown[]) : [];
      next[k] = existingArr.filter((item) => !toRemove.includes(toComparableValue(item)));
    } else if (transform?.kind === 'arrayUnion') {
      const existingArr = Array.isArray(next[k]) ? [...(next[k] as unknown[])] : [];
      for (const elem of transform.elements) {
        const normElem = normalizeValue(elem);
        const comp = toComparableValue(normElem);
        if (!existingArr.some((existingItem) => toComparableValue(existingItem) === comp)) {
          existingArr.push(normElem);
        }
      }
      next[k] = existingArr;
    } else if (transform?.kind === 'serverTimestamp') {
      next[k] = makeAdminTimestamp(new Date());
    } else {
      next[k] = normalizeValue(rawVal);
    }
  }
  return next;
}

function getFieldValue(data: Record<string, unknown>, field: string): unknown {
  if (field in data) {
    return data[field];
  }
  if (!field.includes('.')) {
    return undefined;
  }
  let curr: unknown = data;
  for (const part of field.split('.')) {
    if (!curr || typeof curr !== 'object') {
      return undefined;
    }
    curr = (curr as Record<string, unknown>)[part];
  }
  return curr;
}

interface FilterClause {
  field: string;
  op: string;
  value: unknown;
}

interface OrderByClause {
  field: string;
  direction: 'asc' | 'desc';
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
      set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
        if (options?.merge) {
          const existing = col.get(docId) ?? {};
          col.set(docId, applyPatch(existing, data));
        } else {
          this.seed(collectionName, docId, data);
        }
      },
      update: async (patch: Record<string, unknown>) => {
        const existing = col.get(docId) ?? {};
        col.set(docId, applyPatch(existing, patch));
      },
      delete: async () => {
        col.delete(docId);
      },
    };
    return ref;
  }

  private makeQuery(
    collectionName: string,
    filters: FilterClause[],
    orderBys: OrderByClause[] = [],
    limitCount: number | null = null
  ) {
    const evaluateFilter = (data: Record<string, unknown>, { field, op, value }: FilterClause): boolean => {
      const rawActual = getFieldValue(data, field);
      const actual = toComparableValue(rawActual);
      const target = toComparableValue(value);

      if (op === '==') return actual === target;
      if (op === '!=') return actual !== target;
      if (op === 'in' && Array.isArray(value)) {
        return value.map(toComparableValue).includes(actual);
      }
      if (op === 'not-in' && Array.isArray(value)) {
        return !value.map(toComparableValue).includes(actual);
      }
      if (op === '>=' || op === '>' || op === '<=' || op === '<') {
        if (actual === undefined || actual === null || target === undefined || target === null) {
          return false;
        }
        if (typeof actual !== typeof target) {
          return false;
        }
        if (typeof actual !== 'number' && typeof actual !== 'string') {
          return false;
        }
        if (op === '>=') return actual >= (target as number | string);
        if (op === '>') return actual > (target as number | string);
        if (op === '<=') return actual <= (target as number | string);
        return actual < (target as number | string);
      }
      if (op === 'array-contains') {
        return (
          Array.isArray(rawActual) &&
          rawActual.some((item) => toComparableValue(item) === target)
        );
      }
      if (op === 'array-contains-any' && Array.isArray(value)) {
        const targets = value.map(toComparableValue);
        return (
          Array.isArray(rawActual) &&
          rawActual.some((item) => targets.includes(toComparableValue(item)))
        );
      }
      return true;
    };

    const queryObj = {
      where: (field: string, op: string, value: unknown) =>
        this.makeQuery(collectionName, [...filters, { field, op, value }], orderBys, limitCount),
      orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
        this.makeQuery(collectionName, filters, [...orderBys, { field, direction }], limitCount),
      limit: (n: number) =>
        this.makeQuery(collectionName, filters, orderBys, n),
      get: async () => {
        const col = this.ensureCollection(collectionName);
        let matched = Array.from(col.entries()).filter(([, data]) =>
          filters.every((clause) => evaluateFilter(data, clause))
        );

        if (orderBys.length > 0) {
          matched = [...matched].sort(([, aData], [, bData]) => {
            for (const { field, direction } of orderBys) {
              const av = toComparableValue(getFieldValue(aData, field));
              const bv = toComparableValue(getFieldValue(bData, field));
              if (av === bv) continue;
              const mult = direction === 'desc' ? -1 : 1;
              if (av === undefined || av === null) return -1 * mult;
              if (bv === undefined || bv === null) return 1 * mult;
              if (typeof av === 'number' && typeof bv === 'number') {
                return (av < bv ? -1 : 1) * mult;
              }
              return (String(av) < String(bv) ? -1 : 1) * mult;
            }
            return 0;
          });
        }

        if (limitCount !== null && limitCount >= 0) {
          matched = matched.slice(0, limitCount);
        }

        const docs = matched.map(([id, data]) => {
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
    return queryObj;
  }

  public collection(collectionName: string) {
    return {
      doc: (docId: string) => this.makeDocRef(collectionName, docId),
      where: (field: string, op: string, value: unknown) =>
        this.makeQuery(collectionName, [{ field, op, value }]),
      orderBy: (field: string, direction: 'asc' | 'desc' = 'asc') =>
        this.makeQuery(collectionName, [], [{ field, direction }]),
      limit: (n: number) =>
        this.makeQuery(collectionName, [], [], n),
      get: () => this.makeQuery(collectionName, []).get(),
    };
  }

  public batch() {
    const ops: Array<() => Promise<void>> = [];
    return {
      set: (
        ref: { set: (d: Record<string, unknown>, options?: { merge?: boolean }) => Promise<void> },
        data: Record<string, unknown>,
        options?: { merge?: boolean }
      ) => {
        ops.push(() => ref.set(data, options));
      },
      update: (ref: { update: (p: Record<string, unknown>) => Promise<void> }, patch: Record<string, unknown>) => {
        ops.push(() => ref.update(patch));
      },
      delete: (ref: { delete: () => Promise<void> }) => {
        ops.push(() => ref.delete());
      },
      commit: async () => {
        if (ops.length > 500) {
          throw new Error(`Firestore batch write limit exceeded: ${ops.length} operations (max 500)`);
        }
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
