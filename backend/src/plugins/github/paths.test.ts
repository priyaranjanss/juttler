/**
 * Repo-relative path + branch sanitization for GitHub tools.
 *
 * Models often emit junk prefixes (":", "}}", quotes, file://). Those must never
 * reach the Contents API — that is what caused %3A… 404s.
 */

/** True when the string can be a real file/folder path in a git repo. */
export function isPlausibleRepoPath(path: string): boolean {
  const p = String(path ?? '').trim();
  if (!p || p.length > 512) return false;
  if (!/[A-Za-z0-9_]/.test(p)) return false;
  if (p === '.' || p === '..') return false;
  if (p.includes('://')) return false;
  if (/(^|\/)\.\.(\/|$)/.test(p)) return false;
  return true;
}

/**
 * Normalize a model-supplied path into a clean repo-relative path, or "".
 * Never returns punctuation-only junk.
 */
export function sanitizeRepoPath(raw: unknown): string {
  let path = String(raw ?? '').trim();
  if (!path) return '';

  // URI / copy-paste leftovers
  path = path.replace(/^file:\/\//i, '');
  path = path.replace(/^https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\//i, '');
  path = path.replace(/^https?:\/\/github\.com\/[^/]+\/[^/]+\/\?path=/i, '');
  path = path.replace(/^github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\//i, '');

  // Common naming wrappers used by models in tool calls.
  path = path.replace(/^repo:/i, '');
  path = path.replace(/^path:/i, '');

  // Mustache / template leftovers
  path = path.replace(/^(\{\{[^}]*\}\}|\{[^}]*\})+/, '');

  // Strip wrapping quotes / backticks / braces / colons (":backend/…" → %3A…)
  for (let i = 0; i < 6; i++) {
    const next = path
      .replace(/^[\s`"'{\\}:]+/, '')
      .replace(/[\s`"'{\\}]+$/, '')
      .replace(/^}+/, '')
      .replace(/^{+/, '')
      .replace(/^:+/, '');
    if (next === path) break;
    path = next;
  }

  path = path.replace(/\\/g, '/').replace(/^\/+/, '');

  // "a.ts, b.ts" or leading comma → first real segment
  if (path.includes(',')) {
    const parts = path
      .split(',')
      .map((part) =>
        part
          .trim()
          .replace(/^[\s`"'{\\}:]+/, '')
          .replace(/^\/+/, '')
      )
      .filter((part) => isPlausibleRepoPath(part));
    path = parts[0] ?? '';
  }

  // Drop accidental "./"
  path = path.replace(/^\.\//, '');

  // Drop trailing GitHub URL query fragments after a path.
  path = path.replace(/[?#].*$/, '');

  return isPlausibleRepoPath(path) ? path : '';
}

/** Branch names: no spaces, no refs/heads/ prefix, no template junk. */
export function sanitizeBranchName(raw: unknown): string {
  let name = String(raw ?? '').trim();
  name = name
    .replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '')
    .replace(/^refs\/heads\//i, '')
    .replace(/\s+/g, '-')
    .replace(/^:+/, '');
  if (!name || name.length > 200) return '';
  if (!/^[A-Za-z0-9._/-]+$/.test(name)) {
    name = name.replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/-+/g, '-');
  }
  return name.replace(/^\/+|\/+$/g, '');
}

const PATH_ALIASES = [
  'path',
  'file',
  'file_path',
  'filepath',
  'filePath',
  'filename',
  'file_name',
  'target',
  'src',
] as const;

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

/** Resolve path from path / file / file_path / … onto args.path. */
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

/** Required clean path or a clear error the model can fix. */
export function requiredPath(args: Record<string, unknown>): string {
  const path = resolvePathArg(args) || sanitizeRepoPath(args.path);
  if (!path) {
    throw new Error(
      'Missing or invalid "path". Pass one repo-relative file path (e.g. src/app.ts). ' +
        'Use search_code or list_tree first, then copy the exact path field — never prefix with : or punctuation.'
    );
  }
  return path;
}
