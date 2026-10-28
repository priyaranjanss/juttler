export const PASSWORD_MIN_LENGTH = 8;
export const NAME_MIN_LENGTH = 2;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  const value = email.trim();
  return value.length > 0 && value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function validateName(name: string): string | null {
  const value = name.trim();
  if (!value) return 'Please enter your name.';
  if (value.length < NAME_MIN_LENGTH) return `Name must be at least ${NAME_MIN_LENGTH} characters.`;
  if (value.length > 80) return 'Name must be at most 80 characters.';
  return null;
}

export function validateEmail(email: string): string | null {
  if (!email.trim()) return 'Please enter your email address.';
  if (!isValidEmail(email)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(password: string): string | null {
  if (!password) return 'Please enter a password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > 128) return 'Password must be at most 128 characters.';
  return null;
}

/**
 * Only workspace paths are honoured as a post-login destination. Anything else
 * (including protocol-relative URLs) falls back to the workspace root, so the
 * `next` query parameter can never be used as an open redirect.
 */
export function readNextPath(): string {
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next) return '/workspace';
  if (next !== '/workspace' && !next.startsWith('/workspace/')) return '/workspace';
  return next;
}
