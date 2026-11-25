export interface NavLinkItem {
  label: string;
  href: string;
}

export interface DailyWorryItem {
  id: string;
  title: string;
  description: string;
}

export interface HowItWorksStep {
  stepNumber: number;
  title: string;
  description: string;
}

export interface FeatureItem {
  id: string;
  title: string;
  description: string;
}

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export const NAV_LINKS: readonly NavLinkItem[] = [
  { label: 'How It Works', href: '#how-it-works' },
  { label: 'Features', href: '#features' },
  { label: 'Safety', href: '#safety' },
  { label: 'FAQs', href: '#faqs' },
];

export const DAILY_WORRY_CARDS: readonly DailyWorryItem[] = [
  {
    id: 'multiple-schedules',
    title: 'Keeping track of multiple daily times',
    description:
      'Morning, afternoon, and bedtime prescriptions often carry different meal notes. A calm, structured view keeps every scheduled dose clear.',
  },
  {
    id: 'memory-uncertainty',
    title: 'Wondering whether a dose was already taken',
    description:
      'Without a written or tapped record, it is easy to second-guess an earlier pill. Clear confirmation removes everyday guesswork.',
  },
  {
    id: 'caregiver-checkin',
    title: 'Reassuring family without constant phone calls',
    description:
      'Family members want to know a loved one is okay without interrupting their day. Shared visibility replaces repetitive check-in calls.',
  },
];

export const HOW_IT_WORKS_STEPS: readonly HowItWorksStep[] = [
  {
    stepNumber: 1,
    title: 'Add the prescribed schedule',
    description:
      'The older adult or an authorized caregiver enters each medicine name, user-entered dosage, meal note, and daily schedule times.',
  },
  {
    stepNumber: 2,
    title: 'Receive a timely reminder',
    description:
      'When a dose time arrives, MediMate shows an in-app alert and sends a web push notification where browser support and permission allow.',
  },
  {
    stepNumber: 3,
    title: 'Confirm and keep family informed',
    description:
      'One tap records the dose in history. If a dose remains unconfirmed past 15 minutes, a gentle nudge is sent, and linked caregivers are notified at 30 minutes.',
  },
];

export const CORE_FEATURES: readonly FeatureItem[] = [
  {
    id: 'scheduled-reminders',
    title: 'Prescribed-schedule reminders',
    description:
      'Fixed daily or specific-weekday schedules paired with clear mealtime labels (Breakfast, Lunch, Dinner, Bedtime).',
  },
  {
    id: 'one-tap-undo',
    title: 'One-tap confirmation with 5-second undo',
    description:
      'A 68px high-contrast "Taken ✓" button paired with a gentle audio chime and a 5-second undo bar to prevent accidental taps.',
  },
  {
    id: 'intake-history',
    title: 'Transparent intake history',
    description:
      'Every dose clearly records whether it is upcoming, due, taken, snoozed for 10 minutes, unconfirmed, or missed—along with who confirmed it.',
  },
  {
    id: 'caregiver-awareness',
    title: 'Caregiver missed-dose awareness',
    description:
      'Linked Care Circle members view real-time daily timelines, 7-day record summaries, and 30-minute unconfirmed escalation alerts.',
  },
  {
    id: 'simple-mode',
    title: 'Accessible Older-Adult Simple Mode',
    description:
      'Large typography, WCAG 2.2 AA/AAA contrast tokens, 44px+ touch targets, and a single focused Next Dose card free of clutter.',
  },
  {
    id: 'offline-pwa',
    title: 'Installable, offline-ready PWA',
    description:
      'Install directly to a phone or tablet home screen and keep viewing and recording schedules even during brief network drops.',
  },
];

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    id: 'pwa-install',
    question: 'How do I install MediMate on a phone or tablet?',
    answer:
      'MediMate is a Progressive Web App (PWA). On Android Chrome or desktop browsers, use the "Install App" prompt or browser menu ("Add to Home Screen"). On iPhone or iPad (iOS/iPadOS 16.4 or later), open MediMate in Safari, tap Share, and choose "Add to Home Screen". It also works directly in a standard web browser without installation.',
  },
  {
    id: 'web-push',
    question: 'How do reminders and web push notifications work?',
    answer:
      'MediMate displays clear in-app due cards whenever the app is open and supports Firebase Cloud Messaging web push alerts on compatible browsers once you grant notification permission. Because browser settings, device battery modes, and network connectivity affect delivery, web push is always a helpful aid rather than a guaranteed alert.',
  },
  {
    id: 'caregiver-consent',
    question: 'How do caregiver consent and Care Circle permissions work?',
    answer:
      'Caregivers can only view an older adult’s schedule and dose status after an explicit Care Circle link is established with consent. Permissions define who can view timelines, manage prescriptions, or receive escalation notifications, and Care Circle links can be updated or revoked.',
  },
  {
    id: 'unconfirmed-doses',
    question: 'What happens if a dose is not confirmed on time?',
    answer:
      'At the scheduled time, the dose enters "Due Now". If unconfirmed after 15 minutes, a gentle follow-up reminder is triggered. After 30 minutes without confirmation, the status moves to "Unconfirmed" and linked caregivers receive an awareness alert. A late dose can still be recorded later that day, and MediMate never advises taking an extra dose.',
  },
  {
    id: 'privacy-control',
    question: 'Who can see my medication data, and how do I stay in control?',
    answer:
      'Only you and the caregivers explicitly linked in your Care Circle can see your medication schedules and dose records. MediMate displays no third-party advertisements and never sells health schedules. You or an authorized caregiver can pause, edit, or archive medications at any time.',
  },
  {
    id: 'medical-boundary',
    question: 'Does MediMate give medical advice or replace a doctor?',
    answer:
      'No. MediMate is strictly a schedule reminder and dose-record tracking tool. It does not diagnose conditions, prescribe medicines, check drug interactions, or recommend dosage changes. Always follow instructions from a qualified doctor or pharmacist.',
  },
];
