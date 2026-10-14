import { sql } from '../config/db';
import { generateId } from '../utils/id';
import { decryptTokenSafe, encryptToken } from '../services/tokenCrypto';

export type SlackInstallStatus = 'pending_install' | 'awaiting_admin_approval' | 'connected' | 'error';

export interface SlackBotApp {
  id: string;
  botId: string;
  teamId: string;
  slackTeamId: string | null;
  slackTeamName: string | null;
  slackAppId: string | null;
  clientId: string | null;
  clientSecret: string;
  signingSecret: string;
  botToken: string;
  botUserId: string | null;
  installerUserId: string | null;
  installerSlackUserId: string | null;
  status: SlackInstallStatus;
  statusDetail: string | null;
  welcomeDmSent: boolean;
}

interface AppRow {
  id: string;
  bot_id: string;
  team_id: string;
  slack_team_id: string | null;
  slack_team_name: string | null;
  slack_app_id: string | null;
  client_id: string | null;
  client_secret: string | null;
  signing_secret: string | null;
  bot_token: string | null;
  bot_user_id: string | null;
  installer_user_id: string | null;
  installer_slack_user_id: string | null;
  status: SlackInstallStatus;
  status_detail: string | null;
  welcome_dm_sent: boolean;
}

function mapApp(row: AppRow): SlackBotApp {
  return {
    id: row.id,
    botId: row.bot_id,
    teamId: row.team_id,
    slackTeamId: row.slack_team_id,
    slackTeamName: row.slack_team_name,
    slackAppId: row.slack_app_id,
    clientId: row.client_id,
    clientSecret: decryptTokenSafe(row.client_secret),
    signingSecret: decryptTokenSafe(row.signing_secret),
    botToken: decryptTokenSafe(row.bot_token),
    botUserId: row.bot_user_id,
    installerUserId: row.installer_user_id,
    installerSlackUserId: row.installer_slack_user_id,
    status: row.status,
    statusDetail: row.status_detail,
    welcomeDmSent: row.welcome_dm_sent === true,
  };
}

export async function findSlackAppByBotId(botId: string): Promise<SlackBotApp | null> {
  const rows = (await sql`select * from slack_bot_apps where bot_id = ${botId} limit 1`) as unknown as AppRow[];
  return rows.length > 0 ? mapApp(rows[0]) : null;
}

export async function findSlackAppBySlackAppId(slackAppId: string): Promise<SlackBotApp | null> {
  const rows = (await sql`
    select * from slack_bot_apps where slack_app_id = ${slackAppId} limit 1
  `) as unknown as AppRow[];
  return rows.length > 0 ? mapApp(rows[0]) : null;
}

export async function findSlackAppById(id: string): Promise<SlackBotApp | null> {
  const rows = (await sql`select * from slack_bot_apps where id = ${id} limit 1`) as unknown as AppRow[];
  return rows.length > 0 ? mapApp(rows[0]) : null;
}

export async function insertSlackApp(data: {
  botId: string;
  teamId: string;
  slackTeamId: string | null;
  slackTeamName: string | null;
}): Promise<SlackBotApp> {
  const rows = (await sql`
    insert into slack_bot_apps (id, bot_id, team_id, slack_team_id, slack_team_name, status)
    values (${generateId('sapp_')}, ${data.botId}, ${data.teamId}, ${data.slackTeamId}, ${data.slackTeamName}, 'pending_install')
    returning *
  `) as unknown as AppRow[];
  return mapApp(rows[0]);
}

export async function saveSlackCredentials(
  id: string,
  credentials: { slackAppId: string; clientId: string; clientSecret: string; signingSecret: string }
): Promise<void> {
  await sql`
    update slack_bot_apps
    set slack_app_id = ${credentials.slackAppId},
        client_id = ${credentials.clientId},
        client_secret = ${encryptToken(credentials.clientSecret)},
        signing_secret = ${encryptToken(credentials.signingSecret)},
        updated_at = now()
    where id = ${id}
  `;
}

