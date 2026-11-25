# MediMate — Product Design & Frontend Build Specification

**Version:** 0.2 | **Status:** Discovery draft for stakeholder review | **Reference:** https://khayalcare.co.in/

This document describes how the MediMate experience should be designed and how its frontend should be built after requirements and designs are approved. It is a product/design specification, not application code or permission to begin implementation.

## 1. Product direction

MediMate remains a **Smart Medication Reminder System for Elderly People**. Its purpose is unchanged:
1. Store medicine names, dosages and prescribed schedules.
2. Remind users when a dose is due.
3. Record taken/missed doses and maintain history.
4. Notify caregivers according to agreed missed-dose rules.
5. Provide a simple, accessible experience for older adults.

### Accepted stakeholder direction so far
The user accepted the first four product-team recommendations in the discovery questionnaire:

| Topic | Agreed direction so far |
|---|---|
| Primary audience | Older adult and caregiver, with distinct experiences |
| Who can add schedules | Either older adult or caregiver, subject to permission |
| First platform | Responsive installable web app / PWA |
| Product priorities | Reminders, dose tracking, caregiver support and independence |

Round 2 decisions have now been recorded: no real SMS in the MVP; in-app + web push only; one follow-up reminder followed by a short grace period before caregiver notification; and one fixed snooze interval. The exact grace-period and snooze durations remain open. Team/project-guide confirmation is still required.

## 2. Khayal Care reference — what to reproduce

The public Khayal Care page is a WhatsApp medicine-reminder product. Its structure includes:
- A strong hero with a concise benefit statement and primary/secondary CTA.
- A “daily worry” problem section.
- A three-step “how it works” section.
- A preview of the parent's reminder experience.
- A caregiver dashboard preview with summary metrics and a dose timeline.
- Feature/benefit cards.
- Privacy, consent and safety statements.
- Pricing, FAQs and a final CTA.

### MediMate frontend direction
Follow the reference's **overall page architecture, section rhythm, hierarchy, whitespace, rounded-card composition, product mockup placement and clear CTA pattern** as closely as a high-fidelity reference-led design exercise.

However, MediMate must use its own name, logo, copy, product screenshots, sample data and original visual assets. Do not reuse Khayal's logo, exact wording, images, source code or proprietary graphics, or imply affiliation. Recreate the layout and interaction patterns in MediMate's own identity.

Khayal's parent interaction is WhatsApp-first. MediMate's current direction is PWA + web push. Therefore, adapt the reminder preview to a MediMate app notification and one-tap dose confirmation. Do not silently add WhatsApp as a requirement.

## 3. Product surfaces and site map

### Public marketing website
```text
/
├── Home / landing page
├── How it works (section)
├── Features (section)
├── Privacy & safety (section)
├── FAQs (section)
├── Sign in
└── Get started
```

### Authenticated application
```text
/app
├── Today (older-adult Simple mode)
├── My medicines
│   ├── Medicine list
│   ├── Add medicine
│   └── Edit medicine
├── Dose history
├── Caregiver dashboard (Care view)
├── Care circle / permissions
├── Notifications
└── Settings
    ├── Accessibility
    ├── Reminder preferences
    ├── Language
    └── Privacy
```
Final navigation labels and role model need stakeholder validation.

## 4. Landing page — section-by-section design

### 4.1 Header
MediMate brand, links for How it works / Features / Safety / FAQs, sign-in and one clear CTA. Collapse navigation cleanly on mobile. Do not include pricing until a business model is approved.

### 4.2 Hero
- Headline: explain that MediMate helps older adults remember prescribed medicines and helps caregivers stay informed.
- Supporting text: schedule management, reminders, dose confirmation and follow-up.
- Primary CTA: Get started (wording subject to approval).
- Secondary CTA: See how it works.
- Visual: large responsive mockup of the MediMate Today screen, showing a fictional next-dose card and clear “Taken” action.
- Avoid unsupported claims such as “never miss a dose” or guaranteed health outcomes.

### 4.3 The daily worry
Empathetic, short statements about multiple schedules, memory burden and the difficulty of knowing whether a dose was confirmed. Avoid fear-based or guilt-based copy.

### 4.4 How it works — three steps
1. **Add the schedule:** older adult or authorised caregiver enters medicine name, prescribed dosage and times.
2. **Receive a reminder:** MediMate sends an in-app/web push alert when due, where permission and device support allow it.
3. **Confirm the dose:** user records the status; history updates and caregiver follow-up occurs only under agreed rules.

