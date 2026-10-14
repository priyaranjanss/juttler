import { githubTools } from './executor';
import { PluginModule } from '../types';

export const githubPlugin: PluginModule = {
  definition: {
    slug: 'github',
    name: 'GitHub',
    description:
      'Full developer access to allowed repositories: search code, list the tree, read and write files, manage branches, and open pull requests. No local computer is required.',
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
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            state: { type: 'string', description: 'Pull request state', enum: ['open', 'closed', 'all'] },
          },
          required: [],
        },
      },
      {
        name: 'get_file',
        description:
          'Read the full text of a file from a repository. Returns content you can use to edit and write_file. Prefer this over asking the user to paste code.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            path: { type: 'string', description: 'File path in the repo, e.g. "README.md"' },
            ref: { type: 'string', description: 'Branch, tag, or commit SHA (defaults to the default branch)' },
          },
          required: ['path'],
        },
      },
      {
        name: 'list_commits',
        description: 'List recent commits on a branch.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            sha: { type: 'string', description: 'Branch name or SHA (defaults to the default branch)' },
          },
          required: [],
        },
      },
      {
        name: 'create_issue',
        description: 'Create a new issue in a repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue body (Markdown supported)' },
            labels: { type: 'string', description: 'Comma-separated labels, e.g. "bug,priority"' },
          },
          required: ['title'],
        },
      },
      {
        name: 'comment_pr',
        description: 'Post a comment on a pull request.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            pr_number: { type: 'number', description: 'Pull request number' },
            comment: { type: 'string', description: 'Comment body' },
          },
          required: ['pr_number', 'comment'],
        },
      },
      {
        name: 'create_branch',
        description: 'Create a new branch from an existing branch or SHA.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            branch_name: { type: 'string', description: 'Name of the new branch' },
            from: { type: 'string', description: 'Base branch or SHA (defaults to the default branch)' },
          },
          required: ['branch_name'],
        },
      },
      {
        name: 'list_files',
        description: 'List one directory in a repository. Prefer list_tree to see the whole repo at once.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            path: { type: 'string', description: 'Folder path. Omit for the repository root.' },
            ref: { type: 'string', description: 'Branch, tag, or commit SHA' },
          },
          required: [],
        },
      },
      {
        name: 'list_tree',
        description:
          'List every file and folder path in the repository (or under a folder) in one call. Use this to map the codebase before reading files.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            path: { type: 'string', description: 'Optional folder prefix to scope the tree' },
            ref: { type: 'string', description: 'Branch, tag, or commit SHA (defaults to the default branch)' },
            max_results: { type: 'number', description: 'Max paths to return (default 400)' },
          },
          required: [],
        },
      },
      {
        name: 'search_code',
        description:
          'Search file contents in the repository (like a codebase search). Returns matching paths and text fragments. Then use get_file on the hits you need.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            query: { type: 'string', description: 'Search text or GitHub code-search query terms' },
            path: { type: 'string', description: 'Optional path filter, e.g. backend/src' },
            max_results: { type: 'number', description: 'Max matches to return (default 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_branches',
        description: 'List branches in the repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
          },
          required: [],
        },
      },
      {
        name: 'write_file',
        description: 'Create or replace one file on a branch. Create the branch first. This does not merge to the default branch.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            path: { type: 'string', description: 'File path in the repository' },
            content: { type: 'string', description: 'Full new contents of the file' },
            branch: { type: 'string', description: 'Branch to write on. Must already exist.' },
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['path', 'content', 'branch', 'message'],
        },
      },
      {
        name: 'create_pull_request',
        description: 'Open a pull request from a branch into the default branch, or into an explicit base.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            title: { type: 'string', description: 'Pull request title' },
            head: { type: 'string', description: 'Branch that contains the changes' },
            base: { type: 'string', description: 'Branch to merge into. Defaults to the repository default branch.' },
            body: { type: 'string', description: 'Pull request description' },
          },
          required: ['title', 'head'],
        },
      },
      {
        name: 'merge_pr',
        description: 'Merge a pull request. This changes production code.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            pr_number: { type: 'number', description: 'Pull request number' },
            commit_title: { type: 'string', description: 'Title for the merge commit' },
          },
          required: ['pr_number'],
        },
      },
      {
        name: 'delete_file',
        description: 'Delete a file on a branch.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: 'Repository owner/name. Omit when this bot has exactly one allowed repository.',
            },
            path: { type: 'string', description: 'File path to delete' },
            branch: { type: 'string', description: 'Branch to delete on' },
            message: { type: 'string', description: 'Commit message' },
          },
          required: ['path', 'branch', 'message'],
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
