# Product Requirements Document (PRD)
# MediMate — Smart Medication Reminder System for Older Adults

**Document Status:** Approved Production Specification  
**UN Sustainable Development Goal:** SDG 3 — Good Health & Well-Being (Targets 3.4 & 3.8)  
**Author:** MediMate Systems Architecture Team  
**Date:** 2026-11-24  
**Project Identifier:** `medimate-e27da`  

---

## 1. Product Overview

### 1.1 Product Name
**MediMate** (Smart Medication Reminder & Caregiver Escalation System for Older Adults)

### 1.2 One-Line Description
A dignity-first, highly accessible Progressive Web Application (PWA) that empowers older adults to manage daily medication schedules independently while giving remote family caregivers real-time visibility and proactive escalation for unconfirmed doses.

### 1.3 Problem Statement
Medication non-adherence among older adults represents a severe global public health challenge. Adults aged 65 and older frequently manage multiple chronic conditions (polypharmacy: hypertension, type 2 diabetes, cardiovascular disease) requiring strict dosing schedules. However, age-related memory decline, complex prescription regimens, presbyopia, and motor tremors frequently lead to skipped doses, double dosing, or incorrect timing. According to healthcare research, medication non-adherence causes approximately 125,000 preventable deaths annually in the United States alone and accounts for 10% to 25% of hospital admissions among older adults. 

Concurrently, adult children and family caregivers suffer from chronic anxiety, frequently having to make disruptive daily phone calls ("Did you take your morning pill?") that degrade elderly independence and strain familial relationships. Existing smartphone reminder apps fail older adults because they feature cluttered user interfaces, tiny touch targets, intrusive ads, confusing multi-step menus, and zero automated caregiver escalation when a dose is missed.

### 1.4 Proposed Solution
MediMate bridges elderly autonomy and caregiver peace of mind through a cloud-synchronized, accessible system:
1. **Elderly "Simple Mode" UI:** A clean, distraction-free interface meeting WCAG 2.2 AA standards with large touch targets ($\ge 44\times 44\text{px}$, with $\ge 64\text{px}$ height action buttons), prominent high-contrast pill markers, and single-tap "Taken" and 10-minute "Remind Me Later" (Snooze) actions.
2. **Deterministic Reminder & Escalation State Machine:** An automated dose lifecycle (`scheduled` $\rightarrow$ `due` $\rightarrow$ `taken` / `snoozed` / `unconfirmed` / `missed`) operating on fixed, reliable intervals: initial reminder at scheduled time $T$, fixed 10-minute snooze (max 1 permitted), a gentle follow-up reminder at $T+15\text{m}$, and automatic escalation to linked caregivers at $T+30\text{m}$.
3. **Caregiver Dashboard:** Real-time dose timeline driven by Cloud Firestore snapshot listeners (`onSnapshot`), daily compliance summary badges, care circle management, and high-visibility alert banners that surface immediately when a dose remains unconfirmed after 30 minutes.

### 1.5 Target Users
- **Older Adults (Ages 65+):** Individuals living independently or with a spouse, managing one or more daily chronic prescription medications, who value dignity, autonomy, and simplicity.
- **Family Caregivers & Adult Children:** Off-site or working relatives who oversee their parents' health and require real-time reassurance without micromanagement.
- **Dual Users:** Active older adults managing their own medication regimen while simultaneously acting as primary caregivers for an aging spouse or partner.

### 1.6 Alignment with UN SDG 3 (Good Health & Well-Being)
- **Target 3.4:** Reduce premature mortality from non-communicable diseases (cardiovascular disease, diabetes, hypertension) through prevention and treatment by ensuring consistent therapeutic blood levels via medication adherence.
- **Target 3.8:** Promote access to quality essential healthcare services and safe, effective, and affordable essential medicines by preventing adverse drug events (ADEs), accidental overdoses, and avoidable hospital readmissions.

---

## 2. Goals and Success Criteria

### 2.1 Strategic Goals
- **Empower Independent Aging:** Enable older adults to confidently track and confirm their medications without relying on third-party physical assistance.
- **Eliminate Caregiver Anxiety:** Provide passive, reliable, real-time verification so caregivers only need to intervene when a dose is genuinely unconfirmed.
- **Ensure Absolute Accessibility:** Design from the ground up for low vision, tremors, cognitive decline, and low technical literacy.
- **Ensure Uncompromising Reliability:** Deliver guaranteed state transitions and data synchronization backed by automated tests, strict cloud security rules, and offline resilience.

