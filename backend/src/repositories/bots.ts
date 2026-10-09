import { Bot } from '../../../frontend/src/types/index';
import { sql } from '../config/db';
import { generateId } from '../utils/id';

interface BotRow {
  id: string;
  user_id: string;
  name: string;
  role_title: string;
  system_prompt: string;
  avatar: string;
  color: string;
  allowed_tools: string[];
  is_chief_of_staff: boolean;
  status: string;
  memory_enabled: boolean;
  ai_provider: string | null;
  ai_endpoint: string | null;
  ai_model: string | null;
  ai_api_key: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapRow(row: BotRow): Bot {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    roleTitle: row.role_title,
    systemPrompt: row.system_prompt,
    avatar: row.avatar,
    color: row.color,
    allowedTools: row.allowed_tools || [],
    isChiefOfStaff: row.is_chief_of_staff,
    status: row.status as Bot['status'],
    memoryEnabled: row.memory_enabled,
    aiProvider: (row.ai_provider || 'kilo_gateway') as Bot['aiProvider'],
    aiEndpoint: row.ai_endpoint || 'https://api.kilo.ai/api/gateway',
    // Empty when unset â€” the user must pick a model in bot settings.
    aiModel: row.ai_model || '',
    aiApiKey: row.ai_api_key || '',
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function listAllBots(): Promise<Bot[]> {
  const rows = (await sql`select * from bots order by created_at desc`) as unknown as BotRow[];
  return rows.map(mapRow);
}

export async function listBotsForUser(userId: string): Promise<Bot[]> {
  const rows = (await sql`
    select * from bots where user_id = ${userId} order by created_at desc
  `) as unknown as BotRow[];
  return rows.map(mapRow);
}

export async function findBotById(id: string): Promise<Bot | null> {
  const rows = (await sql`select * from bots where id = ${id} limit 1`) as unknown as BotRow[];
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function createBot(data: {
  userId: string;
  name: string;
  roleTitle: string;
  systemPrompt?: string;
  avatar?: string;
  color?: string;
  allowedTools?: string[];
  isChiefOfStaff?: boolean;
  memoryEnabled?: boolean;
  aiProvider?: string;
  aiEndpoint?: string;
  aiModel?: string;
  aiApiKey?: string | null;
}): Promise<Bot> {
  const rows = (await sql`
    insert into bots (id, user_id, name, role_title, system_prompt, avatar, color, allowed_tools, is_chief_of_staff, memory_enabled, ai_provider, ai_endpoint, ai_model, ai_api_key)
    values (
      ${generateId('bot_')},
      ${data.userId},
      ${data.name},
      ${data.roleTitle},
      ${data.systemPrompt || `You are ${data.name}, ${data.roleTitle}. Assist your teammate effectively.`},
      ${data.avatar || 'blob'},
      ${data.color || '#6366f1'},
      ${JSON.stringify(data.allowedTools || ['web_search'])}::jsonb,
      ${data.isChiefOfStaff ?? false},
      ${data.memoryEnabled !== false},
      ${data.aiProvider || 'kilo_gateway'},
      ${data.aiEndpoint || 'https://api.kilo.ai/api/gateway'},
      ${data.aiModel?.trim() || null},
      ${data.aiApiKey ?? null}
    )
    returning *
  `) as unknown as BotRow[];
  return mapRow(rows[0]);
}

export async function updateBot(id: string, updates: Record<string, unknown>): Promise<Bot | null> {
  const columnMap: Record<string, string> = {
    name: 'name',
    roleTitle: 'role_title',
    systemPrompt: 'system_prompt',
    avatar: 'avatar',
    color: 'color',
    allowedTools: 'allowed_tools',
    isChiefOfStaff: 'is_chief_of_staff',
    status: 'status',
    memoryEnabled: 'memory_enabled',
    aiProvider: 'ai_provider',
    aiEndpoint: 'ai_endpoint',
    aiModel: 'ai_model',
    aiApiKey: 'ai_api_key',
  };

  const setters: string[] = [];
  const values: unknown[] = [];

  for (const [key, column] of Object.entries(columnMap)) {
    if (updates[key] !== undefined) {
      const value = column === 'allowed_tools' ? JSON.stringify(updates[key]) : updates[key];
      values.push(value);
      const cast = column === 'allowed_tools' ? '::jsonb' : '';
      setters.push(`${column} = $${values.length}${cast}`);
    }
  }

  if (setters.length === 0) {
    return findBotById(id);
  }

  setters.push('updated_at = now()');
  values.push(id);
  const rows = (await sql.query(
    `update bots set ${setters.join(', ')} where id = $${values.length} returning *`,
    values
  )) as unknown as BotRow[];
  return rows.length > 0 ? mapRow(rows[0]) : null;
}

export async function deleteBot(id: string): Promise<boolean> {
  const rows = await sql`delete from bots where id = ${id} returning id`;
  return rows.length > 0;
}

export async function clearChiefOfStaff(userId: string, exceptBotId?: string): Promise<void> {
  if (exceptBotId) {
    await sql`update bots set is_chief_of_staff = false where user_id = ${userId} and is_chief_of_staff and id <> ${exceptBotId}`;
  } else {
    await sql`update bots set is_chief_of_staff = false where user_id = ${userId} and is_chief_of_staff`;
  }
}
