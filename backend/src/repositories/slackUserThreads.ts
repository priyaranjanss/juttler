import { sql } from '../config/db';
import { generateId } from '../utils/id';

export interface SlackUserThread {
  installationId: string;
  userId: string;
  slackUserId: string;
  conversationId: string | null;
  channelId: string;
  threadKey: string;
  channelType: string;
}

interface SlackUserThreadRow {
  installation_id: string;
  user_id: string;
  slack_user_id: string;
  conversation_id: string | null;
  channel_id: string;
  thread_key: string;
  channel_type: string;
}

function mapThread(row: SlackUserThreadRow): SlackUserThread {
  return {
    installationId: row.installation_id,
    userId: row.user_id,
    slackUserId: row.slack_user_id,
    conversationId: row.conversation_id,
    channelId: row.channel_id,
    threadKey: row.thread_key,
    channelType: row.channel_type,
  };
}

export async function findSlackUserThread(
  slackTeamId: string,
  channelId: string,
  threadKey: string
): Promise<SlackUserThread | null> {
  const rows = (await sql`
    select t.installation_id, i.user_id, i.metadata ->> 'authed_user_id' as slack_user_id,
           t.conversation_id, t.channel_id, t.thread_key, t.channel_type
    from slack_user_threads t
    join plugin_installations i on i.id = t.installation_id
    where t.slack_team_id = ${slackTeamId}
      and t.channel_id = ${channelId}
      and t.thread_key = ${threadKey}
      and i.status = 'connected'
    limit 1
  `) as unknown as SlackUserThreadRow[];
  return rows.length ? mapThread(rows[0]) : null;
}

export async function upsertSlackUserThread(data: {
  installationId: string;
  slackTeamId: string;
  slackUserId: string;
  userId: string;
  conversationId: string;
  channelId: string;
  threadKey: string;
  channelType: string;
}): Promise<SlackUserThread> {
  const rows = (await sql`
    insert into slack_user_threads (
      id, installation_id, slack_team_id, conversation_id, channel_id, thread_key, channel_type
    )
    values (
      ${generateId('suth_')},
      ${data.installationId},
      ${data.slackTeamId},
      ${data.conversationId},
      ${data.channelId},
      ${data.threadKey},
      ${data.channelType}
    )
    on conflict (installation_id, channel_id, thread_key)
    do update set
      conversation_id = excluded.conversation_id,
      channel_type = excluded.channel_type,
      updated_at = now()
    returning installation_id, conversation_id, channel_id, thread_key, channel_type
  `) as unknown as SlackUserThreadRow[];
  return mapThread({
    ...rows[0],
    user_id: data.userId,
    slack_user_id: data.slackUserId,
  });
}
