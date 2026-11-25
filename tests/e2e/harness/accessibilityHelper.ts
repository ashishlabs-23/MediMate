import { assertContrast, calculateContrast } from './contrastCalculator';

export interface TouchTargetResult {
  passed: boolean;
  width: number;
  height: number;
  reason?: string;
}

export interface AriaComplianceResult {
  passed: boolean;
  missing: string[];
}

function parsePx(val: string | undefined | null): number | null {
  if (!val) return null;
  const trimmed = val.trim();
  if (trimmed === '' || trimmed === 'auto' || trimmed === 'none') return null;
  const match = /^(-?\d+(?:\.\d+)?)px$/i.exec(trimmed);
  if (!match) return null;
  const num = parseFloat(match[1]);
  return Number.isNaN(num) ? null : num;
}

function inferTailwindDimensionPx(
  classList: DOMTokenList | { contains: (c: string) => boolean },
  className: string,
  axis: 'width' | 'height'
): number {
  const tokens = className.split(/\s+/).filter(Boolean);
  const scaleMap: Record<string, number> = {
    '4': 16,
    '6': 24,
    '8': 32,
    '9': 36,
    '10': 40,
    '11': 44,
    '12': 48,
    '14': 56,
    '16': 64,
    '18': 72,
    '20': 80,
  };

  let inferred = 0;
  for (const token of tokens) {
    if (axis === 'width') {
      if (token === 'w-full') inferred = Math.max(inferred, 320);
      const arbitraryW = /^(?:min-)?w-\[(\d+(?:\.\d+)?)px\]$/.exec(token);
      if (arbitraryW) inferred = Math.max(inferred, parseFloat(arbitraryW[1]));
      const scaleW = /^(?:min-)?w-(\d+)$/.exec(token);
      if (scaleW && scaleMap[scaleW[1]]) inferred = Math.max(inferred, scaleMap[scaleW[1]]);
    } else {
      const arbitraryH = /^(?:min-)?h-\[(\d+(?:\.\d+)?)px\]$/.exec(token);
      if (arbitraryH) inferred = Math.max(inferred, parseFloat(arbitraryH[1]));
      const scaleH = /^(?:min-)?h-(\d+)$/.exec(token);
      if (scaleH && scaleMap[scaleH[1]]) inferred = Math.max(inferred, scaleMap[scaleH[1]]);
    }
  }

  if (axis === 'width' && (classList.contains('min-w-[44px]') || classList.contains('w-full'))) {
    inferred = Math.max(inferred, 44);
  }
  if (axis === 'height' && classList.contains('min-h-[44px]')) {
    inferred = Math.max(inferred, 44);
  }

  return inferred;
}

function resolveAxisSize(
  rectVal: number,
  inlineVal: string | undefined,
  inlineMinVal: string | undefined,
  computedVal: string | undefined,
  computedMinVal: string | undefined,
  twVal: number
): number {
  const rectDim = typeof rectVal === 'number' && Number.isFinite(rectVal) && rectVal > 0 ? rectVal : null;
  if (rectDim !== null) {
    return rectDim;
  }

  const inlineDim = parsePx(inlineVal);
  const inlineMin = parsePx(inlineMinVal);
  if (inlineDim !== null) {
    return inlineMin !== null ? Math.max(inlineDim, inlineMin) : inlineDim;
  }

  if (inlineVal && inlineVal.trim() !== '' && inlineVal.trim() !== 'auto') {
    return 0;
  }

  const computedDim = parsePx(computedVal);
  const computedMin = parsePx(computedMinVal);
  if (computedDim !== null) {
    return computedMin !== null ? Math.max(computedDim, computedMin) : computedDim;
  }

  if (inlineMin !== null || computedMin !== null) {
    return Math.max(inlineMin ?? 0, computedMin ?? 0);
  }

  return twVal;
}

/**
 * Evaluates whether an interactive element meets WCAG 2.2 AA touch target minimum (>= 44x44px).
 * Explicit bounding-box / inline / computed dimensions always take precedence over Tailwind class heuristics.
 */
