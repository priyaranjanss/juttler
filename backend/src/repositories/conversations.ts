import { Conversation, Message } from '../../../frontend/src/types/index';
import { sql } from '../config/db';
import { generateId } from '../utils/id';

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

interface ConversationRow {
  id: string;
  user_id: string;
  title: string;
  is_group: boolean;
  participant_bot_ids: string[];
  last_message_snippet: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    isGroup: row.is_group,
    participantBotIds: row.participant_bot_ids || [],
    lastMessageSnippet: row.last_message_snippet ?? undefined,
    lastMessageAt: row.last_message_at ? row.last_message_at.toISOString() : new Date().toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listAllConversations(): Promise<Conversation[]> {
  const rows = (await sql`select * from conversations order by created_at desc`) as unknown as ConversationRow[];
  return rows.map(mapConversation);
}

export async function listConversationsForUser(userId: string): Promise<Conversation[]> {
  const rows = (await sql`
    select * from conversations where user_id = ${userId} order by created_at desc
  `) as unknown as ConversationRow[];
  return rows.map(mapConversation);
}

export async function findConversationById(id: string): Promise<Conversation | null> {
  const rows = (await sql`select * from conversations where id = ${id} limit 1`) as unknown as ConversationRow[];
  return rows.length > 0 ? mapConversation(rows[0]) : null;
}

export async function createConversation(data: {
  userId: string;
  title: string;
  isGroup: boolean;
  participantBotIds: string[];
}): Promise<Conversation> {
  const rows = (await sql`
    insert into conversations (id, user_id, title, is_group, participant_bot_ids)
    values (${generateId('conv_')}, ${data.userId}, ${data.title}, ${data.isGroup}, ${JSON.stringify(data.participantBotIds)}::jsonb)
    returning *
  `) as unknown as ConversationRow[];
  return mapConversation(rows[0]);
}

export async function touchConversation(id: string, snippet: string): Promise<void> {
  await sql`
    update conversations
    set last_message_snippet = ${snippet}, last_message_at = now(), updated_at = now()
    where id = ${id}
  `;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  sender_id: string;
  sender_name: string | null;
  sender_avatar: string | null;
  sender_color: string | null;
  content: string;
  type: string;
  metadata: Message['metadata'] | null;
  timestamp: Date;
}

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    senderType: row.sender_type as Message['senderType'],
    senderId: row.sender_id,
    senderName: row.sender_name ?? '',
    senderAvatar: row.sender_avatar ?? undefined,
    senderColor: row.sender_color ?? undefined,
    content: row.content,
    type: row.type as Message['type'],
    metadata: row.metadata ?? undefined,
    timestamp: row.timestamp.toISOString(),
  };
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const rows = (await sql`
    select * from messages where conversation_id = ${conversationId} order by timestamp asc
  `) as unknown as MessageRow[];
  return rows.map(mapMessage);
}

export async function createMessage(message: Message): Promise<void> {
  await sql`
    insert into messages (id, conversation_id, sender_type, sender_id, sender_name, sender_avatar, sender_color, content, type, metadata, timestamp)
    values (
      ${message.id},
      ${message.conversationId},
      ${message.senderType},
      ${message.senderId},
      ${message.senderName ?? null},
      ${message.senderAvatar ?? null},
      ${message.senderColor ?? null},
      ${message.content},
      ${message.type},
      ${message.metadata ? JSON.stringify(message.metadata) : null}::jsonb,
      ${message.timestamp}
    )
  `;
}
