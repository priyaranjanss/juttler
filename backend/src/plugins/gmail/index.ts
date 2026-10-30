import { gmailTools } from './executor';
import { PluginModule } from '../types';

export const gmailPlugin: PluginModule = {
  definition: {
    slug: 'gmail',
    name: 'Gmail',
    description: 'Read your inbox and send email from your own Google account.',
    category: 'Communication',
    isOfficial: true,
    // Gmail only accepts OAuth 2.0 - there is nothing to paste.
    authType: 'oauth',
    requiredCredentials: [],
    tools: [
      {
        name: 'list_emails',
        description:
          'Search this mailbox with a Gmail search query and return matching messages (subject, sender, date, unread, snippet), newest first.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Gmail search query using Gmail search operators, e.g. "is:unread", "from:boss@corp.com", "newer_than:7d", "in:sent". Omitted means the inbox.',
            },
            max_results: {
              type: 'number',
              description:
                'How many messages to return (default 5, max 15). Each result costs a separate Gmail request and large values can hit Google rate limits.',
            },
            include_body: {
              type: 'boolean',
              description:
                'Also return the body text of the newest messages (at most 3 per call), not just headers.',
            },
          },
        },
      },
      {
        name: 'get_message',
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
        name: 'send_email',
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
  tools: gmailTools,
  oauth: {
    envPrefix: 'GOOGLE',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    // read + send are both requested; the sensitive tool still requires approval.
    scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
    callbackSlug: 'gmail',
    // Google rejects an authorize URL with no response_type; Slack and GitHub
    // do not use that parameter, so this stays opt-in per provider.
    requiresResponseType: true,
    extraAuthParams: {
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
    },
    tokenBodyStyle: 'json',
    extractToken: (token) => token.access_token,
    // Google hands back a refresh token only with access_type=offline; keep it.
    toCredential: (token) => ({
      token: token.access_token,
      refreshToken: token.refresh_token,
    }),
    identity: () => ({}),
    fetchIdentity: async (accessToken) => {
      const profile = (await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      }).then((r) => r.json())) as { email?: string; name?: string };
      return { email: profile.email, name: profile.name || profile.email };
    },
  },
};
