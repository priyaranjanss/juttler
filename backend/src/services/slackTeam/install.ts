import { randomBytes } from 'crypto';
import { Bot } from '../../types';
import { putOauthState, consumeOauthState } from '../../config/oauthState';
import { attachBotTeam, findBotById } from '../../repositories/bots';
import { findUserById } from '../../repositories/users';
import { findInstallationByUserAndPlugin } from '../../repositories/plugins';
import {
  findSlackAppByBotId,
  findSlackAppById,
  insertSlackApp,
  saveSlackCredentials,
  markSlackInstall,
  SlackBotApp,
} from '../../repositories/slackApps';
import { canManageTeam, ensureOwnedTeam, findMembership, linkSlackAccount, listMembers } from '../../repositories/teams';
import { sql } from '../../config/db';
import { upsertSlackApp, installRedirectUrl, deleteSlackApp } from './manifest';
import { TEAM_BOT_BOT_SCOPES, frontendUrl, publicBackendUrl, slackApi, SlackApiError } from './slackApi';

const PENDING_ERRORS = new Set(['request_pending', 'approval_pending', 'app_not_approved']);

export interface SlackInstallView {
  status: 'not_connected' | 'pending_install' | 'awaiting_admin_approval' | 'connected' | 'error';
  slackTeamId: string | null;
  slackTeamName: string | null;
  botUserId: string | null;
  detail: string | null;
  published: boolean;
  isTeamBot: boolean;
  canManage: boolean;
  ownerSlackConnected: boolean;
  ownerSlackTeamName: string | null;
}

interface OwnerSlack {
  teamId: string;
  teamName: string | null;
}

async function ownerSlack(teamId: string): Promise<OwnerSlack | null> {
  const members = await listMembers(teamId);
  const owner = members.find((member) => member.role === 'owner');
  if (!owner) return null;
  const installation = await findInstallationByUserAndPlugin(owner.userId, 'slack');
  const team = installation?.metadata?.team_id;
  if (!installation || installation.status !== 'connected' || typeof team !== 'string' || !team) return null;
  return {
    teamId: team,
    teamName: typeof installation.metadata?.team_name === 'string' ? installation.metadata.team_name : null,
  };
}

async function assertOwner(userId: string, bot: Bot): Promise<void> {
  if (bot.userId !== userId) {
    throw new Error('Only the owner of this bot can connect it to Slack.');
  }
}

/** Slack apps are stored against the owner. The bot itself stays a normal bot. */
async function ensureSlackOwner(userId: string, bot: Bot): Promise<Bot> {
  if (bot.teamId) return bot;
  const owner = await findUserById(userId);
  const team = await ensureOwnedTeam(userId, owner?.name || 'My');
  await attachBotTeam(bot.id, team.id);
  return { ...bot, teamId: team.id };
}

export async function slackInstallView(userId: string, bot: Bot): Promise<SlackInstallView> {
  const member = bot.teamId ? await findMembership(bot.teamId, userId) : null;
  const slack = bot.teamId ? await ownerSlack(bot.teamId) : null;
  const app = await findSlackAppByBotId(bot.id);
  return {
    status: app?.status ?? 'not_connected',
    slackTeamId: app?.slackTeamId ?? slack?.teamId ?? null,
    slackTeamName: app?.slackTeamName ?? slack?.teamName ?? null,
    botUserId: app?.botUserId ?? null,
    detail: app?.statusDetail ?? null,
    published: Boolean(bot.publishedAt),
    isTeamBot: bot.isTeamBot,
    canManage: bot.userId === userId || Boolean(member && canManageTeam(member.role)),
    ownerSlackConnected: Boolean(slack),
    ownerSlackTeamName: slack?.teamName ?? null,
  };
}

async function getOrCreateApp(bot: Bot, slack: OwnerSlack | null): Promise<SlackBotApp> {
  const existing = await findSlackAppByBotId(bot.id);
  if (existing) {
    if (existing.status === 'connected') return existing;
    if (slack && existing.slackTeamId !== slack.teamId) {
      await sql`
        update slack_bot_apps
        set slack_team_id = ${slack.teamId}, slack_team_name = ${slack.teamName}, updated_at = now()
        where id = ${existing.id}
      `;
      existing.slackTeamId = slack.teamId;
      existing.slackTeamName = slack.teamName;
    }
    return existing;
  }

  try {
    return await insertSlackApp({
      botId: bot.id,
      teamId: bot.teamId!,
      slackTeamId: slack?.teamId ?? null,
      slackTeamName: slack?.teamName ?? null,
    });
  } catch {
    const again = await findSlackAppByBotId(bot.id);
    if (again) return again;
    throw new Error('Could not start the Slack install.');
  }
}

