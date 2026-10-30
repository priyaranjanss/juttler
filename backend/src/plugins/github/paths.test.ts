/**
 * Thin GitHub REST helpers shared by every coding tool.
 * No ticket-specific or repo-specific hardcoding.
 */

import { requiredString, requestJson } from '../shared';
import { sanitizeBranchName } from './paths';

export function parseRepo(value: string): { owner: string; repo: string } {
  const cleaned = String(value ?? '')
    .trim()
    .replace(/^repo:/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
  const [owner, repo, ...rest] = cleaned.split('/');
  if (!owner || !repo || rest.length > 0) {
    throw new Error(`"${value}" is not a repository. Use owner/name, e.g. "octocat/Hello-World".`);
  }
  return { owner, repo };
}

export function repoUrl(args: Record<string, any>, suffix = ''): string {
  const { owner, repo } = parseRepo(requiredString(args, 'repo'));
  return `https://api.github.com/repos/${owner}/${repo}${suffix}`;
}

export function encodeRepoPath(path: string): string {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export function githubHeaders(ctx: { credential: Record<string, any> }): Record<string, string> {
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

export async function resolveCommitSha(
  args: Record<string, any>,
  headers: Record<string, string>,
  refName: string
): Promise<string> {
  const name = sanitizeBranchName(refName);
  if (!name) throw new Error('ref is required.');

  try {
    const ref = await requestJson(`${repoUrl(args, `/git/ref/heads/${encodeURIComponent(name)}`)}`, {
      headers,
    });
    if (ref.object?.sha) return ref.object.sha as string;
  } catch {
    // try tag / commit
  }

  try {
    const ref = await requestJson(`${repoUrl(args, `/git/ref/tags/${encodeURIComponent(name)}`)}`, {
      headers,
    });
    if (ref.object?.sha) {
      if (ref.object.type === 'commit') return ref.object.sha as string;
      try {
        const tag = await requestJson(`${repoUrl(args, `/git/tags/${ref.object.sha}`)}`, { headers });
        if (tag.object?.sha) return tag.object.sha as string;
      } catch {
        // lightweight tag
      }
      return ref.object.sha as string;
    }
  } catch {
    // try commit
  }

  const commit = await requestJson(`${repoUrl(args, `/commits/${encodeURIComponent(name)}`)}`, {
    headers,
  });
  const sha = commit.sha;
  if (!sha) throw new Error(`Could not resolve "${refName}" to a commit.`);
  return sha as string;
}

function isAlreadyExists(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\(422\)/.test(message) && /already exists|Reference already exists/i.test(message);
}

/** Ensure branch exists; create from default when missing. */
export async function ensureBranch(
  args: Record<string, any>,
  headers: Record<string, string>,
  branchName: string
): Promise<{ branch: string; created: boolean }> {
  const name = sanitizeBranchName(branchName);
  if (!name) throw new Error('branch is required.');

  try {
    await resolveCommitSha(args, headers, name);
    return { branch: name, created: false };
  } catch {
    // create below
  }

  const repoInfo = await requestJson(repoUrl(args), { headers });
  const from = repoInfo.default_branch;
  if (!from) throw new Error('Could not determine the default branch.');
  const baseSha = await resolveCommitSha(args, headers, from);

  try {
    await requestJson(repoUrl(args, '/git/refs'), {
      method: 'POST',
      headers,
      body: { ref: `refs/heads/${name}`, sha: baseSha },
    });
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
  }
  return { branch: name, created: true };
}

export async function readFileOnRef(
  args: Record<string, any>,
  headers: Record<string, string>,
  path: string,
  ref: string
): Promise<{ content: string; sha: string; size: number }> {
  const encoded = encodeRepoPath(path);
  const data = await requestJson(
    `${repoUrl(args, `/contents/${encoded}`)}?ref=${encodeURIComponent(ref)}`,
    { headers }
  );
  if (Array.isArray(data)) {
    throw new Error(`"${path}" is a directory. Pass a file path.`);
  }

  let content: string | null = null;
  if (typeof data.content === 'string' && data.content.length > 0) {
    content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8');
  } else if (typeof data.download_url === 'string' && data.download_url) {
    const downloaded = await fetch(data.download_url, {
      headers: { Authorization: headers.Authorization!, 'User-Agent': headers['User-Agent']! },
    });
    if (!downloaded.ok) throw new Error(`GET ${path} download failed (${downloaded.status})`);
    content = await downloaded.text();
  }

  if (content == null || !data.sha) {
    throw new Error(`Could not read "${path}" at ref ${ref}.`);
  }
  return {
    content,
    sha: data.sha as string,
    size: typeof data.size === 'number' ? data.size : content.length,
  };
}

export async function putFile(
  args: Record<string, any>,
  headers: Record<string, string>,
  input: {
    path: string;
    branch: string;
    content: string;
    message: string;
    sha?: string;
  }
): Promise<{ commit?: string; url?: string }> {
  if (Buffer.byteLength(input.content, 'utf8') > 900_000) {
    throw new Error('That file is too large to write through GitHub. Keep it under 900 KB.');
  }
  const data = await requestJson(repoUrl(args, `/contents/${encodeRepoPath(input.path)}`), {
    method: 'PUT',
    headers,
    body: {
      message: input.message,
      content: Buffer.from(input.content, 'utf8').toString('base64'),
      branch: input.branch,
      ...(input.sha ? { sha: input.sha } : {}),
    },
  });
  return { commit: data.commit?.sha, url: data.content?.html_url };
}

export { isAlreadyExists };

