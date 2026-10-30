import { slackTools } from './executor';
import { PluginModule } from '../types';

export const slackPlugin: PluginModule = {
  definition: {
    slug: 'slack',
    name: 'Slack',
    description:
      'Read channels, DMs, threads and message history, look up people, and post, reply to, edit, or delete messages. Messages are sent as you, not as a bot.',
    category: 'Communication',
    isOfficial: true,
    // Slack is OAuth-only: a user token (xoxp-) is what makes messages appear as
    // the person, which a pasted bot token cannot do.
    authType: 'oauth',
    requiredCredentials: [],
    tools: [
      {
        name: 'list_channels',
        description: 'List the channels, DMs and group DMs you can see.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'How many channels to return (max 200)' },
          },
        },
      },
      {
        name: 'read_messages',
        description: 'Read recent messages from a channel or DM, with each author\'s name and each message\'s ts and thread info.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id, #name, or a person (for your DM with them)' },
            limit: { type: 'number', description: 'How many messages to return (max 100)' },
          },
          required: ['channel'],
        },
      },
      {
        name: 'read_thread',
        description: 'Read a message and all replies in its thread.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id, #name, or a person' },
            thread_ts: { type: 'string', description: 'ts of the thread\'s parent message' },
            limit: { type: 'number', description: 'How many messages to return (max 200)' },
          },
          required: ['channel', 'thread_ts'],
        },
      },
      {
        name: 'list_users',
        description: 'List people in the Slack workspace with their ids, names, and titles, optionally filtered by name.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Text to match against names and titles' },
            limit: { type: 'number', description: 'How many people to return (max 500)' },
          },
        },
      },
      {
        name: 'search',
        description: 'Search messages across the workspace.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query, e.g. "from:alice deploy"' },
            count: { type: 'number', description: 'How many matches to return (max 100)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'send_message',
        description:
          'Post a message as the connected user to a channel, a DM, or a thread. Sends immediately, without an approval step.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id, #name, or a person (sends them a DM)' },
            text: { type: 'string', description: 'Message text to post' },
            thread_ts: { type: 'string', description: 'Parent message ts to reply in its thread' },
          },
          required: ['channel', 'text'],
        },
      },
      {
        name: 'update_message',
        description: 'Edit a message the connected user posted.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id, #name, or a person' },
            ts: { type: 'string', description: 'ts of the message to edit' },
            text: { type: 'string', description: 'New message text' },
          },
          required: ['channel', 'ts', 'text'],
        },
      },
      {
        name: 'delete_message',
        description: 'Delete a message the connected user posted.',
        sensitive: true,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id, #name, or a person' },
            ts: { type: 'string', description: 'ts of the message to delete' },
          },
          required: ['channel', 'ts'],
        },
      },
    ],
  },
  tools: slackTools,
  oauth: {
    envPrefix: 'SLACK',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    // No bot scopes at all — asking only for user_scope is what makes Slack
    // issue a user token instead of a bot token.
    scope: '',
    // User Token Scopes registered at api.slack.com/apps under
    // OAuth & Permissions -> User Token Scopes.
    userScope:
      'chat:write channels:read groups:read im:read mpim:read users:read search:read channels:history groups:history im:history mpim:history',
    callbackSlug: 'slack',
    // Slack's v2 endpoint takes no response_type parameter.
    extraAuthParams: {},
    // Slack's token endpoint is form-encoded, not JSON.
    tokenBodyStyle: 'form',
    // The user token lives under authed_user, not at the top level.
    extractToken: (token) => token.authed_user?.access_token,
    toCredential: (token) => ({ token: token.authed_user?.access_token }),
    // Everything Slack hands back that the UI and the gateway need.
    identity: (token) => ({
      token_type: 'user',
      team_id: token.team?.id,
      team_name: token.team?.name,
      authed_user_id: token.authed_user?.id,
      scopes: typeof token.scope === 'string' && token.scope.length > 0 ? token.scope.split(',') : [],
    }),
  },
};
