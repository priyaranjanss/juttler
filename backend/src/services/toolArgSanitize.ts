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

/** Mutates known string args in place for GitHub (and similar) tools. */
export function sanitizeToolArgs(toolName: string, args: Record<string, unknown>): void {
  if (typeof args.path === 'string') {
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
}
