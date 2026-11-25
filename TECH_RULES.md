# Technical Rules and Technology Stack
# MediMate — Smart Medication Reminder System for Older Adults

**Document Status:** Approved Technical Source of Truth  
**Target Environment:** Firebase Serverless Cloud & Progressive Web App (PWA)  
**Firebase Project ID:** `medimate-e27da` (Project Number: `84707647710`)  
**Date:** 2026-11-24  

---

## 1. Architecture Summary

### 1.1 Application Type
Responsive, installable Progressive Web Application (PWA) delivering two dedicated interfaces:
1. **Elderly "Simple Mode":** High-contrast, large-touch-target interface (WCAG 2.2 AA compliant, minimum $44\times 44\text{px}$ touch targets) featuring the next scheduled/due dose, single-tap "Taken" confirmation, and single-tap 10-minute snooze.
2. **Caregiver Dashboard:** Real-time dose timeline driven by Cloud Firestore snapshot listeners (`onSnapshot`), today's compliance summary badges, care circle management, and immediate unconfirmed dose alert banners.

### 1.2 Architecture Model
Serverless reactive cloud architecture with strict layer separation:
- **Presentation Layer (`src/components/`, `src/views/`):** React 18+ components built with Tailwind CSS and Lucide React icons, strictly decoupled from database persistence.
- **Domain Logic Layer (`src/domain/`):** Pure TypeScript deterministic state machine and timing interval calculation engine with zero external dependencies and 100% unit test coverage.
- **Service & Data Layer (`src/services/`, `src/config/`):** Firebase SDK client wrappers managing Authentication, Firestore document operations, real-time snapshot listeners, and offline IndexedDB persistence.
- **Cloud Backend Layer (`functions/`):** Node.js 20+ Firebase Cloud Functions for scheduled cron daily dose log generation and periodic dose escalation evaluations.
- **Security & Authorization Layer (`firestore.rules`):** Declarative server-side security rules enforcing patient-caregiver isolation via care circle memberships.

### 1.3 High-Level Data Flow
```text
[Elderly / Caregiver Client]
       │
       ▼ (User Action: Tap "Taken" or "Snooze")
[Domain State Machine] ───(Pure Function Transition Verification)
       │
       ▼ (State Validated)
[Firestore Client SDK]
       │
       ├───► [Local IndexedDB Cache] (Immediate Optimistic UI Update)
       │
       ▼ (Network Transport via TLS 1.3)
[Cloud Firestore Engine]
       │
       ├───► [Firestore Security Rules] (Verify patientId / caregiverIds membership)
       │
       ▼ (Committed Write)
[Firestore Snapshot Listeners (onSnapshot)]
       │
       ▼ (Real-Time Push <= 2.0s)
[Caregiver Dashboard DOM] (Timeline Badge & Alert Banner Update)
```

---

## 2. Approved Technology Stack

