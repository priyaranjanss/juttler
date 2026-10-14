import { jiraTools } from './executor';
import { PluginModule } from '../types';

export const jiraPlugin: PluginModule = {
  definition: {
    slug: 'jira',
    name: 'Jira',
    description: 'Do the ticket work in one Jira project: search, read, create, update, comment, assign, and change status.',
    category: 'Project management',
    isOfficial: true,
    authType: 'token',
    requiredCredentials: [
      { key: 'site', label: 'Jira site', secret: false, placeholder: 'your-site (the part before .atlassian.net)' },
      { key: 'email', label: 'Account email', secret: false, placeholder: 'you@company.com' },
      { key: 'apiToken', label: 'API token', secret: true, placeholder: 'Atlassian API token' },
    ],
    tools: [
      {
        name: 'list_projects',
        description: 'List the Jira projects this account can see.',
        sensitive: false,
        parameters: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'search_tickets',
        description: 'Search Jira issues. total is the full number of matches. issues are the rows. Omit jql to search everything this account can see.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            jql: { type: 'string', description: 'Optional JQL. Leave empty to search every issue this account can see.' },
            max_results: { type: 'number', description: 'How many matching issues to include. total is still the full count.' },
          },
          required: [],
        },
      },
      {
        name: 'create_ticket',
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
        name: 'update_ticket',
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
        name: 'change_status',
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
      {
        name: 'get_ticket',
        description: 'Read one issue, including its description and latest comments.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: { type: 'string', description: 'Issue key, e.g. "ABC-123"' },
          },
          required: ['issue_key'],
        },
      },
      {
        name: 'add_comment',
        description: 'Add a comment to an issue. Use this to record a pull request link.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: { type: 'string', description: 'Issue key, e.g. "ABC-123"' },
            comment: { type: 'string', description: 'Comment text' },
          },
          required: ['issue_key', 'comment'],
        },
      },
      {
        name: 'assign_ticket',
        description: 'Assign an issue to a person by name, email, or account id.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            issue_key: { type: 'string', description: 'Issue key, e.g. "ABC-123"' },
            assignee: { type: 'string', description: 'Display name, email, or Atlassian account id' },
          },
          required: ['issue_key', 'assignee'],
        },
      },
    ],
  },
  tools: jiraTools,
};