### 4.5 What the older adult sees
Show a large mobile/PWA preview with a friendly greeting, today's schedule, next due dose, medicine name, user-entered dosage, scheduled time, a large “Taken” button and optional “Remind me later” action if approved. Show the success state after confirmation.

### 4.6 What the caregiver sees
Show a caregiver dashboard preview:
- Person/profile being cared for.
- Scheduled today, confirmed and pending/unconfirmed summary cards.
- Today's dose timeline with medicine, scheduled time and status.
- Recent activity, including when and by whom a status was recorded.

Do not use an adherence percentage as a medical judgement. If a percentage is displayed, define it as record completion, not a health outcome.

### 4.7 Features
Core: prescribed-schedule reminders, one-tap confirmation, intake history, caregiver missed-dose awareness and accessible Simple mode.

Later candidates (not MVP commitments): multilingual voice prompts, refill prompts from manually maintained stock counts, travel/pause mode, multiple family profiles and optional SMS.

### 4.8 Privacy, consent and safety
Explain caregiver access/consent, who can see information, data deletion/export policy and the product's boundary: MediMate records schedules and reminders; it does not diagnose, prescribe or recommend dosage changes. Do not claim encryption, certification or compliance until implemented and verified.

### 4.9 Pricing, FAQs and footer
Pricing is **not approved** because this is currently an academic project. Do not copy Khayal's trial or subscription model. FAQs should cover installation, notifications, caregiver permissions, unconfirmed doses, privacy and the no-medical-advice boundary. Footer should use project contact details approved for publication, not private student contact information.

## 5. Authenticated screens

### Today — older adult Simple mode
Purpose: show what is due now and what comes next. Display date, next dose, today's list, plain-language status labels and one prominent due-dose action. Include empty, upcoming, due, taken, unconfirmed, offline and notification-disabled states.

### My medicines
List medicine name, user-entered dosage, schedule summary and active/paused status. Provide view/edit actions only to authorised users. Confirm pause/archive actions and show who last changed a schedule.

### Add/edit medicine
Candidate fields: medicine name, prescribed dosage text, schedule frequency/times, start/end date if needed, optional instructions copied from the prescription, optional stock count for later refill support. Require review before saving. The app stores user-provided instructions; it must not decide clinical appropriateness or alter a prescription.

### Dose reminder
Show medicine, dosage as entered, scheduled time and any user-entered note. Primary action: Taken. Secondary snooze action only if its rules are approved. After action, show clear feedback, update history and caregiver view, and prevent duplicate submissions. Never tell a user to take an extra dose after responding late.

### Dose history
Show scheduled time, recorded status, recorded time and actor/source. Distinguish an explicitly reported missed dose from a dose with no response.

### Caregiver dashboard / Care circle
Show permitted schedule/status information and caregiver invitations/permissions. Define consent, visibility, invitation expiry, revocation and multiple-caregiver behavior before implementation. A caregiver must not silently mark a dose taken for the older adult unless a specifically approved rule allows it and records who acted.

### Settings
Show notification permission state, web-push enablement instructions, language, text size, sound/voice preference, Simple mode, privacy and caregiver permissions. Do not show an SMS toggle in the MVP because real SMS is excluded (Q11-A). Request notification permission after a clear explanation and a user action—not immediately on page load.

The interface must explain that reminders can be shown in-app and via web push when supported and permitted, but delivery is not guaranteed. If permission is denied or unsupported, show a persistent, understandable status and instructions to enable notifications. Do not imply that an in-app notice will reach the user when the application is closed.

## 6. Dose-state and interaction rules

Stakeholder-selected reminder behavior (Round 2):
- Send the initial due reminder.
- If there is no response, send one gentle follow-up reminder.
- If the dose remains unconfirmed after a short grace period, notify the caregiver through the approved in-app/web-push channel.
- Keep the dose status as “Unconfirmed” unless an authorised person explicitly records it as “Missed” or a separate status rule is approved.
- Exact follow-up timing and grace duration remain TBD.

Stakeholder-selected snooze behavior: one fixed snooze interval. The duration is TBD; 10 minutes was an example only. Snooze must resurface the reminder without modifying the prescribed schedule, dose occurrence or medicine instructions. The maximum number of snoozes per dose occurrence is also TBD.

Recommended state model for stakeholder approval:

