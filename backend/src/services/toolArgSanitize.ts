/**
 * Pre-flight cleanup of model tool arguments before the gateway runs them.
 * GitHub paths are delegated to the github/paths module (single source of truth).
 */

import {
  resolvePathArg as resolveGithubPathArg,
  sanitizeBranchName,
  sanitizeRepoPath,
} from '../plugins/github/paths';

export { isPlausibleRepoPath, sanitizeRepoPath, resolvePathArg } from '../plugins/github/paths';

/** Soften write payloads when the model wraps the whole file in a markdown fence. */
export function sanitizeFileContent(raw: string): string {
  const text = String(raw ?? '');
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[\w-]*\r?\n([\s\S]*?)\r?\n```$/);
  return fenced ? fenced[1] : text;
}

/** Mutates known string args in place for GitHub / Jira tools. */
export function sanitizeToolArgs(toolName: string, args: Record<string, unknown>): void {
  if (toolName.startsWith('github.')) {
    resolveGithubPathArg(args);
    if (typeof args.branch === 'string') args.branch = sanitizeBranchName(args.branch);
    if (typeof args.branch_name === 'string') args.branch_name = sanitizeBranchName(args.branch_name);
    if (typeof args.head === 'string') args.head = sanitizeBranchName(args.head);
    if (typeof args.base === 'string') args.base = sanitizeBranchName(args.base);
    if (typeof args.ref === 'string') {
      args.ref = String(args.ref).trim().replace(/^[\s`"'{\\}:]+|[\s`"'{\\}]+$/g, '');
    }
    if (typeof args.query === 'string') {
      args.query = args.query.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '');
    }
    if (typeof args.content === 'string' && /\.write_file$/.test(toolName)) {
      args.content = sanitizeFileContent(args.content);
    }
    return;
  }

  if (typeof args.path === 'string') {
    args.path = sanitizeRepoPath(args.path);
  }

  if (toolName.startsWith('jira.')) {
    if (args.issue_key == null && (args.key != null || args.issueKey != null || args.issue != null)) {
      args.issue_key = args.key ?? args.issueKey ?? args.issue;
    }
    if (typeof args.issue_key === 'string') {
      args.issue_key = args.issue_key.trim().replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '');
    }
    if (typeof args.jql === 'string') args.jql = args.jql.trim();
    if (typeof args.project === 'string') args.project = args.project.trim().toUpperCase();
  }
}
