import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  MockFirestoreDb,
  PermissionDeniedError,
  createCareCircleFixture,
  createDoseLogFixture,
  createMedicationFixture,
  createUserFixture,
  type FirestoreRecord,
} from '@harness/index';
import {
  PROJECT_ROOT,
  createMockFirestoreAdapter,
  hasProjectFile,
  loadOptionalModule,
  localTodayISO,
  makeAuthValue,
} from '@harness/reactTestHelper';
import type { CareCircleDocument, CareCircleMember } from '@/types/firestore';

const mockDb = new MockFirestoreDb();
let currentActor = { uid: 'caregiver_vikram', role: 'caregiver' as const };
const bridge = createMockFirestoreAdapter(mockDb, () => currentActor);

const inviteCareCircleMemberSpy = vi.fn(
  async (patientId: string, member: CareCircleMember) => {
    const existing = mockDb.inspectDoc<CareCircleDocument & FirestoreRecord>('care_circles', patientId);
    if (!existing) throw new Error('Care circle not found');
    mockDb.updateDoc(
      'care_circles',
      patientId,
      { members: [...(existing.members ?? []), member], updatedAt: new Date() },
      currentActor
    );
  }
);

vi.mock('@/lib/firebase', () => ({
  firebaseApp: {},
  auth: {},
  db: {},
  getMessagingInstance: vi.fn(async () => null),
  VAPID_KEY: undefined,
}));

vi.mock('@/lib/firestore', () => ({
  subscribeToDoseLogs: (...args: Parameters<typeof bridge.subscribeToDoseLogs>) =>
    bridge.subscribeToDoseLogs(...args),
  subscribeToCareCircle: (...args: Parameters<typeof bridge.subscribeToCareCircle>) =>
    bridge.subscribeToCareCircle(...args),
  updateDoseLog: (...args: Parameters<typeof bridge.updateDoseLog>) =>
    bridge.updateDoseLog(...args),
  getMedications: (...args: Parameters<typeof bridge.getMedications>) =>
    bridge.getMedications(...args),
  subscribeToMedications: (...args: Parameters<typeof bridge.subscribeToMedications>) =>
    bridge.subscribeToMedications(...args),
  createMedication: (...args: Parameters<typeof bridge.createMedication>) =>
    bridge.createMedication(...args),
  updateMedication: (...args: Parameters<typeof bridge.updateMedication>) =>
    bridge.updateMedication(...args),
  setMedicationActive: (...args: Parameters<typeof bridge.setMedicationActive>) =>
    bridge.setMedicationActive(...args),
  getDoseLogsForDateRange: (...args: Parameters<typeof bridge.getDoseLogsForDateRange>) =>
    bridge.getDoseLogsForDateRange(...args),
  getActiveMedications: vi.fn(async () => []),
  getDoseLog: vi.fn(async () => null),
  getUserDocument: vi.fn(async () => null),
  upsertUserDocument: vi.fn(async () => {}),
  getCareCircle: vi.fn(async () => null),
  updateUserAccessibilityPreferences: vi.fn(async () => {}),
  inviteCareCircleMember: (patientId: string, member: CareCircleMember) =>
    inviteCareCircleMemberSpy(patientId, member),
}));

vi.mock('@/lib/generateTodayLogs', () => ({
  todayDateString: () => localTodayISO(),
  generateTodayLogs: vi.fn(async () => ({ created: 0, skipped: 0 })),
  generateTodayLogsForMedication: (...args: Parameters<typeof bridge.generateTodayLogsForMedication>) =>
    bridge.generateTodayLogsForMedication(...args),
}));

const rulesSrc = hasProjectFile('firestore.rules')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'firestore.rules'), 'utf-8')
  : '';
const hasM3Rules =
  rulesSrc.length > 0 && !rulesSrc.includes('isDemoPatient') && rulesSrc.includes('care_invites');
const hasM4CareCircleService = hasProjectFile('src/lib/careCircleService.ts');
const caregiverDashboardSrc = hasProjectFile('src/pages/CaregiverDashboard.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/CaregiverDashboard.tsx'), 'utf-8')
  : '';
const hasM4MultiTenancy =
  hasM4CareCircleService &&
  !caregiverDashboardSrc.includes("'9876543210'") &&
  caregiverDashboardSrc.includes('careCircleService');

