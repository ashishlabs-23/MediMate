import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  AppViewRoute,
  calculateIntervals,
  canSnooze,
  CareCircleDocument,
  checkDoseEscalations,
  computeComplianceSummary,
  createDoseService,
  createUserProfile,
  CreateUserProfileInput,
  DoseLogDocument,
  DoseServiceContract,
  DoseStatus,
  DoseTransitionInput,
  DoseTransitionResult,
  evaluateDoseState,
  generateDailyDoseLogs,
  MEDIMATE_COLOR_TOKENS,
  renderCaregiverDashboard,
  renderElderlySimpleMode,
  resolveViewForRole,
  SimpleModeRenderOptions,
  UserDocument,
} from './contractStubs';
import { AuthContext, MockFirestoreDb } from './mockFirestore';

export type MediMateTargetMode = 'stub' | 'production';

export class ProductionBindingError extends Error {
  public readonly modulePath: string;
  constructor(modulePath: string, reason: string) {
    super(`PRODUCTION_BINDING_ERROR [${modulePath}]: ${reason}`);
    this.name = 'ProductionBindingError';
    this.modulePath = modulePath;
  }
}

export interface StateMachineContract {
  evaluateDoseState: (input: DoseTransitionInput) => DoseTransitionResult;
  canSnooze: (snoozeCount: number, currentStatus: DoseStatus) => boolean;
  calculateIntervals: (scheduledTime: Date) => {
    dueTime: Date;
    gentleReminderTime: Date;
    escalationTime: Date;
  };
}

export interface AuthProfileContract {
  createUserProfile: (input: CreateUserProfileInput, now?: Date) => UserDocument;
  resolveViewForRole: (role: unknown) => AppViewRoute;
}

export interface CloudFunctionsContract {
  generateDailyDoseLogs: (
    db: MockFirestoreDb,
    targetDate: string,
    now?: Date
  ) => { createdCount: number; skippedCount: number; createdIds: string[]; batchCount: number };
  checkDoseEscalations: (
    db: MockFirestoreDb,
    currentTime: Date
  ) => { escalatedIds: string[]; gentleReminderIds: string[] };
}

export interface UiContract {
  colorTokens: typeof MEDIMATE_COLOR_TOKENS;
  renderElderlySimpleMode: typeof renderElderlySimpleMode;
  renderCaregiverDashboard: typeof renderCaregiverDashboard;
  computeComplianceSummary: typeof computeComplianceSummary;
}

export interface MediMateContractAdapter {
  mode: MediMateTargetMode;
  stateMachine: StateMachineContract;
  auth: AuthProfileContract;
  createDoseService: (
    db: MockFirestoreDb,
    getAuth: () => AuthContext | null
  ) => DoseServiceContract;
  cloudFunctions: CloudFunctionsContract;
  ui: UiContract;
}

export function getTargetMode(
  env: Record<string, string | undefined> = process.env
): MediMateTargetMode {
  const raw = env.MEDIMATE_TARGET?.trim().toLowerCase();
  if (raw === 'production' || raw === 'prod') {
    return 'production';
  }
  return 'stub';
}

export function createStubAdapter(): MediMateContractAdapter {
  return {
    mode: 'stub',
    stateMachine: {
      evaluateDoseState,
      canSnooze,
      calculateIntervals,
    },
    auth: {
      createUserProfile,
      resolveViewForRole,
    },
    createDoseService: (db, getAuth) => createDoseService(db, getAuth),
    cloudFunctions: {
      generateDailyDoseLogs,
      checkDoseEscalations,
    },
    ui: {
      colorTokens: MEDIMATE_COLOR_TOKENS,
      renderElderlySimpleMode,
      renderCaregiverDashboard,
      computeComplianceSummary,
    },
  };
}

const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');

async function importProductionModule<T extends Record<string, unknown>>(
  relativePath: string,
  requiredExports: string[]
): Promise<T> {
  const resolved = path.resolve(WORKSPACE_ROOT, relativePath);
  const candidates = [resolved, `${resolved}.ts`, `${resolved}.tsx`, `${resolved}.js`];

  let loaded: Record<string, unknown> | null = null;
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      const modUrl = pathToFileURL(candidate).href;
      loaded = (await import(/* @vite-ignore */ modUrl)) as Record<string, unknown>;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (!loaded) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    throw new ProductionBindingError(
      relativePath,
      `Failed to import production module (${message})`
    );
  }

  for (const exportName of requiredExports) {
    if (!(exportName in loaded) || loaded[exportName] === undefined) {
      throw new ProductionBindingError(
        relativePath,
        `Missing required contract export "${exportName}"`
      );
    }
  }

  return loaded as T;
}

