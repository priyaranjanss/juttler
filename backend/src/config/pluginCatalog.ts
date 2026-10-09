/**
 * The official plugin catalog â€” the source of truth for the marketplace.
 *
 * These are real integrations: each tool maps to a real HTTP API call executed
 * with the user's own stored credential (see services/toolExecutors.ts).
 * Seeded into the `plugins` table by `npm run db:migrate` and upserted so
 * editing this file refreshes the catalog on the next migration.
 */

import { PluginCredentialSpec } from '../../../frontend/src/types/index';

export interface ToolParameterSchema {
  type: 'object';
  properties: Record<string, { type: string; description: string; enum?: string[] }>;
  required?: string[];
}

export interface CatalogTool {
  name: string;
  description: string;
  parameters: ToolParameterSchema;
  // Sensitive tools are gated behind a human approval in chat before executing.
  sensitive: boolean;
}

export interface CatalogPlugin {
  slug: string;
  name: string;
  description: string;
  logo: string;
  category: string;
  isOfficial: boolean;
  authType: 'token' | 'oauth';
  tools: CatalogTool[];
  /**
   * What a user must supply before this plugin can be connected. This is the
   * single source of truth the Chief of Staff looks up when it needs to ask for
   * credentials — nothing about it is hardcoded in the bot's instructions.
   */
  requiredCredentials: PluginCredentialSpec[];
}

export const DEFAULT_SENSITIVE = [
  'github_merge_pr',
  'slack_send_message',
  'jira_create_ticket',
  'jira_change_status',
  'gmail_send_email',
  'notion_create_page',
];

const repoParam = { type: 'string', description: 'Repository in owner/name form, e.g. "anomalyco/opencode"' };

