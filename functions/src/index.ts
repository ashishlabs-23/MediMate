/**
 * Cloud Functions entry point — exports all MediMate scheduled functions.
 *
 * Functions are initialized with Firebase Admin SDK singleton.
 */

import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK once (singleton pattern).
if (!admin.apps.length) {
  admin.initializeApp();
}

export { generateDailyDoseLogs } from './generateDailyDoseLogs';
export { checkDueDosesAndEscalate } from './checkDueDosesAndEscalate';
export { closeMissedDoses } from './closeMissedDoses';
