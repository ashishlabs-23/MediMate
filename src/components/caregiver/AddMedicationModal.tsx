/**
 * AddMedicationModal — Accessible modal wizard for creating or editing a prescription.
 * Supports multiple daily HH:mm times, daily vs specific-days schedule, pill shape & color.
 */

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Plus, Trash2, X } from 'lucide-react';
import { PillMarker } from '../dose/PillMarker';
import type { MedicationDocument, PillShape } from '../../types/firestore';

export interface MedicationFormPayload {
  name: string;
  dosage: string;
  instructions: string;
  times: string[];
  frequency: 'daily' | 'specific_days';
  daysOfWeek?: number[];
  shape: PillShape;
  color: string;
}

export interface AddMedicationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (payload: MedicationFormPayload, existingId?: string) => Promise<void> | void;
  initialMedication?: MedicationDocument | null | undefined;
}

interface ColorOption {
  hex: string;
  label: string;
}

interface ShapeOption {
  value: PillShape;
  label: string;
}

interface WeekdayOption {
  value: number;
  short: string;
  full: string;
}

const COLOR_OPTIONS: ColorOption[] = [
  { hex: '#2563EB', label: 'Blue' },
  { hex: '#0D9488', label: 'Teal' },
  { hex: '#059669', label: 'Green' },
  { hex: '#D97706', label: 'Amber' },
  { hex: '#DC2626', label: 'Coral' },
  { hex: '#7C3AED', label: 'Purple' },
  { hex: '#475569', label: 'Slate' },
];

const SHAPE_OPTIONS: ShapeOption[] = [
  { value: 'round', label: 'Round' },
  { value: 'capsule', label: 'Capsule' },
  { value: 'oval', label: 'Oval' },
  { value: 'square', label: 'Square' },
];

const WEEKDAY_OPTIONS: WeekdayOption[] = [
  { value: 0, short: 'Sun', full: 'Sunday' },
  { value: 1, short: 'Mon', full: 'Monday' },
  { value: 2, short: 'Tue', full: 'Tuesday' },
  { value: 3, short: 'Wed', full: 'Wednesday' },
  { value: 4, short: 'Thu', full: 'Thursday' },
  { value: 5, short: 'Fri', full: 'Friday' },
  { value: 6, short: 'Sat', full: 'Saturday' },
];

const DEFAULT_DAYS = [1, 2, 3, 4, 5];
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const CANDIDATE_TIMES = ['08:00', '12:00', '14:00', '20:00', '21:00'];