| State | Meaning | Display label |
|---|---|---|
| Scheduled | Future dose | Upcoming |
| Due | Scheduled time has arrived | Due now |
| Taken | Confirmed by user/authorised actor | Taken |
| Snoozed | Deferred using approved rule | Remind me later |
| Unconfirmed | No response yet | Not confirmed |
| Missed | Explicitly reported or classified under agreed rule | Missed |

Do not mark a dose missed immediately just because a notification was ignored. Agree the grace period, follow-up reminder count, caregiver escalation and audit trail. Use “Unconfirmed” as an intermediate state. Duplicate notification retries must not create duplicate dose records or caregiver alerts.

## 7. Web push and SMS — cost and feasibility

### Web push
**Yes: the push-delivery product can be used at no cost.** Firebase lists Cloud Messaging (FCM) as a no-cost product. But web push still requires HTTPS, a service worker, a supported browser/device, user permission and a backend sender. iOS/iPadOS supports web push for web apps added to the Home Screen on version 16.4 or later; permission must follow a direct user interaction.

FCM being free does not make the whole application free. Hosting, database, domain, scheduler/worker, storage and monitoring may have their own charges or free-tier limits. Browser/device settings, connectivity and revoked permissions can prevent delivery. Never promise 100% delivery.

### SMS
**No: do not plan on unlimited production SMS being free.** Some gateways offer free test credits/sandbox access, but real transactional messages are generally billed per delivered message. Published examples checked for this document:
- 2Factor lists transactional SMS around ₹0.15/message at its lower volume tier.
- MSG91 shows India-to-India rates that vary with volume, with displayed rates around ₹0.16–₹0.25/message.
Prices can change; GST and provider terms may apply.

TRAI's sender guidance lists sender registration, header and content-template requirements for bulk communications including service/transactional categories. Confirm classification and onboarding requirements with the chosen provider before production use.

**Stakeholder decision (Q11-A):** exclude real SMS from the MVP. Use in-app notifications + web push only. Do not include an SMS toggle, provider integration, paid SMS path or fake “SMS sent” status in the MVP. A future SMS release would require a new stakeholder decision, approved budget and provider/regulatory review.

### Notification event flow
```text
Schedule saved -> dose occurrence created -> backend scheduler reaches due time
  -> in-app event + web push (if subscribed)
  -> user response?
       Yes -> save status -> update history and permitted caregiver view
       No  -> keep Unconfirmed -> approved repeat/grace rule
             -> caregiver notification under consent
             -> optional paid SMS provider, only if approved
```
Frontend code alone cannot reliably schedule alerts when the page is closed. The system needs a backend scheduler/worker, delivery logs, retry handling and duplicate-event protection.

## 8. Visual system and accessibility

**Reference note:** The public page's overall structure is clear from its content. Exact color values, typography, spacing, radii and shadows must be sampled from the live reference at desktop and mobile widths before high-fidelity sign-off; do not invent exact values and claim they match.

Design principles:
- Calm, friendly healthcare SaaS.
- Generous whitespace, short copy blocks and clear hierarchy.
- Rounded feature cards, restrained shadows and large product previews.
- Prominent primary CTA with clear secondary action.
- Warm, respectful tone; no childish or punitive gamification.

Accessibility baseline: target WCAG 2.2 AA, subject to review.
- Semantic headings, labelled form controls and keyboard-accessible navigation.
- Visible focus and sufficient text/control contrast.
- Do not rely on colour alone to show dose status.
- Aim for 44 × 44 CSS px touch targets on primary controls.
- Support browser zoom and larger text.
- Respect reduced-motion settings.
- Provide visual alternatives to voice and sound cues.
- Use alt text for meaningful imagery.

Responsive behavior:
| Viewport | Layout |
|---|---|
| 360–480 px | Single column, stacked CTAs, compact menu, one-column cards |
| 481–767 px | Mobile layout with more breathing room |
| 768–1023 px | Two-column feature/preview sections where readable |
| 1024 px+ | Split hero, multi-column feature cards, full caregiver dashboard |

Older-adult Today view should remain simple at all viewport sizes.

## 9. Frontend build sequence (after approval)

**Phase 0 — Reference audit and content lock**
- Capture Khayal Care at desktop, tablet and mobile sizes.
- Record section sequence, spacing, type hierarchy, card treatment, button treatment and responsive changes.
- Create MediMate-specific copy and fictional sample data.
- Sign off on wireframes.
**Exit:** approved sitemap, copy outline and reference board.