| Layer | Technology | Version / Constraint | Rationale & Justification |
|---|---|---|---|
| **Frontend Framework** | React | `^18.3.1` (or `^19.0.0`) | Mature component ecosystem, declarative UI, robust integration with Vite and PWA service workers. |
| **Language & Typings** | TypeScript | `^5.6.0` (Strict Mode) | Strong compile-time contract enforcement, eliminates runtime null/undefined bugs, interfaces shared between client and functions. |
| **Build & Dev Tooling** | Vite | `^6.0.0` or `^5.4.0` | Sub-second Hot Module Replacement (HMR), optimized tree-shaking, fast production bundling. |
| **Styling & Design Tokens** | Tailwind CSS | `^3.4.0` | Utility-first CSS ensuring strict adherence to WCAG 2.2 AA contrast ratios, fluid touch target sizing, and responsive breakpoints. |
| **Icons & Visual Markers** | Lucide React | `^0.450.0` | Accessible, tree-shakeable SVG icons for pill shapes, compliance badges, and status alerts. |
| **PWA & Offline Worker** | Vite Plugin PWA (`vite-plugin-pwa`) | `^0.20.0` | Zero-config service worker generation, offline caching of static assets, Web App Manifest generation. |
| **Authentication** | Firebase Authentication | SDK `^10.14.0` | Managed user identity, session management, secure multi-role profile linking (`elderly`, `caregiver`, `dual`). |
| **Cloud Database** | Cloud Firestore | Native Mode | Real-time multi-client synchronization via `onSnapshot`, built-in offline persistence, sub-second latency, document-level security rules. |
| **Serverless Functions** | Firebase Cloud Functions (v2) | Node.js 20+ Runtime | Managed serverless compute for scheduled background jobs (daily log generation, escalation checks) without running continuous servers. |
| **Hosting & CDN** | Firebase Hosting | Production CDN | Global CDN hosting with automated SSL/TLS certificates and integration with Firebase CLI deployments. |
| **Unit & Integration Testing** | Vitest | `^2.1.0` | Native Vite integration, instant test runner execution, full compatibility with Jest matchers. |
| **Security Rules Testing** | `@firebase/rules-unit-testing` | `^3.0.0` | Automated offline verification of Firestore security rules using the Firebase Local Emulator Suite. |
| **Accessibility Testing** | `axe-core` / `@axe-core/react` | `^4.10.0` | Automated accessibility linting and component auditing against WCAG 2.2 AA standards. |
| **Code Quality & Linting** | ESLint + TypeScript ESLint | `^9.0.0` / Flat Config | Strict linting rules prohibiting `any`, enforcing hook dependencies and code hygiene. |

### 2.1 Explicit Architectural Deprecations & Forbidden Technologies
1. **REJECTED: Express.js / Node.js Custom REST Server:** The obsolete proposal in preliminary academic drafts referencing an Express server is permanently rejected. MediMate exclusively leverages Firebase serverless cloud architecture (Firestore + Cloud Functions).
2. **REJECTED: Relational Databases (MySQL / PostgreSQL):** Custom relational schemas and migrations are forbidden. All data persistence resides in Cloud Firestore.
3. **REJECTED: Paid Third-Party SMS Gateways:** External SMS aggregators (e.g., 2Factor, MSG91) are excluded from the MVP release per stakeholder decision Q11-A. Notifications rely entirely on Web Push (FCM), in-app alerts, and real-time Firestore synchronization.

---

## 3. Repository Structure

