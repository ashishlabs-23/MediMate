import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import { Timestamp } from 'firebase/firestore';
import { AdherenceHistory } from '../../src/components/caregiver/AdherenceHistory';
import { getMockDoseLogsForRange } from '../../src/lib/mockData';
import type { DoseLogDocument } from '../../src/types/firestore';

function makeDose(
  id: string,
  date: string,
  status: DoseLogDocument['status']
): DoseLogDocument {
  const [y, m, d] = date.split('-').map(Number);
  return {
    id,
    patientId: 'patient_ramesh',
    medicationId: 'med_1',
    medicationName: 'Metformin',
    dosage: '500 mg',
    scheduledDate: date,
    scheduledTime: Timestamp.fromDate(new Date(y, m - 1, d, 8, 0, 0)),
    status,
    snoozeCount: 0,
    followUpSent: false,
    escalationAlertSent: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  };
}

describe('AdherenceHistory', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders 7 day cards, summary counts, non-color-alone icons+labels, and non-medical-judgement framing', () => {
    const dates = [
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ];
    const mockDoses = getMockDoseLogsForRange('patient_ramesh', dates);

    render(<AdherenceHistory doses={mockDoses} dates={dates} />);

    expect(
      screen.getByRole('heading', { name: '7-Day Record Completion' })
    ).toBeInTheDocument();

    expect(
      screen.getByText(
        'Record completion reflects logged reminders only, not clinical outcomes or medical judgement.'
      )
    ).toBeInTheDocument();

    const dayCards = dates.map((d) =>
      document.querySelector(`article[data-date="${d}"]`) as HTMLElement
    );
    expect(dayCards.every(Boolean)).toBe(true);
    expect(dayCards).toHaveLength(7);

    // Last card has Today badge
    expect(within(dayCards[6]).getByText('Today')).toBeInTheDocument();

    // Day 2 ('2026-11-20') in mockData has 2 taken, 1 missed
    const day2 = dayCards[1];
    expect(within(day2).getByText('Taken').closest('li')).toHaveTextContent('2');
    expect(within(day2).getByText('Missed').closest('li')).toHaveTextContent('1');
    expect(within(day2).getByText('Unconfirmed').closest('li')).toHaveTextContent('0');
    expect(within(day2).getByText('Scheduled').closest('li')).toHaveTextContent('0');

    // Non-color-alone check: SVG icons have aria-hidden="true" alongside text labels
    const svgs = day2.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs.length).toBeGreaterThanOrEqual(4);
  });

  it('aggregates due and snoozed into Scheduled and shows empty-day message when no logs exist', () => {
    const dates = [
      '2026-11-19',
      '2026-11-20',
      '2026-11-21',
      '2026-11-22',
      '2026-11-23',
      '2026-11-24',
      '2026-11-25',
    ];

    const doses: DoseLogDocument[] = [
      makeDose('d1', '2026-11-25', 'taken'),
      makeDose('d2', '2026-11-25', 'due'),
      makeDose('d3', '2026-11-25', 'snoozed'),
      makeDose('d4', '2026-11-25', 'scheduled'),
      makeDose('d5', '2026-11-25', 'unconfirmed'),
      makeDose('d6', '2026-11-25', 'missed'),
    ];

    render(<AdherenceHistory doses={doses} dates={dates} />);

    const emptyDay = document.querySelector('article[data-date="2026-11-19"]') as HTMLElement;
    expect(within(emptyDay).getByText('No reminders logged')).toBeInTheDocument();

    const activeDay = document.querySelector('article[data-date="2026-11-25"]') as HTMLElement;
    expect(within(activeDay).getByText('Taken').closest('li')).toHaveTextContent('1');
    expect(within(activeDay).getByText('Missed').closest('li')).toHaveTextContent('1');
    expect(within(activeDay).getByText('Unconfirmed').closest('li')).toHaveTextContent('1');
    expect(within(activeDay).getByText('Scheduled').closest('li')).toHaveTextContent('3');
  });

  it('renders loading spinner with role="status" when isLoading is true', () => {
    render(<AdherenceHistory doses={[]} isLoading={true} />);
    expect(screen.getByRole('status', { name: 'Loading 7-day history…' })).toBeInTheDocument();
  });
});
