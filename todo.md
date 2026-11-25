# Development Roadmap & Implementation Tasks
# MediMate — Smart Medication Reminder System for Older Adults

**Document Status:** Active Implementation Roadmap  
**Current Milestone:** Milestone 1 (M1) — Specification & Document Synchronization  
**Firebase Project:** `medimate-e27da`  
**Date Updated:** 2026-11-24  

---

## How to Use This Roadmap
- Work on tasks strictly in milestone sequence according to architectural dependencies.
- Mark a task complete (`[x]`) only after executing the specified automated verification commands.
- Never introduce speculative abstractions or unapproved dependencies.
- Every commit must link directly to an acceptance criterion in `PRD.md`.

## Status Legend
- `[ ]` Not started
- `[/]` In progress
- `[x]` Completed and verified
- `[!]` Blocked (requires architectural decision or external dependency)

---

## Milestone 1: Specification & Document Synchronization (M1)
**Objective:** Establish the workspace documentation as the authoritative, single source of truth for the entire MediMate system, eliminating all placeholders and aligning with UN SDG 3, Firebase Cloud infrastructure, pure state machine transitions, and WCAG 2.2 AA accessibility standards.

- [x] **Task 1.1: Author Production PRD (`PRD.md`)**
  - Define SDG 3 mission, problem statement, and polypharmacy adherence challenges.
  - Detail three user personas: Ramesh Sharma (Elderly), Priya Sharma (Caregiver), Nirmala Devi (Dual User).
  - Specify functional requirements (R1, R2, R3, R4) and non-functional requirements.
  - Establish traceable acceptance criteria mapped to `ORIGINAL_REQUEST.md`.
  - *Verification:* Verified `PRD.md` contains 0 placeholders and covers AC-01 through AC-10.
- [x] **Task 1.2: Author Technical Rules (`TECH_RULES.md`)**
  - Define production stack: React 18+, TypeScript 5+, Vite, Tailwind CSS, Firebase (Auth, Firestore, Functions).
  - Explicitly deprecate obsolete Express.js, MySQL, and SMS gateway proposals.
  - Provide full TypeScript interfaces for `UserDocument`, `CareCircleDocument`, `MedicationDocument`, `DoseLogDocument`.
  - Document production Firestore security rules logic structure and coding standards.
  - *Verification:* Verified `TECH_RULES.md` contains 0 placeholders and defines all data schemas.
- [x] **Task 1.3: Author Design System & Component Specs (`DESIGN.md`)**
  - Define visual identity tokens, WCAG 2.2 AA contrast ratios, and typography scale.
  - Specify Elderly "Simple Mode" UI with $\ge 44\times 44\text{px}$ touch targets (68px Taken button, 52px Snooze button).
  - Specify Caregiver Dashboard with real-time `onSnapshot` timeline, compliance badges, and unconfirmed alert banner.
  - Detail multi-device responsive breakpoint matrix and accessibility semantics.
  - *Verification:* Verified `DESIGN.md` contains 0 placeholders and complete component hierarchy.
- [x] **Task 1.4: Author Phased Task Roadmap (`todo.md`)**
  - Structure implementation across Milestones M1 through M5.
  - Provide concrete verification commands and acceptance criteria for each phase.
  - Eliminate all template placeholders.
  - *Verification:* Verified `todo.md` is fully synchronized and free of placeholders.

**Milestone 1 Verification Gate:** All 4 workspace documentation files (`PRD.md`, `TECH_RULES.md`, `DESIGN.md`, `todo.md`) fully written and verified with zero placeholders.

---

## Milestone 2: Repository Setup & State Machine Engine (M2)
**Objective:** Initialize Git version control, scaffold the Vite + React + TypeScript toolchain, and implement the pure TypeScript dose lifecycle state machine and operational interval engine with 100% automated test coverage.

- [ ] **Task 2.1: Initialize Git Repository & Exclusion Rules**
  - Run `git init` in `g:\My Drive\Projects\MediMate`.
  - Create robust `.gitignore` excluding `node_modules`, `dist`, `.firebase`, `.env.local`, `firebase-debug.log`.
  - *Verification Command:* `git status` confirms clean repository with `.gitignore` active.
