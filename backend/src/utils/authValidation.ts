/**
 * Validation rules for the authentication surface.
 *
 * The client mirrors these rules for instant feedback; the server remains the
 * authority. Keeping them in one module means the limits cannot drift between
 * the form and the API.
 */

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 80;
export const EMAIL_MAX_LENGTH = 254;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

// Deliberately pragmatic: something@something.tld with no whitespace. Full
// RFC 5322 validation belongs to the mail provider, not the sign-up form.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Canonical form used for storage and lookups. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const value = normalizeEmail(email);
  return value.length > 0 && value.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(value);
}

/** Returns a human-readable error, or null when the value is valid. */
export function validateName(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Please enter your name.';
  if (value.length < NAME_MIN_LENGTH) return `Name must be at least ${NAME_MIN_LENGTH} characters.`;
  if (value.length > NAME_MAX_LENGTH) return `Name must be at most ${NAME_MAX_LENGTH} characters.`;
  return null;
}

export function validateEmail(email: string): string | null {
  const value = normalizeEmail(email);
  if (!value) return 'Please enter your email address.';
  if (value.length > EMAIL_MAX_LENGTH) return 'That email address is too long.';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Please enter a password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}