export function AddMedicationModal({
  isOpen,
  onClose,
  onSave,
  initialMedication,
}: AddMedicationModalProps) {
  const isEditMode = Boolean(initialMedication);

  const [name, setName] = useState('');
  const [dosage, setDosage] = useState('');
  const [instructions, setInstructions] = useState('');
  const [times, setTimes] = useState<string[]>(['08:00']);
  const [frequency, setFrequency] = useState<'daily' | 'specific_days'>('daily');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(DEFAULT_DAYS);
  const [shape, setShape] = useState<PillShape>('round');
  const [color, setColor] = useState('#0D9488');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Sync form state whenever modal opens or target medication changes
  useEffect(() => {
    if (!isOpen) return;

    previousFocusRef.current = document.activeElement as HTMLElement | null;

    if (initialMedication) {
      setName(initialMedication.name);
      setDosage(initialMedication.dosage);
      setInstructions(initialMedication.instructions ?? '');
      setTimes(
        initialMedication.schedule.times.length > 0
          ? [...initialMedication.schedule.times]
          : ['08:00']
      );
      setFrequency(initialMedication.schedule.frequency);
      setDaysOfWeek(
        initialMedication.schedule.daysOfWeek && initialMedication.schedule.daysOfWeek.length > 0
          ? [...initialMedication.schedule.daysOfWeek]
          : DEFAULT_DAYS
      );
      setShape(initialMedication.shape);
      setColor(initialMedication.color);
    } else {
      setName('');
      setDosage('');
      setInstructions('');
      setTimes(['08:00']);
      setFrequency('daily');
      setDaysOfWeek(DEFAULT_DAYS);
      setShape('round');
      setColor('#0D9488');
    }
    setError(null);
    setIsSubmitting(false);

    const timer = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === 'function') {
        previousFocusRef.current.focus();
      }
    };
  }, [isOpen, initialMedication]);

  // Escape-to-close listener
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) {
        e.preventDefault();
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) return null;

  function handleAddTime() {
    const nextCandidate = CANDIDATE_TIMES.find((t) => !times.includes(t)) ?? '09:00';
    setTimes((prev) => [...prev, nextCandidate]);
  }

  function handleTimeChange(index: number, value: string) {
    setTimes((prev) => prev.map((t, i) => (i === index ? value : t)));
  }

  function handleRemoveTime(index: number) {
    if (times.length <= 1) return;
    setTimes((prev) => prev.filter((_, i) => i !== index));
  }

  function handleToggleDay(day: number) {
    setDaysOfWeek((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Medication name is required.');
      return;
    }

    const trimmedDosage = dosage.trim();
    if (!trimmedDosage) {
      setError('Dosage is required.');
      return;
    }

    const validTimes = Array.from(
      new Set(times.map((t) => t.trim()).filter((t) => TIME_PATTERN.test(t)))
    ).sort();

    if (validTimes.length === 0) {
      setError('Please enter at least one valid scheduled time (HH:MM).');
      return;
    }

    if (frequency === 'specific_days' && daysOfWeek.length === 0) {
      setError('Please select at least one day of the week.');
      return;
    }

    const payload: MedicationFormPayload = {
      name: trimmedName,
      dosage: trimmedDosage,
      instructions: instructions.trim(),
      times: validTimes,
      frequency,
      ...(frequency === 'specific_days' ? { daysOfWeek: [...daysOfWeek].sort((a, b) => a - b) } : {}),
      shape,
      color,
    };

    try {
      setIsSubmitting(true);
      await onSave(payload, initialMedication?.id);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to save medication.';
      setError(msg);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="medication-modal-title"
        className="w-full max-w-xl rounded-card bg-surface border border-slate-200 shadow-xl my-auto max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 id="medication-modal-title" className="text-xl font-bold text-ink-primary">
            {isEditMode ? 'Edit Medication' : 'Add Medication'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Close modal"
            className="min-h-touch min-w-touch inline-flex items-center justify-center rounded-btn text-ink-secondary hover:bg-slate-100 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="p-6 space-y-5">
          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-btn bg-alert-bg border border-alert-chip px-4 py-3 text-sm font-medium text-alert"
            >
              {error}
            </div>
          )}

          {/* Live Pill Preview */}
          <div className="flex items-center gap-4 rounded-btn bg-canvas border border-slate-200 p-4">
            <PillMarker
              color={color}
              shape={shape}
              name={name.trim() || 'Medication'}
              dosage={dosage.trim()}
              size={48}
            />
            <div className="min-w-0">
              <p className="text-base font-bold text-ink-primary truncate">
                {name.trim() || 'Medication preview'}
              </p>
              <p className="text-sm text-ink-secondary truncate">
                {dosage.trim() ? `${dosage.trim()} · ` : ''}
                {SHAPE_OPTIONS.find((s) => s.value === shape)?.label ?? shape} ·{' '}
                {COLOR_OPTIONS.find((c) => c.hex === color)?.label ?? color}
              </p>
            </div>
          </div>

          {/* Name & Dosage */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="med-name" className="block text-sm font-semibold text-ink-primary mb-1.5">
                Medication Name
              </label>
              <input
                ref={nameInputRef}
                id="med-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Metformin"
                className="w-full min-h-touch px-3.5 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-base focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
              />
            </div>

            <div>
              <label htmlFor="med-dosage" className="block text-sm font-semibold text-ink-primary mb-1.5">
                Dosage
              </label>
              <input
                id="med-dosage"
                type="text"
                required
                value={dosage}
                onChange={(e) => setDosage(e.target.value)}
                placeholder="e.g. 500 mg"
                className="w-full min-h-touch px-3.5 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-base focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
              />
            </div>
          </div>

          {/* Instructions */}
          <div>
            <label htmlFor="med-instructions" className="block text-sm font-semibold text-ink-primary mb-1.5">
              Instructions
            </label>
            <textarea
              id="med-instructions"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Take with a full glass of water after breakfast"
              className="w-full px-3.5 py-2.5 rounded-btn border border-slate-300 bg-surface text-ink-primary text-base focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
            />
            <p className="mt-1 text-xs text-ink-muted">
              Enter instructions exactly as prescribed.
            </p>
          </div>

          {/* Scheduled Times */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-ink-primary">
                Scheduled Times
              </span>
              <button
                type="button"
                onClick={handleAddTime}
                className="min-h-touch min-w-touch inline-flex items-center gap-1.5 px-3 py-2 rounded-btn border border-brand-teal text-brand-teal text-sm font-semibold hover:bg-brand-teal-light/40 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Add Time
              </button>
            </div>

            <div className="space-y-3">
              {times.map((timeVal, idx) => (
                <div key={`time-row-${idx}`} className="flex items-center gap-3">
                  <label htmlFor={`med-time-${idx}`} className="sr-only">
                    Scheduled time {idx + 1}
                  </label>
                  <input
                    id={`med-time-${idx}`}
                    type="time"
                    value={timeVal}
                    onChange={(e) => handleTimeChange(idx, e.target.value)}
                    className="min-h-touch px-3.5 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-base focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
                  />
                  {times.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveTime(idx)}
                      aria-label={`Remove time ${timeVal || idx + 1}`}
                      className="min-h-touch min-w-touch inline-flex items-center gap-1.5 px-3 py-2 rounded-btn border border-slate-300 text-alert text-sm font-semibold hover:bg-alert-bg focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Frequency */}
          <fieldset>
            <legend className="text-sm font-semibold text-ink-primary mb-2">
              Schedule Frequency
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                aria-pressed={frequency === 'daily'}
                onClick={() => setFrequency('daily')}
                className={`min-h-touch min-w-touch px-4 py-2 rounded-btn border text-sm font-semibold transition-colors focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 ${
                  frequency === 'daily'
                    ? 'bg-brand-teal text-white border-brand-teal'
                    : 'bg-surface text-ink-primary border-slate-300 hover:bg-slate-50'
                }`}
              >
                Every Day
              </button>
              <button
                type="button"
                aria-pressed={frequency === 'specific_days'}
                onClick={() => setFrequency('specific_days')}
                className={`min-h-touch min-w-touch px-4 py-2 rounded-btn border text-sm font-semibold transition-colors focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 ${
                  frequency === 'specific_days'
                    ? 'bg-brand-teal text-white border-brand-teal'
                    : 'bg-surface text-ink-primary border-slate-300 hover:bg-slate-50'
                }`}
              >
                Specific Days
              </button>
            </div>

            {frequency === 'specific_days' && (
              <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Select days of the week">
                {WEEKDAY_OPTIONS.map((day) => {
                  const selected = daysOfWeek.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      aria-pressed={selected}
                      aria-label={day.full}
                      onClick={() => handleToggleDay(day.value)}
                      className={`min-h-touch min-w-touch px-3 py-2 rounded-btn border text-sm font-semibold transition-colors focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 ${
                        selected
                          ? 'bg-brand-teal text-white border-brand-teal'
                          : 'bg-surface text-ink-primary border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      {day.short}
                    </button>
                  );
                })}
              </div>
            )}
          </fieldset>

          {/* Pill Shape */}
          <fieldset>
            <legend className="text-sm font-semibold text-ink-primary mb-2">
              Pill Shape
            </legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {SHAPE_OPTIONS.map((opt) => {
                const selected = shape === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setShape(opt.value)}
                    className={`min-h-touch min-w-touch inline-flex items-center justify-center gap-2 px-3 py-2 rounded-btn border text-sm font-semibold transition-colors focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 ${
                      selected
                        ? 'bg-brand-teal-light/50 border-brand-teal text-brand-teal-dark'
                        : 'bg-surface border-slate-300 text-ink-primary hover:bg-slate-50'
                    }`}
                  >
                    <PillMarker
                      color={color}
                      shape={opt.value}
                      name={opt.label}
                      dosage=""
                      size={24}
                    />
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Pill Color */}
          <fieldset>
            <legend className="text-sm font-semibold text-ink-primary mb-2">
              Pill Color
            </legend>
            <div className="flex flex-wrap gap-3">
              {COLOR_OPTIONS.map((opt) => {
                const selected = color === opt.hex;
                return (
                  <button
                    key={opt.hex}
                    type="button"
                    aria-pressed={selected}
                    aria-label={`${opt.label} pill color`}
                    onClick={() => setColor(opt.hex)}
                    className={`min-h-touch min-w-touch inline-flex items-center gap-2 px-3 py-2 rounded-btn border text-sm font-semibold transition-colors focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2 ${
                      selected
                        ? 'border-ink-primary bg-slate-100 text-ink-primary'
                        : 'border-slate-300 bg-surface text-ink-secondary hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className="h-5 w-5 rounded-full border border-slate-300 inline-flex items-center justify-center shrink-0"
                      style={{ backgroundColor: opt.hex }}
                      aria-hidden="true"
                    >
                      {selected && <Check className="w-3.5 h-3.5 text-white" aria-hidden="true" />}
                    </span>
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="min-h-touch min-w-touch px-4 py-2 rounded-btn border border-slate-300 bg-surface text-ink-primary text-sm font-semibold hover:bg-slate-50 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-touch min-w-touch px-5 py-2 rounded-btn bg-brand-teal text-white text-sm font-bold hover:bg-brand-teal-dark disabled:opacity-60 focus:outline-none focus:ring-[3px] focus:ring-focus focus:ring-offset-2"
            >
              {isSubmitting
                ? 'Saving…'
                : isEditMode
                  ? 'Save Changes'
                  : 'Save Medication'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddMedicationModal;
