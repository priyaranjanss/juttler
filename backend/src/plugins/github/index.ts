/**
 * GitHub plugin — remote coding agent over allowed repositories.
 * Tools mirror Cursor / OpenCode build agents: search → read → edit → PR.
 */

import { PluginModule } from '../types';
import { githubTools } from './tools';

const repoParam = {
  type: 'string' as const,
  description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
};

export const githubPlugin: PluginModule = {
  definition: {
    slug: 'github',
    name: 'GitHub',
    description:
      'Coding agent access to allowed repositories: search, read, surgically edit, write, branch, and open pull requests.',
    category: 'Development',
    isOfficial: true,
    authType: 'token',
    requiredCredentials: [
      { key: 'token', label: 'Access token', secret: true, placeholder: 'ghp_...' },
    ],
    tools: [
      {
        name: 'search_code',
        description:
          'Search file contents in the repository. Returns paths + snippets. Then get_file those paths.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            query: { type: 'string', description: 'Search text or GitHub code-search terms' },
            path: { type: 'string', description: 'Optional folder filter, e.g. backend/src' },
            max_results: { type: 'number', description: 'Max matches (default 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_tree',
        description: 'List file/folder paths in the repo (or under a folder). Use before get_file when unsure of paths.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'Optional folder prefix' },
            ref: { type: 'string', description: 'Branch, tag, or SHA (default: default branch)' },
            max_results: { type: 'number', description: 'Max paths (default 400)' },
          },
          required: [],
        },
      },
      {
        name: 'list_files',
        description: 'List one directory. Prefer list_tree for the whole repo.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'Folder path; omit for root' },
            ref: { type: 'string', description: 'Branch, tag, or SHA' },
          },
          required: [],
        },
      },
      {
        name: 'get_file',
        description:
          'Read one file. path must be a clean repo-relative path from search/list results (never prefix with : or punctuation). Optional start_line/end_line for large files.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: {
              type: 'string',
              description: 'Required. Exact path e.g. src/index.ts — no leading colon or quotes',
            },
            ref: { type: 'string', description: 'Branch, tag, or SHA' },
            start_line: { type: 'number', description: 'Optional 1-based start line' },
            end_line: { type: 'number', description: 'Optional 1-based end line' },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_branches',
        description: 'List branches in the repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: { repo: repoParam },
          required: [],
        },
      },
      {
        name: 'list_commits',
        description: 'List recent commits.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            sha: { type: 'string', description: 'Branch or SHA (default: default branch)' },
          },
          required: [],
        },
      },
      {
        name: 'list_prs',
        description: 'List pull requests.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            state: { type: 'string', description: 'open | closed | all', enum: ['open', 'closed', 'all'] },
          },
          required: [],
        },
      },
      {
        name: 'create_branch',
        description: 'Create a branch from default (or from). edit_file/write_file also create the branch if missing.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            branch_name: { type: 'string', description: 'New branch name' },
            from: { type: 'string', description: 'Base branch or SHA' },
          },
          required: ['branch_name'],
        },
      },
      {
        name: 'edit_file',
        description:
          'Surgical search/replace on an existing file (preferred for fixes). Creates the branch if needed. old_string must match get_file output exactly.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'File path' },
            branch: { type: 'string', description: 'Branch to commit on' },
            old_string: { type: 'string', description: 'Exact text to find' },
            new_string: { type: 'string', description: 'Replacement text' },
            replace_all: { type: 'boolean', description: 'Replace every match (default false)' },
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['path', 'branch', 'old_string', 'new_string'],
        },
      },
      {
        name: 'write_file',
        description:
          'Create a new file or fully replace a file. Prefer edit_file for small changes. Creates the branch if needed.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'File path' },
            content: { type: 'string', description: 'Full file contents' },
            branch: { type: 'string', description: 'Branch to commit on' },
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['path', 'content', 'branch', 'message'],
        },
      },
      {
        name: 'delete_file',
        description: 'Delete a file on a branch.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'File path' },
            branch: { type: 'string', description: 'Branch' },
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['path', 'branch', 'message'],
        },
      },
      {
        name: 'create_pull_request',
        description: 'Open a pull request from head into the default branch (or base).',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            title: { type: 'string', description: 'PR title' },
            head: { type: 'string', description: 'Branch with changes' },
            base: { type: 'string', description: 'Target branch (default: repo default)' },
            body: { type: 'string', description: 'PR description' },
          },
          required: ['title', 'head'],
        },
      },
      {
        name: 'comment_pr',
        description: 'Comment on a pull request.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'PR number' },
            comment: { type: 'string', description: 'Comment body' },
          },
          required: ['pr_number', 'comment'],
        },
      },
      {
        name: 'create_issue',
        description: 'Create a GitHub issue.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue body' },
            labels: { type: 'string', description: 'Comma-separated labels' },
          },
          required: ['title'],
        },
      },
      {
        name: 'merge_pr',
        description: 'Merge a pull request (changes default branch).',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'PR number' },
            commit_title: { type: 'string', description: 'Merge commit title' },
          },
          required: ['pr_number'],
        },
      },
    ],
  },
  tools: githubTools,
  oauth: {
    envPrefix: 'GITHUB',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'repo read:user',
    callbackSlug: 'github',
    extraAuthParams: { response_type: 'code' },
    tokenBodyStyle: 'json',
    extractToken: (token) => token.access_token,
    toCredential: (token) => ({ token: token.access_token }),
    identity: () => ({}),
    fetchIdentity: async (accessToken) => {
      const profile = (await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
      }).then((r) => r.json())) as { login?: string; name?: string };
      return { login: profile.login, name: profile.name || profile.login };
    },
  },
};
