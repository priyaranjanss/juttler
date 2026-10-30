/**
 * Workspace tools — the actions a user can take in the app that the Chief of
 * Staff can take on their behalf: bots and every one of their settings, which
 * plugin tools each bot may use, the team, and group chats.
 *
 * Connecting a plugin account is the one thing left to the user: credentials
 * and sign-in happen in the Plugins screen, never through a bot.
 *
 * Anything that changes workspace state runs immediately when the Chief asks
 * for it. The approval gate still applies to a plugin's own sensitive tools
 * (merging a PR, posting to Slack), because those leave the system.
 */

import { Bot } from '../../types';
import { AI_PROVIDERS, BOT_AVATAR_SHAPES, BOT_AVATAR_COLORS } from '../../constants';
import {
  listBotsForUser,
  createBot,
  updateBot,
  deleteBot,
  findBotById,
  clearChiefOfStaff,
  publishTeamBot,
} from '../../repositories/bots';
import {
  listPluginDefinitions,
  findPluginDefinitionBySlug,
  findInstallationByUserAndPlugin,
  listInstallations,
  deleteInstallation,
  listBotAccess,
  upsertBotAccess,
} from '../../repositories/plugins';
import { findUserById, findUserByEmail } from '../../repositories/users';
import { addMember, ensureOwnedTeam, findMembership, findPrimaryTeam, listMembers, canManageTeam } from '../../repositories/teams';
import { createConversation } from '../../repositories/conversations';
import { findSlackAppByBotId } from '../../repositories/slackApps';
import { syncSlackProfile } from '../../services/slackTeam/install';
import { normalizeProject, normalizeRepos } from '../../services/workScope';
import { isChiefOfStaffBot } from '../../config/chiefOfStaff';
import { registry, resolveTool, listAllTools } from '..';

