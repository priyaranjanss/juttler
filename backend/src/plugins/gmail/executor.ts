/**
 * Gmail plugin - Google Gmail API v1 over OAuth 2.0.
 *
 * Gmail is OAuth-only: there is nothing to paste, the user authorises in Google
 * and the backend keeps the resulting tokens encrypted. Plugin metadata lives in
 * ./index.ts; the API calls live in ./executor.ts.
 */

import { requiredString, optionalNumber, requestJson, mapWithConcurrency, isAuthFailure, ToolExecutor, ToolContext } from '../shared';

// Overridable so the plugin can be pointed at a stub or proxy in tests.
const GMAIL_BASE = `${(process.env.GMAIL_API_BASE || 'https://gmail.googleapis.com/gmail/v1').replace(/\/+$/, '')}/users/me`;
const GOOGLE_TOKEN_URL = (process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token').replace(/\/+$/, '');

/**
 * Exchanges the stored refresh token for a new access token.
 *
 * Gmail access tokens last only an hour, so every long-lived installation hits
 * this eventually. Client id/secret are read from env here rather than threaded
 * through, so the secret never leaves this module.
 */
async function refreshGoogleToken(credential: Record<string, any>): Promise<string> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = credential.refreshToken;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'The Gmail access token expired and it cannot be refreshed (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set). Reconnect Gmail from the Plugins dialog.'
    );
  }

  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !data.access_token) {
    const reason = data.error_description || data.error || `HTTP ${res.status}`;
    throw new Error(`Could not refresh the Gmail token: ${reason}. Reconnect Gmail from the Plugins dialog.`);
  }

  return data.access_token;
}

/**
 * Runs one Gmail call with the current token, refreshing once when Google
 * rejects the credential. A fresh token is handed back to be persisted so the
 * next call does not have to refresh again.
 */
async function withFreshToken<T>(ctx: ToolContext, run: (token: string) => Promise<T>): Promise<T> {
  if (!ctx.credential.token) {
    throw new Error('Gmail needs an OAuth connection. Connect it from the Plugins dialog.');
  }

  try {
    return await run(ctx.credential.token);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Only a rejected credential is worth refreshing; a 429 or a bad query is not.
    if (!isAuthFailure(message) || !ctx.credential.refreshToken) throw err;

    const fresh = await refreshGoogleToken(ctx.credential);
    try {
      await ctx.refreshAccessToken?.(fresh);
    } catch {
      // Persisting is best-effort: the retry below still serves this turn.
    }
    return await run(fresh);
  }
}

