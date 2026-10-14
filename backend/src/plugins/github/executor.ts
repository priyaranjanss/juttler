/**
 * GitHub plugin - GitHub REST API v3.
 *
 * Works with a classic or fine-grained personal access token pasted at connect
 * time, or with OAuth. Metadata in ./index.ts, API calls in ./executor.ts.
 */

import { requiredString, requestJson } from '../shared';
import { ToolExecutor } from '../shared';

/** Accepts "owner/name" or a full GitHub URL. */
function parseRepo(value: string): { owner: string; repo: string } {
  const cleaned = value.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
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
    'User-Agent': 'juttler-bot',
  };
}

export const githubTools: Record<string, ToolExecutor> = {
  list_prs: async (args, ctx) => {
    // state is optional - the model often sends only `repo`.
    const state = typeof args.state === 'string' && args.state.trim() ? args.state.trim() : 'open';
    const data = await requestJson(`${repoUrl(args, '/pulls')}?state=${encodeURIComponent(state)}&per_page=30`, {
      headers: githubHeaders(ctx),
    });
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
    const path = requiredString(args, 'path');
    const ref = args.ref ? `?ref=${encodeURIComponent(String(args.ref))}` : '';
    const data = await requestJson(`${repoUrl(args, `/contents/${path}`)}${ref}`, {
      headers: githubHeaders(ctx),
    });

    if (Array.isArray(data)) {
      return { path, type: 'dir', entries: data.map((e: any) => ({ name: e.name, type: e.type })) };
    }

    const content = data.content ? Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8') : null;
    return { path, type: 'file', size: data.size, truncated: Boolean(data.content === ''), content };
  },

  list_commits: async (args, ctx) => {
    const sha = args.sha ? `?sha=${encodeURIComponent(String(args.sha))}` : '';
    const data = await requestJson(`${repoUrl(args, '/commits')}${sha}&per_page=30`, {
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
    // PRs are issues on the GitHub API, so comments go through /issues/:n/comments.
    const prNumber = requiredString(args, 'pr_number');
    const data = await requestJson(repoUrl(args, `/issues/${prNumber}/comments`), {
      method: 'POST',
      headers: githubHeaders(ctx),
      body: { body: requiredString(args, 'comment') },
    });
    return { commented: true, pr_number: prNumber, comment_url: data.html_url };
  },

  create_branch: async (args, ctx) => {
    const branchName = requiredString(args, 'branch_name');
    const headers = githubHeaders(ctx);

    // Resolve the base ref: an explicit branch/SHA wins, else the default branch.
    const repoInfo = await requestJson(repoUrl(args), { headers });
    const from = args.from ? String(args.from) : repoInfo.default_branch;
    if (!from) {
      throw new Error('Could not determine the default branch. Pass an explicit "from" branch or SHA.');
    }

    const ref = await requestJson(`${repoUrl(args, `/git/ref/heads/${from}`)}`, { headers });
    const baseSha: string = ref.object?.sha;
    if (!baseSha) {
      throw new Error(`Could not resolve branch "${from}" to a commit.`);
    }

    await requestJson(repoUrl(args, '/git/refs'), {
      method: 'POST',
      headers,
      body: { ref: `refs/heads/${branchName}`, sha: baseSha },
    });

    return { created: true, branch: branchName, from_sha: baseSha };
  },

  list_files: async (args, ctx) => {
    const path = typeof args.path === 'string' ? args.path.replace(/^\/+/, '') : '';
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

  write_file: async (args, ctx) => {
    const path = requiredString(args, 'path').replace(/^\/+/, '');
    const content = requiredString(args, 'content');
    const branch = requiredString(args, 'branch');
    const message = requiredString(args, 'message');
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
    const base = args.base ? String(args.base) : repoInfo.default_branch;
    const data = await requestJson(repoUrl(args, '/pulls'), {
      method: 'POST',
      headers,
      body: {
        title: requiredString(args, 'title'),
        head: requiredString(args, 'head'),
        base,
        body: args.body ? String(args.body) : '',
      },
    });
    return {
      created: true,
      number: data.number,
      url: data.html_url,
      head: data.head?.ref,
      base: data.base?.ref,
    };
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