/** Creates or refreshes the Bot’s Slack app and returns the workspace install URL. */
export async function beginSlackInstall(userId: string, botId: string): Promise<{ authorizeUrl?: string; status: string }> {
  const found = await findBotById(botId);
  if (!found) throw new Error('Bot not found');
  await assertOwner(userId, found);
  const bot = await ensureSlackOwner(userId, found);

  const slack = bot.teamId ? await ownerSlack(bot.teamId) : null;
  const app = await getOrCreateApp(bot, slack);
  if (app.status === 'connected' && app.botToken && app.botUserId) {
    return { status: 'connected' };
  }

  const credentials = await upsertSlackApp({
    appId: app.slackAppId,
    name: bot.name,
    description: bot.roleTitle,
    color: bot.color,
  });
  if (credentials) {
    await saveSlackCredentials(app.id, {
      slackAppId: credentials.appId,
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      signingSecret: credentials.signingSecret,
    });
    app.clientId = credentials.clientId;
    app.slackAppId = credentials.appId;
  }
  if (!app.clientId) {
    throw new Error('Slack did not return a client id for this bot.');
  }

  const state = randomBytes(24).toString('base64url');
  await putOauthState(state, { userId, pluginSlug: 'slack-team-install', slackInstallId: app.id });

  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', app.clientId);
  url.searchParams.set('scope', TEAM_BOT_BOT_SCOPES.join(','));
  url.searchParams.set('redirect_uri', installRedirectUrl());
  url.searchParams.set('state', state);
  if (slack?.teamId) url.searchParams.set('team', slack.teamId);

  return { authorizeUrl: url.toString(), status: app.status === 'awaiting_admin_approval' ? app.status : 'pending_install' };
}

async function sendWelcome(bot: Bot, app: SlackBotApp, slackUserId: string): Promise<boolean> {
  if (!app.botToken) return false;
  try {
    const opened = await slackApi(app.botToken, 'conversations.open', { users: slackUserId });
    const channel = opened.channel?.id;
    if (!channel) return false;
    await slackApi(app.botToken, 'chat.postMessage', {
      channel,
      text: `I'm ${bot.name}. This direct message is one conversation, so you can just keep talking.\n\nInvite me to a channel with \`/invite @${bot.name}\`, then @mention me. After that I follow the thread, and later replies do not need another mention.`,
    });
    return true;
  } catch (err) {
    console.error('Slack welcome DM failed:', err);
    return false;
  }
}