### 2.2 Success Metrics & Key Performance Indicators
| Metric | Target | How Measured |
|---|---|---|
| **Dose Confirmation Rate** | $\ge 92\%$ of scheduled doses confirmed | Aggregated from Firestore `dose_logs` (`status == 'taken'`) |
| **Touch Target Compliance** | $100\%$ compliance with WCAG 2.2 AA ($\ge 44\times 44\text{px}$) | Automated axe-core audits and component layout verification |
| **Real-Time Sync Latency** | $\le 2.0\text{s}$ from Elderly tap to Caregiver UI | Timestamp delta between Firestore write and client listener trigger |
| **Escalation Accuracy** | $100\%$ of unconfirmed doses escalated at $T+30\text{m}$ (within the 5-minute `doseEscalationCheck` cadence) | Cloud Function scheduler execution logs and unit test assertions |
| **Single-Tap Ease of Use** | $\le 1$ tap required to confirm a due dose | UI interaction path analysis in Simple Mode |
| **System Test Pass Rate** | $100\%$ passing unit, rules, and E2E tests | Automated CI/CD pipeline execution (`npm test`, `npm run build`) |

---

## 3. User Personas

### Persona 1: Ramesh Sharma — The Independent Senior (Elderly Simple Mode User)
- **Age:** 74 years old
- **Living Situation:** Lives independently in his home; wife passed away two years ago.
- **Health Profile:** Mild hypertension and Type 2 diabetes. Prescribed Metformin (500mg, 8:00 AM & 8:00 PM), Amlodipine (5mg, 8:00 AM), and Atorvastatin (20mg, 8:00 PM).
- **Physical & Cognitive Profile:** Presbyopia (wears reading glasses), mild age-related short-term memory lapses, mild essential tremor in hands.
- **Technical Comfort:** Low. Uses WhatsApp for family video calls; gets frustrated by small buttons, dense menus, multiple tabs, or unexpected popups.
- **Needs:**
  - Needs to know exactly what pill to take right now without navigating through complex screens.
  - Large, impossible-to-miss buttons that respond reliably to imprecise touches.
  - A gentle snooze option if he is currently in the bath, praying, or having breakfast.
  - Reassurance that his daughter is not constantly worrying about him.
- **Pain Points:**
  - Forgets whether he took his 8:00 AM Metformin by 9:30 AM; risks double-dosing.
  - Dislikes apps with tiny English fonts, English medical jargon, or complicated login screens.

### Persona 2: Priya Sharma — The Dedicated Remote Caregiver
- **Age:** 42 years old
- **Living Situation:** Software Engineering Director, lives in a metropolitan city 35 km away from her father (Ramesh).
- **Profile:** Juggles an intensive executive career and parenting two teenage children while managing her aging father's healthcare.
- **Technical Comfort:** High. Power user of mobile and cloud collaboration applications.
- **Needs:**
  - A real-time timeline showing her father's daily medication status without having to call him multiple times a day.
  - Proactive escalation alerts only when a scheduled dose is genuinely overdue ($T+30\text{m}$).
  - Ability to configure and update medication prescriptions, dosages, and times remotely on her father's behalf.
  - Ability to invite her brother (secondary caregiver) into Ramesh's Care Circle.
- **Pain Points:**
  - Constant undercurrent of guilt and anxiety during work meetings wondering if her father took his blood pressure medication.
  - Awkward friction when calling her father to check on medication, which he perceives as overbearing surveillance.

### Persona 3: Nirmala Devi — The Active Senior & Spousal Caregiver (Dual User)
- **Age:** 68 years old
- **Living Situation:** Lives in an apartment with her 72-year-old husband, Suresh.
- **Health Profile:** Takes Levothyroxine (50mcg, morning) and Calcium supplements for herself. Suresh is recovering from a mild ischemic stroke and takes 5 daily medications requiring strict timing.
- **Technical Comfort:** Medium. Comfortable with basic smartphone tasks, online bill payments, and messaging.
- **Needs:**
  - One unified application where she can effortlessly record her own morning medication in Simple Mode, and switch to a Caregiver View to manage Suresh's complex multi-dose schedule.
  - Clear visual distinction between her own simple reminders and Suresh's monitoring dashboard.
  - Reassurance that if Suresh's afternoon dose is unconfirmed, their daughter in Bangalore will also receive the escalation alert.
