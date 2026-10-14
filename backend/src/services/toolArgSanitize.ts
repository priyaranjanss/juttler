/**
 * Models sometimes wrap tool args in template leftovers (}}, {{), quotes, or
 * markdown fences. Clean those before hitting provider APIs — no ticket-specific logic.
 */

/** True when a string looks like a real repo-relative file/folder path. */
export function isPlausibleRepoPath(path: string): boolean {
  const p = String(path ?? '').trim();
  if (!p || p.length > 512) return false;
  // Lone punctuation (e.g. ",") must never hit the GitHub API.
  if (!/[A-Za-z0-9]/.test(p)) return false;
  if (p === '.' || p === '..' || p.includes('://')) return false;
  if (/(^|\/)\.\.(\/|$)/.test(p)) return false;
  return true;
}

/** Repo-relative path: strip braces/quotes/whitespace junk models leave on args. */
export function sanitizeRepoPath(raw: string): string {
  let path = String(raw ?? '').trim();
  if (!path) return path;

  // Drop leading Mustache-style leftovers: }}, {{foo}}, {bar}
  path = path.replace(/^(\{\{[^}]*\}\}|\{[^}]*\}|\})+/, '');

  // Strip wrapping quotes / backticks / braces repeatedly.
  for (let i = 0; i < 4; i++) {
    const next = path
      .replace(/^[\s`"'{\\}]+/, '')
      .replace(/[\s`"'{\\}]+$/, '')
      .replace(/^}+/, '')
      .replace(/^{+/, '');
    if (next === path) break;
    path = next;
  }

  path = path.replace(/^\/+/, '').replace(/\\/g, '/');

  // Models sometimes send "a.ts, b.ts" or a leading comma — use the first real path.
  if (path.includes(',')) {
    const parts = path
      .split(',')
      .map((part) => part.trim().replace(/^\/+/, ''))
      .filter((part) => isPlausibleRepoPath(part));
    path = parts[0] ?? '';
  }

  return isPlausibleRepoPath(path) ? path : '';
}

/** Soften write payloads when the model wraps the whole file in a markdown fence. */
export function sanitizeFileContent(raw: string): string {
  const text = String(raw ?? '');
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[\w-]*\r?\n([\s\S]*?)\r?\n```$/);
  return fenced ? fenced[1] : text;
}

const PATH_ALIASES = [
  'path',
  'file',
  'file_path',
  'filepath',
  'filePath',
  'filename',
  'file_name',
  'name',
  'target',
  'src',
] as const;

/** Coerce a string-ish value the model used for a file path. */
function coercePathValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    const cleaned = sanitizeRepoPath(value);
    return cleaned || null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const cleaned = sanitizeRepoPath(String(value));
    return cleaned || null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const cleaned = coercePathValue(item);
      if (cleaned) return cleaned;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    for (const key of PATH_ALIASES) {
      const cleaned = coercePathValue(row[key]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

/**
 * Fill `path` from common model aliases (file, file_path, …).
 * Returns the resolved path or null when still missing.
 */
export function resolvePathArg(args: Record<string, unknown>): string | null {
  for (const key of PATH_ALIASES) {
    const resolved = coercePathValue(args[key]);
    if (resolved) {
      args.path = resolved;
      return resolved;
    }
  }
  return null;
}

/** Mutates known string args in place for GitHub / Jira tools. */
export function sanitizeToolArgs(toolName: string, args: Record<string, unknown>): void {
  if (toolName.startsWith('github.')) {
    resolvePathArg(args);
  } else if (typeof args.path === 'string') {
    args.path = sanitizeRepoPath(args.path);
  }
  if (typeof args.content === 'string' && /\.write_file$/.test(toolName)) {
    args.content = sanitizeFileContent(args.content);
  }
  if (typeof args.query === 'string') {
    args.query = args.query.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '');
  }
  if (typeof args.branch === 'string') {
    args.branch = args.branch.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '');
  }
  if (typeof args.branch_name === 'string') {
    args.branch_name = args.branch_name.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '');
  }
  if (typeof args.head === 'string') {
    args.head = args.head.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '');
  }
  if (toolName.startsWith('jira.')) {
    if (args.issue_key == null && (args.key != null || args.issueKey != null || args.issue != null)) {
      args.issue_key = args.key ?? args.issueKey ?? args.issue;
    }
    if (typeof args.issue_key === 'string') {
      args.issue_key = args.issue_key.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '');
    }
    if (typeof args.jql === 'string') {
      args.jql = args.jql.trim();
    }
    if (typeof args.project === 'string') {
      args.project = args.project.trim().toUpperCase();
    }
  }
}