export async function markSlackInstall(
  id: string,
  patch: {
    status: SlackInstallStatus;
    statusDetail?: string | null;
    slackTeamId?: string | null;
    slackTeamName?: string | null;
    botToken?: string | null;
    botUserId?: string | null;
    installerUserId?: string | null;
    installerSlackUserId?: string | null;
    welcomeDmSent?: boolean;
  }
): Promise<void> {
  const sets = ['status = $1', 'status_detail = $2', 'updated_at = now()'];
  const values: unknown[] = [patch.status, patch.statusDetail ?? null];

  const set = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };

  if (patch.slackTeamId) set('slack_team_id', patch.slackTeamId);
  if (patch.slackTeamName) set('slack_team_name', patch.slackTeamName);
  if (patch.botToken) set('bot_token', encryptToken(patch.botToken));
  if (patch.botUserId) set('bot_user_id', patch.botUserId);
  if (patch.installerUserId) set('installer_user_id', patch.installerUserId);
  if (patch.installerSlackUserId) set('installer_slack_user_id', patch.installerSlackUserId);
  if (patch.welcomeDmSent !== undefined) set('welcome_dm_sent', patch.welcomeDmSent);

  values.push(id);
  await sql.query(`update slack_bot_apps set ${sets.join(', ')} where id = $${values.length}`, values);
}

export interface SlackThread {
  id: string;
  installationId: string;
  conversationId: string | null;
  channelId: string;
  threadKey: string;
  channelType: string;
  activated: boolean;
  linkPrompted: boolean;
  title: string;
}

interface ThreadRow {
  id: string;
  installation_id: string;
  conversation_id: string | null;
  channel_id: string;
  thread_key: string;
  channel_type: string;
  activated: boolean;
  link_prompted: boolean;
  title: string;
}

function mapThread(row: ThreadRow): SlackThread {
  return {
    id: row.id,
    installationId: row.installation_id,
    conversationId: row.conversation_id,
    channelId: row.channel_id,
    threadKey: row.thread_key,
    channelType: row.channel_type,
    activated: row.activated === true,
    linkPrompted: row.link_prompted === true,
    title: row.title,
  };
}

export async function findSlackThread(
  installationId: string,
  channelId: string,
  threadKey: string
): Promise<SlackThread | null> {
  const rows = (await sql`
    select * from slack_threads
    where installation_id = ${installationId} and channel_id = ${channelId} and thread_key = ${threadKey}
    limit 1
  `) as unknown as ThreadRow[];
  return rows.length > 0 ? mapThread(rows[0]) : null;
}

export async function upsertSlackThread(data: {
  installationId: string;
  channelId: string;
  threadKey: string;
  channelType: string;
  activated: boolean;
  conversationId?: string | null;
  linkPrompted?: boolean;
  title?: string;
}): Promise<SlackThread> {
  const rows = (await sql`
    insert into slack_threads (
      id, installation_id, channel_id, thread_key, channel_type, activated, conversation_id, link_prompted, title
    )
    values (
      ${generateId('sthr_')},
      ${data.installationId},
      ${data.channelId},
      ${data.threadKey},
      ${data.channelType},
      ${data.activated},
      ${data.conversationId ?? null},
      ${data.linkPrompted === true},
      ${data.title ?? ''}
    )
    on conflict (installation_id, channel_id, thread_key)
    do update set
      activated = slack_threads.activated or excluded.activated,
      conversation_id = coalesce(excluded.conversation_id, slack_threads.conversation_id),
      link_prompted = slack_threads.link_prompted or excluded.link_prompted,
      title = case when excluded.title = '' then slack_threads.title else excluded.title end,
      channel_type = excluded.channel_type,
      updated_at = now()
    returning *
  `) as unknown as ThreadRow[];
  return mapThread(rows[0]);
}

/** True the first time this Slack event id is seen. Retries return false. */
export async function claimSlackEvent(eventId: string): Promise<boolean> {
  const rows = await sql`
    insert into slack_event_receipts (event_id)
    values (${eventId})
    on conflict (event_id) do nothing
    returning event_id
  `;
  return rows.length > 0;
}

/** True the first time this channel message is seen. Mention plus message events share a ts. */
export async function claimSlackMessage(installationId: string, channelId: string, messageTs: string): Promise<boolean> {
  const rows = await sql`
    insert into slack_message_receipts (installation_id, channel_id, message_ts)
    values (${installationId}, ${channelId}, ${messageTs})
    on conflict (installation_id, channel_id, message_ts) do nothing
    returning message_ts
  `;
  return rows.length > 0;
}