- **Pain Points:**
  - Cognitive overload managing two separate medication schedules on handwritten paper calendars.
  - Fatigue from manually tracking multiple pill boxes with different schedules throughout the day.

---

## 4. User Stories

### 4.1 Elderly User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| **US-E01** | Elderly User | See my next scheduled medication in large, clear text on the home screen | I immediately know what to take and when without searching | Must Have |
| **US-E02** | Elderly User | Tap a large "Taken" button with immediate tactile and visual confirmation | I can record my medication in one touch and feel confident it was logged | Must Have |
| **US-E03** | Elderly User | Tap a "Remind Me Later" button when I am busy eating or away from my medicine | The reminder pauses for exactly 10 minutes without me worrying | Must Have |
| **US-E04** | Elderly User | Be prevented from snoozing more than once | I do not unintentionally procrastinate and miss my essential medical window | Must Have |
| **US-E05** | Elderly User | Receive a gentle follow-up reminder 15 minutes after scheduled time | I get a second chance to take my medication if I missed the first chime | Must Have |
| **US-E06** | Elderly User | View pill visual markers (distinct color and shape) alongside medication name | I can match the screen prompt to the physical pill in my organizer | Should Have |
| **US-E07** | Elderly User | Use the app even if internet connection drops temporarily | My dose confirmations are stored offline and synchronized when reconnected | Must Have |

### 4.2 Caregiver User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| **US-C01** | Caregiver | View a real-time chronological timeline of today's doses for my family member | I know their adherence status instantaneously without calling | Must Have |
| **US-C02** | Caregiver | See today's compliance summary badges (Scheduled, Taken, Pending, Unconfirmed) | I get an immediate high-level overview of adherence health | Must Have |
| **US-C03** | Caregiver | Receive an immediate high-visibility alert banner when a dose is unconfirmed after 30 minutes | I can step in, call, or arrange assistance before health risks occur | Must Have |
| **US-C04** | Caregiver | Add, edit, or pause medication schedules remotely | I ensure prescription changes ordered by the doctor are updated accurately | Must Have |
| **US-C05** | Caregiver | Invite other family members or nurses into the patient's Care Circle | Multiple caregivers share the responsibility of oversight | Should Have |
| **US-C06** | Caregiver | See exactly when and by whom a dose was confirmed (patient vs. caregiver) | The care circle maintains an unambiguous, transparent audit trail | Must Have |

