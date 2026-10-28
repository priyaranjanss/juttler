import { Message } from '../../types';
import { listBotsForUser } from '../../repositories/bots';
import {
  createConversation,
  createMessage,
  listMessages,
  touchConversation,
} from '../../repositories/conversations';
import {
  getInstallationCredential,
  findSlackUserInstallation,
} from '../../repositories/plugins';
import { claimSlackEvent, claimSlackMessage } from '../../repositories/slackApps';
import {
  findSlackUserThread,
  upsertSlackUserThread,
} from '../../repositories/slackUserThreads';
import { generateId } from '../../utils/id';
import { runBotTurnWithTools } from '../botTurn';
import { SlackMentionTarget, toSlackMrkdwn } from '../slackFormat';
import { slackMentionedUserIds } from './decide';
import { verifySlackSignature } from './signature';
import { slackApi } from './slackApi';

interface SlackUserEvent {
  type?: string;
  user?: string;
  bot_id?: string;
  subtype?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  channel?: string;
  channel_type?: string;
  username?: string;
  user_profile?: {
    display_name?: string;
    real_name?: string;
  };
}

interface SlackUserEventBody {
  type?: string;
  challenge?: string;
  team_id?: string;
  event_id?: string;
  event?: SlackUserEvent;
}

interface SlackUserProfile {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: {
    display_name?: string;
    real_name?: string;
  };
}

const USER_CACHE_TTL_MS = 5 * 60 * 1000;
const workspaceUsersCache = new Map<string, { expiresAt: number; users: SlackUserProfile[] }>();
const channelMembersCache = new Map<string, { expiresAt: number; userIds: string[] }>();

export async function acceptSlackUserEvent(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
  body: SlackUserEventBody
): Promise<{ status: number; challenge?: string }> {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) {
    console.error('Slack user events unavailable: SLACK_SIGNING_SECRET is not configured.');
    return { status: 500 };
  }
  if (!verifySlackSignature(rawBody, timestamp, signature, secret)) {
    return { status: 401 };
  }

  if (body.type === 'url_verification' && typeof body.challenge === 'string') {
    return { status: 200, challenge: body.challenge };
  }
  if (body.type !== 'event_callback' || !body.event_id) return { status: 200 };

  const fresh = await claimSlackEvent(`oauth:${body.event_id}`);
  if (!fresh) return { status: 200 };

  console.info(
    'Slack user event accepted: eventId=%s teamId=%s eventType=%s',
    body.event_id,
    body.team_id ?? 'unknown',
    body.event?.type ?? 'unknown'
  );
  void handleSlackUserEvent(body).catch((err) => {
    console.error('Slack user event failed:', err);
  });
  return { status: 200 };
}

async function slackSpeakerName(token: string, userId: string, event: SlackUserEvent): Promise<string> {
  const hinted = event.user_profile?.display_name || event.user_profile?.real_name || event.username;
  if (hinted) return hinted;
  try {
    const info = await slackApi(token, 'users.info', { user: userId });
    const profile = info.user?.profile ?? {};
    return profile.display_name || info.user?.real_name || info.user?.name || 'Slack user';
  } catch (err) {
    console.warn('Slack event speaker lookup failed:', err);
    return 'Slack user';
  }
}

