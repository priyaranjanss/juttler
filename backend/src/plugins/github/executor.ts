/**
 * GitHub plugin - GitHub REST API v3.
 *
 * Works with a classic or fine-grained personal access token pasted at connect
 * time, or with OAuth. Metadata in ./index.ts, API calls in ./executor.ts.
 */

import { requiredString, requestJson } from '../shared';
import { ToolExecutor } from '../shared';
import {
  resolvePathArg,
  sanitizeFileContent,
  sanitizeRepoPath,
} from '../../services/toolArgSanitize';

/** Required repo-relative path — accepts file / file_path / … aliases. */
function requiredPath(args: Record<string, any>): string {
  const path = resolvePathArg(args) || (typeof args.path === 'string' ? sanitizeRepoPath(args.path) : '');
  if (!path) {
    throw new Error(
      'Missing required parameter "path". Pass a repo-relative file path, e.g. backend/src/services/slackFormat.ts (aliases file / file_path also work).'
    );
  }
  return path;
}

/** Accepts "owner/name" or a full GitHub URL. */
function parseRepo(value: string): { owner: string; repo: string } {
  const cleaned = value.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/$/, '');
  const [owner, repo, ...rest] = cleaned.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`"${value}" is not a repository. Use owner/name form, e.g. "octocat/Hello-World".`);
  }
  return { owner, repo };
}

function repoUrl(args: Record<string, any>, suffix = ''): string {
  const { owner, repo } = parseRepo(requiredString(args, 'repo'));
  return `https://api.github.com/repos/${owner}/${repo}${suffix}`;
}

