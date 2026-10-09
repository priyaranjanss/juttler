import { Request, Response } from 'express';

/**
 * Allows the frontend origin (set via FRONTEND_URL in backend/.env) to call
 * the API cross-origin. When FRONTEND_URL is unset the app is same-origin
 * (backend-hosted build) and no CORS headers are needed.
 *
 * The allow-origin header is only sent when the request's Origin matches
 * FRONTEND_URL exactly — browsers enforce the match, so any other origin
 * is blocked.
 */
export function corsMiddleware(req: Request, res: Response, next: () => void): void {
  const allowedOrigin = process.env.FRONTEND_URL?.replace(/\/+$/, '');
  if (!allowedOrigin || req.headers.origin !== allowedOrigin) {
    next();
    return;
  }

  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');

  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }

  next();
}