- [ ] **Task 2.2: Scaffold Vite + React + TypeScript + Tailwind Toolchain**
  - Initialize project with Vite (`package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`).
  - Install runtime dependencies: `react`, `react-dom`, `lucide-react`, `firebase`.
  - Install devDependencies: `typescript`, `vite`, `tailwindcss`, `postcss`, `autoprefixer`, `vitest`, `@testing-library/react`.
  - Configure `tailwind.config.js` with MediMate accessible color tokens and touch target utilities.
  - *Verification Command:* `npm run build` executes without errors.
- [ ] **Task 2.3: Implement Pure State Machine Engine (`src/domain/stateMachine.ts`)**
  - Export `DoseTransitionInput`, `DoseTransitionResult`, `evaluateDoseState`, and `canSnooze`.
  - Implement 6-state dose lifecycle: `scheduled` $\rightarrow$ `due` $\rightarrow$ `taken` / `snoozed` / `unconfirmed` / `missed` (including `snoozed` $\rightarrow$ `due` on snooze expiry and EOD `missed` closeout).
  - Enforce legal state transitions; disallow illegal jumps (e.g. from `scheduled` directly to `snoozed`) and disallow transitions out of terminal `taken` or `missed` states.
  - Enforce maximum 1 snooze constraint (`snoozeCount <= 1`).
  - Allow late confirmation from `unconfirmed` $\rightarrow$ `taken` (including after a `T+25m` snooze escalated at `T+30m`).
  - *Verification:* Vitest tests assert all valid transitions and reject invalid transitions.
- [ ] **Task 2.4: Implement Operational Interval Engine (`src/domain/intervals.ts`)**
  - Export `calculateIntervals` computing `dueTime` ($T$), `gentleReminderTime` ($T+15\text{m}$), and `escalationTime` ($T+30\text{m}$).
  - Implement fixed 10-minute snooze calculation (`snoozeUntil = now + 10m`).
  - Implement gentle follow-up reminder evaluation at $T + 15\text{m}$ (paused while actively `snoozed`).
  - Implement authoritative caregiver escalation evaluation at $T + 30\text{m}$.
  - *Verification:* Vitest unit tests verify boundary intervals across diverse scheduled times.
- [ ] **Task 2.5: Author Comprehensive Unit Test Suite**
  - Create `tests/unit/stateMachine.test.ts` and `tests/unit/intervals.test.ts`.
  - Validate edge cases: rapid double-tap, snooze at $T+25\text{m}$ (escalating at $T+30\text{m}$ with late `taken` resolution at $T+35\text{m}$), EOD `missed` closeout, and cross-midnight intervals.
  - *Verification Command:* `npm test` passes 100% of unit tests with zero failures.

**Milestone 2 Verification Gate:** `npm test` passes 100% unit tests; `npm run lint` passes; `npm run build` succeeds cleanly.

---

## Milestone 3: Firebase Infrastructure, Security Rules & Cloud Functions (M3)
**Objective:** Provision Firebase project configurations, establish TypeScript Firestore models, implement strict declarative security rules verified via local emulators, and build Cloud Functions for daily log generation and escalation checks.

- [ ] **Task 3.1: Configure Firebase Project & Local Settings**
  - Create `.firebaserc` pointing to project `medimate-e27da`.
  - Configure `firebase.json` for Firestore, Hosting, Cloud Functions, and Local Emulator Suite (ports 8080, 9099, 5001).
  - Register Firebase Web App in `medimate-e27da` and generate `src/config/firebase.ts`.
  - *Verification Command:* `npx firebase-tools emulators:exec "echo Emulator ready"` succeeds.
- [ ] **Task 3.2: Implement Firestore Data Models & Types (`src/types/`)**
  - Import `Timestamp` from `'firebase/firestore'` across all client type definitions.
  - Author `src/types/user.ts` (`UserDocument`, `UserRole`, `AccessibilityPreferences`).
  - Author `src/types/careCircle.ts` (`CareCircleDocument`, `CareCircleMember`, `primaryCaregiverIds`).
  - Author `src/types/medication.ts` (`MedicationDocument`, `MedicationSchedule`, `PillShape`).
  - Author `src/types/dose.ts` (`DoseLogDocument` including `shape?: PillShape`, `DoseStatus`, `DoseTransitionInput`, `DoseTransitionResult`).
  - *Verification:* TypeScript compilation passes without errors.
