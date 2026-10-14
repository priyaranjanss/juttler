import { githubTools } from './executor';
import { PluginModule } from '../types';

export const githubPlugin: PluginModule = {
  definition: {
    slug: 'github',
    name: 'GitHub',
    description: 'Develop in named repositories: read files, commit on a branch, and open a pull request. No computer is required.',
    category: 'Development',
    isOfficial: true,
    authType: 'token',
    requiredCredentials: [
      { key: 'token', label: 'Access token', secret: true, placeholder: 'ghp_...' },
    ],
    tools: [
      {
        name: 'list_prs',
        description: 'List open (or closed) pull requests in a repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form, e.g. "octocat/Hello-World"' },
            state: { type: 'string', description: 'Pull request state', enum: ['open', 'closed', 'all'] },
          },
          required: ['repo'],
        },
      },
      {
        name: 'get_file',
        description: 'Read the contents of a file from a repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            path: { type: 'string', description: 'File path in the repo, e.g. "README.md"' },
            ref: { type: 'string', description: 'Branch, tag, or commit SHA (defaults to the default branch)' },
          },
          required: ['repo', 'path'],
        },
      },
      {
        name: 'list_commits',
        description: 'List recent commits on a branch.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            sha: { type: 'string', description: 'Branch name or SHA (defaults to the default branch)' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'create_issue',
        description: 'Create a new issue in a repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue body (Markdown supported)' },
            labels: { type: 'string', description: 'Comma-separated labels, e.g. "bug,priority"' },
          },
          required: ['repo', 'title'],
        },
      },
      {
        name: 'comment_pr',
        description: 'Post a comment on a pull request.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            pr_number: { type: 'number', description: 'Pull request number' },
            comment: { type: 'string', description: 'Comment body' },
          },
          required: ['repo', 'pr_number', 'comment'],
        },
      },
      {
        name: 'create_branch',
        description: 'Create a new branch from an existing branch or SHA.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            branch_name: { type: 'string', description: 'Name of the new branch' },
            from: { type: 'string', description: 'Base branch or SHA (defaults to the default branch)' },
          },
          required: ['repo', 'branch_name'],
        },
      },
      {
        name: 'list_files',
        description: 'List files and folders in a repository. Omit path to list the repository root.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            path: { type: 'string', description: 'Folder path. Omit for the repository root.' },
            ref: { type: 'string', description: 'Branch, tag, or commit SHA' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'write_file',
        description: 'Create or replace one file on a branch. Create the branch first. This does not merge to the default branch.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            path: { type: 'string', description: 'File path in the repository' },
            content: { type: 'string', description: 'Full new contents of the file' },
            branch: { type: 'string', description: 'Branch to write on. Must already exist.' },
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['repo', 'path', 'content', 'branch', 'message'],
        },
      },
      {
        name: 'create_pull_request',
        description: 'Open a pull request from a branch into the default branch, or into an explicit base.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            title: { type: 'string', description: 'Pull request title' },
            head: { type: 'string', description: 'Branch that contains the changes' },
            base: { type: 'string', description: 'Branch to merge into. Defaults to the repository default branch.' },
            body: { type: 'string', description: 'Pull request description' },
          },
          required: ['repo', 'title', 'head'],
        },
      },
      {
        name: 'merge_pr',
        description: 'Merge a pull request. This changes production code.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            repo: { type: 'string', description: 'Repository in owner/name form' },
            pr_number: { type: 'number', description: 'Pull request number' },
            commit_title: { type: 'string', description: 'Title for the merge commit' },
          },
          required: ['repo', 'pr_number'],
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
