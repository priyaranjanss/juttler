/**
 * Pull Jira-style issue keys from free text (ICS-9, ABC-123, …).
 * Used to route the bot to get_ticket instead of broken free-text JQL.
 */

const KEY_RE = /\b([A-Za-z][A-Za-z0-9]+-\d+)\b/g;

export function extractIssueKeys(...chunks: Array<string | null | undefined>): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (!chunk) continue;
    KEY_RE.lastIndex = 0;
    for (const match of chunk.matchAll(KEY_RE)) {
      const key = match[1].toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(key);
    }
  }
  return found;
}