### 4.3 Dual User Stories
| ID | As a... | I want to... | So that... | Priority |
|---|---|---|---|---|
| **US-D01** | Dual User | Toggle seamlessly between Simple Mode (my medications) and Caregiver Dashboard (my spouse's) | I manage both our routines in one app without multiple logins | Must Have |
| **US-D02** | Dual User | Receive shared escalation alerts for my spouse while still being alerted for my own schedule | Neither of our health regimens is neglected or confused | Must Have |

---

## 5. Functional Requirements (R1 – R4 Mapping)

### 5.1 Requirement R1: Specification & Document Synchronization
- **Description:** The four core workspace documentation files (`PRD.md`, `TECH_RULES.md`, `DESIGN.md`, `todo.md`) serve as the absolute, single source of truth for all architectural, data, design, and implementation work.
- **Rules:**
  - All template placeholder tokens and unpopulated markers must be eliminated and replaced with concrete, production-ready specifications.
  - Reject and permanently deprecate obsolete early proposals (e.g., Express + MySQL or SMS gateways).
  - All requirements from `ORIGINAL_REQUEST.md` must be cross-referenced and verified.
- **Outputs:** Production-grade `PRD.md`, `TECH_RULES.md`, `DESIGN.md`, and `todo.md`.

### 5.2 Requirement R2: Firebase Cloud Infrastructure & Managed Tooling
- **Description:** Serverless backend infrastructure provisioned and managed via Firebase tools.
- **R2.1: Multi-Role Authentication (Firebase Auth):**
  - Support user registration and login with email/password or authentication tokens.
  - Three distinct role profiles: `elderly`, `caregiver`, and `dual`.
  - User profile stored in `users/{userId}` with role, timezone, display name, FCM tokens, and accessibility preferences.
- **R2.2: Cloud Firestore Collections & Schemas:**
  - `users/{userId}`: User identity, contact info, role, and accessibility settings.
  - `care_circles/{circleId}`: Pairing between a patient and authorized caregiver UIDs, permissions, and status.
  - `medications/{medicationId}`: Prescriptions, dosages, instructions, visual markers (color, shape), and schedules.
  - `dose_logs/{doseLogId}`: Discrete daily dose occurrences tracking scheduled time, status, timestamps (`takenAt`, `snoozedAt`, `escalatedAt`, `missedAt`), and snooze counts.
- **R2.3: Strict Firestore Security Rules:**
  - Patients can read and write their own user profile (`/users/{userId}`), medications, and dose logs; active linked caregivers can read patient user profiles (for display/phone escalation) and read/write patient medications and dose logs.
  - Care Circle integrity: `care_circles/{circleId}` requires `circleId == patientId` on creation; `patientId` is immutable on update across `care_circles`, `medications`, and `dose_logs`; caregiver additions/removals in `care_circles` are restricted to the patient or a `primary` caregiver.
  - Unauthenticated or unlinked users receive an immediate 403 `PERMISSION_DENIED`.
  - Immutable historical logging & `taken` lock: Deletion of `dose_logs` is forbidden, and once a dose is marked `taken`, further state transitions are rejected (`resource.data.status != 'taken'`).
  - Enforce monotonic snooze constraints: `snoozeCount >= resource.data.snoozeCount` and `0 <= snoozeCount <= 1`.
- **R2.4: Cloud Functions:**
  - **Daily Dose Log Generator (`dailyLogGenerator`):** Scheduled Cloud Function executing hourly (`0 * * * *`), filtering patients whose local IANA `timezone` is in the midnight hour (`00:00`–`00:59`), closing out unresolved prior-day logs as `missed`, and idempotently generating today's `dose_logs` entries (including denormalized `shape`).
  - **Scheduled Dose Check & Escalation Runner (`doseEscalationCheck`):** Scheduled Cloud Function executing every 5 minutes (`*/5 * * * *`), evaluating active dose logs against current time (paired with immediate client-side clock evaluation):
    - At $t \ge T$: Transitions `scheduled` $\rightarrow$ `due`.
    - At $t \ge \text{snoozeUntil}$ (when $t < T+30\text{m}$): Transitions `snoozed` $\rightarrow$ `due`.
    - At $t \ge T+15\text{m}$: Dispatches gentle follow-up reminder if status is `due` (paused while actively `snoozed` until `snoozeUntil`) and `!followUpSent`.
    - At $t \ge T+30\text{m}$: Transitions status $\rightarrow$ `unconfirmed` (even if actively `snoozed`), sets `escalatedAt`, and dispatches urgent caregiver push notifications.
    - At local midnight EOD: Transitions unresolved prior-day doses (`scheduled`, `due`, `snoozed`, `unconfirmed`) $\rightarrow$ `missed` and sets `missedAt`.

### 5.3 Requirement R3: Reminder State Machine & Escalation Engine
- **Description:** Pure, deterministic 6-state dose lifecycle engine governing all medication status transitions.
- **States:**
  1. `scheduled`: Future scheduled dose occurrence.
  2. `due`: Scheduled time $T$ has arrived; active reminder displayed.
  3. `taken`: User or authorized caregiver confirmed dose was administered (terminal, locked).
  4. `snoozed`: User requested a temporary 10-minute postponement.
  5. `unconfirmed`: Dose remains unconfirmed 30 minutes after scheduled time; escalated to care circle.
  6. `missed`: Explicitly marked missed by user/caregiver or closed out at End of Day (midnight in patient's local `timezone`, terminal).
- **Operational Intervals & Rules:**
  - **Initial Alert ($T$):** When current time $t \ge T$, dose transitions from `scheduled` to `due`.
  - **Snooze Action:** Single tap on "Remind Me Later" transitions dose from `due` to `snoozed`, sets `snoozeUntil = now + 10m`, and increments `snoozeCount` to 1.
  - **Snooze Limit:** Strictly maximum 1 snooze allowed per dose. If `snoozeCount >= 1`, the snooze action is permanently disabled.
  - **Snooze Expiry:** When $t \ge \text{snoozeUntil}$ (and $t < T+30\text{m}$), dose transitions from `snoozed` back to `due`.
  - **Gentle Follow-Up ($T+15\text{m}$):** If current time $t \ge T+15\text{m}$ and dose is in `due` state (if actively `snoozed`, the chime pauses until `snoozeUntil` expires), a gentle secondary reminder is triggered.
  - **Caregiver Escalation ($T+30\text{m}$) & Snooze Precedence:** If current time $t \ge T+30\text{m}$ and status is not `taken` or `missed`, status automatically transitions to `unconfirmed`, `escalatedAt` is recorded, and escalation alerts are broadcast to all linked caregivers. Specifically, if a user snoozes at $T+25\text{m}$, the dose is `snoozed` until $T+35\text{m}$; at $T+30\text{m}$, the caregiver escalation rule evaluates (`currentTime >= T+30m`), transitioning the dose status to `unconfirmed` and sending urgent alerts to caregivers. The patient can still tap "Taken" at $T+35\text{m}$ (or any time prior to EOD closeout) to resolve the `unconfirmed` status in real time.
  - **Late Confirmation & EOD Closeout:** A dose in `unconfirmed` state can still be marked as `taken` by the patient or caregiver (`confirmDoseTaken`) at any time prior to EOD midnight in the patient's local timezone, updating status to `taken`, recording `takenAt` and `takenBy`, and resolving the active escalation banner. Any dose still unresolved at local midnight transitions to `missed` with `missedAt` recorded.

### 5.4 Requirement R4: Accessible Client Application (PWA)
- **Description:** Responsive Progressive Web Application built with React 18+, TypeScript 5+, Vite, and Tailwind CSS.
- **R4.1: Elderly "Simple Mode" Interface:**
  - Ultra-clear, high-contrast interface designed specifically for elderly visual and motor capabilities.
  - **Next Dose Card:** Displays the immediate next scheduled or due dose with high-contrast text (`32px` / `2rem` `700` Bold for medicine name, `22px` semibold dosage, `18px` regular instructions) and visual pill marker (distinctive `color` and `shape`).
  - **Single-Tap "Taken" Confirmation:** Oversized primary button (height `68px` $\ge 64\text{px}$, minimum width `220px`, exceeding WCAG 2.2 AA $44\times 44\text{px}$), high-contrast green `#166534` with `#FFFFFF` `24px` bold text (`7.13:1` contrast, meeting AC-10 $\ge 7:1$), with instantaneous tactile/haptic feedback and visual checkmark state.
  - **Single-Tap "Remind Me Later" (Snooze):** Prominent secondary button (height `52px`, `18px` semibold `#B45309` text) delaying the reminder by exactly 10 minutes. Automatically disabled and visually labeled `"Snooze limit reached (10m delay active)"` while snoozed and `"Snooze limit reached"` after 10-minute expiry.
  - Zero cluttered navigation, zero ads, zero nested multi-step dialogs.
- **R4.2: Caregiver Dashboard:**
  - **Real-Time Dose Timeline:** Chronological card stream of today's medication events updating instantaneously via Firestore `onSnapshot` listeners without manual page refreshes.
  - **Today's Compliance Summary Badges:** 4 dynamic metric badges:
    * *Scheduled:* Total prescribed doses for today.
    * *Taken:* Doses successfully confirmed.
    * *Pending:* Doses upcoming or currently due within grace window.
    * *Unconfirmed:* Doses overdue by $>30$ minutes requiring intervention.
  - **Immediate Unconfirmed Dose Alert Banner:** Prominent high-contrast red warning banner pinned to the top of the Caregiver Dashboard when any dose reaches `unconfirmed` state, showing patient name, medication name, scheduled time, and a one-tap phone call button.
  - **Care Circle Management:** Interface allowing caregivers to view active members, send email invitations, set roles (`primary` vs. `secondary`), and manage patient links.
- **R4.3: Progressive Web App & Offline Capabilities:**
  - Installable to home screen on iOS and Android via Web App Manifest.
  - Service worker caching application shell (HTML, CSS, JS) and offline fallback.
  - Optimistic UI updates allowing elderly users to tap "Taken" while offline; state is synchronized with Firestore immediately upon network restoration.

---

## 6. Non-Functional Requirements

### 6.1 Accessibility (WCAG 2.2 AA Compliance)
- **Touch Target Sizing:** Every interactive control (buttons, links, toggles, icon triggers) must have an accessible touch target area of at least $44\times 44\text{px}$. In Elderly Simple Mode, primary action buttons must have a height of at least $64\text{px}$.
- **Contrast Ratios:** Minimum contrast ratio of 4.5:1 for standard body text, 7:1 for elderly Simple Mode primary body text, and 3:1 for large graphical components and buttons against their backgrounds.
- **Multi-Sensory Cues:** Color is never used as the sole indicator of state. All status indicators must pair color with unambiguous text labels and distinct geometric iconography.
- **Screen Reader Support:** Full semantic HTML (`<main>`, `<header>`, `<article>`, `<button>`), ARIA labels on icon buttons, `role="alert"` on escalation banners, and `aria-live="polite"` on real-time dose status updates.

### 6.2 Performance
- **Sync Latency:** When a dose is marked "Taken" in Simple Mode, the Caregiver Dashboard timeline must update in $\le 2.0\text{seconds}$ under standard 4G/Wi-Fi conditions.
- **Initial Load Time:** First Contentful Paint (FCP) $\le 1.2\text{seconds}$; Time to Interactive (TTI) $\le 1.8\text{seconds}$ on mid-tier mobile hardware.
- **Bundle Size:** Compressed production client bundle under $250\text{KB}$ to ensure rapid loading on low-bandwidth cellular networks.

### 6.3 Security & Data Privacy
- **Authentication & Authorization:** All user interactions authenticated via Firebase Auth tokens. Every Firestore query evaluated against strict server-side security rules.
- **Health Data Segregation:** Caregivers cannot access health data of patients outside their explicit `care_circles` link.
- **Transport & Storage Encryption:** Enforce TLS 1.3 in transit and AES-256 encryption at rest across Firestore and Cloud Functions.
- **Zero Plaintext PHI Logging:** Cloud Functions and client console logs must never log personally identifiable health information (PHI) or authentication secrets.

### 6.4 Reliability & Offline Resilience
- **High Availability:** 99.95% uptime backed by Firebase Cloud infrastructure.
- **Idempotency:** Cloud Functions generating daily logs and recording state transitions must be strictly idempotent to prevent duplicate records or alert spam.
- **Offline Tolerance:** Local IndexedDB persistence via Firestore client SDK ensures offline reads and queueing of offline dose confirmations.

---

## 7. User Flows

### Flow 1: Elderly User Morning Dose Confirmation
1. Ramesh's smartphone sounds a gentle chime and displays the PWA at 8:00 AM (Time $T$).
2. The screen displays: **"Good Morning, Ramesh! Time for your morning medicine."**
3. The **Next Dose Card** highlights: **Metformin (500 mg)** — *White Capsule Icon* — *"Take with water after breakfast"*.
4. Ramesh takes his physical pill and taps the massive green **"Taken ✓"** button.
5. The button provides immediate tactile haptic vibration, displays a checkmark animation, and announces *"Metformin marked as taken."*
6. The screen smoothly transitions to show the next upcoming dose scheduled for 8:00 PM.
7. In the background, Firestore writes `status = 'taken'` and `takenAt = 08:02:15 UTC`.

### Flow 2: 10-Minute Snooze & Expiry
1. At 8:00 AM, Ramesh is in the middle of a phone call with his sister.
2. He taps the amber button **"Remind Me Later (10 min)"**.
3. Status transitions to `snoozed`, `snoozeUntil` is calculated as 8:10 AM, and `snoozeCount` becomes 1.
4. The button transitions to a disabled state: *"Snooze limit reached (10m delay active)"*.
5. At 8:10 AM, the app re-alerts: **"Due Now: Metformin (500 mg)"**. The snooze button remains disabled (*"Snooze limit reached"*).
6. Ramesh finishes his call and taps **"Taken ✓"**.

### Flow 3: Unconfirmed Dose Escalation ($T+30\text{m}$) to Caregiver
1. At 8:00 AM, Ramesh's Amlodipine is due. Ramesh is out gardening and does not hear the phone.
2. At 8:15 AM ($T+15\text{m}$), the `doseEscalationCheck` runner detects status is still `due` and sends a gentle follow-up reminder chime to Ramesh's phone.
3. At 8:30 AM ($T+30\text{m}$), the `doseEscalationCheck` runner evaluates $t \ge T+30\text{m}$ and status is not `taken` or `missed` (this also applies if Ramesh had snoozed at 8:25 AM until 8:35 AM).
4. The runner executes an atomic transaction on `dose_logs`:
   - `status` $\rightarrow$ `unconfirmed`
   - `escalatedAt` $\rightarrow$ `2026-11-24T08:30:00Z`
   - `escalationAlertSent` $\rightarrow$ `true`
5. Priya's Caregiver Dashboard instantaneously updates via Firestore `onSnapshot`:
   - A pulsing red **Alert Banner** appears at the top: **"⚠️ Action Required: Ramesh Sharma has not confirmed Amlodipine 5mg (Scheduled 8:00 AM)."**
   - The banner includes a one-tap button: **"Call Ramesh"** (gracefully disabled with *"No phone on file"* if `phoneNumber` is absent) and a **"Mark Resolved"** button (`confirmDoseTaken`).
   - The compliance summary badge increments the **Unconfirmed** counter from 0 to 1.
6. Priya taps "Call Ramesh", reminds him to take his blood pressure pill. Ramesh goes inside and taps "Taken" at 8:38 AM (even if after a prior snooze window).
7. The status updates to `taken`, the Alert Banner disappears from Priya's screen, and the timeline displays: *"Taken at 8:38 AM (Resolved after escalation)"*.

---

## 8. Data Requirements & Firestore Schema Summary

| Entity | Collection Path | Key Fields | Retention Policy |
|---|---|---|---|
| **User** | `users/{userId}` | `uid`, `email`, `displayName`, `role`, `phoneNumber`, `timezone`, `fcmTokens`, `accessibilityPreferences` | Maintained until account deletion request |
| **Care Circle** | `care_circles/{circleId}` | `id` (`== patientId`), `patientId`, `patientName`, `patientPhone`, `caregiverIds`, `primaryCaregiverIds`, `members[]`, `inviteCode` | Maintained while patient profile is active |
| **Medication** | `medications/{medicationId}` | `id`, `patientId`, `name`, `dosage`, `instructions`, `schedule`, `color`, `shape`, `active` | Maintained while active; archived if discontinued |
| **Dose Log** | `dose_logs/{doseLogId}` | `id`, `patientId`, `medicationId`, `medicationName`, `dosage`, `shape`, `scheduledDate`, `scheduledTime`, `status`, `snoozeCount`, `takenAt`, `escalatedAt`, `missedAt` | Retained indefinitely for adherence history |

---

## 9. Scope

### In Scope (MVP Release)
- Full synchronization of production documentation (`PRD.md`, `TECH_RULES.md`, `DESIGN.md`, `todo.md`).
- Multi-role Firebase Authentication (`elderly`, `caregiver`, `dual`).
- Cloud Firestore collections with strict security rules restricting access to patient and authorized care circle members.
- Pure TypeScript deterministic state machine implementing all 6 states (`scheduled`, `due`, `taken`, `snoozed`, `unconfirmed`, `missed`).
- Operational timing engine: Scheduled time $T$, 10-minute snooze (max 1), $T+15\text{m}$ gentle reminder, $T+30\text{m}$ caregiver escalation.
- Cloud Functions for automated daily dose log creation and periodic scheduled escalation checks.
- Elderly "Simple Mode" UI with WCAG 2.2 AA compliance ($\ge 44\times 44\text{px}$ touch targets, single-tap Taken, single-tap Snooze).
- Caregiver Dashboard with real-time `onSnapshot` timeline, compliance badges, care circle management, and persistent unconfirmed alert banner.
- 100% automated test coverage across unit tests, security rules tests, and end-to-end user journeys.

### Explicitly Out of Scope (Deferred Post-MVP)
- Paid SMS gateway integrations (e.g., 2Factor, MSG91) — excluded per stakeholder decision Q11-A in favor of free Web Push (FCM) and in-app alerts.
- Relational databases (MySQL/PostgreSQL) and custom Express.js servers — permanently rejected.
- Clinical drug-drug interaction checking or automated prescription optical character recognition (OCR).
- Hardware smart pill dispensers or Bluetooth-connected blister packs.

---

## 10. Assumptions, Constraints and Risks

| Type | Description | Mitigation Strategy |
|---|---|---|
| **Constraint** | Elderly users have low technical tolerance and may suffer from hand tremors or presbyopia. | Enforce minimum $44\times 44\text{px}$ touch targets (with $64\text{px}$ buttons for primary actions), large high-contrast fonts, and zero nested menus. |
| **Constraint** | Browser web push notifications require explicit user permission and HTTPS. | Implement graceful in-app notification banners; guide caregivers to ensure PWA is added to home screen with permissions granted. |
| **Assumption** | Firebase project `medimate-e27da` provides sufficient quota on free Spark/Blaze tiers for scheduled Cloud Functions and Firestore operations. | Idempotent queries, batched daily writes, and optimized `onSnapshot` listeners to minimize read/write costs. |
| **Risk** | Intermittent cellular connectivity in elderly homes could cause delayed dose confirmation. | Implement local Firestore offline persistence and optimistic client UI so confirmations are recorded locally and synced when connection resumes. |
| **Risk** | Double-tapping by older adults with finger tremors could trigger duplicate writes. | UI buttons immediately enter disabled/optimistic state on initial touch, preventing duplicate submission. |

---

## 11. Traceable Acceptance Criteria

These criteria directly map to the core requirements specified in `ORIGINAL_REQUEST.md`:

### 11.1 Automated Verification & Code Quality
- [ ] **AC-01 (Build Cleanliness):** The application builds cleanly without TypeScript compiler or bundler errors (`npm run build`).
- [ ] **AC-02 (Lint Cleanliness):** Linter checks execute and pass without unresolved errors or warnings (`npm run lint`).
- [ ] **AC-03 (State Machine Unit Tests):** Automated unit test suite executes and passes via Vitest, verifying all valid transitions and rejecting illegal transitions across the 6 states (`scheduled`, `due`, `taken`, `snoozed`, `unconfirmed`, `missed`).
- [ ] **AC-04 (Timing & Snooze Unit Tests):** Unit tests verify that snoozing delays reminders by exactly 10 minutes and disallows additional snoozes beyond the maximum allowed limit of 1.
- [ ] **AC-05 (Escalation Unit Tests):** Unit tests verify that unconfirmed doses at $T+30\text{m}$ transition to `unconfirmed` state.
- [ ] **AC-06 (Security Rules Unit Tests):** Automated security rules tests pass via `@firebase/rules-unit-testing`, proving unlinked caregivers cannot read or write patient medication records.

### 11.2 Functional Verification & Real-Time Sync
- [ ] **AC-07 (Taken Confirmation & Real-Time Sync):** Marking a dose as "Taken" in the Elderly interface transitions status to `taken`, records `takenAt` in Firestore, and updates the Caregiver dashboard in real time ($\le 2\text{s}$) without manual page refresh.
- [ ] **AC-08 (Snooze Limit Enforcement):** Snoozing a dose delays reminders by exactly 10 minutes and disables the snooze button once `snoozeCount == 1`.
- [ ] **AC-09 (Caregiver Escalation Banner):** Doses unconfirmed 30 minutes after scheduled time trigger escalation state transition to `unconfirmed` and display active alert banners on all linked caregiver dashboards.
- [ ] **AC-10 (WCAG 2.2 AA Accessibility):** All interactive elements on the Elderly interface meet WCAG 2.2 AA touch target sizing ($\ge 44\times 44\text{px}$) and high-contrast accessibility standards ($\ge 4.5:1$ text, $\ge 7:1$ primary controls).
