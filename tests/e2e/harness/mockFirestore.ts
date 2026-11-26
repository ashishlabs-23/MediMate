export type CollectionName =
  | 'users'
  | 'care_circles'
  | 'care_invites'
  | 'medications'
  | 'dose_logs';

export type UserRole = 'elderly' | 'caregiver' | 'dual';

export interface AuthContext {
  uid: string;
  role: UserRole;
}

export type Unsubscribe = () => void;

export interface FirestoreRecord {
  id?: string;
  uid?: string;
  patientId?: string;
  caregiverIds?: string[];
  snoozeCount?: number;
  status?: string;
  [key: string]: unknown;
}

interface SubscriptionEntry<T extends FirestoreRecord> {
  collection: CollectionName;
  predicate: (doc: T) => boolean;
  callback: (docs: T[]) => void;
  auth: AuthContext | null;
  onError?: (error: Error) => void;
  targetPatientId?: string;
}

function cloneValue<T>(value: T): T {
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = cloneValue(v);
    }
    return out as T;
  }
  return value;
}

export class PermissionDeniedError extends Error {
  public readonly code = 'permission-denied';
  constructor(message: string) {
    super(`PERMISSION_DENIED: ${message}`);
    this.name = 'PermissionDeniedError';
  }
}

const DISALLOWED_FIELDS = new Set([
  'isAdmin',
  'admin',
  'superUser',
  '__proto__',
  'bypassRules',
  'constructor',
  'prototype',
]);

export class MockFirestoreDb {
  private stores: Record<CollectionName, Map<string, FirestoreRecord>> = {
    users: new Map(),
    care_circles: new Map(),
    care_invites: new Map(),
    medications: new Map(),
    dose_logs: new Map(),
  };

  private subscriptions: Set<SubscriptionEntry<FirestoreRecord>> = new Set();

  public clearAll(): void {
    (Object.keys(this.stores) as CollectionName[]).forEach((col) => this.stores[col].clear());
    this.subscriptions.clear();
  }

  /**
   * Admin/seed write bypassing security rules for test fixture setup (silent, no subscriber notifications).
   */
  public seedDoc<T extends FirestoreRecord>(collection: CollectionName, docId: string, data: T): T {
    const cloned = cloneValue(data);
    this.stores[collection].set(docId, cloned);
    return cloneValue(cloned);
  }

  /**
   * Administrative write bypassing client security rules while notifying active snapshot subscribers
   * (models Firebase Admin SDK writes from Cloud Functions such as doseEscalationCheck).
   */
  public adminSetDoc<T extends FirestoreRecord>(collection: CollectionName, docId: string, data: T): T {
    const cloned = cloneValue(data);
    this.stores[collection].set(docId, cloned);
    this.notifySubscribers(collection);
    if (collection === 'care_circles') {
      this.notifySubscribers('dose_logs');
      this.notifySubscribers('medications');
    }
    return cloneValue(cloned);
  }

  /**
   * Administrative partial update bypassing client security rules while notifying active snapshot subscribers.
   */
  public adminUpdateDoc<T extends FirestoreRecord>(
    collection: CollectionName,
    docId: string,
    patch: Partial<T>
  ): T {
    const existing = this.stores[collection].get(docId);
    if (!existing) {
      throw new Error(`NOT_FOUND: ${collection}/${docId} does not exist`);
    }
    const merged = {
      ...cloneValue(existing),
      ...cloneValue(patch),
    } as T;
    return this.adminSetDoc(collection, docId, merged);
  }

  /**
   * Direct read bypassing security rules for verification assertions.
   */
  public inspectDoc<T extends FirestoreRecord>(collection: CollectionName, docId: string): T | null {
    const found = this.stores[collection].get(docId);
    return found ? cloneValue(found as T) : null;
  }

  public inspectCollection<T extends FirestoreRecord>(collection: CollectionName): T[] {
    return Array.from(this.stores[collection].values()).map((d) => cloneValue(d as T));
  }