**Phase 1 — Design foundation**
- Define typography, color tokens, spacing, radii, shadows and breakpoints.
- Define buttons, inputs, cards, status chips, navigation and Simple/Care modes.
- Complete accessible wireframes and high-fidelity designs.
**Exit:** approved design system and screens.

**Phase 2 — Public landing frontend**
Build header, hero, daily-worry section, 3-step flow, older-adult preview, caregiver preview, features, privacy/safety, FAQs and footer. Keep pricing disabled unless approved.
**Exit:** responsive, content-approved landing page.

**Phase 3 — Authenticated app shell**
Build role-aware navigation, Today, medicine list/form, reminder view, history, caregiver dashboard, care circle and settings using synthetic data.
**Exit:** navigation and key screen states reviewed.

**Phase 4 — Interaction states**
Implement empty/loading/error/success states, form validation, dose actions, confirmation, permission-denied fallback, offline state and duplicate-tap protection.
**Exit:** each approved MVP story has observable acceptance criteria.

**Phase 5 — API and notification integration**
Connect API data, server authorization, push subscriptions, notification click-through and truthful delivery/permission status. Connect SMS only after provider/cost approval.
**Exit:** end-to-end reminders and history verified on supported devices.

**Phase 6 — Quality validation**
Test mobile/tablet/desktop, keyboard, zoom, text size, permission grant/deny/revoke, slow network, offline state, duplicate taps and expired sessions. Conduct usability sessions with representative older adults/caregivers using synthetic data.
**Exit:** critical defects resolved and stakeholder acceptance recorded.

## 10. Proposed frontend stack (not yet frozen)

The academic synopsis proposes React. Recommended frontend direction:

| Layer | Proposal | Reason |
|---|---|---|
| UI | React + TypeScript | Reusable screens and safer interaction/data states |
| Tooling | Vite | Lightweight modern development/build |
| Styling | Token-based CSS / CSS Modules | Fine visual control for a reference-led design |
| PWA | Web App Manifest + Service Worker | Installable experience and notification handling |
| Web push | Firebase Cloud Messaging | Listed as no-cost by Firebase |
| Forms | React Hook Form + Zod (optional) | Consistent form validation |
| Browser tests | Playwright | Critical user journey and responsive testing |
| Accessibility | axe-core + manual review | Automated checks plus real usability evaluation |

The synopsis proposes Node.js + Express.js + MySQL for the backend. Keep that as the baseline proposal until the team approves the final versions, hosting, scheduler and database strategy in `TECH_RULES.md`.

## 11. Frontend definition of done

- MediMate's original purpose and five core objectives are preserved.
- Landing page follows the approved Khayal-inspired structure with original MediMate content/assets.
- Marketing and authenticated screens respond correctly across phone, tablet and desktop.
- Older-adult and caregiver modes are distinguishable and usable.
- Every key screen has loading, empty, error and success states.
- The app never fabricates a push/SMS delivery success.
- Accessibility, text enlargement, keyboard, contrast and touch interaction checks pass.
- Demo uses synthetic data only.
- Each approved user story and acceptance criterion is verified.

## 12. Decisions still open

1. Does the whole project team/project guide confirm the accepted user/platform directions?
2. SMS policy: mock-only, optional paid fallback, or excluded from MVP?
3. Grace period and follow-up rule before caregiver alert?
4. Is snooze allowed, and at what interval?
5. Exact caregiver invitation, consent and permission model?
6. Is pricing excluded from the academic landing page?
7. Which languages are in MVP?
8. Who approves the sampled visual system and wireframes?
9. Final technology versions and hosting?

## 13. Research references

- Khayal Care public page: https://khayalcare.co.in/
- Firebase Web Messaging setup: https://firebase.google.com/docs/cloud-messaging/web/get-started
- Firebase pricing (FCM no-cost listing): https://firebase.google.com/pricing
- Apple Web Push for web apps and browsers: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
- WebKit: Web Push for Home Screen web apps on iOS/iPadOS: https://webkit.org/blog/13878/
- TRAI advice to senders: https://www.trai.gov.in/advice-to-senders
- 2Factor India pricing: https://www.2factor.in/v4/pricing.html
- MSG91 India SMS pricing: https://msg91.com/in/pricing/sms

Pricing, free credits, provider terms and regulatory onboarding can change. Recheck before choosing a provider or telling users SMS is free.
