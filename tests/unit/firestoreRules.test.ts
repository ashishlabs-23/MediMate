import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const RULES_PATH = path.resolve(process.cwd(), 'firestore.rules');

function extractMatchBlock(rulesSource: string, matchHeader: string): string {
  const startIdx = rulesSource.indexOf(matchHeader);
  if (startIdx === -1) {
    throw new Error(`Could not find block "${matchHeader}" in firestore.rules`);
  }
  const openBraceIdx = rulesSource.indexOf('{', startIdx + matchHeader.length);
  if (openBraceIdx === -1) {
    throw new Error(`Could not find opening brace for "${matchHeader}"`);
  }
  let depth = 0;
  for (let i = openBraceIdx; i < rulesSource.length; i += 1) {
    const ch = rulesSource[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return rulesSource.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error(`Unclosed brace for "${matchHeader}"`);
}

function extractFunctionBlock(rulesSource: string, fnSignature: string): string {
  const startIdx = rulesSource.indexOf(fnSignature);
  if (startIdx === -1) {
    throw new Error(`Could not find function "${fnSignature}" in firestore.rules`);
  }
  const openBraceIdx = rulesSource.indexOf('{', startIdx);
  let depth = 0;
  for (let i = openBraceIdx; i < rulesSource.length; i += 1) {
    const ch = rulesSource[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return rulesSource.slice(startIdx, i + 1);
      }
    }
  }
  throw new Error(`Unclosed function brace for "${fnSignature}"`);
}

// ============================================================================
// Pure in-memory evaluator mirroring every clause of firestore.rules
// ============================================================================

type CollectionName = 'users' | 'care_invites' | 'care_circles' | 'medications' | 'dose_logs';
type Operation = 'get' | 'list' | 'create' | 'update' | 'delete';
type DocData = Record<string, unknown>;

interface AuthToken {
  uid: string | null;
}

interface PolicyStore {
  users: Record<string, DocData>;
  care_invites: Record<string, DocData>;
  care_circles: Record<string, DocData>;
  medications: Record<string, DocData>;
  dose_logs: Record<string, DocData>;
}

function affectedKeys(next: DocData, prev: DocData): string[] {
  const keys = new Set([...Object.keys(next), ...Object.keys(prev)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(next[key]) !== JSON.stringify(prev[key])) {
      changed.push(key);
    }
  }
  return changed;
}

function evaluateRule(
  store: PolicyStore,
  auth: AuthToken | null,
  collection: CollectionName,
  docId: string,
  op: Operation,
  requestData?: DocData
): boolean {
  const isAuthed = auth !== null && typeof auth.uid === 'string' && auth.uid.length > 0;
  const currentUid = isAuthed ? (auth.uid as string) : '';

  const isSelf = (patientId: unknown): boolean =>
    isAuthed && typeof patientId === 'string' && currentUid === patientId;

  const isCaregiverFor = (patientId: unknown): boolean => {
    if (!isAuthed || typeof patientId !== 'string') return false;
    const circle = store.care_circles[patientId];
    if (!circle || !Array.isArray(circle.caregiverIds)) return false;
    return circle.caregiverIds.includes(currentUid);
  };

  const canAccessPatient = (patientId: unknown): boolean =>
    isSelf(patientId) || isCaregiverFor(patientId);

  const existing = store[collection][docId] ?? null;
  const next = requestData ?? {};

  if (collection === 'users') {
    if (op === 'get' || op === 'list') {
      return isAuthed && (currentUid === docId || isCaregiverFor(docId));
    }
    if (op === 'create') {
      return isAuthed && currentUid === docId && next.uid === docId;
    }
    if (op === 'update') {
      return (
        isAuthed &&
        existing !== null &&
        currentUid === docId &&
        next.uid === docId &&
        !(
          'role' in existing &&
          existing.role === 'elderly' &&
          next.role !== 'elderly'
        )
      );
    }
    return false;
  }

  if (collection === 'care_invites') {
    if (op === 'get') return isAuthed;
    if (op === 'list') return false;
    if (op === 'create') {
      return (
        isAuthed &&
        next.code === docId &&
        typeof next.patientId === 'string' &&
        typeof next.active === 'boolean' &&
        (next.patientId === currentUid || isCaregiverFor(next.patientId))
      );
    }
    if (op === 'update') {
      return (
        isAuthed &&
        existing !== null &&
        next.code === docId &&
        next.patientId === existing.patientId &&
        typeof next.active === 'boolean' &&
        (existing.patientId === currentUid || isCaregiverFor(existing.patientId))
      );
    }
    if (op === 'delete') {
      return (
        isAuthed &&
        existing !== null &&
        (existing.patientId === currentUid || isCaregiverFor(existing.patientId))
      );
    }
    return false;
  }

  if (collection === 'care_circles') {
    if (op === 'get' || op === 'list') {
      return (
        isAuthed &&
        (currentUid === docId ||
          (existing !== null &&
            Array.isArray(existing.caregiverIds) &&
            existing.caregiverIds.includes(currentUid)))
      );
    }
    if (op === 'create') {
      return (
        isAuthed &&
        currentUid === docId &&
        next.patientId === docId &&
        Array.isArray(next.caregiverIds)
      );
    }
    if (op === 'update') {
      if (!isAuthed || existing === null || next.patientId !== existing.patientId) {
        return false;
      }
      const existingCaregivers = Array.isArray(existing.caregiverIds)
        ? existing.caregiverIds
        : null;
      if (currentUid === docId || (existingCaregivers && existingCaregivers.includes(currentUid))) {
        return true;
      }
      // isValidCaregiverSelfJoin(patientId)
      const nextCaregivers = Array.isArray(next.caregiverIds) ? next.caregiverIds : null;
      if (!existingCaregivers || !nextCaregivers) return false;
      if (currentUid === docId) return false;
      if (existingCaregivers.includes(currentUid)) return false;

      const allowedKeys = new Set([
        'caregiverIds',
        'members',
        'lastRedeemedInviteCode',
        'updatedAt',
      ]);
      const changed = affectedKeys(next, existing);
      if (!changed.every((k) => allowedKeys.has(k))) return false;

      if (typeof next.lastRedeemedInviteCode !== 'string') return false;
      const invite = store.care_invites[next.lastRedeemedInviteCode];
      if (!invite || invite.active !== true || invite.patientId !== docId) return false;

      const hasAllOld = existingCaregivers.every((id) => nextCaregivers.includes(id));
      const addedOne = nextCaregivers.length === existingCaregivers.length + 1;
      const addedSelf = nextCaregivers.includes(currentUid);
      return hasAllOld && addedOne && addedSelf;
    }
    if (op === 'delete') {
      return isAuthed && currentUid === docId;
    }
    return false;
  }

  if (collection === 'medications') {
    if (op === 'get' || op === 'list') {
      return isAuthed && existing !== null && canAccessPatient(existing.patientId);
    }
    if (op === 'create') {
      return isAuthed && typeof next.patientId === 'string' && canAccessPatient(next.patientId);
    }
    if (op === 'update') {
      return (
        isAuthed &&
        existing !== null &&
        canAccessPatient(existing.patientId) &&
        next.patientId === existing.patientId
      );
    }
    if (op === 'delete') {
      return isAuthed && existing !== null && canAccessPatient(existing.patientId);
    }
    return false;
  }

  // dose_logs
  if (op === 'get' || op === 'list') {
    return isAuthed && existing !== null && canAccessPatient(existing.patientId);
  }
  if (op === 'create') {
    return (
      isAuthed &&
      typeof next.patientId === 'string' &&
      canAccessPatient(next.patientId) &&
      next.snoozeCount === 0
    );
  }
  if (op === 'update') {
    return (
      isAuthed &&
      existing !== null &&
      canAccessPatient(existing.patientId) &&
      next.patientId === existing.patientId &&
      existing.status !== 'taken' &&
      typeof next.snoozeCount === 'number' &&
      Number.isInteger(next.snoozeCount) &&
      typeof existing.snoozeCount === 'number' &&
      next.snoozeCount >= existing.snoozeCount &&
      next.snoozeCount <= 1
    );
  }
  return false;
}

function createSeededStore(): PolicyStore {
  return {
    users: {
      patient_ramesh: {
        uid: 'patient_ramesh',
        role: 'elderly',
        displayName: 'Ramesh Sharma',
      },
      patient_1: {
        uid: 'patient_1',
        role: 'elderly',
        displayName: 'Asha',
      },
      caregiver_1: {
        uid: 'caregiver_1',
        role: 'caregiver',
        displayName: 'Priya',
      },
      caregiver_2: {
        uid: 'caregiver_2',
        role: 'caregiver',
        displayName: 'Vikram',
      },
      stranger_1: {
        uid: 'stranger_1',
        role: 'dual',
        displayName: 'Stranger',
      },
    },
    care_invites: {
      'MED-123456': {
        code: 'MED-123456',
        patientId: 'patient_1',
        patientName: 'Asha',
        active: true,
      },
      'MED-INACTIVE': {
        code: 'MED-INACTIVE',
        patientId: 'patient_1',
        patientName: 'Asha',
        active: false,
      },
    },
    care_circles: {
      patient_ramesh: {
        id: 'patient_ramesh',
        patientId: 'patient_ramesh',
        patientName: 'Ramesh Sharma',
        caregiverIds: ['caregiver_priya'],
        members: [],
        inviteCode: 'MED-7892',
      },
      patient_1: {
        id: 'patient_1',
        patientId: 'patient_1',
        patientName: 'Asha',
        patientPhone: '+919999999999',
        caregiverIds: ['caregiver_1'],
        members: [{ userId: 'caregiver_1', role: 'primary' }],
        inviteCode: 'MED-123456',
      },
    },
    medications: {
      med_ramesh: {
        id: 'med_ramesh',
        patientId: 'patient_ramesh',
        name: 'Metformin',
      },
      med_1: {
        id: 'med_1',
        patientId: 'patient_1',
        name: 'Amlodipine',
      },
    },
    dose_logs: {
      dose_ramesh: {
        id: 'dose_ramesh',
        patientId: 'patient_ramesh',
        status: 'due',
        snoozeCount: 0,
      },
      dose_due: {
        id: 'dose_due',
        patientId: 'patient_1',
        status: 'due',
        snoozeCount: 0,
      },
      dose_taken: {
        id: 'dose_taken',
        patientId: 'patient_1',
        status: 'taken',
        snoozeCount: 0,
      },
    },
  };
}

describe('firestore.rules — R2 & R6 Security Rules Verification', () => {
  const rulesSource = fs.readFileSync(RULES_PATH, 'utf-8');

  describe('Direct firestore.rules structure & invariant assertions', () => {
    it('removes isDemoPatient and all patient_ramesh hardcoded bypasses', () => {
      expect(rulesSource).not.toContain('isDemoPatient');
      expect(rulesSource).not.toContain('patient_ramesh');
    });

    it('enforces isAuthed(), role escalation lock, and delete=false on /users/{userId}', () => {
      const block = extractMatchBlock(rulesSource, 'match /users/{userId}');
      expect(block).toContain('isAuthed()');
      expect(block).toContain("'role' in resource.data");
      expect(block).toContain("resource.data.role == 'elderly' && request.resource.data.role != 'elderly'");
      expect(block).toContain('allow delete: if false;');
    });

    it('defines /care_invites/{inviteCode} with single-doc get, list=false, and anti-hijack patientId lock', () => {
      const block = extractMatchBlock(rulesSource, 'match /care_invites/{inviteCode}');
      expect(block).toContain('allow get: if isAuthed();');
      expect(block).toContain('allow list: if false;');
      expect(block).toContain('request.resource.data.code == inviteCode');
      expect(block).toContain('request.resource.data.patientId == resource.data.patientId');
      expect(block).toContain('resource.data.patientId == uid() || isCaregiverFor(resource.data.patientId)');
    });

    it('hardens /care_circles/{patientId} with caregiverIds read check and controlled self-join', () => {
      const circleBlock = extractMatchBlock(rulesSource, 'match /care_circles/{patientId}');
      expect(circleBlock).toContain('uid() == patientId || (resource != null && uid() in resource.data.caregiverIds)');
      expect(circleBlock).toContain('request.resource.data.patientId == resource.data.patientId');
      expect(circleBlock).toContain('isValidCaregiverSelfJoin(patientId)');
      expect(circleBlock).toContain('allow delete: if isAuthed() && uid() == patientId;');

      const joinFn = extractFunctionBlock(rulesSource, 'function isValidCaregiverSelfJoin(patientId)');
      expect(joinFn).toContain('!(uid() in resource.data.caregiverIds)');
      expect(joinFn).toContain('affectedKeys().hasOnly(');
      expect(joinFn).toContain("'caregiverIds'");
      expect(joinFn).toContain("'members'");
      expect(joinFn).toContain("'lastRedeemedInviteCode'");
      expect(joinFn).toContain("'updatedAt'");
      expect(joinFn).toContain('exists(/databases/$(database)/documents/care_invites/$(request.resource.data.lastRedeemedInviteCode))');
      expect(joinFn).toContain('.data.active == true');
      expect(joinFn).toContain('.data.patientId == patientId');
      expect(joinFn).toContain('request.resource.data.caregiverIds.hasAll(resource.data.caregiverIds)');
      expect(joinFn).toContain('request.resource.data.caregiverIds.size() == resource.data.caregiverIds.size() + 1');
      expect(joinFn).toContain('uid() in request.resource.data.caregiverIds');
    });

    it('enforces patientId immutability on /medications/{medicationId} and taken-lock + snoozeCount<=1 on /dose_logs/{doseLogId}', () => {
      const medsBlock = extractMatchBlock(rulesSource, 'match /medications/{medicationId}');
      expect(medsBlock).toContain('canAccessPatient(resource.data.patientId)');
      expect(medsBlock).toContain('request.resource.data.patientId == resource.data.patientId');

      const doseBlock = extractMatchBlock(rulesSource, 'match /dose_logs/{doseLogId}');
      expect(doseBlock).toContain('request.resource.data.snoozeCount == 0');
      expect(doseBlock).toContain("resource.data.status != 'taken'");
      expect(doseBlock).toContain('request.resource.data.snoozeCount is int');
      expect(doseBlock).toContain('request.resource.data.snoozeCount >= resource.data.snoozeCount');
      expect(doseBlock).toContain('request.resource.data.snoozeCount <= 1');
      expect(doseBlock).toContain('allow delete: if false;');
    });
  });

  describe('Policy matrix evaluation (R2, R6 & invariants)', () => {
    it('R2: blocks all unauthenticated and arbitrary authenticated access to patient_ramesh', () => {
      const store = createSeededStore();

      // Unauthenticated (null) blocked across all 5 collections
      expect(evaluateRule(store, null, 'users', 'patient_ramesh', 'get')).toBe(false);
      expect(
        evaluateRule(store, null, 'users', 'patient_ramesh', 'update', {
          uid: 'patient_ramesh',
          role: 'elderly',
        })
      ).toBe(false);
      expect(evaluateRule(store, null, 'care_circles', 'patient_ramesh', 'get')).toBe(false);
      expect(
        evaluateRule(store, null, 'care_circles', 'patient_ramesh', 'update', {
          ...store.care_circles.patient_ramesh,
          caregiverIds: ['attacker'],
        })
      ).toBe(false);
      expect(evaluateRule(store, null, 'care_invites', 'MED-123456', 'get')).toBe(false);
      expect(evaluateRule(store, null, 'medications', 'med_ramesh', 'get')).toBe(false);
      expect(
        evaluateRule(store, null, 'medications', 'med_new', 'create', {
          patientId: 'patient_ramesh',
          name: 'Poison',
        })
      ).toBe(false);
      expect(evaluateRule(store, null, 'dose_logs', 'dose_ramesh', 'get')).toBe(false);
      expect(
        evaluateRule(store, null, 'dose_logs', 'dose_ramesh', 'update', {
          ...store.dose_logs.dose_ramesh,
          status: 'taken',
        })
      ).toBe(false);

      // Arbitrary authenticated stranger blocked from reading/writing/deleting patient_ramesh
      const stranger: AuthToken = { uid: 'stranger_1' };
      expect(evaluateRule(store, stranger, 'users', 'patient_ramesh', 'get')).toBe(false);
      expect(evaluateRule(store, stranger, 'care_circles', 'patient_ramesh', 'get')).toBe(false);
      expect(evaluateRule(store, stranger, 'medications', 'med_ramesh', 'get')).toBe(false);
      expect(evaluateRule(store, stranger, 'medications', 'med_ramesh', 'delete')).toBe(false);
      expect(evaluateRule(store, stranger, 'dose_logs', 'dose_ramesh', 'get')).toBe(false);
      expect(
        evaluateRule(store, stranger, 'dose_logs', 'dose_ramesh', 'update', {
          ...store.dose_logs.dose_ramesh,
          status: 'taken',
        })
      ).toBe(false);
    });

    it('R6 care_invites: allows authed get, denies list, prevents invite hijacking', () => {
      const store = createSeededStore();
      const stranger: AuthToken = { uid: 'stranger_1' };
      const patient: AuthToken = { uid: 'patient_1' };
      const caregiver: AuthToken = { uid: 'caregiver_1' };

      expect(evaluateRule(store, stranger, 'care_invites', 'MED-123456', 'get')).toBe(true);
      expect(evaluateRule(store, patient, 'care_invites', 'MED-123456', 'list')).toBe(false);

      // Patient and linked caregiver can create/update/delete their own invite
      expect(
        evaluateRule(store, patient, 'care_invites', 'MED-999999', 'create', {
          code: 'MED-999999',
          patientId: 'patient_1',
          active: true,
        })
      ).toBe(true);
      expect(
        evaluateRule(store, caregiver, 'care_invites', 'MED-123456', 'update', {
          code: 'MED-123456',
          patientId: 'patient_1',
          active: false,
        })
      ).toBe(true);
      expect(evaluateRule(store, caregiver, 'care_invites', 'MED-123456', 'delete')).toBe(true);

      // Unlinked user cannot create invite for someone else or hijack existing invite via update
      expect(
        evaluateRule(store, stranger, 'care_invites', 'MED-888888', 'create', {
          code: 'MED-888888',
          patientId: 'patient_1',
          active: true,
        })
      ).toBe(false);
      expect(
        evaluateRule(store, stranger, 'care_invites', 'MED-123456', 'update', {
          code: 'MED-123456',
          patientId: 'stranger_1',
          active: true,
        })
      ).toBe(false);
    });

    it('R6 care_circles: enforces read privacy and single-UID controlled self-join', () => {
      const store = createSeededStore();
      const patient: AuthToken = { uid: 'patient_1' };
      const linkedCg: AuthToken = { uid: 'caregiver_1' };
      const newCg: AuthToken = { uid: 'caregiver_2' };
      const baseCircle = store.care_circles.patient_1;

      expect(evaluateRule(store, patient, 'care_circles', 'patient_1', 'get')).toBe(true);
      expect(evaluateRule(store, linkedCg, 'care_circles', 'patient_1', 'get')).toBe(true);
      expect(evaluateRule(store, newCg, 'care_circles', 'patient_1', 'get')).toBe(false);

      // Valid self-join with active invite touching only allowed keys
      expect(
        evaluateRule(store, newCg, 'care_circles', 'patient_1', 'update', {
          ...baseCircle,
          caregiverIds: ['caregiver_1', 'caregiver_2'],
          members: [...(baseCircle.members as unknown[]), { userId: 'caregiver_2', role: 'secondary' }],
          lastRedeemedInviteCode: 'MED-123456',
          updatedAt: 12345,
        })
      ).toBe(true);

      // Inactive or nonexistent invite denied
      expect(
        evaluateRule(store, newCg, 'care_circles', 'patient_1', 'update', {
          ...baseCircle,
          caregiverIds: ['caregiver_1', 'caregiver_2'],
          lastRedeemedInviteCode: 'MED-INACTIVE',
          updatedAt: 12345,
        })
      ).toBe(false);
      expect(
        evaluateRule(store, newCg, 'care_circles', 'patient_1', 'update', {
          ...baseCircle,
          caregiverIds: ['caregiver_1', 'caregiver_2'],
          lastRedeemedInviteCode: 'MED-MISSING',
          updatedAt: 12345,
        })
      ).toBe(false);

      // Adding 2 UIDs, removing existing caregiver, or tampering with patientName/inviteCode denied
      expect(
        evaluateRule(store, newCg, 'care_circles', 'patient_1', 'update', {
          ...baseCircle,
          caregiverIds: ['caregiver_1', 'caregiver_2', 'stranger_1'],
          lastRedeemedInviteCode: 'MED-123456',
        })
      ).toBe(false);
      expect(
        evaluateRule(store, newCg, 'care_circles', 'patient_1', 'update', {
          ...baseCircle,
          caregiverIds: ['caregiver_2'],
          lastRedeemedInviteCode: 'MED-123456',
        })
      ).toBe(false);
      expect(
        evaluateRule(store, newCg, 'care_circles', 'patient_1', 'update', {
          ...baseCircle,
          patientName: 'Hacked Name',
          caregiverIds: ['caregiver_1', 'caregiver_2'],
          lastRedeemedInviteCode: 'MED-123456',
        })
      ).toBe(false);
    });

    it('preserves elderly role lock, taken-lock, snoozeCount<=1, patientId immutability, and delete locks', () => {
      const store = createSeededStore();
      const patient: AuthToken = { uid: 'patient_1' };

      // Elderly role cannot promote to caregiver/dual
      expect(
        evaluateRule(store, patient, 'users', 'patient_1', 'update', {
          uid: 'patient_1',
          role: 'caregiver',
        })
      ).toBe(false);
      expect(evaluateRule(store, patient, 'users', 'patient_1', 'delete')).toBe(false);

      // dose_logs invariants
      expect(
        evaluateRule(store, patient, 'dose_logs', 'dose_new', 'create', {
          patientId: 'patient_1',
          snoozeCount: 1,
        })
      ).toBe(false);
      expect(
        evaluateRule(store, patient, 'dose_logs', 'dose_due', 'update', {
          ...store.dose_logs.dose_due,
          snoozeCount: 2,
        })
      ).toBe(false);
      expect(
        evaluateRule(store, patient, 'dose_logs', 'dose_taken', 'update', {
          ...store.dose_logs.dose_taken,
          status: 'due',
        })
      ).toBe(false);
      // Taken-lock also prevents mutating takenAt/snoozeCount while keeping status == 'taken'
      expect(
        evaluateRule(store, patient, 'dose_logs', 'dose_taken', 'update', {
          ...store.dose_logs.dose_taken,
          status: 'taken',
          takenBy: 'spoofed',
        })
      ).toBe(false);
      expect(
        evaluateRule(store, patient, 'dose_logs', 'dose_due', 'update', {
          ...store.dose_logs.dose_due,
          patientId: 'patient_ramesh',
        })
      ).toBe(false);
      expect(evaluateRule(store, patient, 'dose_logs', 'dose_due', 'delete')).toBe(false);
    });
  });
});