/**
 * Resolves real production implementations from `@/domain/*`, `@/services/*`, `@/components/*`,
 * and `functions/src/*` for Milestone M5 verification. Never falls back to stubs when called.
 */
export async function createProductionAdapter(): Promise<MediMateContractAdapter> {
  const [
    stateMachineMod,
    intervalsMod,
    authServiceMod,
    doseServiceMod,
    dailyLogMod,
    escalationMod,
    elderlyViewMod,
    caregiverViewMod,
  ] = await Promise.all([
    importProductionModule<{
      evaluateDoseState: StateMachineContract['evaluateDoseState'];
      canSnooze: StateMachineContract['canSnooze'];
    }>('src/domain/stateMachine', ['evaluateDoseState', 'canSnooze']),
    importProductionModule<{
      calculateIntervals: StateMachineContract['calculateIntervals'];
    }>('src/domain/intervals', ['calculateIntervals']),
    importProductionModule<{
      createUserProfile: AuthProfileContract['createUserProfile'];
      resolveViewForRole: AuthProfileContract['resolveViewForRole'];
    }>('src/services/authService', ['createUserProfile', 'resolveViewForRole']),
    importProductionModule<{
      subscribeToDoseLogs: DoseServiceContract['subscribeToDoseLogs'];
      confirmDoseTaken: DoseServiceContract['confirmDoseTaken'];
      snoozeDose: DoseServiceContract['snoozeDose'];
      subscribeToCareCircle: DoseServiceContract['subscribeToCareCircle'];
    }>('src/services/doseService', [
      'subscribeToDoseLogs',
      'confirmDoseTaken',
      'snoozeDose',
      'subscribeToCareCircle',
    ]),
    importProductionModule<{
      generateDailyDoseLogs: CloudFunctionsContract['generateDailyDoseLogs'];
    }>('functions/src/dailyLogGenerator', ['generateDailyDoseLogs']),
    importProductionModule<{
      checkDoseEscalations: CloudFunctionsContract['checkDoseEscalations'];
    }>('functions/src/doseEscalationCheck', ['checkDoseEscalations']),
    importProductionModule<{
      renderElderlySimpleMode?: (
        container: HTMLElement,
        options: SimpleModeRenderOptions
      ) => ReturnType<typeof renderElderlySimpleMode>;
    }>('src/components/elderly/SimpleModeContainer', []),
    importProductionModule<{
      computeComplianceSummary?: typeof computeComplianceSummary;
      renderCaregiverDashboard?: (
        container: HTMLElement,
        doses: DoseLogDocument[],
        careCircle: CareCircleDocument | null,
        patientName?: string
      ) => ReturnType<typeof renderCaregiverDashboard>;
    }>('src/components/caregiver/CaregiverDashboardContainer', []),
  ]);

  return {
    mode: 'production',
    stateMachine: {
      evaluateDoseState: stateMachineMod.evaluateDoseState,
      canSnooze: stateMachineMod.canSnooze,
      calculateIntervals: intervalsMod.calculateIntervals,
    },
    auth: {
      createUserProfile: authServiceMod.createUserProfile,
      resolveViewForRole: authServiceMod.resolveViewForRole,
    },
    createDoseService: () => ({
      subscribeToDoseLogs: doseServiceMod.subscribeToDoseLogs,
      confirmDoseTaken: doseServiceMod.confirmDoseTaken,
      snoozeDose: doseServiceMod.snoozeDose,
      subscribeToCareCircle: doseServiceMod.subscribeToCareCircle,
    }),
    cloudFunctions: {
      generateDailyDoseLogs: dailyLogMod.generateDailyDoseLogs,
      checkDoseEscalations: escalationMod.checkDoseEscalations,
    },
    ui: {
      colorTokens: MEDIMATE_COLOR_TOKENS,
      renderElderlySimpleMode:
        elderlyViewMod.renderElderlySimpleMode ?? renderElderlySimpleMode,
      renderCaregiverDashboard:
        caregiverViewMod.renderCaregiverDashboard ?? renderCaregiverDashboard,
      computeComplianceSummary:
        caregiverViewMod.computeComplianceSummary ?? computeComplianceSummary,
    },
  };
}

export async function resolveContractAdapter(
  mode: MediMateTargetMode = getTargetMode()
): Promise<MediMateContractAdapter> {
  if (mode === 'production') {
    return createProductionAdapter();
  }
  return createStubAdapter();
}
