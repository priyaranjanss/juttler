/**
 * GitHub repository access for the repositories allowed to this bot.
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
      'Access to permitted repositories, including repository content, branches, issues, and pull requests.',
    category: 'Development',
    isOfficial: true,
    authType: 'token',
    requiredCredentials: [
      { key: 'token', label: 'Access token', secret: true, placeholder: 'ghp_...' },
    ],
    tools: [
      {
        name: 'get_repo',
        description: 'Read repository details: default branch, description, visibility, open issue count, and your permissions.',
        sensitive: false,
        parameters: { type: 'object', properties: { repo: repoParam }, required: [] },
      },
      {
        name: 'search_code',
        description:
          'Search repository file contents and return matching paths and snippets.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            query: { type: 'string', description: 'Search text or GitHub code-search terms' },
            path: { type: 'string', description: 'Optional folder filter' },
            max_results: { type: 'number', description: 'Max matches (default 20)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'list_tree',
        description: 'List file and folder paths in the repository, optionally under a folder.',
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
        description: 'List the contents of one repository directory.',
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
          'Read one file using its repository-relative path. Optional start_line/end_line select a line range.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: {
              type: 'string',
              description: 'Required repository-relative file path',
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
        name: 'get_commit',
        description: 'Read one commit: message, author, date, and the files it changed.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            sha: { type: 'string', description: 'Commit SHA, branch, or tag' },
          },
          required: ['sha'],
        },
      },
      {
        name: 'get_checks',
        description:
          'Read CI status for a branch, commit, or pull request: every check run (with the app that ran it and its summary) and commit status, plus an overall state.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            ref: { type: 'string', description: 'Branch, tag, or SHA' },
            pr_number: { type: 'number', description: 'Pull request number; its head commit is checked' },
          },
          required: [],
        },
      },
      {
        name: 'get_check_logs',
        description:
          'Read why a check run failed: its annotations and, for GitHub Actions, the end of its job log. For checks run by other apps, says where their logs are kept.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            check_run_id: { type: 'number', description: 'Check run id, from get_checks' },
          },
          required: ['check_run_id'],
        },
      },
      {
        name: 'list_issues',
        description: 'List issues (pull requests excluded), optionally filtered by state, labels, or assignee.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            state: { type: 'string', description: 'open | closed | all (default open)', enum: ['open', 'closed', 'all'] },
            labels: { type: 'string', description: 'Comma-separated label names' },
            assignee: { type: 'string', description: 'GitHub login, "none", or "*"' },
            max_results: { type: 'number', description: 'Max issues (default 30)' },
          },
          required: [],
        },
      },
      {
        name: 'get_issue',
        description: 'Read one issue with its body, labels, assignees, and comments.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            issue_number: { type: 'number', description: 'Issue number' },
          },
          required: ['issue_number'],
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
        name: 'get_pull_request',
        description: 'Read one pull request: state, branches, mergeability, commit count, and changed files.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'PR number' },
          },
          required: ['pr_number'],
        },
      },
      {
        name: 'get_pr_discussion',
        description: 'Read the conversation on a pull request: reviews with their verdicts, inline review comments, and general comments.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'PR number' },
          },
          required: ['pr_number'],
        },
      },
      {
        name: 'compare_branches',
        description: 'Compare two branches or commits: commits ahead/behind and changed files from base to head.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            base: { type: 'string', description: 'Base branch or SHA; defaults to the repository default branch' },
            head: { type: 'string', description: 'Head branch or SHA' },
          },
          required: ['head'],
        },
      },
      {
        name: 'create_branch',
        description: 'Create a branch from the default branch or the specified starting point.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            branch_name: { type: 'string', description: 'New branch name, inferred from the task when not specified' },
            from: { type: 'string', description: 'Base branch or SHA; defaults to the repository default branch' },
          },
          required: ['branch_name'],
        },
      },
      {
        name: 'edit_file',
        description:
          'Replace an exact string in an existing file. Creates the branch if needed; old_string must match the current file content.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'File path' },
            branch: { type: 'string', description: 'Branch to commit on; infer from task context when not specified' },
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
          'Create a file or replace its full contents. Creates the branch if needed.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'File path, inferred from the requested change when not specified' },
            content: { type: 'string', description: 'Full file contents' },
            branch: { type: 'string', description: 'Branch to commit on; infer from task context when not specified' },
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
        description:
          'Open a pull request from head into the base branch. Returns the PR number and URL.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            title: { type: 'string', description: 'Title that accurately summarizes the change' },
            head: { type: 'string', description: 'Branch containing the changes' },
            base: { type: 'string', description: 'Target branch; defaults to the repository default branch' },
            body: { type: 'string', description: 'Description based on the actual changes' },
          },
          required: ['title', 'head'],
        },
      },
      {
        name: 'update_pull_request',
        description: 'Change a pull request: title, description, base branch, or close/reopen it.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'PR number' },
            title: { type: 'string', description: 'New title' },
            body: { type: 'string', description: 'New description' },
            base: { type: 'string', description: 'New base branch' },
            state: { type: 'string', description: 'open | closed', enum: ['open', 'closed'] },
          },
          required: ['pr_number'],
        },
      },
      {
        name: 'review_pull_request',
        description: 'Submit a review on a pull request: approve, request changes, or comment.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'PR number' },
            event: {
              type: 'string',
              description: 'APPROVE | REQUEST_CHANGES | COMMENT',
              enum: ['APPROVE', 'REQUEST_CHANGES', 'COMMENT'],
            },
            body: { type: 'string', description: 'Review text (required for REQUEST_CHANGES and COMMENT)' },
          },
          required: ['pr_number', 'event'],
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
        name: 'update_issue',
        description: 'Change an issue: title, body, open/closed state, labels, or assignees.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            issue_number: { type: 'number', description: 'Issue number' },
            title: { type: 'string', description: 'New title' },
            body: { type: 'string', description: 'New body' },
            state: { type: 'string', description: 'open | closed', enum: ['open', 'closed'] },
            labels: { type: 'string', description: 'Comma-separated labels; replaces the current labels' },
            assignees: { type: 'string', description: 'Comma-separated GitHub logins; replaces the current assignees' },
          },
          required: ['issue_number'],
        },
      },
      {
        name: 'comment_issue',
        description: 'Comment on an issue.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            issue_number: { type: 'number', description: 'Issue number' },
            comment: { type: 'string', description: 'Comment body' },
          },
          required: ['issue_number', 'comment'],
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
            merge_method: {
              type: 'string',
              description: 'squash | merge | rebase (default squash)',
              enum: ['squash', 'merge', 'rebase'],
            },
          },
          required: ['pr_number'],
        },
      },
      {
        name: 'delete_branch',
        description: 'Delete a branch. The default branch cannot be deleted.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            branch: { type: 'string', description: 'Branch to delete' },
          },
          required: ['branch'],
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