export function checkTouchTarget(element: HTMLElement, minSize = 44): TouchTargetResult {
  const rect = element.getBoundingClientRect();
  const computed =
    typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(element)
      : ({} as CSSStyleDeclaration);

  const twWidth = inferTailwindDimensionPx(element.classList, element.className || '', 'width');
  const twHeight = inferTailwindDimensionPx(element.classList, element.className || '', 'height');

  const width = resolveAxisSize(
    rect.width,
    element.style?.width,
    element.style?.minWidth,
    computed.width,
    computed.minWidth,
    twWidth
  );
  const height = resolveAxisSize(
    rect.height,
    element.style?.height,
    element.style?.minHeight,
    computed.height,
    computed.minHeight,
    twHeight
  );

  const passed = width >= minSize && height >= minSize;

  return {
    passed,
    width,
    height,
    reason: passed
      ? undefined
      : `Expected >= ${minSize}x${minSize}px, got ${width}x${height}px`,
  };
}

export function assertTouchTarget(element: HTMLElement, minSize = 44): TouchTargetResult {
  const result = checkTouchTarget(element, minSize);
  if (!result.passed) {
    throw new Error(
      `Touch target violation for <${element.tagName.toLowerCase()} id="${element.id}" class="${element.className}">: ${result.reason}`
    );
  }
  return result;
}

export function checkAriaCompliance(element: HTMLElement): AriaComplianceResult {
  const missing: string[] = [];
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role');
  const ariaLabel = element.getAttribute('aria-label');
  const ariaLabelledBy = element.getAttribute('aria-labelledby');
  const hasVisibleText = (element.textContent ?? '').trim().length > 0;

  if (tag !== 'button' && tag !== 'a' && role !== 'button' && role !== 'link') {
    missing.push('role="button" or native interactive element');
  }
  if (!ariaLabel && !ariaLabelledBy && !hasVisibleText) {
    missing.push('aria-label or accessible name');
  }
  if ((element as HTMLButtonElement).disabled && element.getAttribute('aria-disabled') !== 'true') {
    missing.push('aria-disabled="true"');
  }

  return {
    passed: missing.length === 0,
    missing,
  };
}

export function checkTouchTargetSeparation(
  first: HTMLElement,
  second: HTMLElement,
  minGapPx = 8
): { passed: boolean; gap: number } {
  const rect1 = first.getBoundingClientRect();
  const rect2 = second.getBoundingClientRect();
  const hasLayoutCoords =
    rect1.top !== 0 ||
    rect1.left !== 0 ||
    rect2.top !== 0 ||
    rect2.left !== 0;

  if (hasLayoutCoords) {
    const verticalGap =
      rect2.top >= rect1.bottom
        ? rect2.top - rect1.bottom
        : rect1.top >= rect2.bottom
          ? rect1.top - rect2.bottom
          : null;
    if (verticalGap !== null) {
      return {
        passed: verticalGap >= minGapPx,
        gap: verticalGap,
      };
    }
    const horizontalGap =
      rect2.left >= rect1.right
        ? rect2.left - rect1.right
        : rect1.left >= rect2.right
          ? rect1.left - rect2.right
          : 0;
    return {
      passed: horizontalGap >= minGapPx,
      gap: horizontalGap,
    };
  }

  const computed1 =
    typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(first)
      : ({} as CSSStyleDeclaration);
  const computed2 =
    typeof window !== 'undefined' && typeof window.getComputedStyle === 'function'
      ? window.getComputedStyle(second)
      : ({} as CSSStyleDeclaration);

  const m1 = parsePx(first.style?.marginBottom) ?? parsePx(computed1.marginBottom) ?? 0;
  const m2 = parsePx(second.style?.marginTop) ?? parsePx(computed2.marginTop) ?? 0;

  let gap: number;
  if (m1 < 0 && m2 < 0) {
    gap = Math.min(m1, m2);
  } else if (m1 < 0 || m2 < 0) {
    gap = m1 + m2;
  } else {
    gap = Math.max(m1, m2);
  }

  return {
    passed: gap >= minGapPx,
    gap,
  };
}

export { assertContrast, calculateContrast };
