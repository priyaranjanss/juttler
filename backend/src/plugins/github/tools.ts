/**
 * GitHub coding-agent tools — Cursor / OpenCode style over the remote repo.
 *
 * Loop the model is steered to use:
 *   search_code | list_tree → get_file → edit_file | write_file → create_pull_request
 */

import { optionalNumber, requiredString, requestJson, ToolExecutor } from '../shared';
import { sanitizeFileContent } from '../../services/toolArgSanitize';
import { applySearchReplace } from './edit';
import {
  ensureBranch,
  githubHeaders,
  isAlreadyExists,
  parseRepo,
  putFile,
  readFileOnRef,
  repoUrl,
  resolveCommitSha,
  encodeRepoPath,
} from './client';
import { requiredPath, sanitizeBranchName, sanitizeRepoPath } from './paths';

function pickString(args: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    if (typeof args[key] === 'string' && args[key].trim()) return args[key].trim();
  }
  throw new Error(`Missing required parameter "${keys[0]}"`);
}

export const githubTools: Record<string, ToolExecutor> = {
  // ── Explore ───────────────────────────────────────────────────────────

  search_code: async (args, ctx) => {
    const query = requiredString(args, 'query');
    const { owner, repo } = parseRepo(requiredString(args, 'repo'));
    const pathFilter = sanitizeRepoPath(args.path);
    const q = `${query} repo:${owner}/${repo}${pathFilter ? ` path:${pathFilter}` : ''}`;
    const limit = optionalNumber(args, 'max_results', 20, 50);
    const headers = {
      ...githubHeaders(ctx),
      Accept: 'application/vnd.github.text-match+json',
    };
    const data = await requestJson(
      `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`,
      { headers }
    );
    const results = (data.items ?? []).map((item: any) => ({
      path: item.path,
      name: item.name,
      url: item.html_url,
      matches: (item.text_matches ?? []).map((m: any) => ({
        fragment: m.fragment,
        property: m.property,
      })),
    }));
    return {
      repo: `${owner}/${repo}`,
      query: q,
      total: typeof data.total_count === 'number' ? data.total_count : results.length,
      returned: results.length,
      results,
      next: results.length
        ? 'Call get_file with path set to one result.path, then edit_file or write_file, then create_pull_request.'
        : 'No hits. Broaden the query or call list_tree.',
    };
  },

  list_tree: async (args, ctx) => {
    const headers = githubHeaders(ctx);
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const refName = args.ref ? String(args.ref) : repoInfo.default_branch;
    if (!refName) throw new Error('Could not determine the default branch.');
    const sha = await resolveCommitSha(args, headers, refName);
    const tree = await requestJson(`${repoUrl(args, `/git/trees/${sha}`)}?recursive=1`, { headers });
    const prefix = sanitizeRepoPath(args.path).replace(/\/+$/g, '');
    let entries = (tree.tree ?? [])
      .filter((node: any) => node?.path && (node.type === 'blob' || node.type === 'tree'))
      .map((node: any) => ({
        path: node.path as string,
        type: node.type === 'tree' ? 'dir' : 'file',
        size: node.size,
      }));
    if (prefix) {
      entries = entries.filter(
        (e: { path: string }) => e.path === prefix || e.path.startsWith(`${prefix}/`)
      );
    }
    const limit = optionalNumber(args, 'max_results', 400, 800);
    return {
      repo: requiredString(args, 'repo'),
      ref: refName,
      path: prefix || '/',
      truncated: Boolean(tree.truncated) || entries.length > limit,
      total: entries.length,
      entries: entries.slice(0, limit),
      next: 'Call get_file on the file paths you need.',
    };
  },

  list_files: async (args, ctx) => {
    const path = sanitizeRepoPath(args.path);
    const ref = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : '';
    const suffix = path ? `/contents/${encodeRepoPath(path)}` : '/contents';
    const data = await requestJson(`${repoUrl(args, suffix)}${ref}`, {
      headers: githubHeaders(ctx),
    });
    const entries = (Array.isArray(data) ? data : [data]).map((entry: any) => ({
      name: entry.name,
      path: entry.path,
      type: entry.type,
      size: entry.size,
    }));
    return { repo: requiredString(args, 'repo'), path: path || '/', entries };
  },

  list_branches: async (args, ctx) => {
    const data = await requestJson(`${repoUrl(args, '/branches')}?per_page=100`, {
      headers: githubHeaders(ctx),
    });
    return {
      repo: requiredString(args, 'repo'),
      total: data.length,
      branches: data.map((b: any) => ({
        name: b.name,
        protected: Boolean(b.protected),
        sha: b.commit?.sha,
      })),
    };
  },

  list_commits: async (args, ctx) => {
    const params = new URLSearchParams({ per_page: '30' });
    if (args.sha) params.set('sha', String(args.sha));
    const data = await requestJson(`${repoUrl(args, '/commits')}?${params}`, {
      headers: githubHeaders(ctx),
    });
    return {
      repo: requiredString(args, 'repo'),
      total: data.length,
      commits: data.map((c: any) => ({
        sha: c.sha,
        message: c.commit?.message?.split('\n')[0],
        author: c.commit?.author?.name,
        date: c.commit?.author?.date,
      })),
    };
  },

  list_prs: async (args, ctx) => {
    const state = typeof args.state === 'string' && args.state.trim() ? args.state.trim() : 'open';
    const data = await requestJson(
      `${repoUrl(args, '/pulls')}?state=${encodeURIComponent(state)}&per_page=30`,
      { headers: githubHeaders(ctx) }
    );
    return {
      repo: requiredString(args, 'repo'),
      state,
      total: data.length,
      pull_requests: data.map((pr: any) => ({
        number: pr.number,
        title: pr.title,
        author: pr.user?.login,
        draft: pr.draft,
        url: pr.html_url,
        head: pr.head?.ref,
        base: pr.base?.ref,
        created_at: pr.created_at,
      })),
    };
  },

  // ── Read ──────────────────────────────────────────────────────────────

  get_file: async (args, ctx) => {
    const path = requiredPath(args);
    const headers = githubHeaders(ctx);
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const ref = args.ref ? String(args.ref) : repoInfo.default_branch;
    if (!ref) throw new Error('Could not determine the default branch.');

    const file = await readFileOnRef(args, headers, path, ref);

    const startLine = Number(args.start_line) > 0 ? Math.floor(Number(args.start_line)) : 0;
    const endLine = Number(args.end_line) > 0 ? Math.floor(Number(args.end_line)) : 0;
    let body = file.content;
    let lineWindow: { start_line: number; end_line: number; total_lines: number } | undefined;
    if (startLine > 0 || endLine > 0) {
      const lines = file.content.split('\n');
      const from = Math.max(1, startLine || 1);
      const to = Math.min(lines.length, endLine || lines.length);
      body = lines.slice(from - 1, to).join('\n');
      lineWindow = { start_line: from, end_line: to, total_lines: lines.length };
    }

    const maxChars = 100_000;
    const truncated = body.length > maxChars;
    return {
      path,
      type: 'file',
      ref,
      size: file.size,
      sha: file.sha,
      truncated,
      ...(lineWindow ? { line_window: lineWindow } : {}),
      content: truncated ? body.slice(0, maxChars) : body,
      next: 'Prefer edit_file with exact old_string from this content. Use write_file only for new files or full rewrites.',
    };
  },

  // ── Write ─────────────────────────────────────────────────────────────

  create_branch: async (args, ctx) => {
    const branchName = sanitizeBranchName(requiredString(args, 'branch_name'));
    if (!branchName) throw new Error('branch_name is required.');
    const headers = githubHeaders(ctx);
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const from = args.from ? String(args.from) : repoInfo.default_branch;
    if (!from) throw new Error('Could not determine the default branch. Pass "from".');
    const baseSha = await resolveCommitSha(args, headers, from);

    try {
      await requestJson(repoUrl(args, '/git/refs'), {
        method: 'POST',
        headers,
        body: { ref: `refs/heads/${branchName}`, sha: baseSha },
      });
      return { created: true, branch: branchName, from_sha: baseSha, existed: false };
    } catch (err) {
      if (!isAlreadyExists(err)) throw err;
      return { created: false, branch: branchName, from_sha: baseSha, existed: true };
    }
  },

  edit_file: async (args, ctx) => {
    const path = requiredPath(args);
    const branchIn = sanitizeBranchName(requiredString(args, 'branch'));
    if (!branchIn) throw new Error('branch is required.');
    const oldString = pickString(args, ['old_string', 'old_str']);
    const newString =
      typeof args.new_string === 'string'
        ? args.new_string
        : typeof args.new_str === 'string'
          ? args.new_str
          : pickString(args, ['new_string']);
    const replaceAll = Boolean(args.replace_all);
    const message =
      typeof args.message === 'string' && args.message.trim() ? args.message.trim() : `Edit ${path}`;

    const headers = githubHeaders(ctx);
    const ensured = await ensureBranch(args, headers, branchIn);
    const current = await readFileOnRef(args, headers, path, ensured.branch);
    const edited = applySearchReplace(current.content, oldString, newString, replaceAll);
    const written = await putFile(args, headers, {
      path,
      branch: ensured.branch,
      content: edited.content,
      message,
      sha: current.sha,
    });
    return {
      edited: true,
      path,
      branch: ensured.branch,
      branch_created: ensured.created,
      replacements: edited.replacements,
      commit: written.commit,
      url: written.url,
      next: 'When the change set is ready, call create_pull_request with head set to this branch.',
    };
  },

  write_file: async (args, ctx) => {
    const path = requiredPath(args);
    const content = sanitizeFileContent(requiredString(args, 'content'));
    const branchIn = sanitizeBranchName(requiredString(args, 'branch'));
    if (!branchIn) throw new Error('branch is required.');
    const message = requiredString(args, 'message');

    const headers = githubHeaders(ctx);
    const ensured = await ensureBranch(args, headers, branchIn);

    let sha: string | undefined;
    try {
      const existing = await readFileOnRef(args, headers, path, ensured.branch);
      sha = existing.sha;
    } catch (err) {
      const missing = err instanceof Error && /\(404\)|Could not read/i.test(err.message);
      if (!missing) throw err;
    }

    const written = await putFile(args, headers, {
      path,
      branch: ensured.branch,
      content,
      message,
      sha,
    });
    return {
      written: true,
      path,
      branch: ensured.branch,
      branch_created: ensured.created,
      commit: written.commit,
      url: written.url,
      next: 'When the change set is ready, call create_pull_request.',
    };
  },

  delete_file: async (args, ctx) => {
    const path = requiredPath(args);
    const branch = sanitizeBranchName(requiredString(args, 'branch'));
    if (!branch) throw new Error('branch is required.');
    const message = requiredString(args, 'message');
    const headers = githubHeaders(ctx);
    await ensureBranch(args, headers, branch);
    const existing = await readFileOnRef(args, headers, path, branch);
    await requestJson(repoUrl(args, `/contents/${encodeRepoPath(path)}`), {
      method: 'DELETE',
      headers,
      body: { message, sha: existing.sha, branch },
    });
    return { deleted: true, path, branch };
  },

  // ── Ship ──────────────────────────────────────────────────────────────

  create_pull_request: async (args, ctx) => {
    const headers = githubHeaders(ctx);
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const base = args.base ? sanitizeBranchName(String(args.base)) : repoInfo.default_branch;
    const head = sanitizeBranchName(requiredString(args, 'head'));
    if (!head) throw new Error('head (branch with changes) is required.');
    const title = requiredString(args, 'title');
    const body = args.body ? String(args.body) : '';
    const { owner } = parseRepo(requiredString(args, 'repo'));

    try {
      const data = await requestJson(repoUrl(args, '/pulls'), {
        method: 'POST',
        headers,
        body: { title, head, base, body },
      });
      return {
        created: true,
        number: data.number,
        url: data.html_url,
        head: data.head?.ref,
        base: data.base?.ref,
        existed: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!/\(422\)/.test(message)) throw err;
      const existing = await requestJson(
        `${repoUrl(args, '/pulls')}?state=open&head=${encodeURIComponent(`${owner}:${head}`)}&per_page=5`,
        { headers }
      );
      const pr = Array.isArray(existing) ? existing[0] : null;
      if (pr?.html_url) {
        return {
          created: false,
          number: pr.number,
          url: pr.html_url,
          head: pr.head?.ref,
          base: pr.base?.ref,
          existed: true,
        };
      }
      throw err;
    }
  },

  comment_pr: async (args, ctx) => {
    const prNumber = requiredString(args, 'pr_number');
    const data = await requestJson(repoUrl(args, `/issues/${prNumber}/comments`), {
      method: 'POST',
      headers: githubHeaders(ctx),
      body: { body: requiredString(args, 'comment') },
    });
    return { commented: true, pr_number: prNumber, comment_url: data.html_url };
  },

  create_issue: async (args, ctx) => {
    const labels = String(args.labels || '')
      .split(',')
      .map((l: string) => l.trim())
      .filter(Boolean);
    const data = await requestJson(repoUrl(args, '/issues'), {
      method: 'POST',
      headers: githubHeaders(ctx),
      body: {
        title: requiredString(args, 'title'),
        body: args.body ? String(args.body) : '',
        ...(labels.length ? { labels } : {}),
      },
    });
    return { created: true, number: data.number, url: data.html_url, state: data.state };
  },

  merge_pr: async (args, ctx) => {
    const prNumber = requiredString(args, 'pr_number');
    const data = await requestJson(repoUrl(args, `/pulls/${prNumber}/merge`), {
      method: 'PUT',
      headers: githubHeaders(ctx),
      body: {
        commit_title: args.commit_title ? String(args.commit_title) : undefined,
        merge_method: 'squash',
      },
    });
    return { merged: Boolean(data.merged), sha: data.sha, message: data.message };
  },
};