export interface WorkspaceToolSpec {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

export interface WorkspaceToolResult {
  ok: boolean;
  result: any;
}

const REASONING_MODES = ['off', 'think', 'big_brain'] as const;
const AI_PROVIDER_KEYS = Object.keys(AI_PROVIDERS);

/** Every setting a bot has, shared by create_bot and update_bot. */
const BOT_SETTING_PROPERTIES: WorkspaceToolSpec['parameters']['properties'] = {
  role_title: { type: 'string', description: 'Role / title, e.g. "Research Lead"' },
  system_prompt: { type: 'string', description: 'The instructions (description) that define how the Bot behaves' },
  avatar: { type: 'string', description: 'Avatar shape', enum: [...BOT_AVATAR_SHAPES] },
  color: { type: 'string', description: `Avatar colour as #RRGGBB, e.g. ${BOT_AVATAR_COLORS.join(', ')}` },
  memory_enabled: { type: 'boolean', description: 'Whether the Bot remembers earlier conversation' },
  reasoning_mode: { type: 'string', description: 'How much the Bot reasons before replying', enum: [...REASONING_MODES] },
  ai_provider: { type: 'string', description: 'Which AI provider runs the Bot', enum: AI_PROVIDER_KEYS },
  ai_model: { type: 'string', description: 'Model id on the AI provider (not used by the free endpoint)' },
  ai_api_key: { type: 'string', description: 'API key for the AI provider. Stored encrypted and never shown again.' },
  jira_project: { type: 'string', description: 'The one Jira project key this Bot may touch, e.g. ABC. Empty clears it.' },
  github_repos: { type: 'string', description: 'Comma-separated owner/name GitHub repositories this Bot may use. Empty clears them.' },
};

/** Every workspace tool, keyed by name. */
export const WORKSPACE_TOOLS: WorkspaceToolSpec[] = [
  {
    name: 'get_team_roster',
    description: 'List every Bot this user owns with its role, purpose, and which plugin tools it may use.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_bot',
    description:
      'Read every setting of one Bot (including the Chief itself): name, role, full instructions, appearance, memory, reasoning mode, AI provider and model, work scope, plugin tool access, team and Slack status.',
    parameters: {
      type: 'object',
      properties: { bot_name: { type: 'string', description: 'Name of the Bot' } },
      required: ['bot_name'],
    },
  },
  {
    name: 'create_bot',
    description: 'Create a new Bot with any of its settings.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short display name, e.g. "Atlas"' },
        ...BOT_SETTING_PROPERTIES,
        team_bot: { type: 'boolean', description: 'Create it as a Team Bot that can be published to the team and given its own Slack app' },
        tools: { type: 'string', description: 'Comma-separated plugin tool names this Bot may use' },
      },
      required: ['name', 'role_title'],
    },
  },
  {
    name: 'update_bot',
    description:
      'Change any setting of an existing Bot, including the Chief itself. Only the settings passed are changed. Returns the Bot as saved.',
    parameters: {
      type: 'object',
      properties: {
        bot_name: { type: 'string', description: 'Current name of the Bot to change' },
        name: { type: 'string', description: 'New name' },
        ...BOT_SETTING_PROPERTIES,
        make_chief: { type: 'boolean', description: 'true makes this Bot the Chief of Staff in place of the current one' },
      },
      required: ['bot_name'],
    },
  },
  {
    name: 'delete_bot',
    description: "Remove one of the user's Bots. The current Chief of Staff cannot be deleted.",
    parameters: {
      type: 'object',
      properties: { bot_name: { type: 'string', description: 'Name of the Bot to delete' } },
      required: ['bot_name'],
    },
  },
  {
    name: 'set_bot_tools',
    description:
      "Choose which tools of a connected plugin a Bot may use. An empty list turns that plugin off for the Bot.",
    parameters: {
      type: 'object',
      properties: {
        bot_name: { type: 'string', description: 'Name of the Bot' },
        plugin_slug: { type: 'string', description: 'Plugin slug, e.g. "github"' },
        tools: { type: 'string', description: "Comma-separated tool names of that plugin; empty disables the plugin's tools for the Bot" },
      },
      required: ['bot_name', 'plugin_slug', 'tools'],
    },
  },
  {
    name: 'list_plugins',
    description: 'List every plugin in the marketplace, whether the user has connected it, and what connecting it requires.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_plugin_requirements',
    description:
      'Look up what the user must provide in the Plugins screen to connect a plugin. Plugin accounts are connected by the user, not by a Bot.',
    parameters: {
      type: 'object',
      properties: { plugin_slug: { type: 'string', description: 'Plugin slug to inspect, e.g. "jira"' } },
      required: ['plugin_slug'],
    },
  },
  {
    name: 'disconnect_plugin',
    description: "Disconnect a plugin account, removing every Bot's access to its tools.",
    parameters: {
      type: 'object',
      properties: { plugin_slug: { type: 'string', description: 'Plugin slug to disconnect' } },
      required: ['plugin_slug'],
    },
  },
  {
    name: 'get_team',
    description: "Read the user's team: its name, the people on it with their roles, and whether each has linked Slack.",
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'invite_team_member',
    description: 'Add a person who already has a Juttler account to the team, by email.',
    parameters: {
      type: 'object',
      properties: { email: { type: 'string', description: "The person's Juttler account email" } },
      required: ['email'],
    },
  },
  {
    name: 'publish_team_bot',
    description: 'Publish a Team Bot so the whole team can use it.',
    parameters: {
      type: 'object',
      properties: { bot_name: { type: 'string', description: 'Name of the Team Bot' } },
      required: ['bot_name'],
    },
  },
  {
    name: 'create_group_chat',
    description: 'Start a new chat with one or more Bots.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Title of the chat' },
        bot_names: { type: 'string', description: 'Comma-separated names of the Bots in the chat' },
      },
      required: ['title', 'bot_names'],
    },
  },
];

const WORKSPACE_TOOL_NAMES = new Set(WORKSPACE_TOOLS.map((t) => t.name));

export function isWorkspaceTool(toolName: string): boolean {
  return WORKSPACE_TOOL_NAMES.has(toolName);
}

