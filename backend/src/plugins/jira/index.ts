/**
 * Jira plugin — ticket agent over the connected Atlassian site.
 */

import { PluginModule } from '../types';
import { jiraTools } from './tools';

const issueKeyParam = {
  type: 'string' as const,
  description:
    'Issue key (ABC-123). Aliases: key / issue / ticket. A bare number is OK when the bot has a preferred project.',
};

export const jiraPlugin: PluginModule = {
  definition: {
    slug: 'jira',
    name: 'Jira',
    description:
      'Do ticket work end-to-end: search, read, create, update, comment, assign, and change status.',
    category: 'Project management',
    isOfficial: true,
    authType: 'token',
    requiredCredentials: [
      { key: 'site', label: 'Jira site', secret: false, placeholder: 'your-site (before .atlassian.net)' },
      { key: 'email', label: 'Account email', secret: false, placeholder: 'you@company.com' },
      { key: 'apiToken', label: 'API token', secret: true, placeholder: 'Atlassian API token' },
    ],
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
          'Search with JQL when you do not already know the issue key. If the user named a key, use get_ticket instead.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            jql: {
              type: 'string',
              description:
                'JQL, a bare issue key, or empty for recent issues in the preferred project.',
            },
            max_results: { type: 'number', description: 'How many issues to return' },
          },
          required: [],
        },
      },
      {
        name: 'get_ticket',
        description:
          'Read one issue by key (summary, description, comments). Prefer this whenever a key is known — including short follow-ups that refer to a ticket in the thread.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: { issue_key: issueKeyParam },
          required: ['issue_key'],
        },
      },
      {
        name: 'create_ticket',
        description: 'Create an issue. Project defaults to the bot preferred project when omitted.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            project: {
              type: 'string',
              description: 'Project key. Omit when the bot has a preferred Jira project.',
            },
            summary: { type: 'string', description: 'Issue summary' },
            issue_type: { type: 'string', description: 'Task, Bug, Story, …' },
            description: { type: 'string', description: 'Description' },
          },
          required: ['summary'],
        },
      },
      {
        name: 'update_ticket',
        description: 'Update summary and/or description on an issue.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: issueKeyParam,
            summary: { type: 'string', description: 'New summary' },
            description: { type: 'string', description: 'New description' },
          },
          required: ['issue_key'],
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
        description: 'Move an issue through its workflow by transition or target status name.',
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
        description: 'Comment on an issue (e.g. drop a PR link).',
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
};
