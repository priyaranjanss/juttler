/**
 * Jira plugin over the connected Atlassian site.
 */

import { PluginModule } from '../types';
import { jiraTools } from './tools';

const issueKeyParam = {
  type: 'string' as const,
  description:
    'Full issue key, such as ABC-123.',
};

const issueFieldParams = {
  priority: { type: 'string', description: 'Priority name, e.g. High' },
  labels: { type: 'string', description: 'Comma-separated labels; replaces the current labels' },
  due_date: { type: 'string', description: 'Due date as YYYY-MM-DD' },
  parent: { type: 'string', description: 'Parent issue key, for a subtask or a child of an epic' },
  assignee: { type: 'string', description: 'Assignee name, email, or account id' },
};

export const jiraPlugin: PluginModule = {
  definition: {
    slug: 'jira',
    name: 'Jira',
    description:
      'Search, read, create, update, link, comment on, assign, and change the status of Jira issues.',
    category: 'Project management',
    isOfficial: true,
    authType: 'oauth',
    requiredCredentials: [],
    tools: [
      {
        name: 'list_projects',
        description: 'List Jira projects this account can see.',
        sensitive: false,
        parameters: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'search_tickets',
        description:
          'Search issues with JQL. Returns issue keys, summaries, statuses, assignees, and links, plus the total match count.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            jql: {
              type: 'string',
              description:
                'JQL query. Empty lists recently updated issues, in the bot\'s configured project when it has one.',
            },
            max_results: { type: 'number', description: 'How many issues to return' },
          },
          required: [],
        },
      },
      {
        name: 'get_ticket',
        description:
          'Read one issue by key, including its summary, description, and comments.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: { issue_key: issueKeyParam },
          required: ['issue_key'],
        },
      },
      {
        name: 'create_ticket',
        description: 'Create an issue. Project defaults to the bot\'s configured project when omitted.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project key',
            },
            summary: { type: 'string', description: 'Issue summary' },
            issue_type: { type: 'string', description: 'Issue type name from the project (get_project lists them); default Task' },
            description: { type: 'string', description: 'Description' },
            ...issueFieldParams,
          },
          required: ['summary'],
        },
      },
      {
        name: 'update_ticket',
        description: 'Update an issue: summary, description, priority, labels, due date, parent, or assignee. Only the fields passed change.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: issueKeyParam,
            summary: { type: 'string', description: 'New summary' },
            description: { type: 'string', description: 'New description' },
            ...issueFieldParams,
          },
          required: ['issue_key'],
        },
      },
      {
        name: 'get_project',
        description: 'Read a project: its issue types, lead, and components. Defaults to the bot\'s configured project.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: { project: { type: 'string', description: 'Project key' } },
          required: [],
        },
      },
      {
        name: 'find_users',
        description: 'Find Jira users by name or email.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: { query: { type: 'string', description: 'Name or email to search for' } },
          required: ['query'],
        },
      },
      {
        name: 'link_tickets',
        description:
          'Link two issues. The phrase reads "issue_key <link_type> other_issue_key", e.g. "ABC-1 blocks ABC-2" or "ABC-1 relates to ABC-3".',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: issueKeyParam,
            link_type: { type: 'string', description: 'Link name or phrase, e.g. "blocks", "is blocked by", "relates to", "duplicates"' },
            other_issue_key: { type: 'string', description: 'Full key of the other issue' },
          },
          required: ['issue_key', 'link_type', 'other_issue_key'],
        },
      },
      {
        name: 'list_transitions',
        description: 'List status transitions available on an issue right now.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: { issue_key: issueKeyParam },
          required: ['issue_key'],
        },
      },
      {
        name: 'change_status',
        description: 'Move an issue through its workflow by transition id, transition name, or target status name.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: issueKeyParam,
            transition: { type: 'string', description: 'Transition or target status name' },
          },
          required: ['issue_key', 'transition'],
        },
      },
      {
        name: 'add_comment',
        description: 'Add a comment to an issue.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: issueKeyParam,
            comment: { type: 'string', description: 'Comment text' },
          },
          required: ['issue_key', 'comment'],
        },
      },
      {
        name: 'assign_ticket',
        description: 'Assign an issue by display name, email, or account id.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: issueKeyParam,
            assignee: { type: 'string', description: 'Name, email, or account id' },
          },
          required: ['issue_key', 'assignee'],
        },
      },
    ],
  },
  tools: jiraTools,
  oauth: {
    envPrefix: 'JIRA',
    authorizeUrl: 'https://auth.atlassian.com/authorize',
    tokenUrl: 'https://auth.atlassian.com/oauth/token',
    scope: 'read:jira-work write:jira-work read:jira-user offline_access',
    callbackSlug: 'jira',
    extraAuthParams: {
      audience: 'api.atlassian.com',
      response_type: 'code',
      prompt: 'consent',
    },
    requiresResponseType: true,
    tokenBodyStyle: 'json',
    extractToken: (token) => token.access_token,
    toCredential: (token) => ({
      token: token.access_token,
      refreshToken: token.refresh_token,
    }),
    identity: () => ({}),
    identityRequired: true,
    fetchIdentity: async (accessToken) => {
      const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Could not list Jira sites (${response.status}).`);
      }
      const resources = (await response.json()) as Array<{
        id?: string;
        name?: string;
        url?: string;
      }>;
      const site = resources.find((resource) => resource.id && resource.url);
      if (!site) {
        throw new Error('This Atlassian account has no Jira site accessible to Juttler.');
      }
      return {
        cloudId: site.id,
        siteName: site.name || site.url,
        siteUrl: site.url,
        accessibleSites: resources
          .filter((resource) => resource.id && resource.url)
          .map((resource) => ({
            cloudId: resource.id,
            name: resource.name || resource.url,
            url: resource.url,
          })),
      };
    },
  },
};
