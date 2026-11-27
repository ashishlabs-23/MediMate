import { describe, expect, it } from 'vitest';
import {
  getPasswordRequirements,
  getSafeAuthRedirect,
  isValidUsername,
  sanitizePlainText,
} from '../../src/lib/authValidation';

describe('authValidation', () => {
  it('strips markup and control characters from plain-text values', () => {
    expect(sanitizePlainText('  <script>alert(1)</script><b>Ramesh</b>\u0000  ')).toBe('Ramesh');
  });

  it('accepts valid 2–30 character usernames and rejects invalid boundaries or punctuation', () => {
    expect(isValidUsername('A1')).toBe(true);
    expect(isValidUsername('Older Adult_1')).toBe(true);
    expect(isValidUsername('a'.repeat(30))).toBe(true);
    expect(isValidUsername('a')).toBe(false);
    expect(isValidUsername('a'.repeat(31))).toBe(false);
    expect(isValidUsername(' user ')).toBe(true);
    expect(isValidUsername('name!')).toBe(false);
  });

  it('reports each password policy requirement independently', () => {
    expect(getPasswordRequirements('Abcd123!').every(({ met }) => met)).toBe(true);
    expect(getPasswordRequirements('lowercase1!').map(({ met }) => met)).toEqual([
      true,
      false,
      true,
      true,
      true,
    ]);
  });

  it('allows only known internal dashboard redirects', () => {
    expect(getSafeAuthRedirect('/app/today?join=invite')).toBe('/app/today');
    expect(getSafeAuthRedirect('/app/caregiver')).toBe('/app/caregiver');
    expect(getSafeAuthRedirect('https://example.com')).toBeNull();
    expect(getSafeAuthRedirect('//example.com')).toBeNull();
    expect(getSafeAuthRedirect('/app/today/../../outside')).toBeNull();
    expect(getSafeAuthRedirect('/login')).toBeNull();
  });
});