```text
g:\My Drive\Projects\MediMate/
├── .firebaserc                     # Firebase project alias (medimate-e27da)
├── firebase.json                   # Firebase services, Hosting, Firestore, and Emulators config
├── firestore.rules                 # Strict Firestore security rules
├── firestore.indexes.json          # Firestore composite query indexes
├── package.json                    # Workspace scripts, dependencies, devDependencies
├── tsconfig.json                   # Root TypeScript compiler configuration
├── tsconfig.app.json               # Frontend React TypeScript configuration
├── tsconfig.node.json              # Tooling and Vite configuration
├── vite.config.ts                  # Vite build, PWA manifest, and Vitest configuration
├── tailwind.config.js              # Theme tokens (high-contrast colors, touch target utilities)
├── postcss.config.js               # PostCSS plugins (Tailwind, Autoprefixer)
├── .gitignore                      # Git exclusion rules (node_modules, dist, .firebase, etc.)
├── PRD.md                          # Synchronized Product Requirements Document
├── TECH_RULES.md                   # Synchronized Technical Rules (this document)
├── DESIGN.md                       # Synchronized Visual Design & Accessibility Specifications
├── todo.md                         # Synchronized Implementation Roadmap & Checklist
├── functions/                      # Firebase Cloud Functions (Node.js 20+)
│   ├── package.json                # Cloud Functions dependencies (firebase-admin, firebase-functions)
│   ├── tsconfig.json               # Functions TypeScript compiler configuration
│   └── src/
│       ├── index.ts                # Cloud Functions export entry point
│       ├── dailyLogGenerator.ts    # Scheduled hourly cron (0 * * * *) filtering local midnight (00:00-00:59)
│       └── doseEscalationCheck.ts  # Scheduled dose check, T+15m follow-up, T+30m escalation & EOD missed (*/5 * * * *)
├── src/
│   ├── main.tsx                    # React application entry point
│   ├── App.tsx                     # Top-level routing, role detection, and layout switcher
│   ├── index.css                   # Global styles, Tailwind directives, WCAG focus rings
│   ├── types/                      # Domain interfaces and Firestore document contracts
│   │   ├── user.ts                 # UserDocument, Role ('elderly' | 'caregiver' | 'dual')
│   │   ├── careCircle.ts           # CareCircleDocument, CareCircleMember
│   │   ├── medication.ts           # MedicationDocument, MedicationSchedule
│   │   └── dose.ts                 # DoseLogDocument, DoseStatus, DoseTransition contracts
│   ├── config/
│   │   └── firebase.ts             # Firebase SDK client initialization (Auth, Firestore, Messaging)
│   ├── domain/
│   │   ├── stateMachine.ts         # Pure TypeScript deterministic 6-state dose machine
│   │   └── intervals.ts            # Timing interval calculations (T, T+10m, T+15m, T+30m)
│   ├── services/
│   │   ├── authService.ts          # Auth state observer, login, registration, role switcher
│   │   ├── doseService.ts          # Firestore operations (subscribeToDoseLogs, confirmDoseTaken, snoozeDose)
│   │   └── careCircleService.ts    # Care circle queries (subscribeToCareCircle), invitations, member management
│   ├── hooks/
│   │   ├── useAuth.ts              # React hook for current user and role profile
│   │   ├── useRealtimeDoses.ts     # onSnapshot hook for patient's daily dose logs
│   │   └── useCareCircle.ts        # onSnapshot hook for active care circle members
│   ├── components/
│   │   ├── common/                 # Accessible button (>=44px), status badge, header, modal
│   │   │   ├── AccessibleButton.tsx
│   │   │   ├── StatusBadge.tsx
│   │   │   └── AlertBanner.tsx
│   │   ├── elderly/                # Simple Mode components
│   │   │   ├── NextDoseCard.tsx    # Prominent pill card with visual marker & instructions
│   │   │   ├── TakenButton.tsx     # Large (height >= 64px) green confirmation button
│   │   │   └── SnoozeButton.tsx    # 10-minute snooze button (disabled after 1 use)
│   │   └── caregiver/              # Caregiver Dashboard components
│   │       ├── DoseTimeline.tsx    # Real-time chronological dose event list
│   │       ├── ComplianceStats.tsx # Summary badges (Scheduled, Taken, Pending, Unconfirmed)
│   │       ├── EscalationAlert.tsx # Persistent high-visibility unconfirmed dose banner
│   │       └── CircleManager.tsx   # Member listing, invite form, permission controls
│   └── views/
│       ├── ElderlySimpleView.tsx   # Ultra-accessible Simple Mode interface for older adults
│       ├── CaregiverDashboardView.tsx # Multi-metric monitoring dashboard for caregivers
│       └── LoginView.tsx           # Authentication view with role profile selector
└── tests/
    ├── unit/
    │   ├── stateMachine.test.ts    # Vitest suite: 6-state dose machine transitions
    │   └── intervals.test.ts       # Vitest suite: 10m snooze, 15m gentle reminder, 30m escalation
    ├── rules/
    │   └── firestore.rules.test.ts # Security rules tests via Firebase Local Emulator
    └── e2e/                        # Automated end-to-end integration tests
```

---

## 4. Coding Standards & Architectural Layering