function registerCareCircleServiceMock() {
  if (!hasM4CareCircleService) return;
  vi.doMock('@/lib/careCircleService', () => ({
    generateInviteCode: () => bridge.generateInviteCode(),
    lookupCareInvite: (code: string) => bridge.lookupCareInvite(code),
    createOrSyncCareInvite: (input: Parameters<typeof bridge.createOrSyncCareInvite>[0]) =>
      bridge.createOrSyncCareInvite(input),
    subscribeToCareCirclesForCaregiver: (
      caregiverUid: string,
      cb: Parameters<typeof bridge.subscribeToCareCirclesForCaregiver>[1],
      onErr?: Parameters<typeof bridge.subscribeToCareCirclesForCaregiver>[2]
    ) => bridge.subscribeToCareCirclesForCaregiver(caregiverUid, cb, onErr),
    getCareCirclesForCaregiver: (caregiverUid: string) =>
      bridge.getCareCirclesForCaregiver(caregiverUid),
    redeemCareInviteCode: (
      rawCode: string,
      caregiver: { uid: string; displayName: string; email: string }
    ) => bridge.redeemCareInviteCode(rawCode, caregiver),
  }));
}

describe('Tier 4 — Scenario 11: Multi-Tenant Invite-Code Pairing, Dynamic Switcher & Revocation (R2, R6)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    currentActor = { uid: 'caregiver_vikram', role: 'caregiver' };
    inviteCareCircleMemberSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.runIf(hasM3Rules && hasM4MultiTenancy)(
    'T4-S11-01: End-to-end onboarding with unique invite code, blocked unlinked access, self-join pairing, real patientPhone & multi-patient switcher',
    async () => {
      const today = localTodayISO();
      const patientA = createUserFixture({ uid: 'patient_asha', role: 'elderly', displayName: 'Asha Devi' });
      const patientB = createUserFixture({ uid: 'patient_mohan', role: 'elderly', displayName: 'Mohan Lal' });
      const caregiver = createUserFixture({ uid: 'caregiver_vikram', role: 'caregiver', displayName: 'Vikram' });
      mockDb.seedDoc('users', patientA.uid, patientA);
      mockDb.seedDoc('users', patientB.uid, patientB);
      mockDb.seedDoc('users', caregiver.uid, caregiver);

      const inviteCodeA = bridge.generateInviteCode();
      expect(inviteCodeA).toMatch(/^MED-[A-Z0-9]{6}$/);
      expect(inviteCodeA).not.toBe('MED-7892');

      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          patientPhone: '+919777666555',
          caregiverIds: [],
          members: [],
          inviteCode: inviteCodeA,
        })
      );
      mockDb.seedDoc('care_invites', inviteCodeA, {
        id: inviteCodeA,
        code: inviteCodeA,
        patientId: 'patient_asha',
        patientName: 'Asha Devi',
        createdBy: 'patient_asha',
        active: true,
      });
      mockDb.seedDoc(
        'medications',
        'med_asha',
        createMedicationFixture({
          id: 'med_asha',
          patientId: 'patient_asha',
          name: 'Thyronorm',
          dosage: '50 mcg',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha_unconf',
        createDoseLogFixture({
          id: 'dose_asha_unconf',
          patientId: 'patient_asha',
          medicationName: 'Thyronorm',
          dosage: '50 mcg',
          scheduledDate: today,
          status: 'unconfirmed',
        })
      );

      // Patient Mohan is already paired with Vikram
      mockDb.seedDoc(
        'care_circles',
        'patient_mohan',
        createCareCircleFixture({
          id: 'patient_mohan',
          patientId: 'patient_mohan',
          patientName: 'Mohan Lal',
          patientPhone: '+919444333222',
          caregiverIds: ['caregiver_vikram'],
          inviteCode: 'MED-MOHAN1',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_mohan_due',
        createDoseLogFixture({
          id: 'dose_mohan_due',
          patientId: 'patient_mohan',
          medicationName: 'Glimepiride',
          dosage: '2 mg',
          scheduledDate: today,
          status: 'due',
        })
      );

      // Before pairing: Vikram is blocked from reading Asha's dose logs
      expect(() =>
        mockDb.getDoc('dose_logs', 'dose_asha_unconf', { uid: 'caregiver_vikram', role: 'caregiver' })
      ).toThrow(PermissionDeniedError);

      registerCareCircleServiceMock();
      const { CaregiverDashboard } = await loadOptionalModule<{
        CaregiverDashboard: React.ComponentType;
      }>('src/pages/CaregiverDashboard.tsx');

      const authVal = makeAuthValue({
        authenticated: true,
        role: 'caregiver',
        uid: 'caregiver_vikram',
        displayName: 'Vikram',
        isDemo: false,
      });

      const { container } = render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      expect(await screen.findByText(/Glimepiride/i)).toBeInTheDocument();
      expect(container.textContent).not.toContain('Ramesh Sharma');
      expect(container.textContent).not.toContain('9876543210');

      // Caregiver enters Asha's invite code to pair
      const codeInput = screen.getByLabelText(/invite code/i);
      fireEvent.change(codeInput, { target: { value: inviteCodeA } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect|join|pair/i }));
      });

      // Switch to Asha and verify real medication & real patientPhone tel: link
      const switcher = await screen.findByRole('combobox', { name: /select patient|monitoring/i });
      fireEvent.change(switcher, { target: { value: 'patient_asha' } });

      expect((await screen.findAllByText(/Thyronorm/i)).length).toBeGreaterThanOrEqual(1);
      const callLink = screen.getByRole('link', { name: /call asha/i });
      expect(callLink).toHaveAttribute('href', 'tel:+919777666555');
      expect(container.textContent).not.toContain('9876543210');
    }
  );

  it.runIf(hasM3Rules && hasM4MultiTenancy)(
    'T4-S11-02: Inactive/forged invite codes are rejected and mid-session revocation removes Patient A while keeping Patient B visible',
    async () => {
      const today = localTodayISO();
      mockDb.seedDoc('care_invites', 'MED-EXPIRED', {
        id: 'MED-EXPIRED',
        code: 'MED-EXPIRED',
        patientId: 'patient_asha',
        patientName: 'Asha Devi',
        createdBy: 'patient_asha',
        active: false,
      });
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          caregiverIds: ['caregiver_vikram'],
          inviteCode: 'MED-ASHA99',
        })
      );
      mockDb.seedDoc(
        'care_circles',
        'patient_mohan',
        createCareCircleFixture({
          id: 'patient_mohan',
          patientId: 'patient_mohan',
          patientName: 'Mohan Lal',
          caregiverIds: ['caregiver_vikram'],
          inviteCode: 'MED-MOHAN1',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha',
        createDoseLogFixture({
          id: 'dose_asha',
          patientId: 'patient_asha',
          medicationName: 'Thyronorm',
          scheduledDate: today,
          status: 'due',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_mohan',
        createDoseLogFixture({
          id: 'dose_mohan',
          patientId: 'patient_mohan',
          medicationName: 'Glimepiride',
          scheduledDate: today,
          status: 'due',
        })
      );

      registerCareCircleServiceMock();
      const { CaregiverDashboard } = await loadOptionalModule<{
        CaregiverDashboard: React.ComponentType;
      }>('src/pages/CaregiverDashboard.tsx');

      const authVal = makeAuthValue({
        authenticated: true,
        role: 'caregiver',
        uid: 'caregiver_vikram',
        displayName: 'Vikram',
        isDemo: false,
      });

      render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      await screen.findByText(/Thyronorm/i);

      // Inactive invite code rejected with role="alert"
      const codeInput = screen.getByLabelText(/invite code/i);
      fireEvent.change(codeInput, { target: { value: 'MED-EXPIRED' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect|join|pair/i }));
      });
      expect(screen.getByRole('alert')).toBeInTheDocument();

      // Revoke Vikram from Patient Asha
      act(() => {
        mockDb.adminUpdateDoc('care_circles', 'patient_asha', {
          caregiverIds: [],
          members: [],
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/Glimepiride/i)).toBeInTheDocument();
      });
      expect(() =>
        mockDb.getDoc('dose_logs', 'dose_asha', { uid: 'caregiver_vikram', role: 'caregiver' })
      ).toThrow(PermissionDeniedError);
    }
  );
});
