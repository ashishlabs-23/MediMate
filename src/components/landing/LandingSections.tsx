import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Clock,
  HeartHandshake,
  History,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
} from 'lucide-react';
import { PillMarker } from '../dose/PillMarker';
import { StatusChip } from '../dose/StatusChip';
import {
  CORE_FEATURES,
  DAILY_WORRY_CARDS,
  FAQ_ITEMS,
  HOW_IT_WORKS_STEPS,
  NAV_LINKS,
} from './landingData';

function renderFeatureIcon(featureId: string) {
  switch (featureId) {
    case 'scheduled-reminders':
      return <CalendarClock className="w-6 h-6 text-brand-teal" aria-hidden="true" />;
    case 'one-tap-undo':
      return <CheckCircle2 className="w-6 h-6 text-taken" aria-hidden="true" />;
    case 'intake-history':
      return <History className="w-6 h-6 text-brand-teal" aria-hidden="true" />;
    case 'caregiver-awareness':
      return <BellRing className="w-6 h-6 text-snooze" aria-hidden="true" />;
    case 'simple-mode':
      return <Sparkles className="w-6 h-6 text-brand-teal" aria-hidden="true" />;
    default:
      return <Smartphone className="w-6 h-6 text-brand-teal" aria-hidden="true" />;
  }
}

