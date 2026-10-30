/** Tools for reading and updating repositories through the GitHub API. */

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

function commaList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function issueView(issue: any) {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state,
    author: issue.user?.login,
    labels: (issue.labels ?? []).map((label: any) => (typeof label === 'string' ? label : label.name)),
    assignees: (issue.assignees ?? []).map((user: any) => user.login),
    comments: issue.comments,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    url: issue.html_url,
  };
}

function commentView(comment: any) {
  return { author: comment.user?.login, body: comment.body, created_at: comment.created_at, url: comment.html_url };
}

const MAX_LOG_CHARS = 12_000;

function checkRunView(run: any) {
  const summary = [run.output?.title, run.output?.summary, run.output?.text]
    .filter((part) => typeof part === 'string' && part.trim() && part.trim() !== run.name)
    .join('\n')
    .trim();
  return {
    id: run.id,
    name: run.name,
    status: run.status,
    conclusion: run.conclusion,
    app: run.app?.name,
    summary: summary ? summary.slice(0, 1_500) : undefined,
    // Only GitHub Actions keeps its logs on GitHub; other apps link to their own dashboards.
    logs_on_github: run.app?.slug === 'github-actions',
    url: run.html_url,
    details_url: run.details_url,
  };
}

export const githubTools: Record<string, ToolExecutor> = {
  // ── Explore ───────────────────────────────────────────────────────────

  get_repo: async (args, ctx) => {
    const data = await requestJson(repoUrl(args), { headers: githubHeaders(ctx) });
    return {
      repo: data.full_name,
      description: data.description,
      default_branch: data.default_branch,
      private: Boolean(data.private),
      open_issues: data.open_issues_count,
      topics: data.topics ?? [],
      url: data.html_url,
      permissions: data.permissions ?? null,
    };
  },

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

  get_commit: async (args, ctx) => {
    const sha = requiredString(args, 'sha');
    const data = await requestJson(repoUrl(args, `/commits/${encodeURIComponent(sha)}`), {
      headers: githubHeaders(ctx),
    });
    return {
      sha: data.sha,
      message: data.commit?.message,
      author: data.commit?.author?.name,
      date: data.commit?.author?.date,
      url: data.html_url,
      stats: data.stats,
      files: (data.files ?? []).map((file: any) => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
    };
  },

  get_checks: async (args, ctx) => {
    const headers = githubHeaders(ctx);
    let ref: string;
    if (args.pr_number != null && String(args.pr_number).trim()) {
      const pr = await requestJson(repoUrl(args, `/pulls/${encodeURIComponent(String(args.pr_number))}`), { headers });
      ref = pr.head?.sha;
    } else if (typeof args.ref === 'string' && args.ref.trim()) {
      ref = sanitizeBranchName(args.ref);
    } else {
      ref = (await requestJson(repoUrl(args), { headers })).default_branch;
    }
    if (!ref) throw new Error('Could not determine which commit to check.');

    const [runs, status] = await Promise.all([
      requestJson(`${repoUrl(args, `/commits/${encodeURIComponent(ref)}/check-runs`)}?per_page=100`, { headers }),
      requestJson(repoUrl(args, `/commits/${encodeURIComponent(ref)}/status`), { headers }),
    ]);
    const checkRuns = (runs.check_runs ?? []).map(checkRunView);
    const statuses = (status.statuses ?? []).map((item: any) => ({
      name: item.context,
      state: item.state,
      description: item.description,
      url: item.target_url,
    }));

    const failing =
      checkRuns.some((run: any) => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(run.conclusion)) ||
      statuses.some((item: any) => ['failure', 'error'].includes(item.state));
    const pending =
      checkRuns.some((run: any) => run.status !== 'completed') || statuses.some((item: any) => item.state === 'pending');
    const overall =
      checkRuns.length + statuses.length === 0 ? 'no_checks' : failing ? 'failing' : pending ? 'pending' : 'passing';

    return { ref, sha: status.sha ?? ref, overall, check_runs: checkRuns, statuses };
  },

  get_check_logs: async (args, ctx) => {
    const headers = githubHeaders(ctx);
    const id = encodeURIComponent(requiredString(args, 'check_run_id'));
    const [run, annotations] = await Promise.all([
      requestJson(repoUrl(args, `/check-runs/${id}`), { headers }),
      requestJson(`${repoUrl(args, `/check-runs/${id}/annotations`)}?per_page=30`, { headers }).catch(() => []),
    ]);
    const check = checkRunView(run);
    const notes = (Array.isArray(annotations) ? annotations : []).map((note: any) => ({
      level: note.annotation_level,
      path: note.path,
      line: note.start_line,
      message: note.message,
    }));
    if (!check.logs_on_github) {
      return {
        check,
        annotations: notes,
        logs: null,
        logs_location: `${check.app ?? 'The app that ran this check'} keeps its logs outside GitHub, at details_url.`,
      };
    }

    const res = await fetch(repoUrl(args, `/actions/jobs/${id}/logs`), { headers });
    if (!res.ok) throw new Error(`GET job logs failed (${res.status}): ${res.statusText}`);
    const text = await res.text();
    return {
      check,
      annotations: notes,
      logs_truncated: text.length > MAX_LOG_CHARS,
      // Failures are reported at the end of a job log.
      logs: text.slice(-MAX_LOG_CHARS),
    };
  },

  list_issues: async (args, ctx) => {
    const state = typeof args.state === 'string' && args.state.trim() ? args.state.trim() : 'open';
    const limit = optionalNumber(args, 'max_results', 30, 100);
    const params = new URLSearchParams({ state, per_page: String(limit) });
    const labels = commaList(args.labels);
    if (labels.length) params.set('labels', labels.join(','));
    if (typeof args.assignee === 'string' && args.assignee.trim()) params.set('assignee', args.assignee.trim());
    const data = await requestJson(`${repoUrl(args, '/issues')}?${params}`, { headers: githubHeaders(ctx) });
    const issues = (Array.isArray(data) ? data : []).filter((issue: any) => !issue.pull_request).map(issueView);
    return { repo: requiredString(args, 'repo'), state, returned: issues.length, issues };
  },

  get_issue: async (args, ctx) => {
    const number = requiredString(args, 'issue_number');
    const headers = githubHeaders(ctx);
    const issue = await requestJson(repoUrl(args, `/issues/${encodeURIComponent(number)}`), { headers });
    const comments = await requestJson(
      `${repoUrl(args, `/issues/${encodeURIComponent(number)}/comments`)}?per_page=50`,
      { headers }
    );
    return {
      ...issueView(issue),
      is_pull_request: Boolean(issue.pull_request),
      body: issue.body ?? '',
      comment_list: (Array.isArray(comments) ? comments : []).map(commentView),
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

  get_pull_request: async (args, ctx) => {
    const prNumber = requiredString(args, 'pr_number');
    const headers = githubHeaders(ctx);
    const pr = await requestJson(repoUrl(args, `/pulls/${encodeURIComponent(prNumber)}`), { headers });
    const files = await requestJson(
      `${repoUrl(args, `/pulls/${encodeURIComponent(prNumber)}/files`)}?per_page=100`,
      { headers }
    );
    return {
      number: pr.number,
      title: pr.title,
      state: pr.state,
      merged: Boolean(pr.merged),
      draft: Boolean(pr.draft),
      mergeable: pr.mergeable ?? null,
      head: pr.head?.ref,
      base: pr.base?.ref,
      commits: pr.commits,
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      url: pr.html_url,
      files: (Array.isArray(files) ? files : []).map((file: any) => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
      })),
    };
  },

  get_pr_discussion: async (args, ctx) => {
    const prNumber = encodeURIComponent(requiredString(args, 'pr_number'));
    const headers = githubHeaders(ctx);
    const [reviews, reviewComments, comments] = await Promise.all([
      requestJson(`${repoUrl(args, `/pulls/${prNumber}/reviews`)}?per_page=100`, { headers }),
      requestJson(`${repoUrl(args, `/pulls/${prNumber}/comments`)}?per_page=100`, { headers }),
      requestJson(`${repoUrl(args, `/issues/${prNumber}/comments`)}?per_page=100`, { headers }),
    ]);
    return {
      pr_number: Number(prNumber),
      reviews: (Array.isArray(reviews) ? reviews : []).map((review: any) => ({
        author: review.user?.login,
        state: review.state,
        body: review.body,
        submitted_at: review.submitted_at,
      })),
      review_comments: (Array.isArray(reviewComments) ? reviewComments : []).map((comment: any) => ({
        author: comment.user?.login,
        path: comment.path,
        line: comment.line ?? comment.original_line ?? null,
        body: comment.body,
        created_at: comment.created_at,
      })),
      comments: (Array.isArray(comments) ? comments : []).map(commentView),
    };
  },

  compare_branches: async (args, ctx) => {
    const headers = githubHeaders(ctx);
    const head = sanitizeBranchName(requiredString(args, 'head'));
    if (!head) throw new Error('head is required.');
    const base = args.base
      ? sanitizeBranchName(String(args.base))
      : (await requestJson(repoUrl(args), { headers })).default_branch;
    const data = await requestJson(
      repoUrl(args, `/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`),
      { headers }
    );
    return {
      base,
      head,
      status: data.status,
      ahead_by: data.ahead_by,
      behind_by: data.behind_by,
      commits: (data.commits ?? []).map((c: any) => ({
        sha: c.sha,
        message: c.commit?.message?.split('\n')[0],
      })),
      files: (data.files ?? []).map((file: any) => ({
        path: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
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

  update_pull_request: async (args, ctx) => {
    const prNumber = requiredString(args, 'pr_number');
    const changes: Record<string, string> = {};
    if (typeof args.title === 'string' && args.title.trim()) changes.title = args.title.trim();
    if (typeof args.body === 'string') changes.body = args.body;
    if (typeof args.base === 'string' && args.base.trim()) changes.base = sanitizeBranchName(args.base);
    if (typeof args.state === 'string' && ['open', 'closed'].includes(args.state.trim())) changes.state = args.state.trim();
    if (Object.keys(changes).length === 0) {
      throw new Error('Nothing to change. Provide title, body, base, or state.');
    }
    const pr = await requestJson(repoUrl(args, `/pulls/${encodeURIComponent(prNumber)}`), {
      method: 'PATCH',
      headers: githubHeaders(ctx),
      body: changes,
    });
    return {
      updated: true,
      number: pr.number,
      title: pr.title,
      state: pr.state,
      base: pr.base?.ref,
      url: pr.html_url,
    };
  },

  review_pull_request: async (args, ctx) => {
    const prNumber = requiredString(args, 'pr_number');
    const event = requiredString(args, 'event').toUpperCase();
    if (!['APPROVE', 'REQUEST_CHANGES', 'COMMENT'].includes(event)) {
      throw new Error('event must be APPROVE, REQUEST_CHANGES, or COMMENT.');
    }
    const body = typeof args.body === 'string' ? args.body : '';
    if (event !== 'APPROVE' && !body.trim()) throw new Error(`body is required for ${event}.`);
    const review = await requestJson(repoUrl(args, `/pulls/${encodeURIComponent(prNumber)}/reviews`), {
      method: 'POST',
      headers: githubHeaders(ctx),
      body: { event, ...(body.trim() ? { body } : {}) },
    });
    return { reviewed: true, pr_number: Number(prNumber), state: review.state, url: review.html_url };
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

  update_issue: async (args, ctx) => {
    const number = requiredString(args, 'issue_number');
    const changes: Record<string, unknown> = {};
    if (typeof args.title === 'string' && args.title.trim()) changes.title = args.title.trim();
    if (typeof args.body === 'string') changes.body = args.body;
    if (typeof args.state === 'string' && ['open', 'closed'].includes(args.state.trim())) changes.state = args.state.trim();
    if (args.labels !== undefined && args.labels !== null) changes.labels = commaList(args.labels);
    if (args.assignees !== undefined && args.assignees !== null) changes.assignees = commaList(args.assignees);
    if (Object.keys(changes).length === 0) {
      throw new Error('Nothing to change. Provide title, body, state, labels, or assignees.');
    }
    const issue = await requestJson(repoUrl(args, `/issues/${encodeURIComponent(number)}`), {
      method: 'PATCH',
      headers: githubHeaders(ctx),
      body: changes,
    });
    return { updated: true, ...issueView(issue) };
  },

  comment_issue: async (args, ctx) => {
    const number = requiredString(args, 'issue_number');
    const data = await requestJson(repoUrl(args, `/issues/${encodeURIComponent(number)}/comments`), {
      method: 'POST',
      headers: githubHeaders(ctx),
      body: { body: requiredString(args, 'comment') },
    });
    return { commented: true, issue_number: Number(number), comment_url: data.html_url };
  },

  merge_pr: async (args, ctx) => {
    const prNumber = requiredString(args, 'pr_number');
    const method = typeof args.merge_method === 'string' && ['squash', 'merge', 'rebase'].includes(args.merge_method)
      ? args.merge_method
      : 'squash';
    const data = await requestJson(repoUrl(args, `/pulls/${prNumber}/merge`), {
      method: 'PUT',
      headers: githubHeaders(ctx),
      body: {
        commit_title: args.commit_title ? String(args.commit_title) : undefined,
        merge_method: method,
      },
    });
    return { merged: Boolean(data.merged), sha: data.sha, message: data.message };
  },

  delete_branch: async (args, ctx) => {
    const branch = sanitizeBranchName(requiredString(args, 'branch'));
    if (!branch) throw new Error('branch is required.');
    const headers = githubHeaders(ctx);
    const repoInfo = await requestJson(repoUrl(args), { headers });
    if (branch === repoInfo.default_branch) {
      throw new Error(`"${branch}" is the default branch and cannot be deleted.`);
    }
    await requestJson(repoUrl(args, `/git/refs/heads/${encodeURIComponent(branch)}`), {
      method: 'DELETE',
      headers,
    });
    return { deleted: true, branch };
  },
};
