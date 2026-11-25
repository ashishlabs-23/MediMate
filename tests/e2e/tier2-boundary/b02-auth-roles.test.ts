import { describe, expect, it } from 'vitest';
import {
  createUserProfile,
  MockFirestoreDb,
  PermissionDeniedError,
  UserDocument,
} from '../harness';

describe('Tier 2 (Boundary) — F02: Multi-Role Authentication Profiles', () => {
  it('T2-F02-01: Empty and Whitespace-Only Payload Rejection', () => {
    expect(() =>
      createUserProfile({
        uid: '',
        email: 'valid@medimate.test',
        displayName: 'Ramesh',
        role: 'elderly',
      })
    ).toThrow(/Invalid uid/);

    expect(() =>
      createUserProfile({
        uid: '   ',
        email: 'valid@medimate.test',
        displayName: 'Ramesh',
        role: 'elderly',
      })
    ).toThrow(/Invalid uid/);

    expect(() =>
      createUserProfile({
        uid: 'user_1',
        email: 'valid@medimate.test',
        displayName: '   \t\n ',
        role: 'elderly',
      })
    ).toThrow(/Invalid displayName/);

    const malformedEmails = ['', '   ', 'notanemail', 'user@', '@domain.com', 'user@domain', 'a b@c.com'];
    for (const email of malformedEmails) {
      expect(() =>
        createUserProfile({
          uid: 'user_1',
          email,
          displayName: 'Ramesh Sharma',
          role: 'elderly',
        })
      ).toThrow(/Invalid email/);
    }
  });

  it('T2-F02-02: Maximum Length String Boundaries', () => {
    const db = new MockFirestoreDb();
    const maxName = 'A'.repeat(256);
    const overMaxName = 'A'.repeat(257);

    const validProfile = createUserProfile({
      uid: 'user_maxlen',
      email: 'maxlen@medimate.test',
      displayName: maxName,
      role: 'elderly',
    });

    expect(validProfile.displayName).toHaveLength(256);
    db.setDoc('users', validProfile.uid, validProfile, { uid: validProfile.uid, role: 'elderly' });
    const stored = db.getDoc<UserDocument>('users', validProfile.uid, {
      uid: validProfile.uid,
      role: 'elderly',
    });
    expect(stored?.displayName).toBe(maxName);

    expect(() =>
      createUserProfile({
        uid: 'user_overlen',
        email: 'overlen@medimate.test',
        displayName: overMaxName,
        role: 'elderly',
      })
    ).toThrow(/exceeds 256 characters/);
  });

  it('T2-F02-03: Unauthorized Privilege Escalation Mutation', () => {
    const db = new MockFirestoreDb();
    const elderly = createUserProfile({
      uid: 'user_elderly',
      email: 'elderly@medimate.test',
      displayName: 'Ramesh',
      role: 'elderly',
    });
    const otherUser = createUserProfile({
      uid: 'user_other',
      email: 'other@medimate.test',
      displayName: 'Priya',
      role: 'caregiver',
    });

    const elderlyAuth = { uid: elderly.uid, role: 'elderly' as const };
    db.setDoc('users', elderly.uid, elderly, elderlyAuth);
    db.seedDoc('users', otherUser.uid, otherUser);

    expect(() =>
      db.updateDoc('users', elderly.uid, { role: 'caregiver' }, elderlyAuth)
    ).toThrow(PermissionDeniedError);

    expect(() =>
      db.updateDoc('users', elderly.uid, { role: 'dual' }, elderlyAuth)
    ).toThrow(PermissionDeniedError);

    expect(() =>
      db.updateDoc('users', otherUser.uid, { displayName: 'Tampered' }, elderlyAuth)
    ).toThrow(PermissionDeniedError);
  });

  it('T2-F02-04: Missing Accessibility Preferences Defaults', () => {
    const profileNoPrefs = createUserProfile({
      uid: 'user_default_prefs',
      email: 'defaults@medimate.test',
      displayName: 'Ramesh Sharma',
      role: 'elderly',
    });

    expect(profileNoPrefs.accessibilityPreferences).toEqual({
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    });
    expect(profileNoPrefs.timezone).toBe('UTC');

    const profilePartialPrefs = createUserProfile({
      uid: 'user_partial_prefs',
      email: 'partial@medimate.test',
      displayName: 'Nirmala Devi',
      role: 'dual',
      accessibilityPreferences: { highContrast: true },
    });

    expect(profilePartialPrefs.accessibilityPreferences).toEqual({
      highContrast: true,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    });
  });

  it('T2-F02-05: Concurrent Duplicate Registration Conflict', async () => {
    const db = new MockFirestoreDb();
    const uid = 'user_concurrent';
    const auth = { uid, role: 'elderly' as const };
    const profile = createUserProfile({
      uid,
      email: 'concurrent@medimate.test',
      displayName: 'Ramesh Sharma',
      role: 'elderly',
    });

    await Promise.all([
      Promise.resolve().then(() => db.setDoc('users', uid, profile, auth)),
      Promise.resolve().then(() => db.setDoc('users', uid, profile, auth)),
      Promise.resolve().then(() => db.setDoc('users', uid, profile, auth)),
    ]);

    const storedAll = db.inspectCollection<UserDocument>('users').filter((u) => u.uid === uid);
    expect(storedAll).toHaveLength(1);
    expect(storedAll[0].email).toBe('concurrent@medimate.test');
    expect(storedAll[0].role).toBe('elderly');
  });
});
