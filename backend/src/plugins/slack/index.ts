import { slackTools } from './executor';
import { PluginModule } from '../types';

export const slackPlugin: PluginModule = {
  definition: {
    slug: 'slack',
    name: 'Slack',
    description:
      'Read channels, DMs and message history, and post messages. Messages are sent as you, not as a bot.',
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
        description: 'Read recent messages from a channel or DM.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id (or name) to read, e.g. "C01ABC23"' },
            limit: { type: 'number', description: 'How many messages to return (max 100)' },
          },
          required: ['channel'],
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
          'Post a message to a Slack channel or DM immediately as the connected user. Provide the destination as channel (a Slack channel ID or #name) and the exact text to send. This tool sends the message without an approval step.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            channel: { type: 'string', description: 'Channel id or name, e.g. "#general"' },
            text: { type: 'string', description: 'Message text to post' },
          },
          required: ['channel', 'text'],
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