  private assertAuthenticated(auth: AuthContext | null): asserts auth is AuthContext {
    if (
      !auth ||
      !Object.hasOwn(auth, 'uid') ||
      typeof auth.uid !== 'string' ||
      auth.uid.trim() === ''
    ) {
      throw new PermissionDeniedError('Unauthenticated access is forbidden');
    }
  }

  private assertNoDisallowedFields(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
    if (value === null || typeof value !== 'object' || value instanceof Date) {
      return;
    }
    if (seen.has(value)) {
      return;
    }
    seen.add(value);

    if (Array.isArray(value)) {
      for (const item of value) {
        this.assertNoDisallowedFields(item, seen);
      }
      return;
    }

    const record = value as Record<string, unknown>;
    const ownKeys = new Set([
      ...Object.keys(record),
      ...Object.getOwnPropertyNames(record),
    ]);
    for (const key of ownKeys) {
      if (DISALLOWED_FIELDS.has(key)) {
        throw new PermissionDeniedError(`Disallowed field "${key}" in payload`);
      }
      this.assertNoDisallowedFields(record[key], seen);
    }
  }

  private isCaregiverFor(uid: string, patientId: string): boolean {
    if (!uid || !patientId) {
      return false;
    }
    if (uid === patientId) {
      return true;
    }
    const directCircle = this.stores.care_circles.get(patientId);
    if (
      directCircle &&
      directCircle.patientId === patientId &&
      Array.isArray(directCircle.caregiverIds)
    ) {
      return directCircle.caregiverIds.some((id) => id === uid);
    }
    return false;
  }

  private isPrimaryCaregiverForCircle(circle: FirestoreRecord, uid: string): boolean {
    if (Array.isArray((circle as Record<string, unknown>).primaryCaregiverIds)) {
      const primaries = (circle as Record<string, unknown>).primaryCaregiverIds as unknown[];
      if (primaries.some((id) => id === uid)) {
        return true;
      }
    }
    if (Array.isArray(circle.members)) {
      return circle.members.some(
        (m) =>
          m !== null &&
          typeof m === 'object' &&
          (m as Record<string, unknown>).userId === uid &&
          (m as Record<string, unknown>).role === 'primary' &&
          (m as Record<string, unknown>).status === 'active'
      );
    }
    return false;
  }

  private canReadDoc(
    collection: CollectionName,
    docId: string,
    doc: FirestoreRecord,
    auth: AuthContext | null
  ): boolean {
    if (!auth || !Object.hasOwn(auth, 'uid') || typeof auth.uid !== 'string' || !auth.uid) {
      return false;
    }

    switch (collection) {
      case 'users': {
        const targetUid = typeof doc.uid === 'string' && doc.uid ? doc.uid : docId;
        return targetUid === auth.uid || this.isCaregiverFor(auth.uid, targetUid);
      }
      case 'care_circles': {
        const patientId = typeof doc.patientId === 'string' ? doc.patientId : '';
        const caregivers = Array.isArray(doc.caregiverIds) ? doc.caregiverIds : [];
        return patientId === auth.uid || caregivers.some((id) => id === auth.uid);
      }
      case 'care_invites': {
        return true;
      }
      case 'medications':
      case 'dose_logs': {
        const patientId = typeof doc.patientId === 'string' ? doc.patientId : '';
        if (!patientId) return false;
        return this.isCaregiverFor(auth.uid, patientId);
      }
      default:
        return false;
    }
  }

  public getDoc<T extends FirestoreRecord>(
    collection: CollectionName,
    docId: string,
    auth: AuthContext | null
  ): T | null {
    this.assertAuthenticated(auth);
    const doc = this.stores[collection].get(docId);
    if (!doc) {
      return null;
    }
    if (!this.canReadDoc(collection, docId, doc, auth)) {
      throw new PermissionDeniedError(
        `User "${auth.uid}" is not authorized to read ${collection}/${docId}`
      );
    }
    return cloneValue(doc as T);
  }