- [ ] **Task 3.3: Implement Declarative Firestore Security Rules (`firestore.rules`)**
  - Restrict `/users/{userId}` `read` to `isOwner(userId) || isCaregiverFor(userId)` and writes to owner (`isOwner(userId)`).
  - Enforce `circleId == request.auth.uid` on `care_circles` creation, immutable `patientId` on updates across `care_circles`/`medications`/`dose_logs`, and patient/primary-caregiver restriction on `care_circles` membership edits.
  - Restrict patient medication and dose log access to the patient and active care circle members (`isCaregiverFor`).
  - Disallow deletion of `dose_logs` (immutable audit trail) and enforce `resource.data.status != 'taken'` (locked `taken` logs) plus monotonic `0 <= snoozeCount <= 1` (`request.resource.data.snoozeCount >= resource.data.snoozeCount`) on updates.
  - *Verification:* Inspect `firestore.rules` syntax.
- [ ] **Task 3.4: Automated Security Rules Test Suite (`tests/rules/firestore.rules.test.ts`)**
  - Implement tests using `@firebase/rules-unit-testing`.
  - Verify patient can read/write own medications and cannot mutate `taken` dose logs or `patientId`.
  - Verify linked caregiver can read/write patient medications and dose logs, while secondary caregivers cannot mutate `care_circles`.
  - Verify unlinked user receives immediate `PERMISSION_DENIED` (403) on `users`, `care_circles`, `medications`, and `dose_logs`.
  - *Verification Command:* `npm run test:rules` passes 100% of security rule scenarios.
- [ ] **Task 3.5: Implement Cloud Functions (`functions/`)**
  - Implement `dailyLogGenerator`: Scheduled Cloud Function (hourly cron: `0 * * * *`) filtering patients whose local IANA `timezone` is in the midnight hour (`00:00`–`00:59`), closing out prior-day unresolved doses to `missed` and generating daily dose logs idempotently (including `shape`).
  - Implement `doseEscalationCheck`: Scheduled Cloud Function running every 5 minutes (`*/5 * * * *`), evaluating `scheduled -> due`, `snoozed -> due`, `T+15m` gentle follow-up, transitioning to `unconfirmed` at $T+30\text{m}$ with caregiver push alerts, and handling EOD `missed` closeout.
  - *Verification Command:* `cd functions && npm run build` compiles with zero TypeScript errors.

**Milestone 3 Verification Gate:** `npm run test:rules` passes against local emulator; Cloud Functions compile cleanly; Firestore security rules deployed/verified.

---

## Milestone 4: Accessible Client Application (PWA) (M4)
**Objective:** Build the complete responsive web application delivering the Elderly "Simple Mode" interface, Caregiver Dashboard with real-time Firestore synchronization, Care Circle management, and PWA offline capabilities.

- [ ] **Task 4.1: Authentication & Multi-Role Provider (`src/services/authService.ts`, `src/hooks/useAuth.ts`)**
  - Integrate Firebase Authentication with role selection (`elderly`, `caregiver`, `dual`).
  - Maintain user profile document in `users/{userId}`.
  - Build `LoginView.tsx` with high-contrast role toggle buttons.
  - *Verification:* Logging in as each role correctly mounts the corresponding view.
- [ ] **Task 4.2: Elderly "Simple Mode" Interface (`src/views/ElderlySimpleView.tsx`)**
  - Implement `NextDoseCard.tsx` with high-contrast pill marker (`color`, `shape`), medication name (`32px` bold), dosage (`22px` semibold), and instructions (`18px` regular).
  - Implement `TakenButton.tsx` (Height: `68px`, Min-Width: `220px`, $\ge 44\times 44\text{px}$ touch target, high-contrast green `#166534` with `#FFFFFF` `24px` bold text achieving `7.13:1` contrast, haptic feedback, single-tap confirmation via `confirmDoseTaken`).
  - Implement `SnoozeButton.tsx` (Height: `52px`, `18px` semibold `#B45309` text, 10-minute delay, disabled after 1 use with `"Snooze limit reached (10m delay active)"` / `"Snooze limit reached"`).
  - Implement optimistic UI updates with tactile and visual confirmation.
  - *Verification:* Test tapping "Taken" transitions dose to `taken`; test snoozing transitions dose to `snoozed` and disables button.
