/**
 * Firebase app initialization — Auth, Firestore, FCM.
 * Uses Firebase SDK v10 modular (tree-shaking friendly) imports.
 *
 * Config is read from Vite env variables (VITE_FIREBASE_*).
 * Copy .env.example → .env.local and populate before running locally.
 */

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from 'firebase/firestore';
import { getMessaging, isSupported, type Messaging } from 'firebase/messaging';

const measurementId =
  import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-BPZBXQVGXW';

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    'AIzaSyCMcRRpvdvnfNyebPEBjHH6EyKaCK_7boc',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ||
    'medimate-e27da.firebaseapp.com',
  projectId:
    import.meta.env.VITE_FIREBASE_PROJECT_ID || 'medimate-e27da',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    'medimate-e27da.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '84707647710',
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    '1:84707647710:web:e6e8a1e64ef59b9b87a24f',
  ...(measurementId ? { measurementId } : {}),
};

/** Singleton Firebase app. */
export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);

/** Firebase Auth instance. */
export const auth: Auth = getAuth(firebaseApp);

/**
 * Creates a Firestore instance configured with IndexedDB multi-tab offline
 * persistence, safely falling back to `getFirestore(app)` in environments
 * where persistence cannot be initialized (e.g. Node/Vitest or already initialized).
 */
export function createFirestoreInstance(app: FirebaseApp = firebaseApp): Firestore {
  try {
    return initializeFirestore(app, {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    });
  } catch (err) {
    console.warn('Firestore persistent cache unavailable, falling back to default:', err);
    return getFirestore(app);
  }
}

/** Cloud Firestore instance. */
export const db: Firestore = createFirestoreInstance(firebaseApp);

/**
 * Returns the FCM Messaging instance when the browser supports it,
 * or null in environments that do not (e.g. Safari < 16, non-HTTPS, Node).
 */
export async function getMessagingInstance(): Promise<Messaging | null> {
  const supported = await isSupported();
  if (!supported) return null;
  return getMessaging(firebaseApp);
}

export const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
