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
          'Search this mailbox and return matching messages (subject, sender, date, unread, snippet), newest first. Works for any question about mail: the latest message, everything unread, mail from a person, this week, attachments, sent items, and so on. Gmail search operators are passed through ("from:x@y.com", "newer_than:7d", "has:attachment"); plain requests like "my inbox" or "unread mail" are mapped for you.',
        sensitive: false,
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'What to search for, or which mailbox to look in. Optional - omit it to read the inbox. Examples: "is:unread", "from:boss@corp.com", "newer_than:7d", "in:sent", "has:attachment". Plain English like "unread mail" is also accepted.',
            },
            max_results: {
              type: 'number',
              description:
                'How many messages to return (max 15). Keep this small - each result costs a separate Gmail request, and large values trigger Google rate limits. 3 to 5 is plenty for most questions.',
            },
            include_body: {
              type: 'boolean',
              description:
                'Also read the text of the newest few messages. Use this when the user wants the content read or summarised, not just headers. At most 3 bodies are fetched per call.',
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
