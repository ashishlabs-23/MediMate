import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  MockFirestoreDb,
  createCareCircleFixture,
  createDoseLogFixture,
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

describe('Tier 2 — B23: Caregiver Multi-Tenancy & Invite-Code Pairing Boundaries (R6)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    currentActor = { uid: 'caregiver_vikram', role: 'caregiver' };
    inviteCareCircleMemberSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.runIf(hasM4MultiTenancy)(
    'T2-B23-01: Invite-code redemption normalizes lowercase/whitespace input and rejects empty, malformed, missing, or inactive codes with role="alert"',
    async () => {
      const today = localTodayISO();
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          caregiverIds: [],
          members: [],
          inviteCode: 'MED-AB12CD',
        })
      );
      mockDb.seedDoc('care_invites', 'MED-AB12CD', {
        id: 'MED-AB12CD',
        code: 'MED-AB12CD',
        patientId: 'patient_asha',
        patientName: 'Asha Devi',
        createdBy: 'patient_asha',
        active: true,
      });
      mockDb.seedDoc('care_invites', 'MED-DEAD99', {
        id: 'MED-DEAD99',
        code: 'MED-DEAD99',
        patientId: 'patient_asha',
        patientName: 'Asha Devi',
        createdBy: 'patient_asha',
        active: false,
      });
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha_norm',
        createDoseLogFixture({
          id: 'dose_asha_norm',
          patientId: 'patient_asha',
          medicationName: 'Metformin',
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

      const codeInput = await screen.findByLabelText(/invite code/i);
      const joinBtn = screen.getByRole('button', { name: /connect|join|pair/i });

      for (const badCode of ['', '   ', 'BAD', 'MED-NOTFND', 'MED-DEAD99']) {
        fireEvent.change(codeInput, { target: { value: badCode } });
        await act(async () => {
          fireEvent.click(joinBtn);
        });
        expect(screen.getByRole('alert')).toBeInTheDocument();
      }

      // Valid code with whitespace and lowercase should normalize and succeed
      fireEvent.change(codeInput, { target: { value: '  med-ab12cd  ' } });
      await act(async () => {
        fireEvent.click(joinBtn);
      });

      expect(await screen.findByText(/Metformin/i)).toBeInTheDocument();
    }
  );

  it.runIf(hasM4MultiTenancy)(
    'T2-B23-02: Patient redeeming own code and already-linked caregiver re-redeeming do not corrupt caregiverIds',
    async () => {
      const asha = createUserFixture({ uid: 'patient_asha', role: 'elderly', displayName: 'Asha Devi' });
      mockDb.seedDoc('users', asha.uid, asha);
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          caregiverIds: ['caregiver_vikram'],
          inviteCode: 'MED-SELF11',
        })
      );
      mockDb.seedDoc('care_invites', 'MED-SELF11', {
        id: 'MED-SELF11',
        code: 'MED-SELF11',
        patientId: 'patient_asha',
        patientName: 'Asha Devi',
        createdBy: 'patient_asha',
        active: true,
      });

      // Self-redemption rejected cleanly
      currentActor = { uid: 'patient_asha', role: 'elderly' as unknown as 'caregiver' };
      await expect(
        bridge.redeemCareInviteCode('MED-SELF11', {
          uid: 'patient_asha',
          displayName: 'Asha Devi',
          email: 'asha@medimate.test',
        })
      ).rejects.toThrow(/own/i);

      // Re-redemption by already-linked caregiver is idempotent (no duplicate entry)
      currentActor = { uid: 'caregiver_vikram', role: 'caregiver' };
      const circle = await bridge.redeemCareInviteCode('MED-SELF11', {
        uid: 'caregiver_vikram',
        displayName: 'Vikram',
        email: 'vikram@medimate.test',
      });
      expect(circle.caregiverIds).toEqual(['caregiver_vikram']);
    }
  );

  it.runIf(hasM4MultiTenancy)(
    'T2-B23-03: Mid-session revocation of Patient A leaves CaregiverDashboard functional for remaining Patient B',
    async () => {
      const today = localTodayISO();
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          caregiverIds: ['caregiver_vikram'],
          inviteCode: 'MED-ASHA01',
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
          inviteCode: 'MED-MOHAN2',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha',
        createDoseLogFixture({
          id: 'dose_asha',
          patientId: 'patient_asha',
          medicationName: 'Levothyroxine',
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

      expect(await screen.findByText(/Levothyroxine/i)).toBeInTheDocument();

      // Patient Asha removes caregiver_vikram mid-session
      act(() => {
        mockDb.adminUpdateDoc('care_circles', 'patient_asha', {
          caregiverIds: [],
          members: [],
        });
      });

      await waitFor(() => {
        expect(screen.getByText(/Glimepiride/i)).toBeInTheDocument();
      });
    }
  );

  it.runIf(hasM4CareCircleService)(
    'T2-B23-04: careCircleService invite code generator emits valid MED-XXXXXX codes and never returns static MED-7892',
    async () => {
      const svc = await loadOptionalModule<{
        generateInviteCode: () => string;
      }>('src/lib/careCircleService.ts');

      const generated = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const code = svc.generateInviteCode();
        expect(code).toMatch(/^MED-[A-Z0-9]{6}$/);
        expect(code).not.toBe('MED-7892');
        generated.add(code);
      }
      expect(generated.size).toBeGreaterThan(10);
    }
  );

  it.runIf(hasM4MultiTenancy)(
    'T2-B23-05: CaregiverDashboard with missing patientPhone never renders hardcoded 9876543210 anywhere in the DOM',
    async () => {
      const today = localTodayISO();
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          caregiverIds: ['caregiver_vikram'],
          inviteCode: 'MED-ASHA01',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha_unconf',
        createDoseLogFixture({
          id: 'dose_asha_unconf',
          patientId: 'patient_asha',
          medicationName: 'Levothyroxine',
          scheduledDate: today,
          status: 'unconfirmed',
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

      const { container } = render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      await screen.findAllByText(/Levothyroxine/i);
      expect(container.textContent).not.toContain('9876543210');
      expect(container.innerHTML).not.toContain('9876543210');
    }
  );
});
