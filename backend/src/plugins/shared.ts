/**
 * Shared plumbing for every plugin.
 *
 * Plugins live in their own folder under src/plugins/<slug>/ and import these
 * helpers rather than re-implementing HTTP and argument handling.
 */

export interface ToolContext {
  /** Decrypted credential object for this installation. */
  credential: Record<string, any>;
  /** Extra account info captured at connect time. */
  metadata: Record<string, any>;
  /**
   * Called when a tool obtains a new access token (e.g. an OAuth refresh) so the
   * caller can persist it. Gmail access tokens last only an hour, so without this
   * every call fails an hour after connecting.
   */
  refreshAccessToken?: (token: string, refreshToken?: string) => void | Promise<void>;
}

export interface ToolOutcome {
  ok: boolean;
  result: any;
  durationMs: number;
  /**
   * True when the provider rejected the credential itself (401/403 or an
   * "invalid token" style message) rather than the request. The gateway uses
   * this to move the installation to needs_reauth.
   */
  authFailed?: boolean;
}

export type ToolExecutor = (args: Record<string, any>, ctx: ToolContext) => Promise<any>;

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Renders an API error body into a readable line, whatever shape it arrives in. */
export function describeErrorBody(parsed: unknown, fallback: string): string {
  if (typeof parsed === 'string') return parsed || fallback;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, any>;
    const candidate = obj.message ?? obj.error ?? obj.errors ?? obj.detail;
    if (typeof candidate === 'string') return candidate;
    if (candidate !== undefined) return JSON.stringify(candidate);
    if (Object.keys(obj).length === 0) return fallback;
    return JSON.stringify(obj);
  }
  return fallback;
}

/** JSON request that throws a descriptive Error on any non-2xx response. */
export async function requestJson(url: string, options: RequestOptions = {}): Promise<any> {
  // Retries are the only lever when a provider will not raise its quota.
  // Google's guidance is exponential backoff with jitter plus honouring
  // Retry-After; retries also re-check the concurrency limiter, so backing off
  // widens the gaps between requests rather than piling another burst on top.
  const maxAttempts = 5;

  for (let attempt = 0; ; attempt++) {
    await waitForTurn(url);

    const { method = 'GET', headers = {}, body } = options;
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();

    if ((res.status === 429 || res.status === 503) && attempt < maxAttempts - 1) {
      await sleep(retryDelayMs(res.headers.get('Retry-After'), attempt));
      continue;
    }

    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const path = new URL(url).pathname;
      const detail = describeErrorBody(parsed, text || res.statusText || 'unknown error');
      throw new Error(`${method} ${path} failed (${res.status}): ${detail}`);
    }

    return parsed;
  }
}

/** Base delay: 1s, 2s, 4s, 8s. Capped so a turn cannot stall for minutes. */
function retryDelayMs(retryAfter: string | null, attempt: number): number {
  const seconds = retryAfter ? Number.parseInt(retryAfter, 10) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const exponential = Math.min(1000 * 2 ** attempt, 16_000);
  // Jitter avoids a synchronised retry storm from parallel callers.
  return exponential * (0.5 + Math.random() * 0.5);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Request spacing
// ---------------------------------------------------------------------------

/**
 * Minimum spacing between requests to the same provider, keyed by origin.
 *
 * Per-user quota is the binding constraint, and a provider's limit is shared
 * with everything else hitting that account, so the only thing we control is
 * our own rate. Spacing out requests keeps a multi-step turn well clear of the
 * ceiling instead of relying on backoff to rescue a burst.
 */
const MIN_SPACING_MS = 150;
const nextAllowedAt = new Map<string, number>();

export async function waitForTurn(url: string): Promise<void> {
  const key = new URL(url).origin;
  const now = Date.now();

  const earliest = nextAllowedAt.get(key) ?? now;
  const wait = Math.max(0, earliest - now);

  // Reserve the next slot now, so parallel callers queue rather than collide.
  nextAllowedAt.set(key, Math.max(now, earliest) + MIN_SPACING_MS);

  if (wait > 0) await sleep(wait);
}

/**
 * Maps items with a concurrency cap, preserving input order.
 *
 * Providers including Gmail enforce a per-user CONCURRENT request limit as well
 * as a rate limit, so fanning out one HTTP request per item with Promise.all can
 * trip 429 on its own. Run a small pool instead.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Reads a required parameter. Numbers and booleans are accepted and coerced to
 * a string, so a schema typed as "number" (e.g. pr_number) doesn't fail
 * validation just because it arrived as a JSON number.
 */
export function requiredString(args: Record<string, any>, key: string): string {
  const raw = args[key];
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw);
  if (typeof raw === 'boolean') return String(raw);
  throw new Error(`Missing required parameter "${key}"`);
}

/** Reads a required numeric parameter. */
export function requiredNumber(args: Record<string, any>, key: string): number {
  const raw = args[key];
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`Missing required parameter "${key}" (expected a positive number)`);
  }
  return parsed;
}

/** Reads an optional numeric parameter, clamped to `max`. */
export function optionalNumber(args: Record<string, any>, key: string, fallback: number, max: number): number {
  const raw = args[key];
  const parsed = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

/**
 * Recognises "the provider rejected our credential" rather than "the request was
 * wrong", so the gateway can move the installation to needs_reauth.
 *
 * Covers generic OAuth wording plus provider-specific invalid-grant and token
 * revocation errors.
 */
export function isAuthFailure(message: string): boolean {
  if (/\(40[13]\)/.test(message)) return true;
  return /invalid[_ ]?(credentials|auth|token|grant)|\bunauthorized\b|\bbad credentials\b|authentication token is invalid|refresh token.*(?:invalid|expired|revoked)|token_revoked|account_inactive|not_authed|missing_scope/i.test(
    message
  );
}
