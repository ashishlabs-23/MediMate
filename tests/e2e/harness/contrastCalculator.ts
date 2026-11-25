/**
 * Calculates relative luminance for an sRGB component per WCAG 2.2 specifications.
 */
function sRgbLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Computes the relative luminance of an RGB triplet.
 * L = 0.2126 * R + 0.7152 * G + 0.0722 * B
 */
export function getRelativeLuminance(r: number, g: number, b: number): number {
  return 0.2126 * sRgbLuminance(r) + 0.7152 * sRgbLuminance(g) + 0.0722 * sRgbLuminance(b);
}

/**
 * Computes contrast ratio between two RGB colors.
 * Ratio = (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter luminance.
 */
export function calculateContrastRatio(
  rgb1: [number, number, number],
  rgb2: [number, number, number]
): number {
  const l1 = getRelativeLuminance(...rgb1);
  const l2 = getRelativeLuminance(...rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parses Hex (#RGB, #RRGGBB, #RRGGBBAA with opaque AA) or rgb(r, g, b) / rgba(r, g, b, 1) to [r, g, b].
 */
export function parseColorToRgb(color: string): [number, number, number] {
  const trimmed = color.trim();
  const rgbMatch = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i.exec(
    trimmed
  );
  if (rgbMatch) {
    const r = Number(rgbMatch[1]);
    const g = Number(rgbMatch[2]);
    const b = Number(rgbMatch[3]);
    const a = rgbMatch[4] !== undefined ? Number(rgbMatch[4]) : 1;
    if (a < 1) {
      throw new Error(`Semi-transparent color cannot be evaluated without backdrop compositing: ${color}`);
    }
    if (r > 255 || g > 255 || b > 255) {
      throw new Error(`RGB channel out of range [0..255]: ${color}`);
    }
    return [r, g, b];
  }

  const cleanHex = trimmed.replace(/^#/, '');
  if (/^[0-9a-fA-F]{8}$/.test(cleanHex)) {
    const alpha = parseInt(cleanHex.slice(6, 8), 16);
    if (alpha < 255) {
      throw new Error(`Semi-transparent hex color cannot be evaluated without backdrop compositing: ${color}`);
    }
    const bigint = parseInt(cleanHex.slice(0, 6), 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }
  if (/^[0-9a-fA-F]{6}$/.test(cleanHex)) {
    const bigint = parseInt(cleanHex, 16);
    return [(bigint >> 16) & 255, (bigint >> 8) & 255, bigint & 255];
  }
  if (/^[0-9a-fA-F]{3}$/.test(cleanHex)) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16);
    const g = parseInt(cleanHex[1] + cleanHex[1], 16);
    const b = parseInt(cleanHex[2] + cleanHex[2], 16);
    return [r, g, b];
  }
  throw new Error(`Unsupported color format: ${color}`);
}

export function hexToRgb(hex: string): [number, number, number] {
  return parseColorToRgb(hex);
}

export function calculateContrast(fgColor: string, bgColor: string): number {
  return calculateContrastRatio(parseColorToRgb(fgColor), parseColorToRgb(bgColor));
}

/**
 * Asserts WCAG 2.2 AA contrast compliance.
 * - Normal text: >= 4.5:1
 * - Large text (>=18pt or >=14pt bold) / UI components: >= 3.0:1
 */
export function assertContrast(
  fgHex: string,
  bgHex: string,
  minRatio = 4.5,
  label = 'Color contrast'
): number {
  const ratio = calculateContrast(fgHex, bgHex);
  if (ratio < minRatio) {
    throw new Error(
      `${label} failed WCAG AA: ratio is ${ratio.toFixed(2)}:1 (minimum required: ${minRatio}:1) for ${fgHex} on ${bgHex}`
    );
  }
  return ratio;
}
