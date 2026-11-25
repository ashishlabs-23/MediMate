import { describe, expect, it } from 'vitest';
import {
  assertContrast,
  assertTouchTarget,
  calculateContrast,
  checkTouchTarget,
  checkTouchTargetSeparation,
  createDoseLogFixture,
  MEDIMATE_COLOR_TOKENS,
  renderElderlySimpleMode,
} from '../harness';

describe('Tier 2 (Boundary) — F07: Elderly "Simple Mode" Touch Targets (>=44x44px) & WCAG AA', () => {
  it('T2-F07-01: Touch Target Scaling Under 200% Zoom', () => {
    const container = document.createElement('div');
    const dose = createDoseLogFixture({ status: 'due', snoozeCount: 0 });
    const { takenButton, snoozeButton } = renderElderlySimpleMode(container, {
      dose,
      patientName: 'Ramesh',
    });

    // At 100% CSS pixels, controls must satisfy >= 44x44px
    const taken100 = assertTouchTarget(takenButton!, 44);
    const snooze100 = assertTouchTarget(snoozeButton!, 44);

    // Under 200% zoom, effective viewport CSS box scales by 2x
    const zoomFactor = 2.0;
    expect(taken100.width * zoomFactor).toBeGreaterThanOrEqual(88);
    expect(taken100.height * zoomFactor).toBeGreaterThanOrEqual(88);
    expect(snooze100.width * zoomFactor).toBeGreaterThanOrEqual(88);
    expect(snooze100.height * zoomFactor).toBeGreaterThanOrEqual(88);
  });

  it('T2-F07-02: Minimum 8px Touch Target Separation', () => {
    const container = document.createElement('div');
    const dose = createDoseLogFixture({ status: 'due', snoozeCount: 0 });
    const { takenButton, snoozeButton } = renderElderlySimpleMode(container, {
      dose,
      patientName: 'Ramesh',
    });

    const separation = checkTouchTargetSeparation(takenButton!, snoozeButton!, 8);
    expect(separation.passed).toBe(true);
    expect(separation.gap).toBeGreaterThanOrEqual(8);

    // Verify checker catches insufficient separation (< 8px)
    const crampedA = document.createElement('button');
    const crampedB = document.createElement('button');
    crampedA.style.marginBottom = '4px';
    crampedB.style.marginTop = '2px';
    const crampedSep = checkTouchTargetSeparation(crampedA, crampedB, 8);
    expect(crampedSep.passed).toBe(false);
    expect(crampedSep.gap).toBe(4);
  });

  it('T2-F07-03: Low-Contrast Palette Rejection', () => {
    // Gray-400 (#9ca3af) on white (#ffffff) fails 4.5:1 WCAG AA
    const badRatio = calculateContrast('#9CA3AF', '#FFFFFF');
    expect(badRatio).toBeLessThan(4.5);
    expect(() => assertContrast('#9CA3AF', '#FFFFFF', 4.5, 'Low contrast test')).toThrow(
      /failed WCAG AA/
    );

    // Approved tokens exceed 4.5:1 (and primary elderly / alert controls meet >= 7:1 per PRD AC-10 & DESIGN.md § 4.1)
    expect(
      assertContrast(MEDIMATE_COLOR_TOKENS.textPrimary, MEDIMATE_COLOR_TOKENS.cardBg, 7.0)
    ).toBeGreaterThanOrEqual(7.0);
    expect(
      assertContrast(MEDIMATE_COLOR_TOKENS.textSecondary, MEDIMATE_COLOR_TOKENS.cardBg, 7.0)
    ).toBeGreaterThanOrEqual(7.0);
    expect(
      assertContrast(MEDIMATE_COLOR_TOKENS.takenBtnText, MEDIMATE_COLOR_TOKENS.takenBtnBg, 7.0)
    ).toBeGreaterThanOrEqual(7.0);
    expect(
      assertContrast(MEDIMATE_COLOR_TOKENS.snoozeBtnText, MEDIMATE_COLOR_TOKENS.snoozeBtnBg, 4.5)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      assertContrast(MEDIMATE_COLOR_TOKENS.alertBannerText, MEDIMATE_COLOR_TOKENS.alertBannerBg, 7.0)
    ).toBeGreaterThanOrEqual(7.0);
    expect(
      assertContrast(
        MEDIMATE_COLOR_TOKENS.overdueWarningText,
        MEDIMATE_COLOR_TOKENS.overdueWarningBg,
        7.0
      )
    ).toBeGreaterThanOrEqual(7.0);
  });

  it('T2-F07-04: 100-Character Medication Name Wrapping', () => {
    const longName =
      'Hydrochlorothiazide-Lisinopril-Extended-Release-Cardiovascular-Maintenance-Tablet-100mg-Morning-Dose';
    expect(longName.length).toBeGreaterThanOrEqual(100);

    const container = document.createElement('div');
    const dose = createDoseLogFixture({
      medicationName: longName,
      status: 'due',
    });
    const { takenButton, snoozeButton, doseCard } = renderElderlySimpleMode(container, {
      dose,
      patientName: 'Ramesh',
    });

    const heading = doseCard?.querySelector('#dose-medication-name');
    expect(heading?.textContent).toBe(longName);
    expect(takenButton).not.toBeNull();
    expect(snoozeButton).not.toBeNull();
    expect(assertTouchTarget(takenButton!, 44).passed).toBe(true);
    expect(assertTouchTarget(snoozeButton!, 44).passed).toBe(true);
  });

  it('T2-F07-05: Screen Reader Live Region Announcements', () => {
    const container = document.createElement('div');
    const dose = createDoseLogFixture({
      medicationName: 'Metformin',
      status: 'due',
      snoozeCount: 0,
    });
    const { takenButton, snoozeButton, statusRegion } = renderElderlySimpleMode(container, {
      dose,
      patientName: 'Ramesh',
    });

    expect(statusRegion?.getAttribute('aria-live')).toBe('polite');
    expect(statusRegion?.textContent).toBe('');

    // Snooze announces without focus loss / element removal
    snoozeButton!.click();
    expect(statusRegion?.textContent).toContain('Metformin snoozed for 10 minutes.');
    expect(snoozeButton?.getAttribute('aria-disabled')).toBe('true');

    // Taken announces cleanly
    takenButton!.click();
    expect(statusRegion?.textContent).toContain('Metformin marked as taken.');
    expect(takenButton?.getAttribute('aria-disabled')).toBe('true');
  });

  it('T2-F07-06: Inline Dimension Precedence Over Tailwind, Non-Px Rejection & Negative Margin Detection', () => {
    // 1. Explicit inline style < 44px must fail even with w-full / w-12 / min-w-[44px]
    const inlineSmall = document.createElement('button');
    inlineSmall.className = 'w-full min-w-[44px] min-h-[44px]';
    inlineSmall.style.width = '16px';
    inlineSmall.style.height = '16px';
    const res1 = checkTouchTarget(inlineSmall, 44);
    expect(res1.passed).toBe(false);
    expect(res1.width).toBe(16);
    expect(res1.height).toBe(16);

    const inlineThirty = document.createElement('button');
    inlineThirty.className = 'w-12 h-12 min-w-[44px] min-h-[44px]';
    inlineThirty.style.width = '30px';
    inlineThirty.style.height = '30px';
    const res2 = checkTouchTarget(inlineThirty, 44);
    expect(res2.passed).toBe(false);
    expect(res2.width).toBe(30);
    expect(res2.height).toBe(30);

    // 2. Non-px percentage width without resolved px rect must not falsely pass
    const percentBtn = document.createElement('button');
    percentBtn.style.width = '50%';
    percentBtn.style.height = '100%';
    const res3 = checkTouchTarget(percentBtn, 44);
    expect(res3.passed).toBe(false);

    // 3. Negative margins reduce effective separation and fail minGapPx check
    const first = document.createElement('button');
    const second = document.createElement('button');
    first.style.marginBottom = '8px';
    second.style.marginTop = '-6px';
    const sep = checkTouchTargetSeparation(first, second, 8);
    expect(sep.passed).toBe(false);
    expect(sep.gap).toBe(2);

    // 4. CSS rgb() string contrast evaluation works cleanly
    expect(calculateContrast('rgb(156, 163, 175)', '#FFFFFF')).toBeLessThan(4.5);
  });
});
