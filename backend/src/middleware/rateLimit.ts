import { Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const SWEEP_THRESHOLD = 5_000;

/** Drops expired buckets so a long-running process does not grow forever. */
function sweep(now: number): void {
  if (buckets.size < SWEEP_THRESHOLD) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Bucket key. Defaults to the caller's IP. */
  key?: (req: Request) => string;
}

/**
 * Fixed-window limiter for brute-force-prone endpoints.
 *
 * This is intentionally in-process: the auth endpoints are low-volume, and a
 * single API instance is the deployment shape today. If the API is ever scaled
 * horizontally, swap the Map for Upstash Redis (already a dependency).
 */
export function rateLimit({ windowMs, max, key }: RateLimitOptions) {
  return (req: Request, res: Response, next: () => void): void => {
    const now = Date.now();
    sweep(now);

    const bucketKey = key
      ? key(req)
      : req.ip || req.socket.remoteAddress || 'unknown';

    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, max - bucket.count);
    const resetSeconds = Math.max(1, Math.ceil(bucket.resetAt / 1000));

    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(resetSeconds));

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: `Too many attempts. Please try again in ${retryAfter} second${retryAfter === 1 ? '' : 's'}.`,
      });
      return;
    }

    next();
  };
}
