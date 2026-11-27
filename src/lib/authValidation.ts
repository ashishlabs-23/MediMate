export const EMAIL_FORMAT_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME_FORMAT_REGEX = /^[A-Za-z0-9_][A-Za-z0-9_ ]{0,28}[A-Za-z0-9_]$/;

export function sanitizePlainText(value: string): string {
  return value
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<[^>]*>/g, '')
    // Control characters are intentionally stripped from user-provided plain text.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
}

export function normalizeUsername(value: string): string {
  return sanitizePlainText(value).toLowerCase();
}

export function isValidUsername(value: string): boolean {
  const cleanValue = sanitizePlainText(value);
  return cleanValue.length >= 2 && cleanValue.length <= 30 && USERNAME_FORMAT_REGEX.test(cleanValue);
}

export function getSafeAuthRedirect(value: string | null): string | null {
  if (!value) return null;
  const candidate = sanitizePlainText(value);
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return null;
  }

  try {
    const url = new URL(candidate, 'https://medimate.invalid');
    if (url.origin !== 'https://medimate.invalid') return null;
    if (url.pathname !== '/app/today' && url.pathname !== '/app/caregiver') return null;
    return url.pathname;
  } catch {
    return null;
  }
}

export function getPasswordRequirements(password: string): {
  label: string;
  met: boolean;
}[] {
  return [
    { label: 'At least 8 characters', met: password.length >= 8 },
    { label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { label: 'One number', met: /\d/.test(password) },
    { label: 'One special character', met: /[^A-Za-z0-9]/.test(password) },
  ];
}
