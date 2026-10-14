import { Request, Response } from 'express';
import { UserRecord, findUserById } from '../repositories/users';
import { verifyAuthToken } from '../config/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRecord;
      /** Original JSON bytes, kept so Slack can verify the request signature. */
      rawBody?: Buffer;
    }
  }
}

export const PUBLIC_AUTH_PATHS = ['/auth/register', '/auth/login', '/auth/logout'];

// OAuth provider callbacks, e.g. /plugins/gmail/callback. Google redirects the
// user's BROWSER here, and a browser navigation carries no Authorization header,
// so these must be reachable without a session. Safety comes from the single-use
// CSRF state minted by POST /plugins/:slug/oauth/start, not from the session.
const OAUTH_CALLBACK_PATH = /^\/plugins\/[^/]+\/callback$/;
// Slack calls these with no Juttler session. Events are signed; the install
// callback is protected by the single-use OAuth state.
const SLACK_PUBLIC_PATH = /^\/slack\/(?:events|team-bots\/callback)$/;

export function isPublicAuthPath(path: string): boolean {
  return PUBLIC_AUTH_PATHS.includes(path) || OAUTH_CALLBACK_PATH.test(path) || SLACK_PUBLIC_PATH.test(path);
}

export function readBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    return header.slice(7);
  }
  return undefined;
}

export async function authenticate(req: Request, res: Response, next: () => void): Promise<void> {
  const userId = verifyAuthToken(readBearerToken(req));
  if (!userId) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // The token proves identity; the database stays the source of truth for
  // status and role so disabling a user takes effect immediately.
  const user = await findUserById(userId);
  if (!user || user.status !== 'active') {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.user = user;
  next();
}

export function requireAdmin(req: Request, res: Response, next: () => void): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
