import * as admin from 'firebase-admin';

export interface FirebaseAdminContext {
  app: admin.app.App | null;
  db: admin.firestore.Firestore | null;
  messaging: admin.messaging.Messaging | null;
  isInitialized: boolean;
  error?: string;
}

function isValidServiceAccountObject(value: unknown): value is admin.ServiceAccount {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const hasProjectId =
    (typeof record.project_id === 'string' && record.project_id.trim().length > 0) ||
    (typeof record.projectId === 'string' && record.projectId.trim().length > 0);
  const hasClientEmail =
    (typeof record.client_email === 'string' && record.client_email.trim().length > 0) ||
    (typeof record.clientEmail === 'string' && record.clientEmail.trim().length > 0);
  const hasPrivateKey =
    (typeof record.private_key === 'string' && record.private_key.trim().length > 0) ||
    (typeof record.privateKey === 'string' && record.privateKey.trim().length > 0);

  return hasProjectId && hasClientEmail && hasPrivateKey;
}

/**
 * Initializes the Firebase Admin SDK singleton from FIREBASE_SERVICE_ACCOUNT_JSON
 * or Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS / USE_ADC=true).
 * Gracefully falls back to an uninitialized context when credentials are missing or invalid.
 */
export function initializeFirebaseAdmin(): FirebaseAdminContext {
  if (admin.apps.length > 0 && admin.apps[0]) {
    const existingApp = admin.apps[0];
    return {
      app: existingApp,
      db: admin.firestore(existingApp),
      messaging: admin.messaging(existingApp),
      isInitialized: true,
    };
  }

  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    try {
      const parsed: unknown = JSON.parse(rawJson);
      if (!isValidServiceAccountObject(parsed)) {
        const message =
          'FIREBASE_SERVICE_ACCOUNT_JSON is missing required service account fields';
        console.warn(`[firebaseAdmin] ${message}`);
        return {
          app: null,
          db: null,
          messaging: null,
          isInitialized: false,
          error: message,
        };
      }

      const app = admin.initializeApp({
        credential: admin.credential.cert(parsed),
      });
      return {
        app,
        db: admin.firestore(app),
        messaging: admin.messaging(app),
        isInitialized: true,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? `Failed to initialize Firebase Admin from FIREBASE_SERVICE_ACCOUNT_JSON: ${err.message}`
          : 'Failed to initialize Firebase Admin from FIREBASE_SERVICE_ACCOUNT_JSON';
      console.warn(`[firebaseAdmin] ${errorMessage}`);
      return {
        app: null,
        db: null,
        messaging: null,
        isInitialized: false,
        error: errorMessage,
      };
    }
  }

  const hasAdcFlag =
    Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim()) ||
    process.env.USE_ADC === 'true';

  if (hasAdcFlag) {
    try {
      const app = admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
      return {
        app,
        db: admin.firestore(app),
        messaging: admin.messaging(app),
        isInitialized: true,
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? `Failed to initialize Firebase Admin with Application Default Credentials: ${err.message}`
          : 'Failed to initialize Firebase Admin with Application Default Credentials';
      console.warn(`[firebaseAdmin] ${errorMessage}`);
      return {
        app: null,
        db: null,
        messaging: null,
        isInitialized: false,
        error: errorMessage,
      };
    }
  }

  const missingMessage =
    'No Firebase credentials configured; running in uninitialized fallback mode';
  console.warn(`[firebaseAdmin] ${missingMessage}`);
  return {
    app: null,
    db: null,
    messaging: null,
    isInitialized: false,
    error: missingMessage,
  };
}
