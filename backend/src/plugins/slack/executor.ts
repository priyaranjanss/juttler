/**
 * Slack plugin - Slack Web API, acting as the connected USER.
 *
 * Slack is connected with a User Token (xoxp-...) rather than a Bot Token, so
 * everything the plugin does happens under the user's own name and picture.
 *
 * Metadata in ./index.ts; API calls in ./executor.ts.
 */

import { requiredString, optionalNumber, requestJson } from '../shared';
import { ToolExecutor } from '../shared';

// Overridable so the plugin can be pointed at a stub or proxy in tests.
const SLACK_API = (process.env.SLACK_API_BASE || 'https://slack.com/api').replace(/\/+$/, '');

/**
 * Reads the stored credential, and explains exactly which token is expected so
 * a bot-token connection is an obvious mistake rather than a cryptic failure.
 */
function slackHeaders(ctx: { credential: Record<string, any> }): Record<string, string> {
  const token = ctx.credential.token;
  if (!token) {
    throw new Error('Slack is not connected. Reconnect it from the Plugins dialog.');
  }
  if (typeof token === 'string' && token.startsWith('xoxb-')) {
    throw new Error(
      'Slack is connected with a bot token (xoxb-). Reconnect it with OAuth so actions happen as you.'
    );
  }
  return { Authorization: `Bearer ${token}` };
}

interface SlackCallInit {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

/**
 * Calls the Slack Web API with the user's token.
 *
 * Slack reports most failures in a 200 body with ok:false, so the status check
 * alone would miss them. GET for reads, POST for writes (chat.postMessage
 * rejects anything else).
 */
async function slackCall(
  ctx: { credential: Record<string, any> },
  path: string,
  params: Record<string, string | number> = {},
  init: SlackCallInit = {}
): Promise<any> {
  const url = new URL(`${SLACK_API}/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }

  let data: any;
  try {
    data = await requestJson(url.toString(), {
      method: init.method ?? 'GET',
      headers: slackHeaders(ctx),
      body: init.body,
    });
  } catch (err) {
    // A non-2xx can still carry a Slack error code (a rejected user token in
    // particular), so map it rather than leaking a bare transport message.
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Slack ${path} failed: ${mapSlackMessage(message)}`);
  }

  if (!data?.ok) {
    throw new Error(`Slack ${path} failed: ${formatSlackError(data?.error)}`);
  }

  return data;
}

/**
 * Pulls a Slack error code out of a transport-level message, if present.
 * The code can arrive quoted inside a JSON body or bare after a colon,
 * depending on how the provider reported it.
 */
function mapSlackMessage(message: string): string {
  const quoted = /"error"\s*:\s*"([a-z_]+)"/i.exec(message);
  if (quoted) return formatSlackError(quoted[1]);

  const trailing = /:\s*([a-z_]+)\s*$/.exec(message);
  return trailing ? formatSlackError(trailing[1]) : message;
}

/**
 * Maps Slack's error codes onto something a person can act on.
 *
 * `missing_scope` and the auth codes name themselves literally, so the gateway
 * can recognise them and flip the installation to needs_reauth.
 */
function formatSlackError(code: string | undefined): string {
  switch (code) {
    case 'missing_scope':
      return 'the connection is missing a required scope (missing_scope). Reconnect Slack with the requested user token scopes.';
    case 'not_in_channel':
      return 'the user is not a member of that channel. Add them to the channel in Slack first.';
    case 'channel_not_found':
      return 'that channel does not exist. Check the channel id or name.';
    case 'is_archived':
      return 'that channel is archived. Pick a different channel.';
    case 'ratelimited':
      return 'Slack is rate limiting this account. Wait a moment and try again.';
    case 'invalid_auth':
    case 'token_revoked':
    case 'account_inactive':
    case 'not_authed':
      return 'the Slack token was rejected (invalid_auth). Reconnect Slack from the Plugins dialog.';
    default:
      return code || 'unknown Slack error';
  }
}

export const slackTools: Record<string, ToolExecutor> = {
  /** List the channels, DMs and group DMs the user can see. */
  list_channels: async (args, ctx) => {
    const limit = optionalNumber(args, 'limit', 100, 200);
    const types =
      (typeof args.types === 'string' && args.types.trim()) ||
      'public_channel,private_channel,mpim,im';

    const data = await slackCall(
      ctx,
      'conversations.list',
      { limit, exclude_archived: 'false', types },
      {}
    );

    return {
      total: data.channels?.length ?? 0,
      channels: (data.channels ?? []).map((c: any) => ({
        id: c.id,
        name: c.name || c.user,
        is_im: c.is_im === true,
        is_private: c.is_private === true,
        purpose: c.purpose?.value,
      })),
    };
  },

  /** Read recent messages from a channel or DM. */
  read_messages: async (args, ctx) => {
    const channel = requiredString(args, 'channel').replace(/^#/, '');
    const limit = optionalNumber(args, 'limit', 20, 100);
    const data = await slackCall(ctx, 'conversations.history', { channel, limit }, {});

    return {
      channel,
      total: data.messages?.length ?? 0,
      messages: (data.messages ?? []).map((m: any) => ({
        user: m.user,
        text: m.text,
        ts: m.ts,
        datetime: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : undefined,
      })),
    };
  },

  /** Search messages across the workspace (needs the search:read scope). */
  search: async (args, ctx) => {
    const query = requiredString(args, 'query');
    const count = optionalNumber(args, 'count', 20, 100);
    const data = await slackCall(ctx, 'search.messages', { query, count }, {});

    return {
      total: data.messages?.total ?? 0,
      matches: (data.messages?.matches ?? []).map((m: any) => ({
        user: m.user,
        channel: m.channel?.name,
        text: m.text,
        permalink: m.permalink,
      })),
    };
  },

  /**
   * Post a message as the user. Marked sensitive, so the gateway always creates
   * an approval request before this runs.
   *
   * No `as_user` parameter: with a user token the message is already attributed
   * to the real person, and the legacy app-level override is not needed.
   */
  send_message: async (args, ctx) => {
    const channelValue = args.channel ?? args.channel_id;
    if (typeof channelValue !== 'string' || !channelValue.trim()) {
      throw new Error('A Slack channel is required. Provide channel as a channel ID or #name.');
    }
    const channel = channelValue.trim().replace(/^#/, '');
    const text = requiredString(args, 'text');

    const data = await slackCall(ctx, 'chat.postMessage', {}, {
      method: 'POST',
      body: { channel, text },
    });

    return {
      sent: true,
      channel: data.channel ?? channel,
      text: data.message?.text ?? text,
      ts: data.ts,
    };
  },
};