/** Gmail returns base64url bodies nested inside MIME parts. */
function decodeGmailBody(payload: any): string {
  if (!payload) return '';

  const fromB64 = (data: string) => {
    try {
      return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch {
      return '';
    }
  };

  if (typeof payload.body?.data === 'string' && payload.body.data) {
    return fromB64(payload.body.data);
  }

  for (const part of payload.parts ?? []) {
    const nested = decodeGmailBody(part);
    if (nested) return nested;
  }
  return '';
}

function headerValue(headers: any[], name: string): string {
  const found = (headers ?? []).find((h: any) => String(h?.name).toLowerCase() === name);
  return found?.value || '';
}

/** Builds a minimal RFC 5322 message the way Gmail expects it (base64url). */
function encodeMime(to: string, subject: string, body: string): string {
  const mime = [
    `To: ${to}`,
    `Subject: ${subject.replace(/[\r\n]+/g, ' ')}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    body,
  ].join('\r\n');

  return Buffer.from(mime, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Gmail search operators the user might type as plain English. */
const NATURAL_QUERY_ALIASES: Record<string, string> = {
  '': 'in:inbox',
  'all': 'in:anywhere',
  'all mail': 'in:anywhere',
  'all mails': 'in:anywhere',
  'everything': 'in:anywhere',
  'mail': 'in:inbox',
  'mails': 'in:inbox',
  'mail in inbox': 'in:inbox',
  'mails in inbox': 'in:inbox',
  'emails': 'in:inbox',
  'email': 'in:inbox',
  'emails in inbox': 'in:inbox',
  'inbox': 'in:inbox',
  'unread': 'is:unread',
  'unread mail': 'is:unread',
  'unread mails': 'is:unread',
  'unread email': 'is:unread',
  'unread emails': 'is:unread',
  'unread in inbox': 'in:inbox is:unread',
  'recent': 'in:inbox',
  'recent mail': 'in:inbox',
  'recent mails': 'in:inbox',
  'latest': 'in:inbox',
  'latest mail': 'in:inbox',
  'latest mails': 'in:inbox',
  'newest': 'in:inbox',
  'sent': 'in:sent',
  'sent mail': 'in:sent',
  'sent mails': 'in:sent',
  'sent items': 'in:sent',
  'drafts': 'in:drafts',
  'draft': 'in:drafts',
  'spam': 'in:spam',
  'trash': 'in:trash',
  'bin': 'in:trash',
  'starred': 'is:starred',
  'important': 'is:important',
  'attachments': 'has:attachment',
  'attachment': 'has:attachment',
};

/** Strips filler so phrasings like "show me my unread mail" still resolve. */
function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[!.?,]/g, '')
    .replace(/^(please\s+|can you\s+|show me\s+|get me\s+|give me\s+|show\s+|get\s+|list\s+|check\s+|read\s+|fetch\s+|find\s+|search\s+|look at\s+)/, '')
    .replace(/\b(my|the|all|any|me)\b/g, ' ')
    .replace(/\binbox\b/g, 'inbox')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Turns whatever the model passed into a valid Gmail query. A missing or
 * conversational value is mapped to the sensible default rather than erroring,
 * so a plain "check my inbox" works without Gmail search syntax.
 */
function resolveQuery(raw: unknown): string {
  if (typeof raw !== 'string') return 'in:inbox';
  const value = raw.trim();
  if (!value) return 'in:inbox';

  const key = normalizeKey(value);
  const alias = NATURAL_QUERY_ALIASES[key] ?? NATURAL_QUERY_ALIASES[value.toLowerCase()];
  if (alias) return alias;

  return value;
}

export const gmailTools: Record<string, ToolExecutor> = {
  /**
   * Search the mailbox and return matching messages.
   *
   * The query is optional: plain requests like "check my inbox" or "my unread
   * mail" are mapped to the right Gmail syntax, and any Gmail search operator is
   * passed through when given ("from:x@y.com", "newer_than:7d", "has:attachment").
   *
   * Headers only by default. Pass include_body to also read the first few
   * bodies, which turns "summarise my unread" into one call instead of one per
   * message. Results are newest first.
   */
  list_emails: async (args, ctx) => {
    const query = resolveQuery(args.query);
    // Gmail enforces a per-user CONCURRENT request limit, so keep both the count
    // and the fanout small.
    const limit = optionalNumber(args, 'max_results', 5, 15);
    const includeBody = args.include_body === true;
    // Reading bodies costs a request each, so cap how many are pulled in one go.
    const bodyBudget = 3;

    // The whole read runs through withFreshToken, so an expired token is
    // refreshed once and the read retried rather than failing every request.
    return withFreshToken(ctx, async (token) => {
      const headers = { Authorization: `Bearer ${token}` };

      const list = await requestJson(
        `${GMAIL_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`,
        { headers }
      );

      const ids: string[] = (list.messages ?? []).map((m: any) => m.id).filter(Boolean);
      if (ids.length === 0) {
        return { query, total: 0, messages: [] };
      }

      // Kept deliberately low: the per-user ceiling is what we cannot raise, and
      // the request spacer keeps these spaced out rather than bursted.
      const messages = await mapWithConcurrency(ids, 2, async (id, index) => {
        const msg = await requestJson(
          `${GMAIL_BASE}/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
          { headers }
        );

        const entry: Record<string, any> = {
          id,
          subject: headerValue(msg.payload?.headers, 'subject'),
          from: headerValue(msg.payload?.headers, 'from'),
          date: headerValue(msg.payload?.headers, 'date'),
          snippet: msg.snippet,
          unread: (msg.labelIds ?? []).includes('UNREAD'),
        };

        // Pull bodies for the newest handful only, so one call can answer a
        // "read/summarise these" question without a request per message.
        if (includeBody && index < bodyBudget) {
          const full = await requestJson(`${GMAIL_BASE}/messages/${id}?format=full`, { headers });
          entry.body = decodeGmailBody(full.payload).slice(0, 8000);
        }

        return entry;
      });

      // Newest first, which is what "latest email" questions want and what every
      // other read is best served by too.
      messages.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());

      return { query, total: messages.length, messages };
    });
  },

  /** Read one message in full, decoded to plain text. */
  get_message: async (args, ctx) => {
    const id = requiredString(args, 'message_id');
    const msg = await withFreshToken(ctx, (token) =>
      requestJson(`${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=full`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    );

    return {
      id,
      subject: headerValue(msg.payload?.headers, 'subject'),
      from: headerValue(msg.payload?.headers, 'from'),
      to: headerValue(msg.payload?.headers, 'to'),
      date: headerValue(msg.payload?.headers, 'date'),
      body: decodeGmailBody(msg.payload).slice(0, 8000),
      labels: msg.labelIds ?? [],
    };
  },

  /** Send an email. Sensitive: it reaches a real inbox. */
  send_email: async (args, ctx) => {
    const to = requiredString(args, 'to');
    const subject = requiredString(args, 'subject');
    const body = requiredString(args, 'body');

    const sent = await withFreshToken(ctx, (token) =>
      requestJson(`${GMAIL_BASE}/messages/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { raw: encodeMime(to, subject, body) },
      })
    );

    return { sent: true, to, subject, id: sent.id, threadId: sent.threadId ?? null };
  },
};
