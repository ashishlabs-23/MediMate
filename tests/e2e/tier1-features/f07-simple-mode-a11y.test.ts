import { describe, expect, it } from 'vitest';
import {
  assertContrast,
  assertTouchTarget,
  checkAriaCompliance,
  createDoseLogFixture,
  MEDIMATE_COLOR_TOKENS,
  renderElderlySimpleMode,
} from '../harness';

describe('Tier 1 — F07: Elderly "Simple Mode" Touch Targets (>=44x44px) & WCAG AA', () => {
  it('T1-F07-01: "Taken" Button and All Interactive Controls Minimum Bounding Box (>=44x44px)', () => {
    const container = document.createElement('div');
    const dose = createDoseLogFixture({ status: 'due' });
    const { takenButton } = renderElderlySimpleMode(container, { dose, patientName: 'Ramesh' });

    expect(takenButton).not.toBeNull();
    const result = assertTouchTarget(takenButton!, 44);
    expect(result.passed).toBe(true);
    expect(result.width).toBeGreaterThanOrEqual(44);
    expect(result.height).toBeGreaterThanOrEqual(44);

    const interactiveControls = container.querySelectorAll('button, a, [role="button"]');
    expect(interactiveControls.length).toBeGreaterThanOrEqual(2);
    for (const control of interactiveControls) {
      const check = assertTouchTarget(control, 44);
      expect(check.passed).toBe(true);
    }
  });

  it('T1-F07-02: "Remind Me Later" (Snooze) Button Minimum Bounding Box (>=44x44px)', () => {
    const container = document.createElement('div');
    const dose = createDoseLogFixture({ status: 'due', snoozeCount: 0 });
    const { snoozeButton } = renderElderlySimpleMode(container, { dose, patientName: 'Ramesh' });

    expect(snoozeButton).not.toBeNull();
    const result = assertTouchTarget(snoozeButton!, 44);
    expect(result.passed).toBe(true);
    expect(result.width).toBeGreaterThanOrEqual(44);
    expect(result.height).toBeGreaterThanOrEqual(44);
  });

  it('T1-F07-03: High Contrast Color Palette (>=4.5:1)', () => {
    const primaryRatio = assertContrast(
      MEDIMATE_COLOR_TOKENS.textPrimary,
      MEDIMATE_COLOR_TOKENS.cardBg,
      4.5,
      'Simple Mode primary text'
    );
    const takenBtnRatio = assertContrast(
      MEDIMATE_COLOR_TOKENS.takenBtnText,
      MEDIMATE_COLOR_TOKENS.takenBtnBg,
      4.5,
      'Taken button'
    );
    const snoozeBtnRatio = assertContrast(
      MEDIMATE_COLOR_TOKENS.snoozeBtnText,
      MEDIMATE_COLOR_TOKENS.snoozeBtnBg,
      4.5,
      'Snooze button'
    );
    const alertBannerRatio = assertContrast(
      MEDIMATE_COLOR_TOKENS.alertBannerText,
      MEDIMATE_COLOR_TOKENS.alertBannerBg,
      4.5,
      'Alert banner'
    );

    expect(primaryRatio).toBeGreaterThanOrEqual(4.5);
    expect(takenBtnRatio).toBeGreaterThanOrEqual(4.5);
    expect(snoozeBtnRatio).toBeGreaterThanOrEqual(4.5);
    expect(alertBannerRatio).toBeGreaterThanOrEqual(4.5);
  });

  it('T1-F07-04: Assistive Technology ARIA Semantics', () => {
    const container = document.createElement('div');
    const dose = createDoseLogFixture({ status: 'due', medicationName: 'Metformin' });
    const { takenButton, snoozeButton, statusRegion } = renderElderlySimpleMode(container, {
      dose,
      patientName: 'Ramesh',
    });

    expect(checkAriaCompliance(takenButton!).passed).toBe(true);
    expect(checkAriaCompliance(snoozeButton!).passed).toBe(true);
    expect(takenButton?.getAttribute('aria-label')).toContain('Metformin');
    expect(statusRegion?.getAttribute('aria-live')).toBe('polite');
    expect(container.querySelector('h1')).not.toBeNull();
    expect(container.querySelector('h2')?.textContent).toBe('Metformin');
  });

  it('T1-F07-05: Next Due Dose Card Information Clarity', () => {
    const container = document.createElement('div');
    const dose = createDoseLogFixture({
      medicationName: 'Amlodipine',
      dosage: '5 mg',
      instructions: 'Take once daily in the morning',
      status: 'due',
    });
    const { doseCard } = renderElderlySimpleMode(container, { dose, patientName: 'Ramesh' });

    expect(doseCard).not.toBeNull();
    expect(doseCard?.textContent).toContain('Amlodipine');
    expect(doseCard?.textContent).toContain('5 mg');
    expect(doseCard?.textContent).toContain('Take once daily in the morning');
    expect(doseCard?.textContent).toContain('2026-11-25T08:00:00.000Z');
  });
});
