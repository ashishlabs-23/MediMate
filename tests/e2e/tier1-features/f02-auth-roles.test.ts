import { describe, expect, it } from 'vitest';
import {
  createCareCircleFixture,
  createUserProfile,
  MockFirestoreDb,
  resolveViewForRole,
} from '../harness';

describe('Tier 1 — F02: Multi-Role Authentication Profiles', () => {
  it('T1-F02-01: Elderly Profile Creation & Schema Validation', () => {
    const db = new MockFirestoreDb();
    const profile = createUserProfile({
      uid: 'user_elderly_1',
      email: 'ramesh@medimate.test',
      displayName: 'Ramesh Sharma',
      role: 'elderly',
      timezone: 'Asia/Kolkata',
    });

    db.setDoc('users', profile.uid, profile, { uid: profile.uid, role: 'elderly' });
    const stored = db.getDoc('users', profile.uid, { uid: profile.uid, role: 'elderly' });

    expect(stored).not.toBeNull();
    expect(stored?.uid).toBe('user_elderly_1');
    expect(stored?.email).toBe('ramesh@medimate.test');
    expect(stored?.displayName).toBe('Ramesh Sharma');
    expect(stored?.role).toBe('elderly');
    expect(stored?.timezone).toBe('Asia/Kolkata');
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored?.accessibilityPreferences).toEqual({
      highContrast: false,
      largeText: true,
      hapticFeedback: true,
      soundEnabled: true,
    });
  });

  it('T1-F02-02: Caregiver Profile Creation & Schema Validation', () => {
    const db = new MockFirestoreDb();
    const caregiver = createUserProfile({
      uid: 'user_cg_1',
      email: 'priya@medimate.test',
      displayName: 'Priya Sharma',
      role: 'caregiver',
      timezone: 'Asia/Kolkata',
    });
    db.setDoc('users', caregiver.uid, caregiver, { uid: caregiver.uid, role: 'caregiver' });

    const circle = createCareCircleFixture({
      id: 'user_elderly_1',
      patientId: 'user_elderly_1',
      caregiverIds: [caregiver.uid],
      members: [
        {
          userId: caregiver.uid,
          displayName: caregiver.displayName,
          email: caregiver.email,
          role: 'primary',
          permissions: ['read', 'write_schedule', 'receive_alerts'],
          status: 'active',
          invitedAt: new Date(),
          joinedAt: new Date(),
        },
      ],
    });
    db.setDoc('care_circles', circle.id, circle, { uid: 'user_elderly_1', role: 'elderly' });

    const storedCircle = db.getDoc('care_circles', circle.id, { uid: caregiver.uid, role: 'caregiver' });
    expect(storedCircle?.caregiverIds).toContain(caregiver.uid);
    expect(caregiver.role).toBe('caregiver');
  });

  it('T1-F02-03: Dual Role Profile Creation', () => {
    const dualProfile = createUserProfile({
      uid: 'user_dual_1',
      email: 'nirmala@medimate.test',
      displayName: 'Nirmala Devi',
      role: 'dual',
      timezone: 'Asia/Kolkata',
    });

    expect(dualProfile.role).toBe('dual');
    expect(resolveViewForRole(dualProfile.role)).toBe('DualViewSwitcher');
  });

  it('T1-F02-04: Invalid Role Rejection', () => {
    const invalidRoles: unknown[] = ['admin', 'doctor', '', null, undefined, 123];
    for (const badRole of invalidRoles) {
      expect(() =>
        createUserProfile({
          uid: 'user_bad',
          email: 'bad@medimate.test',
          displayName: 'Bad Role',
          role: badRole,
        })
      ).toThrow(/Invalid role/);
    }
  });

  it('T1-F02-05: Role-Based View Route Resolver', () => {
    expect(resolveViewForRole('elderly')).toBe('ElderlySimpleView');
    expect(resolveViewForRole('caregiver')).toBe('CaregiverDashboardView');
    expect(resolveViewForRole('dual')).toBe('DualViewSwitcher');
    expect(() => resolveViewForRole('guest')).toThrow();
  });
});