### 4.1 Strict Separation of Concerns
1. **Domain Layer (`src/domain/`):** Must be 100% pure TypeScript. Importing React, DOM APIs, or Firebase SDK modules inside `src/domain/` is strictly prohibited. All functions must take inputs and return outputs deterministically.
2. **Service Layer (`src/services/`):** Encapsulates all Firestore and Auth I/O. UI components must never call Firestore primitives (`doc`, `getDoc`, `setDoc`, `updateDoc`) directly; they must call service functions or custom hooks.
3. **Presentation Layer (`src/components/`, `src/views/`):** Pure presentation. Components receive data via props or custom hooks and emit user intent via callbacks.

### 4.2 TypeScript Strictness
- `tsconfig.json` must enforce:
  ```json
  {
    "compilerOptions": {
      "strict": true,
      "noImplicitAny": true,
      "strictNullChecks": true,
      "noUnusedLocals": true,
      "noUnusedParameters": true,
      "exactOptionalPropertyTypes": true,
      "noImplicitReturns": true,
      "noFallthroughCasesInSwitch": true
    }
  }
  ```
- The use of `any` is strictly prohibited. Use explicit type annotations, generics, or `unknown` with runtime type guards.

### 4.3 Error Handling & Idempotency
- Never silently catch exceptions (`catch (e) {}`). All errors must be handled, logged with context (excluding PHI), and presented to the user via accessible alert feedback.
- Network updates (e.g., confirming a dose) must be idempotent. If a user taps "Taken" twice, the second write must not corrupt the record or create duplicate audit entries.

---

## 5. Data Schemas & Contracts (TypeScript Definitions)

> **Timestamp Contract:** Client TypeScript models in `src/types/` MUST import `Timestamp` from `'firebase/firestore'` (Web SDK). Cloud Functions under `functions/src/` use `firebase-admin/firestore` `Timestamp`.

### 5.1 Users Collection: `users/{userId}`
```typescript
import type { Timestamp } from 'firebase/firestore';

export type UserRole = 'elderly' | 'caregiver' | 'dual';

export interface AccessibilityPreferences {
  highContrast: boolean;
  largeText: boolean;
  hapticFeedback: boolean;
  soundEnabled: boolean;
}

export interface UserDocument {
  uid: string;                                // Matches Firebase Auth UID (request.auth.uid)
  email: string;
  displayName: string;
  role: UserRole;
  phoneNumber?: string;
  timezone: string;                           // IANA timezone identifier (e.g., "Asia/Kolkata", "America/New_York")
  fcmTokens: string[];                        // Registered Web Push device tokens
  accessibilityPreferences: AccessibilityPreferences;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 5.2 Care Circles Collection: `care_circles/{circleId}`
```typescript
import type { Timestamp } from 'firebase/firestore';

export type CaregiverCircleRole = 'primary' | 'secondary';
export type MemberPermission = 'read' | 'write_schedule' | 'receive_alerts';
export type MemberStatus = 'active' | 'invited' | 'declined';

export interface CareCircleMember {
  userId: string;                             // Caregiver UID
  displayName: string;
  email: string;
  role: CaregiverCircleRole;
  permissions: MemberPermission[];
  status: MemberStatus;
  invitedAt: Timestamp;
  joinedAt?: Timestamp;
}

