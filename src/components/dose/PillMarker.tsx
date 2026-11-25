/**
 * PillMarker — geometric pill SVG matching medication color + shape.
 *
 * Renders a 48×48px accessible icon for round, capsule, oval, or square pills.
 * Color is derived from the medication's `color` field (hex string).
 */

import type { PillShape } from '../../types/firestore';

interface PillMarkerProps {
  color?: string;
  shape?: PillShape;
  name: string;
  dosage: string;
  size?: number;
}

export function PillMarker({ color = '#0D9488', shape = 'round', name, dosage, size = 48 }: PillMarkerProps) {
  const label = `${color} ${shape}-shaped pill – ${name} ${dosage}`;

  if (shape === 'capsule') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        aria-label={label}
        role="img"
        focusable="false"
      >
        <rect x="4" y="12" width="40" height="24" rx="12" fill={color} opacity="0.9" />
        <rect x="4" y="12" width="20" height="24" rx="12" fill="#FFFFFF" opacity="0.4" />
        <rect x="4" y="12" width="40" height="24" rx="12" fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    );
  }

  if (shape === 'oval') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-label={label} role="img" focusable="false">
        <ellipse cx="24" cy="24" rx="20" ry="13" fill={color} opacity="0.9" />
        <ellipse cx="24" cy="24" rx="20" ry="13" fill="none" stroke={color} strokeWidth="1.5" />
        <line x1="4" y1="24" x2="44" y2="24" stroke="#FFFFFF" strokeWidth="1" opacity="0.5" />
      </svg>
    );
  }

  if (shape === 'square') {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" aria-label={label} role="img" focusable="false">
        <rect x="6" y="6" width="36" height="36" rx="6" fill={color} opacity="0.9" />
        <line x1="6" y1="24" x2="42" y2="24" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.5" />
        <line x1="24" y1="6" x2="24" y2="42" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.5" />
      </svg>
    );
  }

  // Default: round tablet
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-label={label} role="img" focusable="false">
      <circle cx="24" cy="24" r="20" fill={color} opacity="0.9" />
      <line x1="4" y1="24" x2="44" y2="24" stroke="#FFFFFF" strokeWidth="1.5" opacity="0.5" />
    </svg>
  );
}

export default PillMarker;