/** Roster summary the Chief can route against. */
export async function describeRoster(userId: string): Promise<{
  bots: Array<{ name: string; roleTitle: string; isChief: boolean; purpose: string; tools: string[] }>;
}> {
  const roster = await listBotsForUser(userId);
  const out: Array<{ name: string; roleTitle: string; isChief: boolean; purpose: string; tools: string[] }> = [];

  for (const bot of roster) {
    out.push({
      name: bot.name,
      roleTitle: bot.roleTitle,
      isChief: isChiefOfStaffBot(bot),
      purpose: oneLine(bot.systemPrompt, 220),
      tools: await enabledToolIds(bot.id),
    });
  }

  return { bots: out };
}

async function enabledToolIds(botId: string): Promise<string[]> {
  const access = await listBotAccess(botId);
  const tools: string[] = [];
  for (const entry of access) {
    for (const enabled of entry.enabledTools) {
      tools.push(resolveTool(registry, enabled)?.id ?? `${entry.pluginSlug}.${enabled}`);
    }
  }
  return tools;
}

/** Every setting of a bot, as the Chief reads it. The API key itself is never returned. */
async function describeBot(bot: Bot) {
  const slackApp = await findSlackAppByBotId(bot.id);
  return {
    name: bot.name,
    role_title: bot.roleTitle,
    system_prompt: bot.systemPrompt,
    avatar: bot.avatar,
    color: bot.color,
    is_chief: isChiefOfStaffBot(bot),
    memory_enabled: bot.memoryEnabled,
    reasoning_mode: bot.reasoningMode,
    ai_provider: bot.aiProvider,
    ai_model:
      bot.aiProvider === 'free_endpoint'
        ? `${AI_PROVIDERS.free_endpoint.model} (tool calls) + ${AI_PROVIDERS.free_endpoint.reasoningModel} (reasoning)`
        : bot.aiModel || null,
    ai_api_key_saved: Boolean(bot.aiApiKey),
    jira_project: bot.jiraProject,
    github_repos: bot.githubRepos,
    tools: await enabledToolIds(bot.id),
    team_bot: bot.isTeamBot,
    published: Boolean(bot.publishedAt),
    slack_app: slackApp?.status ?? 'not_connected',
  };
}