/** Slack redirected the installer back. Exchanges the code, or records admin approval. */
export async function finishSlackInstall(query: {
  code?: string;
  state?: string;
  error?: string;
}): Promise<string> {
  const frontend = frontendUrl();
  const fail = (botId: string, reason: string) =>
    `${frontend}/workspace?slackBot=${encodeURIComponent(botId)}&slackInstall=error&slackReason=${encodeURIComponent(reason)}`;

  if (!query.state) return `${frontend}/workspace?slackInstall=error`;
  const bound = await consumeOauthState(query.state);
  if (!bound || bound.pluginSlug !== 'slack-team-install' || !bound.slackInstallId) {
    return `${frontend}/workspace?slackInstall=error`;
  }

  const app = await findSlackAppById(bound.slackInstallId);
  if (!app || !app.clientId || !app.clientSecret) return `${frontend}/workspace?slackInstall=error`;
  const bot = await findBotById(app.botId);
  if (!bot) return `${frontend}/workspace?slackInstall=error`;

  if (query.error || !query.code) {
    const pending = query.error ? PENDING_ERRORS.has(query.error) : false;
    const status = pending ? 'awaiting_admin_approval' : 'pending_install';
    const detail = pending
      ? 'Awaiting admin approval. Send the request again after an admin approves the app, or ask them to approve it in Slack.'
      : 'Slack did not finish the install. If this workspace requires an admin to approve apps, send the request from the bot’s settings.';
    await markSlackInstall(app.id, { status, statusDetail: detail });
    return `${frontend}/workspace?slackBot=${encodeURIComponent(bot.id)}&slackInstall=${status}`;
  }

  try {
    const payload = new URLSearchParams({
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code: query.code,
      redirect_uri: installRedirectUrl(),
    });
    const response = await fetch(`${(process.env.SLACK_API_BASE || 'https://slack.com/api').replace(/\/+$/, '')}/oauth.v2.access`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: payload,
    });
    const token = (await response.json().catch(() => ({}))) as Record<string, any>;
    if (!response.ok || token.ok === false || typeof token.access_token !== 'string') {
      const code = String(token.error || 'token_exchange_failed');
      if (PENDING_ERRORS.has(code)) {
        await markSlackInstall(app.id, {
          status: 'awaiting_admin_approval',
          statusDetail: 'Awaiting admin approval. You can send the request again from this bot’s settings.',
        });
        return `${frontend}/workspace?slackBot=${encodeURIComponent(bot.id)}&slackInstall=awaiting_admin_approval`;
      }
      throw new Error(code);
    }

    const installedTeam = token.team?.id;
    if (app.slackTeamId && installedTeam && installedTeam !== app.slackTeamId) {
      throw new Error('That Slack workspace is not the one the team owner connected.');
    }

    const installerSlackUserId = typeof token.authed_user?.id === 'string' ? token.authed_user.id : null;
    await markSlackInstall(app.id, {
      status: 'connected',
      statusDetail: null,
      slackTeamId: installedTeam ?? app.slackTeamId,
      slackTeamName: token.team?.name ?? app.slackTeamName,
      botToken: token.access_token,
      botUserId: typeof token.bot_user_id === 'string' ? token.bot_user_id : null,
      installerUserId: bound.userId,
      installerSlackUserId,
    });

    const fresh = await findSlackAppById(app.id);
    if (installerSlackUserId && installedTeam) {
      let displayName: string | null = null;
      if (fresh?.botToken) {
        try {
          const info = await slackApi(fresh.botToken, 'users.info', { user: installerSlackUserId });
          const profile = info.user?.profile ?? {};
          displayName = profile.display_name || info.user?.real_name || info.user?.name || null;
        } catch {
          displayName = null;
        }
      }
      await linkSlackAccount(bound.userId, installerSlackUserId, installedTeam, displayName);
    }

    const welcomed = fresh && installerSlackUserId ? await sendWelcome(bot, fresh, installerSlackUserId) : false;
    if (welcomed) await markSlackInstall(app.id, { status: 'connected', welcomeDmSent: true });

    return `${frontend}/workspace?slackBot=${encodeURIComponent(bot.id)}&slackInstall=connected`;
  } catch (err) {
    const message = err instanceof SlackApiError ? err.details || err.message : err instanceof Error ? err.message : 'Install failed';
    await markSlackInstall(app.id, { status: 'error', statusDetail: message });
    return fail(bot.id, message);
  }
}

/** Identifies a teammate’s Slack user without storing a token that can post as them. */
export async function buildAccountLinkUrl(userId: string, slackTeamId?: string): Promise<string> {
  const clientId = (process.env.SLACK_CLIENT_ID || '').trim();
  if (!clientId) {
    throw new Error(
      'SLACK_CLIENT_ID is not set. Linking a Slack account uses the same Slack app as the Slack plugin. Add the redirect {PUBLIC_BACKEND_URL}/api/plugins/slack/callback to that app.'
    );
  }
  const state = randomBytes(24).toString('base64url');
  await putOauthState(state, { userId, pluginSlug: 'slack-link' });
  const url = new URL('https://slack.com/oauth/v2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('user_scope', 'users:read');
  url.searchParams.set('redirect_uri', `${publicBackendUrl()}/api/plugins/slack/callback`);
  url.searchParams.set('state', state);
  if (slackTeamId) url.searchParams.set('team', slackTeamId);
  return url.toString();
}

/** Keeps the Slack app’s name and color aligned with the bot. Failures are non-blocking. */
export async function syncSlackProfile(bot: Bot): Promise<void> {
  const app = await findSlackAppByBotId(bot.id);
  if (!app?.slackAppId) return;
  await upsertSlackApp({
    appId: app.slackAppId,
    name: bot.name,
    description: bot.roleTitle,
    color: bot.color,
  });
}

export async function removeSlackApp(botId: string): Promise<void> {
  const app = await findSlackAppByBotId(botId);
  if (!app?.slackAppId) return;
  try {
    await deleteSlackApp(app.slackAppId);
  } catch (err) {
    console.error('Could not delete the Slack app:', err);
  }
}
