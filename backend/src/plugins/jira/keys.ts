/**
 * Issue-key resolution for Jira tools.
 * Understands full keys (ABC-123), bare numbers with a desk project (9 → ABC-9),
 * and strips model/XML junk that otherwise becomes the "issue key".
 */

const FULL_KEY = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/;
/** Whole string is only a ticket number (optionally "ticket 9" / "#9"). */
const BARE_NUMBER_ONLY = /^(?:ticket|issue|bug|#)?\s*#?(\d+)$/i;
/**
 * Number as a ticket reference in casual text: "9", "do 9", "ticket 9", "#9".
 * Avoids matching years/versions by requiring ticket words or a short lone digit run.
 */
const BARE_NUMBER_IN_TEXT =
  /(?:(?:ticket|issue|bug|task)\s*#?\s*|[#])(\d+)\b|\b(?:do|fix|work\s+on|handle)\s+(\d+)\b|^\s*(\d{1,5})\s*$/i;

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

function bareNumberFromText(text: string): string | null {
  const only = text.match(BARE_NUMBER_ONLY);
  if (only) return only[1];
  const inText = text.match(BARE_NUMBER_IN_TEXT);
  if (!inText) return null;
  return inText[1] || inText[2] || inText[3] || null;
}

/**
 * Resolve one issue key from free text.
 * If preferredProject is set and the user only said a number (e.g. "9"),
 * returns PROJECT-9.
 */
export function resolveIssueKey(raw: unknown, preferredProject?: string | null): string | null {
  const text = stripKeyJunk(raw);
  if (!text) return null;

  const full = text.match(FULL_KEY);
  if (full) return full[1].toUpperCase();

  const project = preferredProject?.trim().toUpperCase() || null;
  if (project) {
    const bare = bareNumberFromText(text);
    if (bare) return `${project}-${bare}`;
  }
  return null;
}

/** Collect unique keys from several text chunks (message + history). */
export function extractIssueKeys(
  preferredProject: string | null | undefined,
  ...chunks: Array<string | null | undefined>
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk) continue;
    const cleaned = stripKeyJunk(chunk);
    // Full keys anywhere in the text
    const re = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g;
    for (const match of cleaned.matchAll(re)) {
      const key = match[1].toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(key);
    }
    // Bare number with preferred project → PROJECT-N
    const alone = resolveIssueKey(cleaned, preferredProject);
    if (alone && !seen.has(alone)) {
      seen.add(alone);
      found.push(alone);
    }
  }
  return found;
}

const KEY_ALIASES = ['issue_key', 'key', 'issueKey', 'issue', 'ticket', 'ticket_key'] as const;

/**
 * Pull issue_key from model args (with aliases). Uses preferred project for bare numbers.
 * Throws a clear error when nothing resolves.
 */
export function pickIssueKeyArg(
  args: Record<string, unknown>,
  preferredProject?: string | null
): string {
  for (const alias of KEY_ALIASES) {
    if (args[alias] == null) continue;
    const key = resolveIssueKey(args[alias], preferredProject);
    if (key) {
      args.issue_key = key;
      return key;
    }
  }
  // Context key injected by the gateway / turn for "continue" follow-ups
  if (args._contextIssueKey != null) {
    const key = resolveIssueKey(args._contextIssueKey, preferredProject);
    if (key) {
      args.issue_key = key;
      return key;
    }
  }
  const first = KEY_ALIASES.map((k) => args[k]).find((v) => v != null && String(v).trim());
  throw new Error(
    `"${stripKeyJunk(first ?? '')}" is not a Jira issue key. Pass issue_key like ABC-123` +
      (preferredProject ? `, or just the number when the desk project is ${preferredProject}` : '') +
      '.'
  );
}