function oneLine(text: string, max: number): string {
  const flat = (text || '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  return String(value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const text = String(value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'on', '1'].includes(text)) return true;
  if (['false', 'no', 'off', '0'].includes(text)) return false;
  return undefined;
}

/**
 * Turns tool arguments into the bot columns they change, validated the same
 * way the bot settings screen validates them. Absent arguments change nothing.
 */
function botSettingsFromArgs(args: Record<string, any>): { updates: Record<string, unknown> } | { error: string } {
  const updates: Record<string, unknown> = {};
  const has = (key: string) => args[key] !== undefined && args[key] !== null;
  const text = (key: string) => String(args[key]).trim();

  for (const [key, field] of [['name', 'name'], ['role_title', 'roleTitle'], ['system_prompt', 'systemPrompt']] as const) {
    if (!has(key)) continue;
    if (!text(key)) return { error: `${key} cannot be empty.` };
    updates[field] = text(key);
  }

  if (has('avatar')) {
    if (!(BOT_AVATAR_SHAPES as readonly string[]).includes(text('avatar'))) {
      return { error: `avatar must be one of: ${BOT_AVATAR_SHAPES.join(', ')}.` };
    }
    updates.avatar = text('avatar');
  }

  if (has('color')) {
    if (!/^#[0-9a-f]{6}$/i.test(text('color'))) return { error: 'color must be a hex colour like #7C3AED.' };
    updates.color = text('color');
  }

  if (has('memory_enabled')) {
    const memory = parseBoolean(args.memory_enabled);
    if (memory === undefined) return { error: 'memory_enabled must be true or false.' };
    updates.memoryEnabled = memory;
  }

  if (has('reasoning_mode')) {
    if (!(REASONING_MODES as readonly string[]).includes(text('reasoning_mode'))) {
      return { error: `reasoning_mode must be one of: ${REASONING_MODES.join(', ')}.` };
    }
    updates.reasoningMode = text('reasoning_mode');
  }

  if (has('ai_provider')) {
    const provider = text('ai_provider');
    if (!AI_PROVIDER_KEYS.includes(provider)) {
      return { error: `ai_provider must be one of: ${AI_PROVIDER_KEYS.join(', ')}.` };
    }
    updates.aiProvider = provider;
    updates.aiEndpoint = AI_PROVIDERS[provider as keyof typeof AI_PROVIDERS].endpoint;
  }

  if (has('ai_model')) updates.aiModel = text('ai_model');
  if (has('ai_api_key') && text('ai_api_key')) updates.aiApiKey = text('ai_api_key');

  try {
    if (has('jira_project') || args.jira_project === null) updates.jiraProject = normalizeProject(args.jira_project);
    if (has('github_repos')) updates.githubRepos = normalizeRepos(parseList(args.github_repos));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }

  return { updates };
}

/** Resolves a bot by name for this user. */
async function resolveBot(userId: string, botName: string): Promise<Bot | null> {
  const wanted = String(botName || '').trim().toLowerCase();
  if (!wanted) return null;
  const roster = await listBotsForUser(userId);
  return roster.find((b) => b.name.toLowerCase() === wanted) || null;
}

async function noSuchBot(userId: string, botName: unknown): Promise<WorkspaceToolResult> {
  const roster = await listBotsForUser(userId);
  return {
    ok: false,
    result: { error: `No Bot named "${String(botName ?? '')}". Bots: ${roster.map((b) => b.name).join(', ')}` },
  };
}

/** Saves bot settings and keeps the bot's Slack app profile in step with them. */
async function saveBot(bot: Bot, updates: Record<string, unknown>): Promise<Bot | null> {
  const updated = await updateBot(bot.id, updates);
  if (updated && (updates.name !== undefined || updates.color !== undefined || updates.roleTitle !== undefined)) {
    void syncSlackProfile(updated).catch((err) => console.error('Slack profile sync failed:', err));
  }
  return updated;
}

/** Executes one workspace tool. */
export async function executeWorkspaceTool(
  toolName: string,
  args: Record<string, any>,
  ctx: { userId: string; botName: string }
): Promise<WorkspaceToolResult> {
  switch (toolName) {
    case 'get_team_roster':
      return { ok: true, result: await describeRoster(ctx.userId) };

    case 'get_bot': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return noSuchBot(ctx.userId, args.bot_name);
      return { ok: true, result: await describeBot(target) };
    }

    case 'create_bot': {
      const settings = botSettingsFromArgs(args);
      if ('error' in settings) return { ok: false, result: { error: settings.error } };
      const { name, roleTitle, ...rest } = settings.updates as { name?: string; roleTitle?: string };
      if (!name || !roleTitle) {
        return { ok: false, result: { error: 'name and role_title are required.' } };
      }
      if (await resolveBot(ctx.userId, name)) {
        return { ok: false, result: { error: `A Bot named "${name}" already exists.` } };
      }

      const teamBot = parseBoolean(args.team_bot) === true;
      let teamId: string | null = null;
      if (teamBot) {
        const owner = await findUserById(ctx.userId);
        teamId = (await ensureOwnedTeam(ctx.userId, owner?.name || 'My')).id;
      }

      const created = await createBot({
        userId: ctx.userId,
        name,
        roleTitle,
        allowedTools: [],
        isChiefOfStaff: false,
        isTeamBot: teamBot,
        teamId,
      });
      const saved = Object.keys(rest).length > 0 ? (await updateBot(created.id, rest)) ?? created : created;

      const wantedTools = parseList(args.tools);
      const granted = await grantToolsForNewBot(ctx.userId, saved.id, wantedTools);

      return {
        ok: true,
        result: {
          created: true,
          bot: await describeBot(saved),
          ...(granted.skipped.length > 0 ? { tools_not_granted: granted.skipped } : {}),
        },
      };
    }

    case 'update_bot': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return noSuchBot(ctx.userId, args.bot_name);

      const settings = botSettingsFromArgs(args);
      if ('error' in settings) return { ok: false, result: { error: settings.error } };
      const updates = settings.updates;

      if (typeof updates.name === 'string' && updates.name.toLowerCase() !== target.name.toLowerCase()) {
        if (await resolveBot(ctx.userId, updates.name)) {
          return { ok: false, result: { error: `A Bot named "${updates.name}" already exists.` } };
        }
      }

      const makeChief = parseBoolean(args.make_chief) === true;
      if (makeChief) {
        if (target.isTeamBot) return { ok: false, result: { error: 'A Team Bot cannot be the Chief.' } };
        await clearChiefOfStaff(ctx.userId, target.id);
        updates.isChiefOfStaff = true;
      }

      if (Object.keys(updates).length === 0) {
        return { ok: false, result: { error: 'No settings to change were given.', settings: Object.keys(BOT_SETTING_PROPERTIES) } };
      }

      const updated = await saveBot(target, updates);
      if (!updated) return { ok: false, result: { error: `"${target.name}" could not be updated.` } };
      return { ok: true, result: { updated: true, bot: await describeBot(updated) } };
    }

    case 'delete_bot': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return noSuchBot(ctx.userId, args.bot_name);
      if (isChiefOfStaffBot(target)) {
        return { ok: false, result: { error: 'The current Chief of Staff cannot be deleted. Another Bot must be made Chief first.' } };
      }

      await deleteBot(target.id);
      return { ok: true, result: { deleted: true, name: target.name } };
    }

    case 'set_bot_tools': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return noSuchBot(ctx.userId, args.bot_name);

      const slug = String(args.plugin_slug || '').trim();
      const installation = await findInstallationByUserAndPlugin(ctx.userId, slug);
      if (!installation) {
        return { ok: false, result: { error: `The "${slug}" plugin is not connected.` } };
      }

      const validIds = listAllTools(registry)
        .filter((t) => t.pluginSlug === slug)
        .map((t) => t.id);

      const canonical: string[] = [];
      const rejected: string[] = [];
      for (const entry of parseList(args.tools)) {
        const record = resolveTool(registry, entry);
        if (!record || record.pluginSlug !== slug) {
          rejected.push(entry);
          continue;
        }
        if (!canonical.includes(record.id)) canonical.push(record.id);
      }

      if (rejected.length > 0) {
        return { ok: false, result: { error: `Not tools of ${slug}: ${rejected.join(', ')}. Valid tools: ${validIds.join(', ')}` } };
      }

      await upsertBotAccess(target.id, installation.id, canonical);
      return {
        ok: true,
        result: {
          updated: true,
          bot: target.name,
          plugin: slug,
          enabledTools: canonical,
        },
      };
    }

    case 'list_plugins': {
      const definitions = await listPluginDefinitions();
      const installations = await listInstallations(ctx.userId);
      const connected = new Map(installations.map((i) => [i.pluginSlug, i]));

      return {
        ok: true,
        result: {
          plugins: definitions.map((d) => ({
            slug: d.slug,
            name: d.name,
            category: d.category,
            toolCount: d.tools.length,
            connected: connected.has(d.slug),
            connects_with: d.authType === 'oauth' ? 'sign-in' : 'credentials',
            needs: (d.requiredCredentials ?? []).map((c: any) => c.label),
          })),
        },
      };
    }

    case 'get_plugin_requirements': {
      const slug = String(args.plugin_slug || '').trim();
      const definition = await findPluginDefinitionBySlug(slug);
      if (!definition) return { ok: false, result: { error: `Unknown plugin "${slug}".` } };

      const installation = await findInstallationByUserAndPlugin(ctx.userId, slug);
      return {
        ok: true,
        result: {
          plugin: definition.name,
          slug,
          alreadyConnected: Boolean(installation),
          connected_by: 'the user, in the Plugins screen',
          connects_with: definition.authType === 'oauth' ? 'sign-in' : 'credentials',
          requiredFields: (definition.requiredCredentials ?? []).map((c: any) => ({
            label: c.label,
            secret: c.secret,
            example: c.placeholder,
          })),
        },
      };
    }

    case 'disconnect_plugin': {
      const slug = String(args.plugin_slug || '').trim();
      const installation = await findInstallationByUserAndPlugin(ctx.userId, slug);
      if (!installation) return { ok: false, result: { error: `"${slug}" is not connected.` } };

      await deleteInstallation(installation.id);
      return { ok: true, result: { disconnected: true, plugin: slug } };
    }

    case 'get_team': {
      const found = await findPrimaryTeam(ctx.userId);
      if (!found) return { ok: true, result: { team: null } };
      const members = await listMembers(found.team.id);
      return {
        ok: true,
        result: {
          team: found.team.name,
          your_role: found.role,
          members: members.map((m) => ({
            name: m.name,
            email: m.email,
            role: m.role,
            slack_linked: Boolean(m.slackUserId),
          })),
        },
      };
    }

    case 'invite_team_member': {
      const email = String(args.email || '').trim();
      if (!email) return { ok: false, result: { error: 'email is required.' } };

      const owner = await findUserById(ctx.userId);
      const found = (await findPrimaryTeam(ctx.userId)) ?? { team: await ensureOwnedTeam(ctx.userId, owner?.name || 'My'), role: 'owner' as const };
      const actor = await findMembership(found.team.id, ctx.userId);
      if (!actor || !canManageTeam(actor.role)) {
        return { ok: false, result: { error: 'Only the team owner or a manager can invite people.' } };
      }

      const user = await findUserByEmail(email);
      if (!user) return { ok: false, result: { error: `No Juttler account uses ${email}. They need an account before they can join.` } };
      if (user.id === ctx.userId) return { ok: false, result: { error: 'That is the user themself.' } };
      if (await findMembership(found.team.id, user.id)) {
        return { ok: false, result: { error: `${user.name} is already on the team.` } };
      }

      await addMember(found.team.id, user.id, 'member');
      return { ok: true, result: { added: true, team: found.team.name, name: user.name, email: user.email, role: 'member' } };
    }

    case 'publish_team_bot': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return noSuchBot(ctx.userId, args.bot_name);
      if (!target.isTeamBot) return { ok: false, result: { error: `"${target.name}" is not a Team Bot.` } };

      const published = await publishTeamBot(target.id);
      if (!published) return { ok: false, result: { error: `"${target.name}" could not be published.` } };
      return { ok: true, result: { published: true, bot: published.name } };
    }

    case 'create_group_chat': {
      const title = String(args.title || '').trim();
      if (!title) return { ok: false, result: { error: 'title is required.' } };

      const roster = await listBotsForUser(ctx.userId);
      const names = parseList(args.bot_names);
      const missing = names.filter((name) => !roster.some((b) => b.name.toLowerCase() === name.toLowerCase()));
      if (names.length === 0 || missing.length > 0) {
        return {
          ok: false,
          result: { error: `${missing.length ? `No Bot named: ${missing.join(', ')}. ` : ''}Bots: ${roster.map((b) => b.name).join(', ')}` },
        };
      }

      const bots = names.map((name) => roster.find((b) => b.name.toLowerCase() === name.toLowerCase())!);
      const conversation = await createConversation({
        userId: ctx.userId,
        title,
        isGroup: bots.length > 1,
        participantBotIds: [...new Set(bots.map((b) => b.id))],
      });
      return { ok: true, result: { created: true, title: conversation.title, bots: bots.map((b) => b.name) } };
    }

    default:
      return { ok: false, result: { error: `Unknown workspace tool "${toolName}".` } };
  }
}

/**
 * Enables the named tools on a freshly created bot where they exist.
 * Names are resolved through the registry, so any spelling the Chief uses
 * (canonical, legacy or bare) grants the same tool.
 */
async function grantToolsForNewBot(
  userId: string,
  botId: string,
  toolNames: string[]
): Promise<{ skipped: Array<{ tool: string; reason: string }> }> {
  const skipped: Array<{ tool: string; reason: string }> = [];
  for (const toolName of toolNames) {
    const record = resolveTool(registry, toolName);
    if (!record) {
      skipped.push({ tool: toolName, reason: 'unknown tool' });
      continue;
    }

    const installation = await findInstallationByUserAndPlugin(userId, record.pluginSlug);
    if (!installation) {
      skipped.push({ tool: toolName, reason: `the ${record.pluginSlug} plugin is not connected` });
      continue;
    }

    const current = await listBotAccess(botId);
    const existing = current.find((a) => a.installationId === installation.id);
    const merged = new Set(existing?.enabledTools ?? []);
    merged.add(record.id);
    await upsertBotAccess(botId, installation.id, [...merged]);
  }
  return { skipped };
}

export { findBotById };
