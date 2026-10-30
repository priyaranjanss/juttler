/**
 * Issue-key handling for Jira tools.
 * Accepts a full key (ABC-123) from the model's arguments and strips XML /
 * template leftovers that otherwise become the "issue key".
 */

const FULL_KEY = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/;

/** Strip XML / DSML / template leftovers models sometimes put in args. */
export function stripKeyJunk(raw: unknown): string {
  let text = String(raw ?? '');
  text = text.replace(/<\/?(?:[\w.-]+:)?[\w.-]+\b[^>]*>/g, ' ');
  text = text.replace(/parameter\s*name\s*=\s*["'][^"']*["']/gi, ' ');
  text = text.replace(/\bDSML\b/gi, ' ');
  text = text.replace(/[|｜]+/g, ' ');
  text = text.replace(/^[\s`"'{\\}:]+|[\s`"'{\\}:]+$/g, '');
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

/** The full issue key in a value, uppercased, or null when there is none. */
export function resolveIssueKey(raw: unknown): string | null {
  const text = stripKeyJunk(raw);
  if (!text) return null;
  const full = text.match(FULL_KEY);
  return full ? full[1].toUpperCase() : null;
}

const KEY_ALIASES = ['issue_key', 'key', 'issueKey', 'issue', 'ticket', 'ticket_key'] as const;

/** Pull issue_key from model args (with aliases). Throws when no full key is present. */
export function pickIssueKeyArg(args: Record<string, unknown>): string {
  for (const alias of KEY_ALIASES) {
    if (args[alias] == null) continue;
    const key = resolveIssueKey(args[alias]);
    if (key) {
      args.issue_key = key;
      return key;
    }
  }
  const first = KEY_ALIASES.map((k) => args[k]).find((v) => v != null && String(v).trim());
  throw new Error(`"${stripKeyJunk(first ?? '')}" is not a Jira issue key. issue_key must be a full key such as ABC-123.`);
}