/** GitHub accepts a path with slashes. Each segment is encoded on its own. */
function encodeRepoPath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function githubHeaders(ctx: { credential: Record<string, any> }): Record<string, string> {
  if (!ctx.credential.token) {
    throw new Error('GitHub needs an access token. Reconnect GitHub from Plugins and paste a new one.');
  }
  return {
    Authorization: `Bearer ${ctx.credential.token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    Accept: 'application/vnd.github+json',
    'User-Agent': 'juttler-bot',
  };
}

/** Strip model junk from branch names. */
function sanitizeBranchName(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/^[\s`"'{\\}]+|[\s`"'{\\}]+$/g, '')
    .replace(/\s+/g, '-')
    .replace(/^refs\/heads\//i, '');
}

/** Resolve a branch name or commit SHA to a commit SHA. */
async function resolveCommitSha(
  args: Record<string, any>,
  headers: Record<string, string>,
  refName: string
): Promise<string> {
  const name = sanitizeBranchName(refName);
  try {
    const ref = await requestJson(`${repoUrl(args, `/git/ref/heads/${encodeURIComponent(name)}`)}`, {
      headers,
    });
    if (ref.object?.sha) return ref.object.sha as string;
  } catch {
    // Fall through — might be a tag or commit SHA.
  }
  try {
    const ref = await requestJson(`${repoUrl(args, `/git/ref/tags/${encodeURIComponent(name)}`)}`, {
      headers,
    });
    if (ref.object?.sha) {
      if (ref.object.type === 'commit') return ref.object.sha as string;
      const tag = await requestJson(`${repoUrl(args, `/git/tags/${ref.object.sha}`)}`, { headers });
      if (tag.object?.sha) return tag.object.sha as string;
      return ref.object.sha as string;
    }
  } catch {
    // Fall through to commits API.
  }
  const commit = await requestJson(`${repoUrl(args, `/commits/${encodeURIComponent(name)}`)}`, {
    headers,
  });
  const sha = commit.sha ?? commit.commit?.tree?.sha;
  if (!sha) throw new Error(`Could not resolve "${refName}" to a commit.`);
  return sha as string;
}

function isAlreadyExists(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\(422\)/.test(message) && /already exists|Reference already exists/i.test(message);
}

export const githubTools: Record<string, ToolExecutor> = {
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

  get_file: async (args, ctx) => {
    const path = requiredPath(args);
    const encoded = encodeRepoPath(path);
    const ref = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : '';
    const headers = githubHeaders(ctx);
    const data = await requestJson(`${repoUrl(args, `/contents/${encoded}`)}${ref}`, { headers });

    if (Array.isArray(data)) {
      return {
        path,
        type: 'dir',
        entries: data.map((entry: any) => ({ name: entry.name, path: entry.path, type: entry.type })),
      };
    }

    let content: string | null = null;
    if (typeof data.content === 'string' && data.content.length > 0) {
      content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
    } else if (typeof data.download_url === 'string' && data.download_url) {
      const downloaded = await fetch(data.download_url, {
        headers: { Authorization: headers.Authorization, 'User-Agent': headers['User-Agent'] },
      });
      if (!downloaded.ok) {
        throw new Error(`GET ${path} download failed (${downloaded.status})`);
      }
      content = await downloaded.text();
    }

    if (content == null) {
      throw new Error(
        `Could not read "${path}". The GitHub API returned no file body — check the path and token repo access.`
      );
    }

    const maxChars = 100_000;
    const truncated = content.length > maxChars;
    return {
      path,
      type: 'file',
      size: typeof data.size === 'number' ? data.size : content.length,
      sha: data.sha ?? null,
      truncated,
      content: truncated ? content.slice(0, maxChars) : content,
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

  comment_pr: async (args, ctx) => {
    const prNumber = requiredString(args, 'pr_number');
    const data = await requestJson(repoUrl(args, `/issues/${prNumber}/comments`), {
      method: 'POST',
      headers: githubHeaders(ctx),
      body: { body: requiredString(args, 'comment') },
    });
    return { commented: true, pr_number: prNumber, comment_url: data.html_url };
  },

  create_branch: async (args, ctx) => {
    const branchName = sanitizeBranchName(requiredString(args, 'branch_name'));
    if (!branchName) throw new Error('branch_name is required.');
    const headers = githubHeaders(ctx);

    const repoInfo = await requestJson(repoUrl(args), { headers });
    const from = args.from ? String(args.from) : repoInfo.default_branch;
    if (!from) {
      throw new Error('Could not determine the default branch. Pass an explicit "from" branch or SHA.');
    }

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
      // Branch already exists — continue the workflow (write_file / PR) on it.
      return { created: false, branch: branchName, from_sha: baseSha, existed: true };
    }
  },

  list_files: async (args, ctx) => {
    const path = typeof args.path === 'string' ? sanitizeRepoPath(args.path) : '';
    const ref = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : '';
    const suffix = path ? `/contents/${encodeRepoPath(path)}` : '/contents';
    const data = await requestJson(`${repoUrl(args, suffix)}${ref}`, { headers: githubHeaders(ctx) });
    const entries = Array.isArray(data) ? data : [data];
    return {
      repo: requiredString(args, 'repo'),
      path: path || '/',
      entries: entries.map((entry: any) => ({
        name: entry.name,
        path: entry.path,
        type: entry.type,
        size: entry.size,
      })),
    };
  },

  list_tree: async (args, ctx) => {
    const headers = githubHeaders(ctx);
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const refName = args.ref ? String(args.ref) : repoInfo.default_branch;
    if (!refName) throw new Error('Could not determine the default branch.');

    const sha = await resolveCommitSha(args, headers, refName);
    const tree = await requestJson(`${repoUrl(args, `/git/trees/${sha}`)}?recursive=1`, { headers });
    const prefix = typeof args.path === 'string' ? sanitizeRepoPath(args.path).replace(/\/+$/g, '') : '';
    let paths = (tree.tree ?? [])
      .filter((node: any) => node?.path && (node.type === 'blob' || node.type === 'tree'))
      .map((node: any) => ({
        path: node.path as string,
        type: node.type === 'tree' ? 'dir' : 'file',
        size: node.size,
      }));
    if (prefix) {
      paths = paths.filter(
        (node: { path: string }) => node.path === prefix || node.path.startsWith(`${prefix}/`)
      );
    }
    const limit = Math.min(Math.max(Number(args.max_results) || 400, 1), 800);
    return {
      repo: requiredString(args, 'repo'),
      ref: refName,
      path: prefix || '/',
      truncated: Boolean(tree.truncated) || paths.length > limit,
      total: paths.length,
      entries: paths.slice(0, limit),
    };
  },

  search_code: async (args, ctx) => {
    const query = requiredString(args, 'query');
    const { owner, repo } = parseRepo(requiredString(args, 'repo'));
    const pathFilter =
      typeof args.path === 'string' && sanitizeRepoPath(args.path)
        ? ` path:${sanitizeRepoPath(args.path)}`
        : '';
    const q = `${query} repo:${owner}/${repo}${pathFilter}`;
    const limit = Math.min(Math.max(Number(args.max_results) || 20, 1), 50);
    const data = await requestJson(
      `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${limit}`,
      {
        headers: {
          ...githubHeaders(ctx),
          Accept: 'application/vnd.github.text-match+json',
        },
      }
    );
    const items = (data.items ?? []).map((item: any) => ({
      path: item.path,
      name: item.name,
      url: item.html_url,
      score: item.score,
      matches: (item.text_matches ?? []).map((match: any) => ({
        fragment: match.fragment,
        property: match.property,
      })),
    }));
    return {
      repo: `${owner}/${repo}`,
      query: q,
      total: typeof data.total_count === 'number' ? data.total_count : items.length,
      returned: items.length,
      results: items,
      hint:
        items.length > 0
          ? 'Call github.get_file on the paths you need, then write_file / create_pull_request to finish.'
          : 'No matches. Try a shorter query or list_tree, then get_file.',
    };
  },

  list_branches: async (args, ctx) => {
    const data = await requestJson(`${repoUrl(args, '/branches')}?per_page=100`, {
      headers: githubHeaders(ctx),
    });
    return {
      repo: requiredString(args, 'repo'),
      total: data.length,
      branches: data.map((branch: any) => ({
        name: branch.name,
        protected: Boolean(branch.protected),
        sha: branch.commit?.sha,
      })),
    };
  },

  write_file: async (args, ctx) => {
    const path = requiredPath(args);
    const content = sanitizeFileContent(requiredString(args, 'content'));
    const branch = sanitizeBranchName(requiredString(args, 'branch'));
    const message = requiredString(args, 'message');
    if (!branch) throw new Error('branch is required.');
    if (Buffer.byteLength(content, 'utf8') > 900_000) {
      throw new Error('That file is too large to write through GitHub. Keep it under 900 KB.');
    }

    const headers = githubHeaders(ctx);
    const encoded = encodeRepoPath(path);
    let sha: string | undefined;
    try {
      const existing = await requestJson(
        `${repoUrl(args, `/contents/${encoded}`)}?ref=${encodeURIComponent(branch)}`,
        { headers }
      );
      if (Array.isArray(existing)) {
        throw new Error(`"${path}" is a directory. Write a file path, not a folder.`);
      }
      if (existing?.sha) sha = existing.sha;
    } catch (err) {
      const missing = err instanceof Error && /\(404\)/.test(err.message);
      if (!missing) throw err;
    }

    const data = await requestJson(repoUrl(args, `/contents/${encoded}`), {
      method: 'PUT',
      headers,
      body: {
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {}),
      },
    });
    return {
      written: true,
      path,
      branch,
      commit: data.commit?.sha,
      url: data.content?.html_url,
    };
  },

  create_pull_request: async (args, ctx) => {
    const headers = githubHeaders(ctx);
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const base = args.base ? sanitizeBranchName(String(args.base)) : repoInfo.default_branch;
    const head = sanitizeBranchName(requiredString(args, 'head'));
    const title = requiredString(args, 'title');
    const body = args.body ? String(args.body) : '';

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
      // PR may already exist for this head — return it so the turn can finish.
      const existing = await requestJson(
        `${repoUrl(args, '/pulls')}?state=open&head=${encodeURIComponent(
          `${parseRepo(requiredString(args, 'repo')).owner}:${head}`
        )}&per_page=5`,
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

  delete_file: async (args, ctx) => {
    const path = requiredPath(args);
    const branch = sanitizeBranchName(requiredString(args, 'branch'));
    const message = requiredString(args, 'message');
    if (!branch) throw new Error('branch is required.');
    const headers = githubHeaders(ctx);
    const encoded = encodeRepoPath(path);
    const existing = await requestJson(
      `${repoUrl(args, `/contents/${encoded}`)}?ref=${encodeURIComponent(branch)}`,
      { headers }
    );
    if (Array.isArray(existing) || !existing?.sha) {
      throw new Error(`"${path}" is not a file on branch ${branch}.`);
    }
    await requestJson(repoUrl(args, `/contents/${encoded}`), {
      method: 'DELETE',
      headers,
      body: {
        message,
        sha: existing.sha,
        branch,
      },
    });
    return { deleted: true, path, branch };
  },
};