export interface CareCircleDocument {
  id: string;                                 // Document ID MUST equal patientId
  patientId: string;                          // UID of elderly/dual user (immutable)
  patientName: string;
  patientPhone?: string;                      // Optional contact number for one-tap caregiver call
  caregiverIds: string[];                     // Flat array of active caregiver UIDs (for Firestore security queries)
  primaryCaregiverIds?: string[];             // Flat array of primary caregiver UIDs authorized to manage members
  members: CareCircleMember[];
  inviteCode?: string;                        // Optional 6-character pairing code
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 5.3 Medications Collection: `medications/{medicationId}`
```typescript
import type { Timestamp } from 'firebase/firestore';

export type PillShape = 'round' | 'capsule' | 'oval' | 'square';
export type ScheduleFrequency = 'daily' | 'specific_days';

export interface MedicationSchedule {
  times: string[];                            // 24-hour HH:mm format, e.g. ["08:00", "20:00"]
  frequency: ScheduleFrequency;
  daysOfWeek?: number[];                      // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  startDate: string;                          // ISO "YYYY-MM-DD"
  endDate?: string | null;                    // ISO "YYYY-MM-DD" or null if ongoing
}

export interface MedicationDocument {
  id: string;
  patientId: string;                          // UID of owning patient (immutable)
  name: string;                               // Prescribed medication name, e.g. "Metformin"
  dosage: string;                             // Dosage string, e.g. "500 mg"
  instructions: string;                       // e.g. "Take after breakfast with a full glass of water"
  schedule: MedicationSchedule;
  color: string;                              // Hex color code for pill marker, e.g. "#3B82F6"
  shape: PillShape;                           // Visual pill shape identifier
  active: boolean;                            // True if active, false if discontinued
  createdBy: string;                          // UID of user who entered the prescription
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

### 5.4 Dose Logs Collection: `dose_logs/{doseLogId}`
```typescript
import type { Timestamp } from 'firebase/firestore';
import type { PillShape } from './medication';

export type DoseStatus = 'scheduled' | 'due' | 'taken' | 'snoozed' | 'unconfirmed' | 'missed';

export interface DoseLogDocument {
  id: string;                                 // Deterministic ID: `${patientId}_${medicationId}_${date}_${time}`
  patientId: string;                          // UID of owning patient (immutable)
  medicationId: string;
  medicationName: string;                     // Denormalized for display performance
  dosage: string;                             // Denormalized
  instructions?: string;                      // Denormalized
  color?: string;                             // Denormalized
  shape?: PillShape;                          // Denormalized pill shape for NextDoseCard rendering
  scheduledDate: string;                      // ISO "YYYY-MM-DD" in patient's local IANA timezone
  scheduledTime: Timestamp;                   // UTC Timestamp of scheduled time T
  status: DoseStatus;
  snoozeCount: number;                        // Monotonic, enforced strictly 0 <= snoozeCount <= 1
  snoozedAt?: Timestamp | null;
  snoozeUntil?: Timestamp | null;             // Exactly snoozedAt + 10 minutes
  takenAt?: Timestamp | null;
  takenBy?: string | null;                    // UID of user confirming dose (patient or caregiver)
  escalatedAt?: Timestamp | null;             // Recorded when transitioning to 'unconfirmed' at T + 30m
  missedAt?: Timestamp | null;                // Recorded on EOD closeout or explicit missed action
  followUpSent: boolean;                      // True if T + 15m gentle reminder was sent
  escalationAlertSent: boolean;               // True if T + 30m caregiver alert was sent
  notes?: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
```

---

## 6. Security Rules Principles & Logic Structure

### 6.1 Core Security Principles
1. **Authenticated Access Only:** All Firestore read and write operations require an active Firebase Auth session (`request.auth != null`).
2. **Patient Ownership & Scoped Profile Reads:** Patients have full write access to their own user profile (`/users/{userId}`). Reads on `/users/{userId}` are strictly restricted to the owner (`isOwner(userId)`) or an active linked caregiver (`isCaregiverFor(userId)`); world-readable queries across `/users` are forbidden.
3. **Care Circle Authorization & Integrity:** Each `care_circles/{circleId}` document ID MUST equal `patientId` (`circleId == request.resource.data.patientId`) so `isCaregiverFor(patientId)` lookups resolve deterministically. On update, `patientId` is immutable and caregiver additions/removals are restricted to the patient or a `primary` caregiver. Caregivers listed in `caregiverIds` can read/write patient `medications` and `dose_logs` (with `MemberPermission` enforced in services/UI and immutable `patientId` enforced in rules).
4. **Unlinked Access Rejection:** Any read or write request by a user who is neither the patient nor an authorized care circle member is immediately denied (HTTP 403 `PERMISSION_DENIED`).
5. **Immutable Historical Logs:** Deletion of `dose_logs` is permanently disallowed to preserve medical audit trails.
6. **Constraint Validation & Taken Lock:** Updates to `dose_logs` must enforce `resource.data.status != 'taken'` (doses marked `taken` are locked and cannot transition to other states), immutable `patientId`, and monotonic `snoozeCount` bounded by `0 <= snoozeCount <= 1` (`request.resource.data.snoozeCount >= resource.data.snoozeCount`).

### 6.2 Production `firestore.rules` Logic
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function isCaregiverFor(patientId) {
      return isAuthenticated() && (
        request.auth.uid == patientId ||
        (
          exists(/databases/$(database)/documents/care_circles/$(patientId)) &&
          request.auth.uid in get(/databases/$(database)/documents/care_circles/$(patientId)).data.caregiverIds
        )
      );
    }

    function isPrimaryCaregiver(circleData) {
      return 'primaryCaregiverIds' in circleData &&
        request.auth.uid in circleData.primaryCaregiverIds;
    }

    // 1. users Collection
    match /users/{userId} {
      allow read: if isOwner(userId) || isCaregiverFor(userId);
      allow create, update: if isOwner(userId);
      allow delete: if false;
    }

    // 2. care_circles Collection
    match /care_circles/{circleId} {
      allow read: if isAuthenticated() && (
        resource.data.patientId == request.auth.uid ||
        request.auth.uid in resource.data.caregiverIds
      );
      allow create: if isAuthenticated() &&
        request.resource.data.patientId == request.auth.uid &&
        circleId == request.auth.uid;
      allow update: if isAuthenticated() &&
        request.resource.data.patientId == resource.data.patientId &&
        circleId == resource.data.patientId && (
          resource.data.patientId == request.auth.uid ||
          (
            isPrimaryCaregiver(resource.data) &&
            !request.resource.data.diff(resource.data).affectedKeys().hasAny(['patientId', 'primaryCaregiverIds'])
          )
        );
      allow delete: if isAuthenticated() && resource.data.patientId == request.auth.uid;
    }

    // 3. medications Collection
    match /medications/{medicationId} {
      allow read: if isAuthenticated() && (
        resource.data.patientId == request.auth.uid ||
        isCaregiverFor(resource.data.patientId)
      );
      allow create: if isAuthenticated() && (
        request.resource.data.patientId == request.auth.uid ||
        isCaregiverFor(request.resource.data.patientId)
      );
      allow update: if isAuthenticated() &&
        request.resource.data.patientId == resource.data.patientId && (
          resource.data.patientId == request.auth.uid ||
          isCaregiverFor(resource.data.patientId)
        );
      allow delete: if isAuthenticated() && (
        resource.data.patientId == request.auth.uid ||
        isCaregiverFor(resource.data.patientId)
      );
    }

    // 4. dose_logs Collection
    match /dose_logs/{doseLogId} {
      allow read: if isAuthenticated() && (
        resource.data.patientId == request.auth.uid ||
        isCaregiverFor(resource.data.patientId)
      );
      allow create: if isAuthenticated() && (
        request.resource.data.patientId == request.auth.uid ||
        isCaregiverFor(request.resource.data.patientId)
      );
      allow update: if isAuthenticated() &&
        (resource.data.patientId == request.auth.uid || isCaregiverFor(resource.data.patientId)) &&
        resource.data.status != 'taken' &&
        request.resource.data.patientId == resource.data.patientId &&
        request.resource.data.snoozeCount >= resource.data.snoozeCount &&
        request.resource.data.snoozeCount >= 0 &&
        request.resource.data.snoozeCount <= 1;
      allow delete: if false; // Permanent audit preservation
    }
  }
}
```

---

## 7. State Machine Engine & Operational Intervals

### 7.1 Pure State Transition Contracts & Service Exports
Let $S = \{\text{scheduled}, \text{due}, \text{taken}, \text{snoozed}, \text{unconfirmed}, \text{missed}\}$ be the set of valid states.  
Let $T$ be the dose scheduled timestamp.

```typescript
// src/domain/stateMachine.ts & src/domain/intervals.ts
export interface DoseTransitionInput {
  currentStatus: DoseStatus;
  scheduledTime: Date; // Time T
  currentTime: Date;
  snoozeCount: number; // 0 or 1
  snoozeUntil?: Date | null;
  action?: 'tapTaken' | 'tapSnooze' | 'markMissed';
}

export interface DoseTransitionResult {
  nextStatus: DoseStatus;
  snoozeCount: number;
  snoozeUntil?: Date | null;
  takenAt?: Date | null;
  escalatedAt?: Date | null;
  missedAt?: Date | null;
  sendGentleReminder?: boolean;
  sendEscalationAlert?: boolean;
}

export function evaluateDoseState(input: DoseTransitionInput): DoseTransitionResult;
export function canSnooze(snoozeCount: number, currentStatus: DoseStatus): boolean;
export function calculateIntervals(scheduledTime: Date): {
  dueTime: Date;               // T
  gentleReminderTime: Date;    // T + 15m
  escalationTime: Date;        // T + 30m
};

// src/services/doseService.ts
export function subscribeToDoseLogs(
  patientId: string,
  date: string,
  callback: (doses: DoseLogDocument[]) => void
): Unsubscribe;
export function confirmDoseTaken(doseLogId: string, userId: string): Promise<void>;
export function snoozeDose(doseLogId: string): Promise<void>;
```

### 7.2 Interval Calculations, Precedence & EOD Closeout
- **Scheduled $\rightarrow$ Due ($T$):** Evaluated deterministically on the client clock and via Cloud Function: when `currentStatus === 'scheduled'` and `currentTime >= scheduledTime`, status moves to `due`.
- **Snooze Duration & Expiry (`due` $\rightarrow$ `snoozed` $\rightarrow$ `due`):** Fixed at exactly 10 minutes ($600,000\text{ms}$). Permitted only when `canSnooze(snoozeCount, currentStatus)` is `true` (`currentStatus === 'due'` and `snoozeCount === 0`). Tapping snooze sets `snoozeCount = 1` and `snoozeUntil = currentTime + 10m`. When `currentStatus === 'snoozed'` and `currentTime >= snoozeUntil` (while `currentTime < scheduledTime + 30m`), status transitions from `snoozed` back to `due` with snooze permanently disabled.
- **Gentle Reminder Interval ($T+15\text{m}$):** If `currentTime >= scheduledTime + 15 min` and `currentStatus === 'due'` (an active `snoozed` pause suppresses the gentle reminder until `snoozeUntil` expires), `sendGentleReminder` is set to `true` to trigger a gentle in-app chime/push.
- **Escalation Interval ($T+30\text{m}$) & Snooze Precedence:** `T+30m` is an authoritative caregiver safety boundary. If `currentTime >= scheduledTime + 30 min` and `currentStatus` is not in `('taken', 'missed')`, status transitions to `unconfirmed` (`escalatedAt` is recorded and `sendEscalationAlert` is set to `true`). Specifically, if a patient snoozes at `T+25m` (`snoozeUntil = T+35m`), the dose remains `snoozed` until `T+30m`, at which point the caregiver escalation rule evaluates (`currentTime >= T+30m`), transitioning the dose status to `unconfirmed` and sending urgent alerts to caregivers. The patient can still tap "Taken" at `T+35m` (or any time prior to EOD closeout) to resolve the `unconfirmed` status to `taken` in real time (`confirmDoseTaken`).
- **Late Confirmation (`unconfirmed` $\rightarrow$ `taken`):** Tapping "Taken" (patient) or "Mark Resolved" (caregiver via `confirmDoseTaken`) when status is `due`, `snoozed`, or `unconfirmed` transitions status to `taken` and records `takenAt` and `takenBy`. Once `taken`, no further state transitions are permitted.
- **End-of-Day (`missed`) Closeout:** When `action === 'markMissed'` (explicitly triggered or executed during the local midnight EOD sweep for prior-day logs not in `'taken'`), any `scheduled`, `due`, `snoozed`, or `unconfirmed` dose transitions to `missed` and records `missedAt`. `missed` is a terminal state.

### 7.3 Cloud Functions Specifications (`functions/src/`)
1. **`dailyLogGenerator` (`functions/src/dailyLogGenerator.ts`):**
   - **Schedule:** Hourly cron (`0 * * * *`).
   - **Timezone Filtering:** Inspects active patient users and filters those whose local time in their IANA `timezone` (e.g., `Asia/Kolkata`, `America/New_York`) falls in the midnight window (`00:00`–`00:59`).
   - **Idempotent Generation & EOD Closeout:** For each matching patient, closes out any unresolved prior-day `dose_logs` (`status` in `['scheduled', 'due', 'snoozed', 'unconfirmed']`) to `'missed'` with `missedAt`, and idempotently creates today's `dose_logs` documents using deterministic IDs `${patientId}_${medicationId}_${localDate}_${time}` (populating denormalized `medicationName`, `dosage`, `instructions`, `color`, and `shape`).
2. **`doseEscalationCheck` (`functions/src/doseEscalationCheck.ts`):**
   - **Schedule:** Every 5 minutes (`*/5 * * * *`).
   - **Evaluation:** Queries non-terminal `dose_logs` (`status` in `['scheduled', 'due', 'snoozed', 'unconfirmed']`), applies `evaluateDoseState`, writes `due` / `unconfirmed` / `missed` (if past patient local midnight) transitions atomically, sets `followUpSent` / `escalationAlertSent` flags idempotently, and dispatches FCM notifications to the patient (`T+15m`) and active care circle members (`T+30m`).

---

## 8. Quality Gates & Testing Standards

### 8.1 Automated Quality Gates
Every contribution must pass the following four gates without failure:
1. **TypeScript Typecheck:** `npm run build` or `npx tsc --noEmit` must complete with zero errors.
2. **ESLint Cleanliness:** `npm run lint` must pass with zero unresolved errors.
3. **State Machine Unit Tests:** `npm test` running Vitest must pass 100% of domain tests verifying all valid and invalid state transitions, intervals, and snooze constraints.
4. **Security Rules Verification:** `@firebase/rules-unit-testing` running against the local Firebase emulator must verify that unlinked users cannot read or write patient data.

### 8.2 Git Workflow
- Default branch: `main`
- Commit message format: Conventional Commits (`feat: ...`, `fix: ...`, `test: ...`, `docs: ...`, `refactor: ...`).
- Direct pushes of unverified or broken builds to `main` are prohibited.

---

## 9. Environment and Commands

```bash
# 1. Install dependencies
npm install

# 2. Start local development server (Vite HMR)
npm run dev

# 3. Execute unit test suites (Vitest)
npm test

# 4. Execute unit test suites in watch mode
npm run test:watch

# 5. Execute Firestore security rules tests against local emulator
npm run test:rules

# 6. Execute linter checks
npm run lint

# 7. Execute production build (TypeScript compile + Vite bundle)
npm run build

# 8. Start Firebase Local Emulators (Auth, Firestore, Functions, Hosting)
firebase emulators:start
```

---

## 10. AI / Implementation Rules
1. **Always read `PRD.md`, `DESIGN.md`, and this file** before implementing or modifying code.
2. **Implement strictly from `todo.md`:** Work on one task at a time, verify completion against acceptance criteria, and update `todo.md`.
3. **Zero Placeholders:** Never generate dummy text, placeholder comments (`// TODO: implement later`), or fake test assertions.
4. **Preserve Separation of Concerns:** Do not place Firestore queries inside React UI components or domain state machine files.
5. **No Speculative Dependencies:** Do not install extra libraries (e.g. Redux, Axios, Express) without explicit justification and architectural sign-off.