export const PLUGINS: CatalogPlugin[] = [
  {
    slug: 'web-search',
    name: 'Web Search',
    description: 'Search the public web and return titles, snippets, and URLs.',
    logo: '',
    category: 'Research',
    isOfficial: true,
    authType: 'token',
    tools: [
      {
        name: 'web_search',
        description: 'Search the web and return relevant results.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            max_results: { type: 'number', description: 'How many results to return (max 10)' },
          },
          required: ['query'],
        },
      },
    ],
    requiredCredentials: [
      { key: 'apiKey', label: 'Search API key', secret: true, placeholder: 'Paste a Brave Search API key' },
    ],
  },
  {
    slug: 'github',
    name: 'GitHub',
    description: 'Read repositories and pull requests, open issues, comment, and create branches.',
    logo: '',
    category: 'Development',
    isOfficial: true,
    authType: 'token',
    tools: [
      {
        name: 'github_list_prs',
        description: 'List open (or recently closed) pull requests in a repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            state: { type: 'string', description: 'Pull request state', enum: ['open', 'closed', 'all'] },
          },
          required: ['repo'],
        },
      },
      {
        name: 'github_get_file',
        description: 'Read the contents of a file from a repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            path: { type: 'string', description: 'File path in the repo, e.g. "README.md"' },
            ref: { type: 'string', description: 'Branch, tag, or commit SHA (defaults to the default branch)' },
          },
          required: ['repo', 'path'],
        },
      },
      {
        name: 'github_list_commits',
        description: 'List recent commits on a branch.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            sha: { type: 'string', description: 'Branch name or SHA (defaults to the default branch)' },
          },
          required: ['repo'],
        },
      },
      {
        name: 'github_create_issue',
        description: 'Create a new issue in a repository.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            title: { type: 'string', description: 'Issue title' },
            body: { type: 'string', description: 'Issue body (Markdown supported)' },
            labels: { type: 'string', description: 'Comma-separated labels, e.g. "bug,priority"' },
          },
          required: ['repo', 'title'],
        },
      },
      {
        name: 'github_comment_pr',
        description: 'Post a comment on a pull request.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'Pull request number' },
            comment: { type: 'string', description: 'Comment body' },
          },
          required: ['repo', 'pr_number', 'comment'],
        },
      },
      {
        name: 'github_create_branch',
        description: 'Create a new branch from an existing branch or SHA.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            branch_name: { type: 'string', description: 'Name of the new branch' },
            from: { type: 'string', description: 'Base branch or SHA (defaults to the default branch)' },
          },
          required: ['repo', 'branch_name'],
        },
      },
      {
        name: 'github_merge_pr',
        description: 'Merge a pull request. This changes production code.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            repo: repoParam,
            pr_number: { type: 'number', description: 'Pull request number' },
            commit_title: { type: 'string', description: 'Title for the merge commit' },
          },
          required: ['repo', 'pr_number'],
        },
      },
    ],
    requiredCredentials: [
      { key: 'token', label: 'Access token', secret: true, placeholder: 'ghp_...' },
    ],
  },
  {
    slug: 'jira',
    name: 'Jira',
    description: 'Search issues, create and update tickets, and move them through workflow transitions.',
    logo: '',
    category: 'Project management',
    isOfficial: true,
    authType: 'token',
    tools: [
      {
        name: 'jira_search_tickets',
        description: 'Search issues using JQL.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            jql: { type: 'string', description: 'JQL query, e.g. "project = ABC AND status = In Progress"' },
            max_results: { type: 'number', description: 'How many issues to return (max 50)' },
          },
          required: ['jql'],
        },
      },
      {
        name: 'jira_create_ticket',
        description: 'Create a new issue in a project.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            project: { type: 'string', description: 'Project key, e.g. "ABC"' },
            summary: { type: 'string', description: 'Issue summary' },
            issue_type: { type: 'string', description: 'Issue type, e.g. "Task" or "Bug"' },
            description: { type: 'string', description: 'Issue description' },
          },
          required: ['project', 'summary'],
        },
      },
      {
        name: 'jira_update_ticket',
        description: 'Update fields on an existing issue.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: { type: 'string', description: 'Issue key, e.g. "ABC-123"' },
            summary: { type: 'string', description: 'New summary' },
            description: { type: 'string', description: 'New description' },
          },
          required: ['issue_key'],
        },
      },
      {
        name: 'jira_change_status',
        description: 'Transition an issue to a different status.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            issue_key: { type: 'string', description: 'Issue key, e.g. "ABC-123"' },
            transition: { type: 'string', description: 'Target transition name, e.g. "Done"' },
          },
          required: ['issue_key', 'transition'],
        },
      },
    ],
    requiredCredentials: [
      { key: 'site', label: 'Jira site', secret: false, placeholder: 'your-site (before .atlassian.net)' },
      { key: 'email', label: 'Account email', secret: false, placeholder: 'you@company.com' },
      { key: 'apiToken', label: 'API token', secret: true, placeholder: 'Atlassian API token' },
    ],
  },
  {
    slug: 'slack',
    name: 'Slack',
    description: 'Read channels and message history, and post messages to your workspace.',
    logo: '',
    category: 'Communication',
    isOfficial: true,
    authType: 'token',
    tools: [
      {
        name: 'slack_list_channels',
        description: 'List channels the connected bot is a member of.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'How many channels to return (max 200)' },
          },
        },
      },
      {
        name: 'slack_search_messages',
        description: 'Search messages across the workspace.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            count: { type: 'number', description: 'How many messages to return (max 100)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'slack_send_message',
        description: 'Post a message to a channel. This is visible to other people.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id or name, e.g. "#general"' },
            text: { type: 'string', description: 'Message text' },
          },
          required: ['channel', 'text'],
        },
      },
    ],
    requiredCredentials: [
      { key: 'token', label: 'Bot token', secret: true, placeholder: 'xoxb-...' },
    ],
  },
  {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Read your inbox and send email from your own Google account.',
    logo: '',
    category: 'Communication',
    isOfficial: true,
    // Gmail only accepts OAuth 2.0 — there is nothing to paste.
    authType: 'oauth',
    requiredCredentials: [],
    tools: [
      {
        name: 'gmail_list_emails',
        description: 'Search the mailbox and return matching messages with subject, sender, and date.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Gmail search query, e.g. "from:boss@corp.com is:unread"' },
            max_results: { type: 'number', description: 'How many messages to return (max 50)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'gmail_get_message',
        description: 'Read one message by id, decoded to plain text.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            message_id: { type: 'string', description: 'Gmail message id from a search result' },
          },
          required: ['message_id'],
        },
      },
      {
        name: 'gmail_send_email',
        description: 'Send an email from the connected Google account. This reaches a real inbox.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Recipient email address' },
            subject: { type: 'string', description: 'Email subject line' },
            body: { type: 'string', description: 'Email body (plain text)' },
          },
          required: ['to', 'subject', 'body'],
        },
      },
    ],
  },
];

export function findCatalogPlugin(slug: string): CatalogPlugin | undefined {
  return PLUGINS.find((p) => p.slug === slug);
}

export function isSensitiveTool(toolName: string): boolean {
  for (const plugin of PLUGINS) {
    const tool = plugin.tools.find((t) => t.name === toolName);
    if (tool) return tool.sensitive;
  }
  return DEFAULT_SENSITIVE.includes(toolName);
}
