import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The backend reads a single env file: backend/.env
// The Neon CLI keeps DATABASE_URL fresh in it via: neon env pull --file backend/.env
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Used only when JWT_SECRET is missing in development so the app can still boot.
// Never valid in production — getSecret() throws there.
const INSECURE_DEV_SECRET = 'juttler-insecure-development-secret';

// Token lifetime. After this the browser must log in again.
export const JWT_EXPIRES_IN = '7d';

let cachedSecret: string | null = null;

function getSecret(): string {
  if (cachedSecret) return cachedSecret;

  const secret = process.env.JWT_SECRET;
  if (secret) {
    cachedSecret = secret;
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET is not set. Generate one with `node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"` and add it to backend/.env.');
  }

  console.warn('⚠ JWT_SECRET is not set — falling back to an insecure development secret. Add one to backend/.env.');
  cachedSecret = INSECURE_DEV_SECRET;
  return cachedSecret;
}

// ---------------------------------------------------------------------------
// Token issuing & verification (stateless HS256 JWTs)
// ---------------------------------------------------------------------------

export function signSlackLink(slackUserId: string, slackTeamId: string, displayName: string): string {
  return jwt.sign(
    { purpose: 'slack-link', slackUserId, slackTeamId, displayName: displayName.slice(0, 80) },
    getSecret(),
    { expiresIn: '30m' }
  );
}

export function verifySlackLink(token: string | undefined): {
  slackUserId: string;
  slackTeamId: string;
  displayName: string;
} | null {
  if (!token) return null;
  try {
    const payload = jwt.verify(token, getSecret());
    if (typeof payload === 'string' || payload.purpose !== 'slack-link') return null;
    const slackUserId = payload.slackUserId;
    const slackTeamId = payload.slackTeamId;
    const displayName = payload.displayName;
    if (typeof slackUserId !== 'string' || typeof slackTeamId !== 'string') return null;
    return {
      slackUserId,
      slackTeamId,
      displayName: typeof displayName === 'string' ? displayName : '',
    };
  } catch {
    return null;
  }
}

export function signAuthToken(userId: string): string {
  return jwt.sign({ sub: userId }, getSecret(), { expiresIn: JWT_EXPIRES_IN });
}

// Returns the user id encoded in a valid, unexpired token, or null otherwise.
export function verifyAuthToken(token: string | undefined): string | null {
  if (!token) return null;

  try {
    const payload = jwt.verify(token, getSecret());
    if (typeof payload === 'string') return null;
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
