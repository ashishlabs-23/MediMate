import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCircle2, RotateCcw } from 'lucide-react';

type PreviewDoseState = 'due' | 'snoozed' | 'taken';

export function HeroSection() {
  const [previewState, setPreviewState] = useState<PreviewDoseState>('due');

  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className="py-12 sm:py-16 lg:py-24 bg-surface transition-colors"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-14 items-center">
        {/* Left Column: Value proposition, headline, CTAs, trust badges */}
        <div className="lg:col-span-7 space-y-7">
          {/* Top pill badge — Clean Khayal style */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 text-slate-800 text-xs sm:text-sm font-semibold border border-slate-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
              <span>Simple Daily Reminders</span>
            </span>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-teal-light text-brand-teal-dark text-xs font-semibold">
              <span>UN SDG 3 · Good Health &amp; Well-Being</span>
            </span>
          </div>

          {/* Huge headline styled like Khayal Care */}
          <h1
            id="hero-heading"
            className="text-4xl sm:text-5xl lg:text-[4.25rem] font-extrabold tracking-tight text-ink-primary leading-[1.12]"
          >
            Calm daily medicine reminders so you know your parents took their medicine, without calling every evening.
          </h1>

          {/* Supporting paragraph in clean readable slate */}
          <p className="text-lg sm:text-xl text-ink-secondary leading-relaxed max-w-2xl">
            MediMate sends gentle reminders right on schedule. Your parents tap one big button to confirm, and you are alerted only if a dose is unconfirmed.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 pt-2">
            <Link
              to="/login"
              className="inline-flex items-center justify-center gap-2.5 min-h-[52px] min-w-[44px] px-7 py-3.5 rounded-xl bg-brand-teal text-white text-base font-semibold hover:bg-brand-teal-dark active:scale-[0.98] transition-all shadow-md shadow-brand-teal/20"
            >
              <span>Get Started</span>
              <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center justify-center min-h-[52px] min-w-[44px] px-6 py-3.5 rounded-xl border border-slate-300 bg-surface text-ink-primary text-base font-semibold hover:bg-slate-50 transition-colors"
            >
              See How It Works
            </a>
          </div>

          {/* Trust badges below CTAs */}
          <div className="flex flex-wrap items-center gap-y-2 gap-x-6 pt-3 text-sm text-ink-secondary font-medium">
            <div className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
              <span className="text-ink-secondary">Free for families</span>
            </div>
            <div className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
              <span className="text-ink-secondary">Simple one-tap mode for parents</span>
            </div>
            <div className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4 stroke-[2.5]" aria-hidden="true" />
              <span className="text-ink-secondary">WCAG 2.2 AA accessible</span>
            </div>
          </div>
        </div>

        {/* Right Column: Realistic Khayal-style Phone Frame Mockup */}
        <div className="lg:col-span-5 flex justify-center">
          <div
            aria-label="Interactive preview of the Today next-dose card"
            className="w-full max-w-[340px] sm:max-w-[360px] rounded-[36px] bg-surface border-4 border-slate-200 dark:border-slate-700 p-4 sm:p-5 shadow-2xl relative"
          >
            {/* Phone Top Notch / Status Bar */}
            <div className="flex items-center justify-between text-xs font-semibold text-slate-400 px-3 pb-3 mb-2 border-b border-slate-100">
              <span>9:41</span>
              <div className="w-16 h-4 bg-slate-200 dark:bg-slate-700 rounded-full mx-auto" aria-hidden="true" />
              <div className="flex items-center gap-1">
                <span className="text-[10px]">5G</span>
                <span>100%</span>
              </div>
            </div>

            {/* Chat App Header Bar inside phone */}
            <div className="flex items-center gap-3 p-2 mb-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100">
              <div className="w-10 h-10 rounded-full bg-brand-teal text-white flex items-center justify-center font-bold text-sm shadow-sm">
                M
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-ink-primary leading-tight truncate">MediMate Reminders</p>
                <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                  online
                </p>
              </div>
            </div>

            {/* Date Tag inside phone */}
            <div className="text-center my-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-md">
                TODAY
              </span>
            </div>

            {/* Incoming Message Bubble from MediMate */}
            <div className="bg-slate-100 dark:bg-slate-800/80 rounded-2xl rounded-tl-sm p-4 text-sm text-ink-primary space-y-2 mb-3 shadow-sm border border-slate-200/60">
              <p className="leading-relaxed">
                Hello Ramesh ji, it is time for your 8:30 AM medicines: <strong className="font-bold text-ink-primary">Metformin</strong> <span className="font-semibold text-brand-teal">500 mg</span>, Telmisartan 40 mg. Please tap below once taken.
              </p>
              <div className="flex justify-end">
                <span className="text-[10px] text-slate-400">08:30 AM</span>
              </div>
            </div>

            {/* Interactive Action Area inside Phone */}
            {previewState === 'taken' ? (
              <div className="space-y-3">
                {/* Outgoing "Taken" confirmation bubble */}
                <div className="flex justify-end">
                  <div className="bg-brand-teal-light/40 border border-brand-teal/30 rounded-2xl rounded-tr-sm p-3.5 max-w-[85%] text-right shadow-sm">
                    <p className="text-sm font-bold text-brand-teal-dark flex items-center justify-end gap-1.5">
                      <span>Taken</span>
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" aria-hidden="true" />
                    </p>
                    <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 mt-1">
                      <span>08:32 AM</span>
                      <span className="text-brand-teal">✓✓</span>
                    </div>
                  </div>
                </div>

                {/* Status banner */}
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-xl bg-taken-bg text-taken p-3 text-center text-sm font-bold flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Recorded! Good job.</span>
                </div>

                {/* Reset button */}
                <button
                  type="button"
                  onClick={() => setPreviewState('due')}
                  className="w-full min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 bg-surface text-ink-secondary text-xs font-semibold hover:bg-slate-50 transition-colors inline-flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Reset preview</span>
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {/* Two Action Buttons inside Chat Bubble Style */}
                <button
                  type="button"
                  onClick={() => setPreviewState('taken')}
                  className="w-full min-h-[48px] min-w-[44px] rounded-xl bg-white dark:bg-slate-800 border-2 border-brand-teal text-brand-teal hover:bg-brand-teal hover:text-white font-bold text-base transition-colors shadow-sm flex items-center justify-center gap-2"
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
                      ? 'w-full min-h-[44px] min-w-[44px] rounded-xl border border-slate-200 bg-slate-100 text-slate-400 text-xs font-semibold cursor-not-allowed'
                      : 'w-full min-h-[44px] min-w-[44px] rounded-xl border border-slate-300 bg-white dark:bg-slate-800 text-ink-secondary hover:text-ink-primary font-semibold text-xs transition-colors'
                  }
                >
                  {previewState === 'snoozed'
                    ? 'Snooze active (10 min delay)'
                    : 'Remind Me Later (10 min)'}
                </button>
              </div>
            )}

            {/* Phone bottom label */}
            <p className="text-[11px] text-slate-400 text-center mt-4">
              End-to-end private · Automated reminders only
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;