  public queryDocs<T extends FirestoreRecord>(
    collection: CollectionName,
    predicate: (doc: T) => boolean,
    auth: AuthContext | null,
    targetPatientId?: string
  ): T[] {
    this.assertAuthenticated(auth);

    if (collection === 'care_invites') {
      throw new PermissionDeniedError('Listing care_invites is forbidden (allow list: if false)');
    }

    if (targetPatientId) {
      if (!this.isCaregiverFor(auth.uid, targetPatientId)) {
        throw new PermissionDeniedError(
          `Unlinked user "${auth.uid}" cannot query ${collection} for patient "${targetPatientId}"`
        );
      }
    }

    const matching: T[] = [];
    for (const [docId, raw] of this.stores[collection].entries()) {
      const typed = raw as T;
      if (!this.canReadDoc(collection, docId, typed, auth)) {
        continue;
      }
      if (predicate(typed)) {
        matching.push(cloneValue(typed));
      }
    }
    return matching;
  }

  public setDoc<T extends FirestoreRecord>(
    collection: CollectionName,
    docId: string,
    data: T,
    auth: AuthContext | null
  ): T {
    this.assertAuthenticated(auth);
    this.assertNoDisallowedFields(data);

    const existing = this.stores[collection].get(docId);

    switch (collection) {
      case 'users': {
        if (auth.uid !== docId) {
          throw new PermissionDeniedError(`User "${auth.uid}" cannot write profile for "${docId}"`);
        }
        if (existing && existing.role && data.role && existing.role !== data.role && existing.role === 'elderly') {
          throw new PermissionDeniedError('Elderly users cannot elevate their own role');
        }
        break;
      }
      case 'care_circles': {
        const patientId = typeof data.patientId === 'string' ? data.patientId : '';
        if (!existing) {
          if (!patientId || docId !== patientId) {
            throw new PermissionDeniedError('care_circles document ID must equal patientId');
          }
          if (patientId !== auth.uid) {
            throw new PermissionDeniedError('Only the patient can create their care circle');
          }
        } else {
          const existingPatientId = typeof existing.patientId === 'string' ? existing.patientId : '';
          const existingCaregivers = Array.isArray(existing.caregiverIds) ? existing.caregiverIds : [];
          const isMemberOrPatient =
            existingPatientId === auth.uid || existingCaregivers.some((id) => id === auth.uid);

          if (!isMemberOrPatient) {
            const redeemedCode =
              typeof data.lastRedeemedInviteCode === 'string' ? data.lastRedeemedInviteCode : '';
            const invite = redeemedCode ? this.stores.care_invites.get(redeemedCode) : undefined;
            const nextCaregivers = Array.isArray(data.caregiverIds) ? data.caregiverIds : [];
            const samePatient = data.patientId === existing.patientId && existingPatientId === docId;
            const sameInviteCode = data.inviteCode === existing.inviteCode;
            const validInvite =
              Boolean(invite) &&
              invite!.active === true &&
              invite!.patientId === docId;
            const preservesExisting = existingCaregivers.every((id) => nextCaregivers.includes(id));
            const exactPlusOne = nextCaregivers.length === existingCaregivers.length + 1;
            const includesSelf = nextCaregivers.includes(auth.uid);
            const allowedSelfJoinKeys = new Set([
              'caregiverIds',
              'members',
              'lastRedeemedInviteCode',
              'updatedAt',
            ]);
            const allKeys = new Set([...Object.keys(existing), ...Object.keys(data)]);
            const onlyAllowedFieldsChanged = Array.from(allKeys).every((key) => {
              if (allowedSelfJoinKeys.has(key)) return true;
              return JSON.stringify(existing[key]) === JSON.stringify(data[key]);
            });

            if (
              !(
                samePatient &&
                sameInviteCode &&
                redeemedCode.length > 0 &&
                validInvite &&
                preservesExisting &&
                exactPlusOne &&
                includesSelf &&
                onlyAllowedFieldsChanged
              )
            ) {
              throw new PermissionDeniedError('Unauthorized care_circles update');
            }
          } else {
            if (patientId && patientId !== existingPatientId) {
              throw new PermissionDeniedError('Cannot reassign care circle patientId');
            }
            if (auth.uid !== existingPatientId) {
              const membershipChanged =
                JSON.stringify(existing.caregiverIds ?? []) !== JSON.stringify(data.caregiverIds ?? []) ||
                JSON.stringify(existing.members ?? []) !== JSON.stringify(data.members ?? []) ||
                JSON.stringify((existing as Record<string, unknown>).primaryCaregiverIds ?? []) !==
                  JSON.stringify((data as Record<string, unknown>).primaryCaregiverIds ?? []);
              if (membershipChanged && !this.isPrimaryCaregiverForCircle(existing, auth.uid)) {
                throw new PermissionDeniedError(
                  'Only the patient or a primary caregiver can modify care circle membership'
                );
              }
            }
          }
        }
        break;
      }
      case 'care_invites': {
        const patientId = typeof data.patientId === 'string' ? data.patientId : '';
        if (!patientId || (patientId !== auth.uid && !this.isCaregiverFor(auth.uid, patientId))) {
          throw new PermissionDeniedError(
            `User "${auth.uid}" cannot write care_invites/${docId} for patient "${patientId}"`
          );
        }
        if (existing) {
          const existingPatientId = typeof existing.patientId === 'string' ? existing.patientId : '';
          if (
            !existingPatientId ||
            (existingPatientId !== auth.uid && !this.isCaregiverFor(auth.uid, existingPatientId)) ||
            patientId !== existingPatientId
          ) {
            throw new PermissionDeniedError(
              `User "${auth.uid}" cannot modify existing care_invites/${docId}`
            );
          }
        }
        break;
      }
      case 'medications':
      case 'dose_logs': {
        const patientId = typeof data.patientId === 'string' ? data.patientId : '';
        if (!patientId || !this.isCaregiverFor(auth.uid, patientId)) {
          throw new PermissionDeniedError(
            `Unlinked user "${auth.uid}" cannot write to ${collection}/${docId}`
          );
        }
        if (existing && existing.patientId && existing.patientId !== patientId) {
          throw new PermissionDeniedError('Cannot reassign patientId on existing record');
        }
        if (collection === 'dose_logs') {
          if (
            existing &&
            existing.status === 'taken' &&
            data.status !== 'taken'
          ) {
            throw new PermissionDeniedError('Cannot revert a taken dose log to another status');
          }
          if (data.snoozeCount !== undefined) {
            if (
              typeof data.snoozeCount !== 'number' ||
              !Number.isInteger(data.snoozeCount) ||
              data.snoozeCount < 0 ||
              data.snoozeCount > 1
            ) {
              throw new PermissionDeniedError('snoozeCount must be an integer between 0 and 1');
            }
          }
          if (existing) {
            const existingSnooze = typeof existing.snoozeCount === 'number' ? existing.snoozeCount : 0;
            const nextSnooze =
              typeof data.snoozeCount === 'number' ? data.snoozeCount : existingSnooze;
            if (nextSnooze < existingSnooze) {
              throw new PermissionDeniedError('snoozeCount is monotonic and cannot be decremented');
            }
          }
        }
        break;
      }
    }

    const cloned = cloneValue(data);
    this.stores[collection].set(docId, cloned);
    this.notifySubscribers(collection);
    if (collection === 'care_circles') {
      this.notifySubscribers('dose_logs');
      this.notifySubscribers('medications');
    }
    return cloneValue(cloned);
  }