export function LandingSections() {
  const [openFaqId, setOpenFaqId] = useState<string | null>(null);

  function handleToggleFaq(id: string) {
    setOpenFaqId((prev) => (prev === id ? null : id));
  }

  return (
    <>
      {/* §4.3 The Daily Worry */}
      <section
        id="daily-worry"
        aria-labelledby="daily-worry-heading"
        className="py-12 sm:py-16 border-t border-slate-200 bg-surface"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-teal">
              Everyday Challenges
            </p>
            <h2
              id="daily-worry-heading"
              className="text-2xl sm:text-3xl font-bold text-ink-primary mt-2"
            >
              Managing daily medicines shouldn&rsquo;t mean daily worry
            </h2>
            <p className="text-base sm:text-lg text-ink-secondary mt-3 leading-relaxed">
              Routines work best when they feel calm, clear, and supportive for both the person taking
              their medicines and the family member checking in from afar.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {DAILY_WORRY_CARDS.map((card) => (
              <article
                key={card.id}
                className="rounded-card bg-canvas border border-slate-200 p-6 shadow-sm"
              >
                <h3 className="text-lg font-bold text-ink-primary">{card.title}</h3>
                <p className="text-base text-ink-secondary mt-2.5 leading-relaxed">
                  {card.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* §4.4 How It Works */}
      <section
        id="how-it-works"
        aria-labelledby="how-it-works-heading"
        className="py-12 sm:py-16 border-t border-slate-200 bg-canvas"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-teal">
              How It Works
            </p>
            <h2
              id="how-it-works-heading"
              className="text-2xl sm:text-3xl font-bold text-ink-primary mt-2"
            >
              Three steady steps from schedule to confirmation
            </h2>
          </div>

          <ol className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {HOW_IT_WORKS_STEPS.map((step) => (
              <li
                key={step.stepNumber}
                className="rounded-card bg-surface border border-slate-200 p-6 shadow-sm flex flex-col"
              >
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-brand-teal-light text-brand-teal-dark font-extrabold text-base mb-4">
                  {step.stepNumber}
                </span>
                <h3 className="text-lg font-bold text-ink-primary">{step.title}</h3>
                <p className="text-base text-ink-secondary mt-2.5 leading-relaxed">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* §4.5 & §4.6 Dual Experience Previews */}
      <section
        id="experiences"
        aria-labelledby="experiences-heading"
        className="py-12 sm:py-16 border-t border-slate-200 bg-surface"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-teal">
              Dual-Role Design
            </p>
            <h2
              id="experiences-heading"
              className="text-2xl sm:text-3xl font-bold text-ink-primary mt-2"
            >
              Two clear views tailored to each person&rsquo;s role
            </h2>
            <p className="text-base sm:text-lg text-ink-secondary mt-3 leading-relaxed">
              Older adults see one distraction-free dose at a time, while linked caregivers see a
              structured daily timeline and confirmation history.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
            {/* §4.5 What the Older Adult Sees */}
            <article
              aria-labelledby="older-adult-preview-heading"
              className="rounded-card bg-canvas border border-slate-200 p-6 shadow-sm space-y-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="inline-block px-3 py-1 rounded-full bg-brand-teal-light text-brand-teal-dark text-xs font-bold">
                    What the Older Adult Sees
                  </span>
                  <h3
                    id="older-adult-preview-heading"
                    className="text-xl font-bold text-ink-primary mt-2"
                  >
                    Simple Mode · Today View
                  </h3>
                </div>
                <span className="text-sm font-medium text-ink-muted">Large text &amp; tap targets</span>
              </div>

              <div className="rounded-card bg-surface border border-slate-200 p-5 space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-base font-bold text-ink-primary">Good Morning, Ramesh</p>
                  <StatusChip status="due" />
                </div>

                <div className="flex items-center gap-3.5">
                  <PillMarker
                    color="#2563EB"
                    shape="capsule"
                    name="Metformin"
                    dosage="500 mg"
                    size={44}
                  />
                  <div>
                    <p className="text-lg font-bold text-ink-primary">Metformin · 500 mg</p>
                    <p className="text-sm text-ink-secondary">
                      08:00 AM · Take with a full glass of water after breakfast
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="rounded-btn bg-taken text-white font-bold text-base py-3 px-4 text-center">
                    Taken ✓
                  </div>
                  <div className="rounded-btn border-2 border-snooze bg-surface text-snooze font-semibold text-sm py-3 px-4 text-center">
                    Remind Me Later (10 min)
                  </div>
                </div>

                <div className="rounded-btn bg-taken-bg text-taken px-4 py-2.5 text-sm font-semibold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>After tapping: &ldquo;Recorded! Good job.&rdquo; with 5-second undo safety</span>
                </div>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Upcoming Today
                </p>
                <div className="flex items-center justify-between gap-3 rounded-card bg-surface border border-slate-200 p-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <PillMarker color="#059669" shape="round" name="Amlodipine" dosage="5 mg" size={36} />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-primary truncate">Amlodipine</p>
                      <p className="text-xs text-ink-secondary">5 mg · 02:00 PM · Lunch</p>
                    </div>
                  </div>
                  <StatusChip status="scheduled" />
                </div>
                <div className="flex items-center justify-between gap-3 rounded-card bg-surface border border-slate-200 p-3.5">
                  <div className="flex items-center gap-3 min-w-0">
                    <PillMarker color="#D97706" shape="oval" name="Atorvastatin" dosage="20 mg" size={36} />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-primary truncate">Atorvastatin</p>
                      <p className="text-xs text-ink-secondary">20 mg · 08:00 PM · Dinner</p>
                    </div>
                  </div>
                  <StatusChip status="scheduled" />
                </div>
              </div>
            </article>

            {/* §4.6 What the Caregiver Sees */}
            <article
              aria-labelledby="caregiver-preview-heading"
              className="rounded-card bg-canvas border border-slate-200 p-6 shadow-sm space-y-5"
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <span className="inline-block px-3 py-1 rounded-full bg-pending-bg text-pending text-xs font-bold">
                    What the Caregiver Sees
                  </span>
                  <h3
                    id="caregiver-preview-heading"
                    className="text-xl font-bold text-ink-primary mt-2"
                  >
                    Caregiver Dashboard · Monitoring: Ramesh Sharma
                  </h3>
                </div>
                <Users className="w-5 h-5 text-brand-teal shrink-0" aria-hidden="true" />
              </div>

              {/* Explicit counts — zero medical-judgement adherence percentages */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-card bg-surface border border-slate-200 p-3 text-center">
                  <p className="text-2xl font-extrabold text-ink-primary">3</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary mt-0.5">
                    Scheduled
                  </p>
                </div>
                <div className="rounded-card bg-taken-bg border border-emerald-200 p-3 text-center">
                  <p className="text-2xl font-extrabold text-taken">1</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-taken mt-0.5">
                    Taken
                  </p>
                </div>
                <div className="rounded-card bg-pending-bg border border-sky-200 p-3 text-center">
                  <p className="text-2xl font-extrabold text-pending">1</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-pending mt-0.5">
                    Pending
                  </p>
                </div>
                <div className="rounded-card bg-alert-bg border border-red-200 p-3 text-center">
                  <p className="text-2xl font-extrabold text-alert">1</p>
                  <p className="text-xs font-semibold uppercase tracking-wide text-alert mt-0.5">
                    Unconfirmed
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Today&rsquo;s Dose Timeline &amp; Actor Attribution
                </p>

                <div className="rounded-card bg-surface border border-slate-200 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <PillMarker color="#2563EB" shape="capsule" name="Metformin" dosage="500 mg" size={36} />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-primary truncate">Metformin · 500 mg</p>
                      <p className="text-xs text-ink-secondary">
                        08:00 AM · Confirmed at 08:04 AM by Ramesh (Self)
                      </p>
                    </div>
                  </div>
                  <StatusChip status="taken" />
                </div>

                <div className="rounded-card bg-alert-bg border border-red-200 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <AlertCircle className="w-5 h-5 text-alert shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-primary truncate">Amlodipine · 5 mg</p>
                      <p className="text-xs text-alert font-medium">
                        02:00 PM · No confirmation after 30 min · Caregiver alerted at 02:30 PM
                      </p>
                    </div>
                  </div>
                  <StatusChip status="unconfirmed" />
                </div>

                <div className="rounded-card bg-surface border border-slate-200 p-3.5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Clock className="w-5 h-5 text-ink-muted shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="font-semibold text-ink-primary truncate">Atorvastatin · 20 mg</p>
                      <p className="text-xs text-ink-secondary">08:00 PM · Scheduled for tonight</p>
                    </div>
                  </div>
                  <StatusChip status="scheduled" />
                </div>
              </div>

              <p className="text-xs text-ink-muted">
                Daily counts reflect logged schedule completions and confirmations only—not a clinical
                assessment or health score.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* §4.7 Core Features */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="py-12 sm:py-16 border-t border-slate-200 bg-canvas"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mb-10">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-teal">
              Core Capabilities
            </p>
            <h2
              id="features-heading"
              className="text-2xl sm:text-3xl font-bold text-ink-primary mt-2"
            >
              Thoughtful features built for everyday reliability
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CORE_FEATURES.map((feature) => (
              <article
                key={feature.id}
                className="rounded-card bg-surface border border-slate-200 p-6 shadow-sm"
              >
                <div className="w-11 h-11 rounded-xl bg-brand-teal-light/60 flex items-center justify-center mb-4">
                  {renderFeatureIcon(feature.id)}
                </div>
                <h3 className="text-lg font-bold text-ink-primary">{feature.title}</h3>
                <p className="text-base text-ink-secondary mt-2 leading-relaxed">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* §4.8 Privacy, Consent & Non-Medical Boundary */}
      <section
        id="safety"
        aria-labelledby="safety-heading"
        className="py-12 sm:py-16 border-t border-slate-200 bg-surface"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-teal">
              Privacy, Security &amp; Scope Boundary
            </p>
            <h2
              id="safety-heading"
              className="text-2xl sm:text-3xl font-bold text-ink-primary mt-2"
            >
              Built on explicit caregiver agreements and clear non-medical boundaries
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <article className="rounded-card bg-canvas border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <Users className="w-5 h-5 text-brand-teal shrink-0" aria-hidden="true" />
                <h3 className="text-lg font-bold text-ink-primary">
                  Consent-based Care Circle visibility
                </h3>
              </div>
              <p className="text-base text-ink-secondary leading-relaxed">
                Caregivers only see schedules and dose logs for an older adult connected through an
                explicit Care Circle. Permissions define who can view timelines, manage prescriptions,
                or receive unconfirmed-dose alerts, and access can be revoked.
              </p>
            </article>

            <article className="rounded-card bg-canvas border border-slate-200 p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-3">
                <ShieldCheck className="w-5 h-5 text-brand-teal shrink-0" aria-hidden="true" />
                <h3 className="text-lg font-bold text-ink-primary">
                  Schedule control &amp; data transparency
                </h3>
              </div>
              <p className="text-base text-ink-secondary leading-relaxed">
                Schedules and dose records exist solely to display reminders and history for the
                patient and their linked Care Circle. Users can pause or archive medications at any
                time, and sample previews use synthetic placeholder profiles.
              </p>
            </article>
          </div>

          <div
            role="note"
            aria-labelledby="non-medical-boundary-heading"
            className="rounded-card border-2 border-brand-teal bg-brand-teal-light/25 p-6"
          >
            <h3
              id="non-medical-boundary-heading"
              className="text-lg font-bold text-brand-teal-dark"
            >
              Non-Medical-Advice Boundary Notice
            </h3>
            <p className="text-base text-ink-primary mt-2 leading-relaxed">
              MediMate records user-entered medication schedules and sends reminders. It does not
              diagnose medical conditions, prescribe treatments, check drug interactions, or
              recommend dosage changes. Always follow the instructions of your doctor or pharmacist.
            </p>
          </div>
        </div>
      </section>

      {/* §4.9 FAQ Accordion */}
      <section
        id="faqs"
        aria-labelledby="faqs-heading"
        className="py-12 sm:py-16 border-t border-slate-200 bg-canvas"
      >
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-10">
            <p className="text-sm font-semibold uppercase tracking-wider text-brand-teal">
              Common Questions
            </p>
            <h2
              id="faqs-heading"
              className="text-2xl sm:text-3xl font-bold text-ink-primary mt-2"
            >
              Frequently asked questions
            </h2>
          </div>

          <div className="space-y-3">
            {FAQ_ITEMS.map((item) => {
              const isOpen = openFaqId === item.id;
              const triggerId = `faq-trigger-${item.id}`;
              const panelId = `faq-panel-${item.id}`;

              return (
                <div
                  key={item.id}
                  className="rounded-card bg-surface border border-slate-200 shadow-sm overflow-hidden"
                >
                  <h3>
                    <button
                      type="button"
                      id={triggerId}
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => handleToggleFaq(item.id)}
                      className="w-full min-h-[44px] min-w-[44px] px-5 py-4 flex items-center justify-between gap-4 text-left text-base sm:text-lg font-semibold text-ink-primary hover:bg-slate-50 transition-colors"
                    >
                      <span>{item.question}</span>
                      <ChevronDown
                        className={`w-5 h-5 text-ink-secondary shrink-0 transition-transform ${
                          isOpen ? 'rotate-180' : ''
                        }`}
                        aria-hidden="true"
                      />
                    </button>
                  </h3>
                  <div
                    id={panelId}
                    role="region"
                    aria-labelledby={triggerId}
                    hidden={!isOpen}
                    className="px-5 pb-5 pt-1 text-base text-ink-secondary leading-relaxed border-t border-slate-100"
                  >
                    {item.answer}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* §4.9 Academic Footer */}
      <footer
        role="contentinfo"
        className="border-t border-slate-200 bg-surface py-10"
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col gap-8">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div className="space-y-2 max-w-xl">
              <div className="inline-flex items-center gap-2 text-lg font-bold text-ink-primary">
                <HeartHandshake className="w-5 h-5 text-brand-teal" aria-hidden="true" />
                <span>MediMate</span>
              </div>
              <p className="text-sm text-ink-secondary leading-relaxed">
                Academic Project aligned with{' '}
                <strong className="font-semibold text-ink-primary">
                  UN SDG 3 — Good Health &amp; Well-Being (Targets 3.4 &amp; 3.8)
                </strong>
                . Built to support calm medication scheduling and family awareness without medical
                claims.
              </p>
            </div>

            <nav aria-label="Footer navigation" className="flex flex-wrap items-center gap-3">
              {NAV_LINKS.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-3 rounded-btn text-sm font-medium text-ink-secondary hover:text-brand-teal hover:bg-slate-100 transition-colors"
                >
                  {item.label}
                </a>
              ))}
              <Link
                to="/login"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 rounded-btn border border-slate-300 bg-surface text-sm font-semibold text-ink-primary hover:bg-slate-50 transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/login?mode=signup"
                className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-4 rounded-btn bg-brand-teal text-sm font-semibold text-white hover:bg-brand-teal-dark transition-colors"
              >
                Create Account
              </Link>
            </nav>
          </div>

          <div className="pt-6 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-ink-muted">
            <p>
              MediMate records schedules and reminders only; it does not diagnose, prescribe, or
              recommend dosage changes.
            </p>
            <p>Academic Capstone Demonstration · Synthetic sample profiles shown</p>
          </div>
        </div>
      </footer>
    </>
  );
}

export default LandingSections;
