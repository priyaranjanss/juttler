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

type SlackContext = { credential: Record<string, any> };

/** Follows Slack's cursor pagination for a list method, up to a page budget. */
async function listAll(ctx: SlackContext, method: string, key: string, params: Record<string, string | number>): Promise<any[]> {
  const items: any[] = [];
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const data = await slackCall(ctx, method, { ...params, limit: 200, ...(cursor ? { cursor } : {}) });
    items.push(...(data[key] ?? []));
    cursor = data.response_metadata?.next_cursor || '';
    if (!cursor) break;
  }
  return items;
}

function listMembers(ctx: SlackContext): Promise<any[]> {
  return listAll(ctx, 'users.list', 'members', {});
}

function memberName(member: any): string {
  return member.profile?.display_name || member.real_name || member.name || member.id;
}

/**
 * Accepts a channel id, a #name, a DM id, or a person (user id, @handle, or
 * name), and returns the conversation id Slack expects. A person resolves to
 * the DM with them; when no DM exists yet, the user id itself, which
 * chat.postMessage accepts.
 */
async function resolveChannel(ctx: SlackContext, raw: unknown): Promise<string> {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new Error('A Slack channel is required: a channel ID, #name, or a person.');
  }
  const value = raw.trim().replace(/^[#@]/, '');
  if (/^[CGD][A-Z0-9]{6,}$/.test(value)) return value;

  const conversations = await listAll(ctx, 'conversations.list', 'channels', {
    types: 'public_channel,private_channel,mpim,im',
    exclude_archived: 'true',
  });
  const wanted = value.toLowerCase();
  const channel = conversations.find((c: any) => typeof c.name === 'string' && c.name.toLowerCase() === wanted);
  if (channel) return channel.id;

  let userId = /^[UW][A-Z0-9]{6,}$/.test(value) ? value : '';
  if (!userId) {
    const members = (await listMembers(ctx)).filter((m: any) => !m.deleted);
    const person = members.find((m: any) =>
      [m.name, m.real_name, m.profile?.display_name, m.profile?.real_name]
        .filter(Boolean)
        .some((name: string) => name.toLowerCase() === wanted)
    );
    userId = person?.id ?? '';
  }
  if (userId) {
    const dm = conversations.find((c: any) => c.is_im && c.user === userId);
    return dm?.id ?? userId;
  }

  throw new Error(`No channel or person named "${raw}" is visible to this Slack account.`);
}

/** Message fields shared by every read, with the author's name alongside their id. */
async function messageViews(ctx: SlackContext, messages: any[]) {
  const names = new Map<string, string>();
  if (messages.some((m) => m.user)) {
    try {
      for (const member of await listMembers(ctx)) names.set(member.id, memberName(member));
    } catch {
      // Names are a convenience; the ids are still returned.
    }
  }
  return messages.map((m: any) => ({
    user: m.user,
    user_name: m.user ? names.get(m.user) ?? null : m.username ?? null,
    text: m.text,
    ts: m.ts,
    thread_ts: m.thread_ts,
    reply_count: m.reply_count,
    datetime: m.ts ? new Date(Number(m.ts) * 1000).toISOString() : undefined,
  }));
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
    const channel = await resolveChannel(ctx, args.channel);
    const limit = optionalNumber(args, 'limit', 20, 100);
    const data = await slackCall(ctx, 'conversations.history', { channel, limit }, {});

    return {
      channel,
      total: data.messages?.length ?? 0,
      messages: await messageViews(ctx, data.messages ?? []),
    };
  },

  /** Read a message and every reply in its thread. */
  read_thread: async (args, ctx) => {
    const channel = await resolveChannel(ctx, args.channel);
    const ts = requiredString(args, 'thread_ts');
    const limit = optionalNumber(args, 'limit', 50, 200);
    const data = await slackCall(ctx, 'conversations.replies', { channel, ts, limit }, {});
    return {
      channel,
      thread_ts: ts,
      total: data.messages?.length ?? 0,
      messages: await messageViews(ctx, data.messages ?? []),
    };
  },

  /** People in the workspace, optionally filtered by name. */
  list_users: async (args, ctx) => {
    const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : '';
    const limit = optionalNumber(args, 'limit', 50, 500);
    const members = (await listMembers(ctx)).filter((m: any) => !m.deleted && m.id !== 'USLACKBOT');
    const matches = query
      ? members.filter((m: any) =>
          [m.name, m.real_name, m.profile?.display_name, m.profile?.title]
            .filter(Boolean)
            .some((field: string) => field.toLowerCase().includes(query))
        )
      : members;
    return {
      total: matches.length,
      users: matches.slice(0, limit).map((m: any) => ({
        id: m.id,
        name: memberName(m),
        handle: m.name,
        title: m.profile?.title || null,
        is_bot: Boolean(m.is_bot),
        timezone: m.tz ?? null,
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
    const channel = await resolveChannel(ctx, args.channel ?? args.channel_id);
    const text = requiredString(args, 'text');
    const threadTs = typeof args.thread_ts === 'string' && args.thread_ts.trim() ? args.thread_ts.trim() : undefined;

    const data = await slackCall(ctx, 'chat.postMessage', {}, {
      method: 'POST',
      body: { channel, text, ...(threadTs ? { thread_ts: threadTs } : {}) },
    });

    return {
      sent: true,
      channel: data.channel ?? channel,
      text: data.message?.text ?? text,
      ts: data.ts,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    };
  },

  /** Edit a message the connected user posted. */
  update_message: async (args, ctx) => {
    const channel = await resolveChannel(ctx, args.channel);
    const ts = requiredString(args, 'ts');
    const text = requiredString(args, 'text');
    const data = await slackCall(ctx, 'chat.update', {}, { method: 'POST', body: { channel, ts, text } });
    return { updated: true, channel: data.channel ?? channel, ts: data.ts ?? ts, text: data.text ?? text };
  },

  /** Delete a message the connected user posted. */
  delete_message: async (args, ctx) => {
    const channel = await resolveChannel(ctx, args.channel);
    const ts = requiredString(args, 'ts');
    await slackCall(ctx, 'chat.delete', {}, { method: 'POST', body: { channel, ts } });
    return { deleted: true, channel, ts };
  },
};
