/**
 * JQL helpers shared by the Jira executor and tests.
 * No ticket-specific hardcoding — only shape normalization.
 */

/** Pull a PROJ-123 style key out of free text, or null. */
export function extractIssueKey(value: unknown): string | null {
  const upper = String(value ?? '').trim().toUpperCase();
  if (!upper) return null;
  const match = upper.match(/\b([A-Z][A-Z0-9]+-\d+)\b/);
  if (match) return match[1];
  const cleaned = upper.replace(/[^A-Z0-9-]/g, '');
  if (/^[A-Z][A-Z0-9]+-\d+$/.test(cleaned)) return cleaned;
  return null;
}

/**
 * Models pass bare keys, free text, or empty JQL. Enhanced search rejects
 * unbounded queries, so always return a filterable clause.
 */
export function normalizeJql(raw: unknown, preferredProject?: string | null): string {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  const project = preferredProject?.trim().toUpperCase() || null;

  if (!trimmed) {
    return project
      ? `project = ${project} AND updated >= -120d ORDER BY updated DESC`
      : 'updated >= -120d ORDER BY updated DESC';
  }
  if (/^order\s+by\b/i.test(trimmed)) {
    const base = project ? `project = ${project} AND updated >= -120d` : 'updated >= -120d';
    return `${base} ${trimmed}`;
  }

  const bareKey = trimmed.match(/^[\s"'`]*([A-Za-z][A-Za-z0-9]+-\d+)[\s"'`.]*$/);
  if (bareKey) return `key = ${bareKey[1].toUpperCase()}`;

  if (!/\b(AND|OR|NOT|ORDER|project|key|status|assignee|updated|created|text|summary|type|IN|=|~)\b/i.test(trimmed)) {
    const keys = [...trimmed.matchAll(/\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g)];
    if (keys.length === 1) return `key = ${keys[0][1].toUpperCase()}`;
  }

  return trimmed;
}

/** Accept issue_key / key / issueKey / issue from the model. */
export function pickIssueKeyArg(args: Record<string, unknown>): string {
  const candidates = [args.issue_key, args.key, args.issueKey, args.issue];
  for (const candidate of candidates) {
    const key = extractIssueKey(candidate);
    if (key) return key;
  }
  const first = candidates.find((c) => c != null && String(c).trim());
  throw new Error(
    `"${first ?? ''}" is not a Jira issue key. Pass issue_key like ABC-123.`
  );
}
