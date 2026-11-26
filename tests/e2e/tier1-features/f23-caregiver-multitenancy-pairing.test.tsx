import fs from 'node:fs';
import path from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  MockFirestoreDb,
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

const hasM4CareCircleService = hasProjectFile('src/lib/careCircleService.ts');
const caregiverDashboardSrc = hasProjectFile('src/pages/CaregiverDashboard.tsx')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/pages/CaregiverDashboard.tsx'), 'utf-8')
  : '';
const generateTodaySrc = hasProjectFile('src/lib/generateTodayLogs.ts')
  ? fs.readFileSync(path.resolve(PROJECT_ROOT, 'src/lib/generateTodayLogs.ts'), 'utf-8')
  : '';
const hasM4MultiTenancy =
  hasM4CareCircleService &&
  !caregiverDashboardSrc.includes("'9876543210'") &&
  caregiverDashboardSrc.includes('careCircleService');
const hasM4OnboardingNoHardcode =
  hasM4CareCircleService && !generateTodaySrc.includes("inviteCode: 'MED-7892'");

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

describe('Tier 1 — F23: Caregiver Multi-Tenancy & Invite-Code Pairing (R6-UI/Service)', () => {
  beforeEach(() => {
    mockDb.clearAll();
    currentActor = { uid: 'caregiver_vikram', role: 'caregiver' };
    inviteCareCircleMemberSpy.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.runIf(hasM4MultiTenancy)(
    'T1-F23-01: Authenticated caregiver linked to 2 real patients switches between them dynamically without touching patient_ramesh',
    async () => {
      const today = localTodayISO();
      const cg = createUserFixture({ uid: 'caregiver_vikram', role: 'caregiver', displayName: 'Vikram' });
      const asha = createUserFixture({ uid: 'patient_asha', role: 'elderly', displayName: 'Asha Devi' });
      const mohan = createUserFixture({ uid: 'patient_mohan', role: 'elderly', displayName: 'Mohan Lal' });
      mockDb.seedDoc('users', cg.uid, cg);
      mockDb.seedDoc('users', asha.uid, asha);
      mockDb.seedDoc('users', mohan.uid, mohan);

      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          patientPhone: '+919111111111',
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
          patientPhone: '+919222222222',
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
          dosage: '50 mcg',
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
          dosage: '2 mg',
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

      render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      expect(await screen.findByText(/Levothyroxine/i)).toBeInTheDocument();
      expect(screen.queryByText(/Ramesh Sharma/i)).toBeNull();

      const switcher = screen.getByRole('combobox', { name: /select patient|monitoring/i });
      fireEvent.change(switcher, { target: { value: 'patient_mohan' } });

      expect(await screen.findByText(/Glimepiride/i)).toBeInTheDocument();
    }
  );

  it.runIf(hasM4MultiTenancy)(
    'T1-F23-02: CaregiverDashboard uses real careCircle.patientPhone for call link and omits tel: when missing',
    async () => {
      const today = localTodayISO();
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          patientPhone: '+919988776655',
          caregiverIds: ['caregiver_vikram'],
          inviteCode: 'MED-ASHA01',
        })
      );
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha_urg',
        createDoseLogFixture({
          id: 'dose_asha_urg',
          patientId: 'patient_asha',
          medicationName: 'Levothyroxine',
          dosage: '50 mcg',
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

      const { unmount } = render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      const callLink = await screen.findByRole('link', { name: /call asha/i });
      expect(callLink).toHaveAttribute('href', 'tel:+919988776655');
      unmount();

      // Now remove patientPhone
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

      render(
        <MemoryRouter>
          <AuthProvider value={authVal}>
            <CaregiverDashboard />
          </AuthProvider>
        </MemoryRouter>
      );

      await screen.findByText(/Levothyroxine/i);
      expect(screen.queryByRole('link', { name: /call asha/i })).toBeNull();
    }
  );

  it.runIf(hasM4MultiTenancy)(
    'T1-F23-03: Caregiver with 0 linked patients sees invite-code pairing prompt and pairs end-to-end with MED-XXXXXX code',
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
          inviteCode: 'MED-PAIR99',
        })
      );
      mockDb.seedDoc('care_invites', 'MED-PAIR99', {
        id: 'MED-PAIR99',
        code: 'MED-PAIR99',
        patientId: 'patient_asha',
        patientName: 'Asha Devi',
        createdBy: 'patient_asha',
        active: true,
      });
      mockDb.seedDoc(
        'dose_logs',
        'dose_asha_paired',
        createDoseLogFixture({
          id: 'dose_asha_paired',
          patientId: 'patient_asha',
          medicationName: 'Insulin Glargine',
          dosage: '10 units',
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

      expect(screen.queryByText(/Ramesh Sharma/i)).toBeNull();
      const codeInput = await screen.findByLabelText(/invite code/i);
      fireEvent.change(codeInput, { target: { value: 'MED-PAIR99' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /connect|join|pair/i }));
      });

      expect(await screen.findByText(/Insulin Glargine/i)).toBeInTheDocument();
    }
  );

  it.runIf(hasM4OnboardingNoHardcode)(
    'T1-F23-04: Real patient onboarding generates unique MED-XXXXXX inviteCode (not MED-7892) with caregiverIds: [] and syncs /care_invites',
    async () => {
      const code = bridge.generateInviteCode();
      expect(code).toMatch(/^MED-[A-Z0-9]{6}$/);
      expect(code).not.toBe('MED-7892');

      const svc = await loadOptionalModule<{
        generateInviteCode?: () => string;
      }>('src/lib/careCircleService.ts');
      if (typeof svc.generateInviteCode === 'function') {
        const realCode = svc.generateInviteCode();
        expect(realCode).toMatch(/^MED-[A-Z0-9]{6}$/);
        expect(realCode).not.toBe('MED-7892');
      }
      expect(generateTodaySrc).not.toContain("caregiverIds: ['caregiver_priya']");
      expect(generateTodaySrc).not.toContain("inviteCode: 'MED-7892'");
    }
  );

  it.runIf(hasM4MultiTenancy)(
    'T1-F23-05: Paired caregiver invites secondary caregiver via CareCircleInviteModal using dynamic patient inviteCode (never MED-7892)',
    async () => {
      mockDb.seedDoc(
        'care_circles',
        'patient_asha',
        createCareCircleFixture({
          id: 'patient_asha',
          patientId: 'patient_asha',
          patientName: 'Asha Devi',
          caregiverIds: ['caregiver_vikram'],
          members: [
            {
              userId: 'caregiver_vikram',
              displayName: 'Vikram',
              email: 'vikram@medimate.test',
              role: 'primary',
              permissions: ['read', 'write_schedule', 'receive_alerts'],
              status: 'active',
              invitedAt: new Date(),
              joinedAt: new Date(),
            },
          ],
          inviteCode: 'MED-DYN554',
        })
      );
      mockDb.seedDoc(
        'medications',
        'med_asha_1',
        createMedicationFixture({ id: 'med_asha_1', patientId: 'patient_asha' })
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

      await waitFor(() => {
        expect(screen.getByText(/Asha Devi/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /invite another family member|invite/i }));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(/MED-DYN554/)).toBeInTheDocument();
      expect(within(dialog).queryByText(/MED-7892/)).toBeNull();
    }
  );
});
