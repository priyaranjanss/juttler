import { createCipheriv, createDecipheriv, randomBytes, createHash, scryptSync } from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
// Prefix distinguishing an encrypted token from a plaintext one left over
// from before this feature existed.
const ENCRYPTED_PREFIX = 'v1';

let cachedKey: Buffer | null = null;

function getKey(): Buffer {
  if (cachedKey) return cachedKey;

  const secret = process.env.CREDENTIAL_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('CREDENTIAL_SECRET is not set. Generate one with `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"` and add it to backend/.env.');
    }
    console.warn('⚠ CREDENTIAL_SECRET is not set — using a derived development key. Add one to backend/.env.');
    cachedKey = createHash('sha256').update('juttler-insecure-development-credential-key').digest();
    return cachedKey;
  }

  // Derive a fixed-size key from any length of secret so the env value can be
  // a passphrase or a base64 key blob.
  cachedKey = scryptSync(secret, 'juttler-credential-secret-v1', KEY_BYTES);
  return cachedKey;
}

/**
 * Encrypts a token for storage. Returns base64 of
 * `${prefix}.${iv}.${ciphertext}.${authTag}`.
 */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [
    ENCRYPTED_PREFIX,
    iv.toString('base64'),
    ciphertext.toString('base64'),
    cipher.getAuthTag().toString('base64'),
  ].join('.');
}

/** Decrypts a value produced by encryptToken. Throws if it was tampered with. */
export function decryptToken(stored: string): string {
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== ENCRYPTED_PREFIX) {
    throw new Error('Unrecognized encrypted token format');
  }

  const [, ivB64, ciphertextB64, tagB64] = parts;
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, 'base64')), decipher.final()]).toString('utf8');
}

/** True when the value was produced by encryptToken (vs. any stray plaintext). */
export function isEncryptedToken(value: string): boolean {
  return value.startsWith(`${ENCRYPTED_PREFIX}.`);
}

/**
 * Decrypts a stored token, tolerating values written before encryption existed
 * so an older row never crashes the gateway.
 */
export function decryptTokenSafe(stored: string | null | undefined): string {
  if (!stored) return '';
  if (!isEncryptedToken(stored)) return stored;
  return decryptToken(stored);
}

/** Truncated, non-reversible fingerprint for display — never the token itself. */
export function tokenFingerprint(stored: string | null | undefined): string {
  if (!stored) return '';
  const hash = createHash('sha256').update(stored).digest('hex').slice(0, 8);
  return `••••${hash}`;
}