  public updateDoc<T extends FirestoreRecord>(
    collection: CollectionName,
    docId: string,
    patch: Partial<T>,
    auth: AuthContext | null
  ): T {
    this.assertAuthenticated(auth);
    this.assertNoDisallowedFields(patch as Record<string, unknown>);

    const existing = this.stores[collection].get(docId);
    if (!existing) {
      throw new Error(`NOT_FOUND: ${collection}/${docId} does not exist`);
    }

    if (
      patch.patientId !== undefined &&
      existing.patientId !== undefined &&
      patch.patientId !== existing.patientId
    ) {
      throw new PermissionDeniedError('Cannot reassign patientId');
    }

    if (collection === 'dose_logs') {
      if (
        existing.status === 'taken' &&
        patch.status !== undefined &&
        patch.status !== 'taken'
      ) {
        throw new PermissionDeniedError('Cannot revert a taken dose log to another status');
      }
      const existingSnooze = typeof existing.snoozeCount === 'number' ? existing.snoozeCount : 0;
      const nextSnoozeCount =
        patch.snoozeCount !== undefined ? patch.snoozeCount : existingSnooze;
      if (
        typeof nextSnoozeCount !== 'number' ||
        !Number.isInteger(nextSnoozeCount) ||
        nextSnoozeCount < 0 ||
        nextSnoozeCount > 1
      ) {
        throw new PermissionDeniedError('snoozeCount cannot exceed 1');
      }
      if (nextSnoozeCount < existingSnooze) {
        throw new PermissionDeniedError('snoozeCount is monotonic and cannot be decremented');
      }
    }

    const merged = {
      ...cloneValue(existing),
      ...cloneValue(patch),
    } as T;

    return this.setDoc(collection, docId, merged, auth);
  }

