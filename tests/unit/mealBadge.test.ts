import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import { getMealAssociation } from '../../src/domain/meals';
import { MealBadge } from '../../src/components/dose/MealBadge';
import { DoseCard } from '../../src/components/dose/DoseCard';
import type { DoseLogDocument } from '../../src/types/firestore';

function localTime(hours: number, minutes: number): Date {
  return new Date(2026, 10, 25, hours, minutes, 0, 0);
}

function makeDose(overrides?: Partial<DoseLogDocument>): DoseLogDocument {
  const scheduled = localTime(8, 0);
  const ts = Timestamp.fromDate(scheduled);
  return {
    id: 'dose-meal-1',
    patientId: 'patient-1',
    medicationId: 'med-1',
    medicationName: 'Metformin',
    dosage: '500mg',
    instructions: 'Take after breakfast',
    color: '#0D9488',
    shape: 'round',
    scheduledDate: '2026-11-25',
    scheduledTime: ts,
    status: 'due',
    snoozeCount: 0,
    followUpSent: false,
    escalationAlertSent: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

describe('domain/meals getMealAssociation', () => {
  it('maps exact local time boundaries for Breakfast, Lunch, Dinner, and Bedtime', () => {
    expect(getMealAssociation(localTime(5, 59))).toBeNull();
    expect(getMealAssociation(localTime(6, 0))).toEqual({
      period: 'breakfast',
      label: 'Breakfast',
      emoji: '🥣',
    });
    expect(getMealAssociation(localTime(10, 0))).toEqual({
      period: 'breakfast',
      label: 'Breakfast',
      emoji: '🥣',
    });
    expect(getMealAssociation(localTime(10, 1))).toBeNull();

    expect(getMealAssociation(localTime(11, 59))).toBeNull();
    expect(getMealAssociation(localTime(12, 0))).toEqual({
      period: 'lunch',
      label: 'Lunch',
      emoji: '🥗',
    });
    expect(getMealAssociation(localTime(15, 0))).toEqual({
      period: 'lunch',
      label: 'Lunch',
      emoji: '🥗',
    });
    expect(getMealAssociation(localTime(15, 1))).toBeNull();

    expect(getMealAssociation(localTime(17, 59))).toBeNull();
    expect(getMealAssociation(localTime(18, 0))).toEqual({
      period: 'dinner',
      label: 'Dinner',
      emoji: '🍽️',
    });
    expect(getMealAssociation(localTime(20, 59))).toEqual({
      period: 'dinner',
      label: 'Dinner',
      emoji: '🍽️',
    });

    expect(getMealAssociation(localTime(21, 0))).toEqual({
      period: 'bedtime',
      label: 'Bedtime',
      emoji: '🌙',
    });
    expect(getMealAssociation(localTime(23, 59))).toEqual({
      period: 'bedtime',
      label: 'Bedtime',
      emoji: '🌙',
    });
    expect(getMealAssociation(localTime(0, 0))).toBeNull();
  });

  it('supports Firestore Timestamp and duck-typed { toDate } objects', () => {
    const ts = Timestamp.fromDate(localTime(13, 30));
    expect(getMealAssociation(ts)).toEqual({
      period: 'lunch',
      label: 'Lunch',
      emoji: '🥗',
    });

    expect(getMealAssociation({ toDate: () => localTime(21, 15) })).toEqual({
      period: 'bedtime',
      label: 'Bedtime',
      emoji: '🌙',
    });
  });

  it('returns null safely for invalid Dates or throwing toDate()', () => {
    expect(getMealAssociation(new Date('invalid-date'))).toBeNull();
    expect(
      getMealAssociation({
        toDate: () => {
          throw new Error('Corrupt timestamp');
        },
      })
    ).toBeNull();
    expect(getMealAssociation({ toDate: () => new Date(Number.NaN) })).toBeNull();
  });
});

describe('components/dose/MealBadge & DoseCard integration', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders accessible non-interactive badge for each meal period with emoji + text', () => {
    const cases = [
      { time: localTime(8, 0), period: 'breakfast', label: 'Breakfast', emoji: '🥣' },
      { time: localTime(13, 0), period: 'lunch', label: 'Lunch', emoji: '🥗' },
      { time: localTime(19, 30), period: 'dinner', label: 'Dinner', emoji: '🍽️' },
      { time: localTime(22, 0), period: 'bedtime', label: 'Bedtime', emoji: '🌙' },
    ];

    for (const item of cases) {
      const { unmount } = render(React.createElement(MealBadge, { scheduledTime: item.time }));
      const badge = screen.getByTestId('meal-badge');
      expect(badge.tagName).toBe('SPAN');
      expect(badge).toHaveAttribute('data-meal-period', item.period);
      expect(badge).not.toHaveAttribute('role');
      expect(badge).toHaveTextContent(item.label);

      const emojiSpan = badge.querySelector('[aria-hidden="true"]');
      expect(emojiSpan).not.toBeNull();
      expect(emojiSpan?.textContent).toBe(item.emoji);
      unmount();
    }
  });

  it('renders nothing when scheduledTime falls outside meal windows', () => {
    const { container } = render(
      React.createElement(MealBadge, { scheduledTime: localTime(16, 0) })
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders MealBadge on full and compact DoseCard while preserving DOM contracts', () => {
    const dinnerDose = makeDose({
      id: 'dose-dinner',
      medicationName: 'Atorvastatin',
      scheduledTime: Timestamp.fromDate(localTime(19, 0)),
    });

    const { rerender } = render(React.createElement(DoseCard, { dose: dinnerDose }));
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Atorvastatin');
    expect(document.getElementById('dose-scheduled-time')).toBeInTheDocument();
    expect(screen.getByTestId('meal-badge')).toHaveAttribute('data-meal-period', 'dinner');
    expect(screen.getByTestId('meal-badge')).toHaveTextContent('Dinner');

    rerender(React.createElement(DoseCard, { dose: dinnerDose, compact: true }));
    expect(screen.getByTestId('meal-badge')).toHaveAttribute('data-meal-period', 'dinner');

    const afternoonDose = makeDose({
      id: 'dose-afternoon',
      scheduledTime: Timestamp.fromDate(localTime(16, 0)),
    });
    rerender(React.createElement(DoseCard, { dose: afternoonDose }));
    expect(screen.queryByTestId('meal-badge')).not.toBeInTheDocument();
  });

  it('clears justTaken feedback when dose.status reverts from taken to due (Undo)', async () => {
    const doseDue = makeDose({ id: 'dose-undo-card', status: 'due' });
    const onTaken = vi.fn().mockResolvedValue(undefined);

    const { rerender } = render(
      React.createElement(DoseCard, { dose: doseDue, onTaken })
    );

    const btn = document.getElementById('taken-button') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(btn).toHaveTextContent('✓ Recorded! Good job.');

    // Parent optimistically sets status to taken
    rerender(
      React.createElement(DoseCard, {
        dose: makeDose({ id: 'dose-undo-card', status: 'taken' }),
        onTaken,
      })
    );
    expect(document.getElementById('taken-button')).toHaveTextContent('✓ Recorded! Good job.');

    // Undo reverts status back to due -> feedback must clear immediately
    rerender(
      React.createElement(DoseCard, {
        dose: makeDose({ id: 'dose-undo-card', status: 'due' }),
        onTaken,
      })
    );
    const restoredBtn = document.getElementById('taken-button') as HTMLButtonElement;
    expect(restoredBtn).toHaveTextContent('Taken ✓');
    expect(restoredBtn).not.toBeDisabled();
  });
});