- [ ] **Task 4.3: Caregiver Dashboard & Real-Time Sync (`src/views/CaregiverDashboardView.tsx`)**
  - Implement `useRealtimeDoses.ts` hook subscribing via `subscribeToDoseLogs` / Firestore `onSnapshot` keyed by the patient's local timezone date.
  - Implement `DoseTimeline.tsx` displaying chronological doses with accessible status chips (`scheduled`, `due`, `taken`, `snoozed`, `unconfirmed`, `missed`).
  - Implement `ComplianceStats.tsx` with 4 summary badges: Scheduled, Taken, Pending, Unconfirmed.
  - Implement `EscalationAlert.tsx`: Persistent red warning banner (`#991B1B` on `#FEF2F2`) visible when any dose is `unconfirmed`, including patient name, medication, one-tap "Call Patient" button (with missing-phone fallback), and "Mark Resolved" (`confirmDoseTaken`).
  - *Verification:* Marking dose "Taken" in Simple Mode updates Caregiver Dashboard in $\le 2.0\text{s}$ without page reload.
- [ ] **Task 4.4: Care Circle Management UI (`src/components/caregiver/CircleManager.tsx`)**
  - Display active care circle members and their permission levels.
  - Provide invitation form to add secondary caregivers by email.
  - *Verification:* Adding a caregiver updates `care_circles` document and grants read permissions.
- [ ] **Task 4.5: Progressive Web App & Offline Resilience**
  - Configure `vite-plugin-pwa` with web app manifest and offline service worker.
  - Enable Firestore offline persistence via `enableIndexedDbPersistence`.
  - *Verification:* Disconnecting network and tapping "Taken" caches update locally; reconnecting network syncs write to Firestore.

**Milestone 4 Verification Gate:** Elderly Simple Mode and Caregiver Dashboard fully functional; real-time sync verified; touch targets $\ge 44\times 44\text{px}$; PWA installable.

---

## Milestone 5: Final Milestone: E2E Test Pass & Hardening (M5)
**Objective:** Execute the dual-track testing protocol: Phase 1 verifies 100% passing of opaque-box E2E tests (Tiers 1-4) published in `TEST_READY.md`; Phase 2 executes Tier 5 white-box adversarial hardening and final release verification.

- [ ] **Task 5.1: Dual-Track Phase 1 — Execute & Pass E2E Tiers 1-4**
  - Read `TEST_READY.md` test matrix published by the independent test team.
  - Run Tier 1: Smoke Tests (App boot, view routing, role toggling).
  - Run Tier 2: Happy Path End-to-End Tests (Elderly scheduled $\rightarrow$ due $\rightarrow$ taken flow, real-time sync to caregiver).
  - Run Tier 3: Edge Case Tests (10-minute snooze boundary, max 1 snooze limit, late confirmation after escalation).
  - Run Tier 4: Security Boundary Tests (Unlinked caregiver 403 access denial, immutable audit trail).
  - *Verification:* 100% of Tiers 1-4 tests pass without skips or regressions.
- [ ] **Task 5.2: Dual-Track Phase 2 — Tier 5 Adversarial Coverage Hardening**
  - Test rapid concurrent button taps on "Taken" (tremor simulation).
  - Test cross-timezone synchronization between patient and caregiver devices.
  - Test offline queue flushing and conflict resolution after extended disconnection.
  - Stress test Firestore security rules against malformed payload injections.
  - *Verification:* All adversarial edge cases handled gracefully without data corruption.
- [ ] **Task 5.3: Production Build, Lint & Final Verification**
  - Execute `npm run lint` and verify zero errors or warnings.
  - Execute `npm run build` and verify clean production bundle generation.
  - Perform final WCAG 2.2 AA audit with `axe-core` confirming $\ge 44\times 44\text{px}$ touch targets and high-contrast compliance.
  - *Verification Command:* `npm run build && npm run lint && npm test` all return exit code 0.

**Milestone 5 Verification Gate:** 100% of all automated test tiers pass; zero lint violations; clean production build; ready for production deployment.

---

## Current Task Status
- **Active Milestone:** Milestone 1 (M1) — Specification & Document Synchronization
- **Status:** COMPLETED AND VERIFIED
- **Deliverables Produced:**
  1. `PRD.md` — Authoritative Product Requirements Document
  2. `TECH_RULES.md` — Authoritative Technical Rules & Stack Document
  3. `DESIGN.md` — Authoritative Accessible Design System Specification
  4. `todo.md` — Phased Implementation Roadmap
- **Next Milestone:** Milestone 2 (M2) — Repository Setup & State Machine Engine
