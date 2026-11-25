# Product Design & Accessible Design System
# MediMate — Smart Medication Reminder System for Older Adults

**Document Status:** Approved Production Design Specification  
**Design Standard:** WCAG 2.2 Level AA / AAA Compliant  
**Inspiration & Architecture Reference:** Khayal Care Layout Architecture (Tailored to MediMate's Standalone Identity)  
**Date:** 2026-11-24  

---

## 1. Design Overview

### 1.1 Product Purpose & Philosophy
MediMate provides a calm, dignified, and ultra-accessible medication management experience. It reconciles two distinct user mindsets:
1. **The Older Adult:** Seeks absolute simplicity, reassurance, zero cognitive clutter, oversized touch targets, and effortless one-tap confirmation.
2. **The Remote Caregiver:** Seeks rapid, at-a-glance status verification, real-time timeline clarity, and immediate actionable alerts when a dose is unconfirmed.

### 1.2 Target Platforms
- **Primary Delivery:** Installable Progressive Web Application (PWA) optimized for mobile touchscreens (iOS Safari / Android Chrome), tablets, and desktop browsers.
- **Form Factors:** Mobile-first responsive grid (360px to 1920px+).

### 1.3 Design Reference & Relationship to Khayal Care
MediMate adapts the proven user flow and layout composition of the reference (clear hero message, rounded-card hierarchy, real-time caregiver timeline, and compliance metrics) while establishing its own visual identity, color system, typography, and PWA interaction paradigm. MediMate eliminates third-party messaging dependencies in favor of native web push notifications and in-app tactile actions.

---

## 2. Design Principles

1. **Dignity Over Surveillance:** Language is respectful, supportive, and non-judgmental. Reminders are gentle prompts, not punitive alarms.
2. **Cognitive Clarity (Single-Task Focus):** In Elderly Simple Mode, the interface presents exactly one dominant question: *"What do I need to take right now?"* All secondary navigation, settings, and complex histories are tucked away or surfaced only when relevant.
3. **Multi-Sensory Feedback:** Every critical action (confirming a dose, snoozing) is accompanied by three simultaneous cues: visual transformation (color/icon), physical haptic vibration (device vibration API), and auditory confirmation.
4. **Forgiving Touch Geometry:** Interactive controls exceed the minimum WCAG 2.2 AA $44\times 44\text{px}$ standard, offering large target zones ($\ge 64\text{px}$ height in Simple Mode) to accommodate intentional or imprecise tremors.
5. **Never Color Alone:** Color coding is strictly paired with geometric pill markers, descriptive iconography, and explicit plain-text status labels.

---

## 3. Information Architecture

```text
MediMate PWA
├── Public / Marketing & Sign-In (/login)
│   ├── Welcoming Hero & Mission Statement
│   ├── Role Selection Toggle: [I am an Older Adult] | [I am a Family Caregiver] | [I manage both]
│   └── Secure Authentication (Email / Password / Credential Token)
│
├── Elderly "Simple Mode" Interface (/app/today)
│   ├── Header: Friendly Personalized Greeting ("Good Morning, Ramesh") & Live Clock
│   ├── Status Card: Next Scheduled / Due Dose Card
│   │   ├── Visual Pill Marker (Color + Shape Graphic)
│   │   ├── Medication Name (Large 32px Font) & Dosage
│   │   └── Prescribed Timing & Dietary Instructions ("Take after breakfast with water")
│   ├── Primary Action Zone:
│   │   ├── Single-Tap "Taken ✓" Confirmation Button (Height: 68px, High-Contrast Green)
│   │   └── Single-Tap "Remind Me Later (10 min)" Snooze Button (Height: 52px, Amber Outline)
│   └── Today's Schedule Overview: Collapsible list of upcoming & completed doses for the day
│
├── Caregiver Dashboard (/app/dashboard)
│   ├── Care Circle Header & Patient Switcher
│   ├── Persistent Escalation Alert Banner (Conditional: Visible if any dose is 'unconfirmed')
│   │   ├── High-Contrast Red Warning Banner
│   │   ├── Medication Name, Overdue Duration (e.g. "Overdue by 34 minutes")
│   │   └── One-Tap "Call Patient" Action Button
│   ├── Today's Compliance Summary Badges (4 Metric Cards: Scheduled, Taken, Pending, Unconfirmed)
│   ├── Real-Time Dose Timeline (Firestore onSnapshot Live Stream)
│   │   └── Chronological Dose Cards with Status Chips, Timestamp, and Taken-By Actor
│   ├── Medication Schedule Manager (Add / Edit Prescriptions, Dosages, Times)
│   └── Care Circle Management (View Members, Send Invites, Revoke Access)
│
└── Settings & Accessibility (/app/settings)
    ├── High Contrast Mode Toggle
    ├── Sound & Haptic Feedback Toggles
    ├── Notification Permissions Guide
    └── Care Circle Pairing Code
```

---

## 4. Visual Identity & Design Tokens

### 4.1 Color Palette & Contrast Ratios
The palette is calibrated against WCAG 2.2 AA (minimum 4.5:1 text, 3:1 graphical controls) and WCAG 2.2 AAA (7:1 for critical text and primary elderly controls).

| Token Name | Hex Code | Purpose / Application | Contrast Ratio (vs. Background) |
|---|---|---|---|
| `--color-bg-canvas` | `#F8FAFC` | Main application background (Slate 50) | Baseline surface |
| `--color-surface-card` | `#FFFFFF` | Primary card and container surface | **1.05:1** vs `#F8FAFC` canvas |
| `--color-text-primary` | `#0F172A` | Primary headings, medication names (Slate 900) | **17.85:1** on `#FFFFFF` (Exceeds AAA) |
| `--color-text-secondary`| `#334155` | Instructions, secondary labels (Slate 700) | **10.35:1** on `#FFFFFF` (Exceeds AAA) |
| `--color-text-muted` | `#475569` | Timestamps, metadata (Slate 600) | **7.58:1** on `#FFFFFF` (Exceeds AAA) |
| `--color-primary-teal` | `#115E59` | Brand accent, navigation links (Teal 800) | **7.58:1** on `#FFFFFF` (True AAA) |
| `--color-taken-green` | `#166534` | "Taken" confirmation button & badges (Green 800) | **7.13:1** on `#FFFFFF` (True AAA); Button: `#FFFFFF` on `#166534` (**7.13:1**, True AAA, meets PRD AC-10 >= 7:1) |
| `--color-snooze-amber` | `#B45309` | Snooze button border, text & badges (Amber 700) | **5.02:1** on `#FFFFFF` (Exceeds AA) |
| `--color-alert-red` | `#991B1B` | Escalated / Unconfirmed alert banner, text & CTA (Red 800) | **8.31:1** on `#FFFFFF` (True AAA); **7.60:1** on `#FEF2F2` banner surface (True AAA) |
| `--color-alert-bg` | `#FEF2F2` | Unconfirmed dose banner background (Red 50) | Subtle, calm warning surface |
| `--color-focus-ring` | `#0284C7` | High-visibility focus indicator (Sky 600) | **4.10:1** on `#FFFFFF` / **3.91:1** on `#F8FAFC` (Exceeds 3:1 UI non-text); 3px solid outline, 2px offset |

### 4.2 Typography Scale
All typography uses system font stacks for zero font-download latency:
`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.

| Text Style Role | Font Size (px / rem) | Font Weight | Line Height | Application |
|---|---|---|---|---|
| **Elderly Hero / Pill Name** | 32px / 2.0rem | 700 (Bold) | 1.25 | Medication name on Next Dose Card |
| **Elderly Primary Greeting** | 28px / 1.75rem | 700 (Bold) | 1.3 | Top greeting in Simple Mode |
| **Elderly Taken Button Label** | 24px / 1.5rem | 700 (Bold) | 1.2 | `"Taken ✓"` primary confirmation button text |
| **Elderly Snooze Button Label** | 18px / 1.125rem | 600 (Semibold) | 1.25 | `"Remind Me Later (10 min)"` secondary button text |
| **Elderly Dosage** | 22px / 1.375rem | 600 (Semibold) | 1.35 | Dosage label on Next Dose Card (e.g., `500 mg`) |
| **Elderly Instructions** | 18px / 1.125rem | 400 (Regular) | 1.45 | Dietary and administration instructions |
| **Caregiver Section Heading** | 22px / 1.375rem | 700 (Bold) | 1.3 | Dashboard section titles |
| **Caregiver Card Title** | 18px / 1.125rem | 600 (Semibold) | 1.4 | Timeline medication names |
| **Caregiver Body Text** | 16px / 1.0rem | 400 (Regular) | 1.5 | General descriptions, forms, modal text |
| **Caregiver Metadata** | 14px / 0.875rem | 500 (Medium) | 1.4 | Timestamps, badge chips, status labels |

### 4.3 Spacing & Layout Tokens
- `--space-xs`: 4px (0.25rem)
- `--space-sm`: 8px (0.5rem)
- `--space-md`: 16px (1.0rem)
- `--space-lg`: 24px (1.5rem)
- `--space-xl`: 32px (2.0rem)
- `--space-2xl`: 48px (3.0rem)
- `--radius-card`: 16px (1.0rem) — Generously rounded corners reflecting a friendly, modern healthcare feel.
- `--radius-btn`: 12px (0.75rem) — Pill-shaped or rounded-rectangle buttons.

---

## 5. Elderly "Simple Mode" Screen Specification

### 5.1 Purpose & Entry Point
Designed for older adults who want to confirm their current medication with maximum speed and zero friction.
- **Entry Point:** Default home view when authenticated user role is `elderly` or `dual`.

### 5.2 Layout Hierarchy & Components

```text
┌────────────────────────────────────────────────────────┐
│  MediMate                         [Simple Mode Active] │
├────────────────────────────────────────────────────────┤
│  Good Morning, Ramesh!                                 │
│  Tuesday, November 24 • 8:00 AM                        │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │  💊 DUE NOW                                      │  │
│  │                                                  │  │
│  │  [ Capsule Icon ]  Metformin                     │  │
│  │    White & Blue    500 mg                        │  │
│  │                                                  │  │
│  │  📋 Instructions:                                │  │
│  │  "Take with a full glass of water after breakfast" │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │                                                  │  │
│  │                  TAKEN  ✓                        │  │
│  │                                                  │  │
│  └──────────────────────────────────────────────────┘  │
│   (Height: 68px, Min-Width: 220px, Bg: #166534, Text: #FFFFFF 24px Bold) │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │           Remind Me Later (10 min)               │  │
│  └──────────────────────────────────────────────────┘  │
│   (Height: 52px, Border: 2px #B45309, Text: #B45309 18px)│
│                                                        │
│  ▼ Next up today:                                      │
│  • Amlodipine 5mg at 8:00 PM                           │
└────────────────────────────────────────────────────────┘
```

### 5.3 Detailed Component Specifications

#### 1. Next Scheduled / Due Dose Card
- **Dimensions:** Full container width, padding `24px`, border `2px solid #E2E8F0`, border-radius `16px`, background `#FFFFFF`.
- **Due State Animation:** When the dose reaches scheduled time $T$, the card border pulses gently with a subtle teal glow (`box-shadow: 0 0 0 4px rgba(17, 94, 89, 0.2)`).
- **Pill Visual Marker:**
  - High-contrast geometric pill icon rendered from denormalized `color` and `shape` (`PillShape`: `round` | `capsule` | `oval` | `square`), size `48x48px`.
  - Accessible description: `aria-label="White and blue capsule-shaped pill"`.
- **Text Elements:**
  - Status Tag: `DUE NOW` badge (Bold `14px`, `#042F2E` deep navy/teal text on soft teal background `#CCFBF1` — **12.84:1** contrast, exceeds AAA).
  - Medication Name: `32px` (`2rem`) `700` Bold `#0F172A` (**17.85:1** contrast).
  - Dosage: `22px` (`1.375rem`) `600` Semibold `#334155` (**10.35:1** contrast).
  - Dietary Instruction: `18px` (`1.125rem`) `400` Regular `#1E293B`, framed in a light gray info callout `#F1F5F9` (**13.35:1** contrast).

#### 2. Single-Tap "Taken" Confirmation Button
- **Dimensions:** Width `100%` (min-width `220px`), Height `68px`.
- **Touch Target:** Substantially exceeds WCAG 2.2 AA ($44\times 44\text{px}$) to guarantee accessibility for hand tremors.
- **Styling:** Solid `#166534` (Green 800) background with `#FFFFFF` bold text (`24px`), achieving **7.13:1** contrast (True WCAG AAA, satisfies PRD AC-10 $\ge 7:1$ for primary controls).
- **Tactile & Visual Feedback:**
  - On tap: Triggers `navigator.vibrate([40, 60, 40])` for double haptic pulse.
  - State transforms instantly into a confirmation checkmark animation: **"Recorded! Good job."**
  - Button disables immediately to prevent duplicate submissions.
  - Optimistic client update completes within `50ms`; background Firestore write via `confirmDoseTaken` persists `takenAt` and `takenBy`.

#### 3. Single-Tap "Remind Me Later" (Snooze) Button
- **Dimensions:** Width `100%`, Height `52px` (well above $44\text{px}$ minimum).
- **Styling:** White surface (`#FFFFFF`), `2px` solid `#B45309` border, `#B45309` semibold text (`18px`, **5.02:1** contrast).
- **Interaction Logic:**
  - Tapping postpones reminder by exactly 10 minutes (`snoozeUntil = now + 10m`).
  - `snoozeCount` increments to 1.
  - Button immediately transitions to disabled state:
    - Text changes to: *"Snooze limit reached (10m delay active)"* while actively snoozed, and *"Snooze limit reached"* once returned to `due` after 10-minute expiry.
    - Note on escalation precedence: If snoozed at $T+25\text{m}$ (`snoozeUntil = T+35m`), caregiver escalation still triggers at $T+30\text{m}$ (`unconfirmed`), while the patient can still tap `"Taken ✓"` at $T+35\text{m}$ to resolve the dose in real time.
    - Background: `#F1F5F9`, Text: `#94A3B8`, Cursor: `not-allowed`.
    - `aria-disabled="true"`.

---

## 6. Caregiver Dashboard Specification

### 6.1 Purpose & Entry Point
Provides real-time visibility across all prescribed medications, historical adherence, and urgent unconfirmed dose escalations for family caregivers and nurses.
- **Entry Point:** Default home view when authenticated user role is `caregiver` or accessed via mode switcher in `dual` role.

### 6.2 Layout Hierarchy & Components

```text
┌────────────────────────────────────────────────────────────────────────┐
│  MediMate Caregiver     [Monitoring: Ramesh Sharma ▼]    [+ Invite]   │
├────────────────────────────────────────────────────────────────────────┤
│  ⚠️ URGENT ALERT: Ramesh Sharma has 1 unconfirmed dose!                │
│  Metformin 500 mg was scheduled for 8:00 AM (Overdue by 32 min)        │
│  [ Call Ramesh (9876543210) ]                [ Mark Resolved ]         │
├────────────────────────────────────────────────────────────────────────┤
│  TODAY'S COMPLIANCE SUMMARY                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │ 3 Scheduled  │ │   2 Taken    │ │  0 Pending   │ │1 Unconfirmed │   │
│  │ Total Prescr.│ │ Confirmed OK │ │ Due within 30m│ │ Escalated!   │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
├────────────────────────────────────────────────────────────────────────┤
│  REAL-TIME DOSE TIMELINE (Live Sync)                                   │
│                                                                        │
│  [08:00 AM]  Metformin 500 mg                       [UNCONFIRMED ⚠️]   │
│              Scheduled 8:00 AM • Follow-up sent 8:15 AM                 │
│              Escalated to Care Circle at 8:30 AM                       │
│                                                                        │
│  [08:00 AM]  Amlodipine 5 mg                        [TAKEN ✓]          │
│              Scheduled 8:00 AM • Confirmed 8:04 AM by Ramesh (Self)    │
│                                                                        │
│  [08:00 PM]  Atorvastatin 20 mg                     [SCHEDULED 🕒]     │
│              Scheduled 8:00 PM • Evening dose with dinner              │
└────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Detailed Component Specifications

#### 1. High-Visibility Persistent Escalation Alert Banner
- **Visibility:** Rendered dynamically at the top of the dashboard whenever any dose has `status === 'unconfirmed'`.
- **Styling:** Border `2px solid #991B1B`, background `#FEF2F2`, text `#991B1B` (**7.60:1** contrast, True AAA), padding `16px 20px`, border-radius `12px`.
- **Accessibility:** Configured with `role="alert"` and `aria-live="assertive"`.
- **Action Buttons:**
  - **"Call Patient":** Direct `tel:` link styled as a solid dark-red button (`#991B1B` background with `#FFFFFF` text = **8.31:1** contrast, True AAA, min touch target $44\times 44\text{px}$). If neither `CareCircleDocument.patientPhone` nor `UserDocument.phoneNumber` is available, display a disabled `"No phone on file"` state instead of an empty `tel:` link.
  - **"Mark Resolved":** Secondary button allowing caregiver to manually confirm the dose via `confirmDoseTaken(doseLogId, caregiverUid)`, which transitions `unconfirmed` $\rightarrow$ `taken` (recording `takenAt` and `takenBy = caregiverUid`) and dismisses the alert banner.

#### 2. Today's Compliance Summary Badges
Four compact metric cards displaying adherence progress:
1. **Scheduled:** Neutral Slate (`#F1F5F9` background, `#0F172A` text — **16.30:1**) — Count of total doses prescribed for the current calendar date in the patient's timezone.
2. **Taken:** Soft Green (`#DCFCE7` background, `#166534` text — **6.49:1**) — Count of doses successfully confirmed.
3. **Pending:** Soft Blue (`#E0F2FE` background, `#075985` text — **6.59:1**) — Count of doses upcoming or currently due within grace window.
4. **Unconfirmed:** Soft Red (`#FEE2E2` background, `#991B1B` text — **6.80:1**, bold pulse) — Count of doses overdue by $>30$ minutes.

#### 3. Real-Time Dose Timeline (`DoseTimeline.tsx`)
- Driven by a Firestore snapshot listener via `subscribeToDoseLogs(patientId, patientLocalDate, callback)` where `patientLocalDate` (`"YYYY-MM-DD"`) is computed in the **patient's IANA `timezone`** (preventing cross-timezone midnight drift between caregiver and patient devices): `onSnapshot(query(collection('dose_logs'), where('patientId', '==', id), where('scheduledDate', '==', patientLocalDate)))`.
- Updates DOM instantaneously without page reloads.
- Distinct Status Badge Chips (explicit foreground & background hex tokens with verified WCAG 2.2 contrast):
  - `scheduled`: `#334155` text on `#F1F5F9` background (**9.45:1** contrast), Clock Icon (`Scheduled`).
  - `due`: `#1E40AF` text on `#DBEAFE` background (**7.15:1** contrast), Bell Icon (`Due Now`).
  - `taken`: `#166534` text on `#DCFCE7` background (**6.49:1** contrast), Checkmark Icon (`Taken at 8:04 AM`).
  - `snoozed`: `#92400E` text on `#FEF3C7` background (**6.37:1** contrast), Pause Icon (`Snoozed until 8:10 AM`).
  - `unconfirmed`: `#991B1B` text on `#FEE2E2` background (**6.80:1** contrast), Alert Triangle Icon (`Overdue - Escalated`).
  - `missed`: `#475569` text on `#E2E8F0` background (**6.15:1** contrast), X-Circle Icon (`Missed`).

#### 4. Care Circle Management Section
- Displays current members of the patient's care circle with role badges (`Primary Caregiver`, `Secondary / Nurse`).
- Modal dialog for inviting new caregivers via email with permission toggles:
  - *Can view dose timeline and adherence history.*
  - *Can edit medication schedules and dosages.*
  - *Receives escalation alerts for unconfirmed doses.*

---

## 7. Accessibility & Usability Standards (WCAG 2.2 AA Compliance)

### 7.1 Touch Target Sizing & Spatial Separation
- **Target Size:** Every button, toggle, dropdown, and interactive icon must measure at least $44\times 44\text{px}$ in computed CSS layout (WCAG 2.2 Success Criterion 2.5.8).
- **Simple Mode Buttons:** Primary "Taken" button height is set to `68px`; Snooze button is set to `52px`.
- **Target Separation:** Minimum $12\text{px}$ margin between adjacent interactive elements to prevent accidental touches by users with hand tremors.

### 7.2 Visual & Screen Reader Semantics
- **Color Independence:** Color is never used as the sole conveyor of meaning. Statuses always combine color with an SVG icon and plain-text label (e.g. green checkmark + text "Taken").
- **Semantic Structure:**
  - Simple Mode wraps content in `<main role="main">` with semantic `<header>`, `<section>`, and `<article>` tags.
  - The live alert banner uses `role="alert"` and `aria-live="assertive"`.
  - Timeline updates use `aria-live="polite"` so screen readers inform blind users when a dose changes status without interrupting current speech.
- **Keyboard Navigation & Visible Focus:**
  - All interactive elements are fully focusable in standard tab order.
  - Active focus is highlighted with a 3px solid Sky Blue outline (`#0284C7`) with a 2px offset (`outline-offset: 2px`).

---

## 8. Responsive Breakpoint Layout Matrix

| Breakpoint | Viewport Range | Simple Mode (Elderly) Behavior | Caregiver Dashboard Behavior |
|---|---|---|---|
| **Mobile** | $360\text{px} - 639\text{px}$ | Single centered column (max-width 420px), full-width action buttons, oversized touch targets. | Single-column stacked cards, full-width summary metrics, bottom sticky alert banner. |
| **Tablet** | $640\text{px} - 1023\text{px}$ | Centered focus card with generous whitespace (max-width 540px), horizontal button pairing. | 2-column grid: Left column = timeline & alerts; Right column = summary badges & care circle. |
| **Desktop** | $1024\text{px}+$ | Centered high-contrast card (max-width 640px) ensuring no eye-strain or neck movement. | 3-column layout: Left = patient selector & care circle; Center = live timeline; Right = schedule manager. |

---

## 9. Design System Asset Specifications

### 9.1 Pill Markers & Shapes
Pill markers provide an instant visual bridge between the screen prompt and the physical medication box:
- **Round Tablet:** `svg` circle with center score line, colored per medication schema (`#3B82F6`, `#EF4444`, `#10B981`, `#F59E0B`).
- **Capsule:** `svg` rounded capsule with dual-tone bi-color fill (e.g. white body, colored cap).
- **Oval Caplet:** `svg` smooth elongated ellipse.
- **Square Tablet:** `svg` rounded-rect with cross score line.

### 9.2 Tactile & Sound Assets
- **Haptic Patterns:**
  - Taken Tap: `navigator.vibrate([40, 60, 40])` (double tap success confirmation).
  - Snooze Tap: `navigator.vibrate([80])` (single gentle confirmation).
  - Escalation Alert: `navigator.vibrate([200, 100, 200, 100, 400])` (urgent pulsing pattern).
- **Audio Chimes:** Short, gentle, pleasant frequency tones ($440\text{Hz}$ / $520\text{Hz}$) avoiding harsh buzzer sounds that induce panic.
