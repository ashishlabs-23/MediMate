import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, Clock, HeartHandshake, RotateCcw } from 'lucide-react';
import { PillMarker } from '../dose/PillMarker';

type PreviewDoseState = 'due' | 'snoozed' | 'taken';

export function HeroSection() {
  const [previewState, setPreviewState] = useState<PreviewDoseState>('due');

  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className="py-12 sm:py-16 lg:py-20 bg-gradient-to-b from-brand-teal-light/30 via-canvas to-canvas"
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
        {/* Left column: Value proposition & CTAs */}
        <div className="lg:col-span-6 space-y-6">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-brand-teal-light text-brand-teal-dark text-sm font-semibold">
            <HeartHandshake className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>UN SDG 3 · Good Health &amp; Well-Being</span>
          </div>

          <h1
            id="hero-heading"
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-ink-primary leading-tight"
          >
            Calm daily medicine reminders for older adults. Shared reassurance for families.
          </h1>

          <p className="text-lg text-ink-secondary leading-relaxed max-w-xl">
            MediMate helps older adults stay on top of prescribed schedules with one-tap dose confirmation and timely
            reminders—while keeping linked family caregivers gently informed under clear consent rules.
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-1">
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2 min-h-[44px] min-w-[44px] px-6 py-3 rounded-btn bg-brand-teal text-white text-base font-semibold hover:bg-brand-teal-dark transition-colors shadow-sm"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] px-6 py-3 rounded-btn border-2 border-brand-teal bg-surface text-brand-teal text-base font-semibold hover:bg-brand-teal-light/40 transition-colors"
            >
              See How It Works
            </a>
          </div>

          <p className="text-sm text-ink-muted">
            Installable web app (PWA) · Simple Mode for older adults · Real-time Care Circle timeline
          </p>
        </div>

        {/* Right column: Interactive Today Next-Dose Preview */}
        <div className="lg:col-span-6">
          <div
            aria-label="Interactive preview of the Today next-dose card"
            className="rounded-card bg-surface border-2 border-brand-teal p-5 sm:p-6 shadow-md"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 mb-4 border-b border-slate-200">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                  Today · Older Adult Simple Mode Preview
                </p>
                <p className="text-base font-bold text-ink-primary mt-0.5">Good Morning, Ramesh</p>
              </div>

              {previewState === 'taken' ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-taken-bg text-taken"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Taken</span>
                </span>
              ) : previewState === 'snoozed' ? (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-snooze-bg text-snooze-text"
                >
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Snoozed · 10 min</span>
                </span>
              ) : (
                <span
                  role="status"
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-due-bg text-due"
                >
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>DUE NOW</span>
                </span>
              )}
            </div>

            <div className="flex items-start gap-4 mb-4">
              <PillMarker color="#2563EB" shape="capsule" name="Metformin" dosage="500 mg" size={48} />
              <div className="min-w-0">
                <h2 className="text-2xl sm:text-[1.75rem] font-bold text-ink-primary leading-tight">Metformin</h2>
                <p className="text-lg font-semibold text-ink-secondary mt-0.5">500 mg</p>
                <p className="text-sm text-ink-muted mt-1">Scheduled: 08:00 AM · Breakfast</p>
              </div>
            </div>

            <div className="rounded-btn bg-slate-100 px-4 py-3 mb-5" role="note" aria-label="Sample instructions">
              <p className="text-base text-ink-primary">
                Take with a full glass of water after breakfast
              </p>
            </div>

            {previewState === 'taken' ? (
              <div className="flex flex-col gap-3">
                <div
                  role="status"
                  aria-live="polite"
                  className="w-full min-h-[68px] rounded-btn bg-taken-bg text-taken px-4 py-3 flex items-center justify-center gap-2 text-xl font-bold"
                >
                  <CheckCircle2 className="w-6 h-6 shrink-0" aria-hidden="true" />
                  <span>Recorded! Good job.</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPreviewState('due')}
                  className="w-full min-h-[44px] min-w-[44px] rounded-btn border border-slate-300 bg-surface text-ink-primary text-sm font-semibold hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" aria-hidden="true" />
                  <span>Reset preview</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <button
                  type="button"
                  onClick={() => setPreviewState('taken')}
                  className="w-full min-h-[68px] min-w-[44px] rounded-btn bg-taken text-white text-xl font-bold hover:bg-green-800 active:bg-green-900 transition-colors inline-flex items-center justify-center gap-2"
                >
                  <span>Taken ✓</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewState('snoozed')}
                  disabled={previewState === 'snoozed'}
                  aria-disabled={previewState === 'snoozed'}
                  className={
                    previewState === 'snoozed'
                      ? 'w-full min-h-[52px] min-w-[44px] rounded-btn border-2 border-slate-300 bg-slate-100 text-ink-muted text-base font-semibold cursor-not-allowed'
                      : 'w-full min-h-[52px] min-w-[44px] rounded-btn border-2 border-snooze bg-surface text-snooze text-base font-semibold hover:bg-snooze-bg transition-colors'
                  }
                >
                  {previewState === 'snoozed'
                    ? 'Snooze active (10 min delay)'
                    : 'Remind Me Later (10 min)'}
                </button>
              </div>
            )}

            <p className="text-xs text-ink-muted text-center mt-4">
              Interactive sample card using synthetic placeholder data. Tap &ldquo;Taken ✓&rdquo; to preview the confirmation flow.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;
