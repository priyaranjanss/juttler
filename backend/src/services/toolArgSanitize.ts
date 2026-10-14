/**
 * Models sometimes wrap tool args in template leftovers (}}, {{), quotes, or
 * markdown fences. Clean those before hitting provider APIs — no ticket-specific logic.
 */

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

  return path.replace(/^\/+/, '').replace(/\\/g, '/');
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
  if (typeof value === 'string' && value.trim()) return sanitizeRepoPath(value);
  if (typeof value === 'number' && Number.isFinite(value)) return sanitizeRepoPath(String(value));
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const row = value as Record<string, unknown>;
    for (const key of PATH_ALIASES) {
      if (typeof row[key] === 'string' && String(row[key]).trim()) {
        return sanitizeRepoPath(String(row[key]));
      }
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
