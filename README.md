# MediMate — Smart Medication Reminder System

**SDG 3 — Good Health and Well-Being**

A digital medication companion that helps older adults manage their prescribed medication schedules independently while keeping caregivers informed.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Auth & DB | Firebase Auth + Firestore |
| Push Notifications | Firebase Cloud Messaging (FCM) |
| Backend Logic | Firebase Cloud Functions v2 (Node 20) |
| Automation Backend | Node 20 + Express + node-cron (Render) |
| PWA | Vite PWA Plugin + Web Manifest + FCM Service Worker |
| Testing | Vitest (34 unit + 123 E2E = 157 tests) |

**Firebase Project:** `medimate-e27da`

---

## Quick Start

### 1. Prerequisites

- Node.js 18+
- A Firebase project with Firestore, Auth, Functions and FCM enabled

### 2. Clone & Install

```bash
# Install dependencies (use a local path — Google Drive paths cause npm issues)
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env.local
```

Edit `.env.local` with your Firebase config values:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=medimate-e27da.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=medimate-e27da
VITE_FIREBASE_STORAGE_BUCKET=medimate-e27da.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_VAPID_KEY=...
```

> **Note**: Get your VAPID key from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates.

### 4. Run Development Server

```bash
npm run dev
```

App available at `http://localhost:5173`

---

## Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server |
| `npm run build` | TypeScript check + production build |
| `npm run lint` | ESLint with 0 warnings allowed |
| `npm test` | Run 34 unit tests (state machine + intervals) |
| `npx vitest run --config tests/e2e/vitest.config.ts` | Run 123 E2E tests (Tiers 1–4) |

---

## Dose State Machine

All dose status transitions are handled by the deterministic state machine in `src/domain/stateMachine.ts`.

```
scheduled → due → taken ✓
                → snoozed → due (snooze expired)
                → unconfirmed (T+30m escalation)
                → missed
```

**Intervals** (`src/domain/intervals.ts`):

| Event | Offset |
|---|---|
| Dose due | T+0 |
| Snooze duration | T+10 min (max 1 snooze) |
| Gentle follow-up reminder | T+15 min |
| Caregiver escalation | T+30 min |

---

## Firebase Deployment

```bash
# Deploy Firestore security rules
npx firebase-tools deploy --only firestore:rules --project medimate-e27da

# Deploy Firestore composite indexes
npx firebase-tools deploy --only firestore:indexes --project medimate-e27da

# Build and deploy Cloud Functions
cd functions && npm run build && cd ..
npx firebase-tools deploy --only functions --project medimate-e27da

# Deploy hosting (after npm run build)
npx firebase-tools deploy --only hosting --project medimate-e27da

# Deploy everything
npx firebase-tools deploy --project medimate-e27da
```

> **Render Backend & Keep-Alive**: See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for Render deployment, `/ping` keep-alive setup, `CRON_SECRET` configuration, and `gcloud scheduler` HTTP job commands.

---

## Cloud Functions & Scheduled Jobs

| Function | Schedule | Purpose |
|---|---|---|
| `generateDailyDoseLogs` | Every 30 min (`0,30 * * * *` UTC) | Runs the per-patient IANA timezone midnight cycle: closes past-midnight unresolved doses to `missed` and idempotently pre-populates today's `dose_logs` |
| `closeMissedDoses` | Every 30 min (`0,30 * * * *` UTC) | Transitions unresolved past-midnight doses (`scheduled`, `due`, `snoozed`, `unconfirmed`) to `missed` with `missedAt` for patient timezones in local hour `00` |
| `checkDueDosesAndEscalate` | Every 5 minutes (`*/5 * * * *` UTC) | Bounded 48-hour lookback scan that transitions dose states and sends FCM alerts at T (initial), T+15m (gentle), and T+30m (escalation to patient + caregivers) |

---

## Firestore Collections

| Collection | Purpose |
|---|---|
| `users/{uid}` | User profile, role (`elderly`/`caregiver`), IANA `timezone` (default `Asia/Kolkata`), FCM tokens |
| `care_circles/{patientId}` | Links caregivers to a patient |
| `medications/{medicationId}` | Medication name, dosage, schedule |
| `dose_logs/{doseLogId}` | Daily dose records, status, snooze/escalation/missed tracking |

---

## Accessibility

- **WCAG 2.2 AA** compliant
- Minimum touch target: **44×44 px** (Taken button: 68px height)
- Font scaling: tested up to 200% zoom
- Color contrast: ≥ 4.5:1 for all text

---

## Project Structure

```
MediMate/
├── src/
│   ├── domain/           # State machine + intervals (pure logic)
│   ├── types/            # TypeScript interfaces
│   ├── lib/              # Firebase init, Firestore helpers
│   ├── contexts/         # AuthContext
│   ├── hooks/            # useAuth
│   ├── components/       # DoseCard, StatusChip, AppShell, LoginScreen
│   └── pages/            # TodayView (elderly), CaregiverDashboard
├── server/               # Express + node-cron automation backend (Render)
│   ├── src/jobs/         # Daily log generation, EOD closeout, escalation
│   └── tests/            # Backend unit & integration tests
├── functions/src/        # Cloud Functions (v2 scheduled)
├── docs/
│   └── DEPLOYMENT.md     # Render, Cloud Scheduler & Firestore index deployment guide
├── tests/
│   ├── unit/             # 34 unit tests
│   └── e2e/              # 123 E2E tests (Tier 1–4)
├── public/
│   ├── manifest.json     # PWA manifest
│   └── firebase-messaging-sw.js  # FCM service worker
├── firestore.rules       # Security rules
├── firestore.indexes.json # Composite Firestore indexes
├── render.yaml           # Render web service blueprint
├── firebase.json         # Firebase project config
└── .env.example          # Environment variable template
```

---

## What MediMate Does NOT Do

- ❌ Diagnose medical conditions
- ❌ Prescribe or recommend medicines
- ❌ Independently verify that medicine was swallowed
- ❌ Send real SMS (MVP uses in-app + web push only)
- ❌ Adjust medication dosages

> MediMate assists with **reminders and tracking** only.