  public deleteDoc(collection: CollectionName, docId: string, auth: AuthContext | null): void {
    this.assertAuthenticated(auth);

    if (collection === 'users' || collection === 'dose_logs') {
      throw new PermissionDeniedError(`Deletion from ${collection} is forbidden`);
    }

    const existing = this.stores[collection].get(docId);
    if (!existing) {
      throw new Error(`NOT_FOUND: ${collection}/${docId} does not exist`);
    }

    if (collection === 'care_circles') {
      if (existing.patientId !== auth.uid) {
        throw new PermissionDeniedError('Only the patient can delete their care circle');
      }
    } else if (collection === 'care_invites') {
      const patientId = typeof existing.patientId === 'string' ? existing.patientId : '';
      if (!patientId || (patientId !== auth.uid && !this.isCaregiverFor(auth.uid, patientId))) {
        throw new PermissionDeniedError(`User "${auth.uid}" cannot delete care_invites/${docId}`);
      }
    } else if (collection === 'medications') {
      const patientId = typeof existing.patientId === 'string' ? existing.patientId : '';
      if (!this.isCaregiverFor(auth.uid, patientId)) {
        throw new PermissionDeniedError(`User "${auth.uid}" cannot delete medication "${docId}"`);
      }
    }

    this.stores[collection].delete(docId);
    this.notifySubscribers(collection);
  }

  public subscribe<T extends FirestoreRecord>(
    collection: CollectionName,
    predicate: (doc: T) => boolean,
    callback: (docs: T[]) => void,
    auth: AuthContext | null,
    onError?: (error: Error) => void,
    targetPatientId?: string
  ): Unsubscribe {
    const entry: SubscriptionEntry<FirestoreRecord> = {
      collection,
      predicate: predicate as (doc: FirestoreRecord) => boolean,
      callback: callback as (docs: FirestoreRecord[]) => void,
      auth,
      onError,
      targetPatientId,
    };

    try {
      const initial = this.queryDocs<T>(collection, predicate, auth, targetPatientId);
      this.subscriptions.add(entry);
      callback(initial);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      if (onError) {
        onError(error);
      } else {
        throw error;
      }
    }

    return () => {
      this.subscriptions.delete(entry);
    };
  }

  private notifySubscribers(collection: CollectionName): void {
    for (const sub of Array.from(this.subscriptions)) {
      if (sub.collection !== collection) continue;
      try {
        const docs = this.queryDocs(sub.collection, sub.predicate, sub.auth, sub.targetPatientId);
        sub.callback(docs);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        this.subscriptions.delete(sub);
        if (sub.onError) {
          sub.onError(error);
        }
      }
    }
  }
}