async function workspaceUsers(
  token: string,
  teamId: string
): Promise<SlackUserProfile[]> {
  const cached = workspaceUsersCache.get(teamId);
  if (cached && cached.expiresAt > Date.now()) return cached.users;

  const users: SlackUserProfile[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 25; page += 1) {
    const response = await slackApi(token, 'users.list', {
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    users.push(...((response.members ?? []) as SlackUserProfile[]));
    cursor = response.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  workspaceUsersCache.set(teamId, { expiresAt: Date.now() + USER_CACHE_TTL_MS, users });
  return users;
}

async function channelMentionTargets(
  token: string,
  teamId: string,
  channelId: string
): Promise<SlackMentionTarget[]> {
  const cacheKey = `${teamId}:${channelId}`;
  let cached = channelMembersCache.get(cacheKey);
  if (cached && cached.expiresAt <= Date.now()) {
    cached = undefined;
  }
  if (!cached) {
    const userIds: string[] = [];
    let cursor: string | undefined;
    let lookupFailed = false;
    try {
      for (let page = 0; page < 10; page += 1) {
        const response = await slackApi(token, 'conversations.members', {
          channel: channelId,
          limit: 200,
          ...(cursor ? { cursor } : {}),
        });
        userIds.push(...((response.members ?? []) as string[]));
        cursor = response.response_metadata?.next_cursor || undefined;
        if (!cursor) break;
      }
    } catch (err) {
      lookupFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        'Slack channel member lookup unavailable; dynamic name mentions are skipped for this channel for five minutes:',
        message
      );
      cached = { expiresAt: Date.now() + USER_CACHE_TTL_MS, userIds: [] };
      channelMembersCache.set(cacheKey, cached);
    }
    if (!lookupFailed) {
      cached = { expiresAt: Date.now() + USER_CACHE_TTL_MS, userIds };
      channelMembersCache.set(cacheKey, cached);
    }
  }

  const resolvedCache = cached;
  if (!resolvedCache || resolvedCache.userIds.length === 0) return [];
  const ids = new Set(resolvedCache.userIds);
  const profiles = await workspaceUsers(token, teamId);
  return profiles
    .filter((user) => ids.has(user.id) && !user.deleted && !user.is_bot)
    .slice(0, 100)
    .map((user) => ({
      userId: user.id,
      names: [
        user.profile?.display_name,
        user.profile?.real_name,
        user.real_name,
        user.name,
      ]
        .map((name) => name?.replace(/\s+/g, ' ').trim().slice(0, 80))
        .filter((name): name is string => Boolean(name)),
    }))
    .filter((user) => user.names.length > 0);
}

async function handleSlackUserEvent(body: SlackUserEventBody): Promise<void> {
  const event = body.event;
  const teamId = body.team_id;
  if (
    !event ||
    event.type !== 'message' ||
    !teamId ||
    !event.channel ||
    !event.ts ||
    !event.user ||
    event.bot_id ||
    (event.subtype && event.subtype !== 'file_share') ||
    (event.channel_type !== 'channel' && event.channel_type !== 'group')
  ) {
    return;
  }

  const threadKey = event.thread_ts || event.ts;
  const existing = await findSlackUserThread(teamId, event.channel, threadKey);
  let installation = existing
    ? await findSlackUserInstallation(teamId, existing.slackUserId)
    : null;
  let targetSlackUserId = installation?.slackUserId ?? '';

  if (!installation) {
    const mentionedUsers = slackMentionedUserIds(event.text ?? '');
    for (const mentionedUserId of mentionedUsers) {
      installation = await findSlackUserInstallation(teamId, mentionedUserId);
      if (installation) {
        targetSlackUserId = mentionedUserId;
        break;
      }
    }
    if (!installation && mentionedUsers.length) {
      console.warn('Slack user event ignored: no unique connected Juttler account matches the mentioned Slack user.');
    }
  }

  if (!installation || !targetSlackUserId || event.user === targetSlackUserId) return;

  const claimed = await claimSlackMessage(installation.id, event.channel, event.ts);
  if (!claimed) return;

  const credential = await getInstallationCredential(installation.id);
  const token = typeof credential.token === 'string' ? credential.token : '';
  if (!token) {
    console.error('Slack user event skipped: connected OAuth installation has no access token.');
    return;
  }

  const bots = await listBotsForUser(installation.userId);
  const bot = bots.find((candidate) => candidate.isChiefOfStaff) ?? bots[0];
  if (!bot) {
    console.error('Slack user event skipped: no Juttler bot exists for the connected account.');
    return;
  }

  let mentionTargets: SlackMentionTarget[] = [];
  try {
    mentionTargets = await channelMentionTargets(token, teamId, event.channel);
  } catch (err) {
    console.warn('Slack channel member lookup failed; name-based mentions will not be expanded:', err);
  }
  const senderProfile = mentionTargets.find((target) => target.userId === event.user);
  const speaker =
    event.user_profile?.display_name ||
    event.user_profile?.real_name ||
    senderProfile?.names[0] ||
    (await slackSpeakerName(token, event.user, event));
  const title = `Slack · ${event.channel}`;
  let conversationId = existing?.conversationId ?? null;
  if (!conversationId) {
    const conversation = await createConversation({
      userId: installation.userId,
      title,
      isGroup: false,
      participantBotIds: [bot.id],
      source: 'slack',
    });
    conversationId = conversation.id;
  }

  await upsertSlackUserThread({
    installationId: installation.id,
    slackTeamId: teamId,
    slackUserId: targetSlackUserId,
    userId: installation.userId,
    conversationId,
    channelId: event.channel,
    threadKey,
    channelType: event.channel_type ?? 'channel',
  });

  const spoken = (event.text ?? '')
    .replaceAll(`<@${targetSlackUserId}>`, '')
    .replace(/\s+/g, ' ')
    .trim() || '(no text)';
  const history = (await listMessages(conversationId))
    .slice(-12)
    .map((message) =>
      message.content.length > 1200
        ? { ...message, content: `${message.content.slice(0, 1200)}…` }
        : message
    );
  const userMessage: Message = {
    id: generateId('msg_'),
    conversationId,
    senderType: 'user',
    senderId: event.user,
    senderName: speaker,
    content: spoken,
    type: 'text',
    timestamp: new Date().toISOString(),
  };
  await createMessage(userMessage);
  await touchConversation(conversationId, spoken);

  let reply: string;
  let failed = false;
  try {
    const turn = await runBotTurnWithTools({
      userId: installation.userId,
      bot,
      userName: speaker,
      messageContent: spoken,
      history,
      conversationId,
      systemAddendum:
        [
          'You are responding in Slack. Treat only this Slack thread history and the current Slack message as the active conversation context. Do not import, reveal, or assume details from unrelated Juttler chats or other Slack channels.',
          'Follow the bot-specific instructions below together with the task and applicable safety rules. Work independently: answer directly when possible, use relevant enabled Juttler tools for research or actions, and do not claim to have searched Juttler memory unless an available tool actually retrieved that information.',
          'If the request is ambiguous in a way that could change the result, ask a concise clarifying question in Slack. Ask useful counterquestions when they unblock the task; do not ask for confirmation of ordinary, reversible steps. Respect required approval for sensitive or external actions.',
          'Use this Slack thread as the primary context. Search connected Juttler services or workspace data when the request needs it, then relate the findings back to the thread without merging unrelated chat histories.',
          'The reply is posted as the connected Slack user and will automatically start by mentioning the person who sent the message; do not repeat that sender mention. Decide from context whether to mention other people. If you choose to mention someone, use their exact display name with @. Only mention people in this channel roster; never invent a person.',
          `Channel members you may mention: ${JSON.stringify(mentionTargets.map((target) => ({ names: target.names })))}`,
          `Additional instructions configured for this bot: ${bot.systemPrompt}`,
        ].join('\n\n'),
    });
    if (turn.waitingForApproval) {
      reply = 'I need approval in Juttler before I can finish that. Open this bot there and approve the pending action.';
    } else if (turn.error) {
      failed = true;
      reply = turn.error.message;
    } else {
      reply = turn.text?.trim() || 'Done.';
    }
  } catch (err) {
    failed = true;
    reply = err instanceof Error ? err.message : 'Something went wrong while handling that Slack message.';
    console.error('Slack user bot turn failed:', err);
  }

  await createMessage({
    id: generateId('msg_'),
    conversationId,
    senderType: failed ? 'system' : 'bot',
    senderId: failed ? 'sys' : bot.id,
    senderName: failed ? 'System' : bot.name,
    senderAvatar: bot.avatar,
    senderColor: bot.color,
    content: reply,
    type: 'text',
    timestamp: new Date().toISOString(),
  });
  await touchConversation(conversationId, reply);

  try {
    const addressedReply = ` <@${event.user}> ${reply}`.trim();
    const formatted = toSlackMrkdwn(addressedReply, targetSlackUserId, mentionTargets);
    await slackApi(token, 'chat.postMessage', {
      channel: event.channel,
      text: formatted.length > 3500 ? `${formatted.slice(0, 3500)}…` : formatted,
      mrkdwn: true,
      thread_ts: event.thread_ts || event.ts,
    });
    console.info(
      'Slack user reply posted: channel=%s thread=%s mentions=%s',
      event.channel,
      event.thread_ts || event.ts,
      mentionTargets.length
    );
  } catch (err) {
    console.error('Slack user reply failed:', err);
  }
}
