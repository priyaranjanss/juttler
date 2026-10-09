/**
 * Workspace tools â€” the actions a user can take that the Chief of Staff can
 * take on their behalf.
 *
 * These are the management surface (bots, plugins, per-bot tool access) rather
 * than the plugins' own actions. The Chief looks up what a plugin needs via
 * get_plugin_requirements instead of being told, so nothing about a provider's
 * prerequisites is hardcoded in the bot's instructions.
 *
 * Anything that changes workspace state runs immediately when the Chief asks
 * for it. The approval gate still applies to a plugin's own sensitive tools
 * (merging a PR, posting to Slack), because those leave the system.
 */

import { Bot } from '../types';
import { BOT_AVATAR_SHAPES, BOT_AVATAR_COLORS } from '../constants';
import {
  listBotsForUser,
  createBot,
  updateBot,
  deleteBot,
  findBotById,
} from '../repositories/bots';
import {
  listPluginDefinitions,
  findPluginDefinitionBySlug,
  findInstallationByUserAndPlugin,
  listInstallations,
  createInstallation,
  deleteInstallation,
  listBotAccess,
  upsertBotAccess,
  grantPluginToBot,
} from '../repositories/plugins';
import { isChiefOfStaffBot } from '../config/chiefOfStaff';

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

/** Every workspace tool, keyed by name. */
export const WORKSPACE_TOOLS: WorkspaceToolSpec[] = [
  {
    name: 'get_team_roster',
    description:
      'List every specialist Bot this user owns with its role, purpose, and which plugin tools it may use. Use this before delegating or creating a new Bot.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_bot',
      description:
        'Create a new specialist Bot for the user. Derive a good name, role, and system prompt from the request and your knowledge of the team. Do not interrogate the user for these — make sensible choices and say what you picked.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short display name, e.g. "Atlas"' },
        role_title: { type: 'string', description: 'What this Bot is, e.g. "Research Lead"' },
        system_prompt: { type: 'string', description: 'Instructions describing how the Bot should behave' },
        avatar: { type: 'string', description: 'Avatar shape', enum: [...BOT_AVATAR_SHAPES] },
        color: { type: 'string', description: 'Avatar colour (hex)', enum: [...BOT_AVATAR_COLORS] },
        tools: {
          type: 'string',
          description: 'Plugin tool names this Bot may use, comma separated. Leave empty for none.',
        },
      },
      required: ['name', 'role_title', 'system_prompt'],
    },
  },
  {
    name: 'update_bot',
    description: 'Change an existing Bot: its name, role, instructions, avatar, or colour.',
    parameters: {
      type: 'object',
      properties: {
        bot_name: { type: 'string', description: 'Current name of the Bot to change' },
        name: { type: 'string', description: 'New name' },
        role_title: { type: 'string', description: 'New role / title' },
        system_prompt: { type: 'string', description: 'New instructions' },
        avatar: { type: 'string', description: 'New avatar shape', enum: [...BOT_AVATAR_SHAPES] },
        color: { type: 'string', description: 'New avatar colour', enum: [...BOT_AVATAR_COLORS] },
      },
      required: ['bot_name'],
    },
  },
  {
    name: 'delete_bot',
    description: 'Remove one of the user\'s specialist Bots. Never use this on the Chief of Staff.',
    parameters: {
      type: 'object',
      properties: { bot_name: { type: 'string', description: 'Name of the Bot to delete' } },
      required: ['bot_name'],
    },
  },
  {
    name: 'set_bot_tools',
    description:
      'Choose which plugin tools a specific Bot is allowed to use. The plugin must already be connected, and the tools must belong to that plugin.',
    parameters: {
      type: 'object',
      properties: {
        bot_name: { type: 'string', description: 'Name of the Bot' },
        plugin_slug: { type: 'string', description: 'Plugin slug, e.g. "github"' },
        tools: {
          type: 'string',
          description: 'Comma-separated tool names to enable. An empty string disables all of that plugin\'s tools for the Bot.',
        },
      },
      required: ['bot_name', 'plugin_slug', 'tools'],
    },
  },
  {
    name: 'list_plugins',
    description:
      'List every plugin in the marketplace, whether each is connected, and how many tools it offers. Use this before suggesting a connection.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_plugin_requirements',
    description:
      'Look up exactly what a plugin needs before it can be connected (for example a site, an email, and a token). Call this before asking the user for credentials so you request the right things.',
    parameters: {
      type: 'object',
      properties: { plugin_slug: { type: 'string', description: 'Plugin slug to inspect, e.g. "jira"' } },
      required: ['plugin_slug'],
    },
  },
  {
    name: 'connect_plugin',
    description:
      'Connect a plugin for the user, once you have collected every field that get_plugin_requirements reported. Values are stored encrypted and never shown again.',
    parameters: {
      type: 'object',
      properties: {
        plugin_slug: { type: 'string', description: 'Plugin slug to connect' },
        credentials: {
          type: 'string',
          description:
            'JSON object of the fields returned by get_plugin_requirements, e.g. {"site":"acme","email":"a@b.com","apiToken":"..."}',
        },
      },
      required: ['plugin_slug', 'credentials'],
    },
  },
  {
    name: 'disconnect_plugin',
    description: 'Disconnect a plugin the user no longer wants, removing every Bot\'s access to its tools.',
    parameters: {
      type: 'object',
      properties: { plugin_slug: { type: 'string', description: 'Plugin slug to disconnect' } },
      required: ['plugin_slug'],
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
    const access = await listBotAccess(bot.id);
    const tools: string[] = [];
    for (const entry of access) {
      const definitions = await listPluginDefinitions();
      const def = definitions.find((d) => d.slug === entry.pluginSlug);
      for (const enabled of entry.enabledTools) {
        tools.push(def ? `${entry.pluginSlug}.${enabled}` : enabled);
      }
    }

    out.push({
      name: bot.name,
      roleTitle: bot.roleTitle,
      isChief: isChiefOfStaffBot(bot),
      purpose: oneLine(bot.systemPrompt, 220),
      tools,
    });
  }

  return { bots: out };
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

/** Resolves a bot by name for this user. */
async function resolveBot(userId: string, botName: string): Promise<Bot | null> {
  const wanted = String(botName || '').trim().toLowerCase();
  if (!wanted) return null;
  const roster = await listBotsForUser(userId);
  return roster.find((b) => b.name.toLowerCase() === wanted) || null;
}

/** Executes one workspace tool. Read-only tools run immediately. */
export async function executeWorkspaceTool(
  toolName: string,
  args: Record<string, any>,
  ctx: { userId: string; botName: string }
): Promise<WorkspaceToolResult> {
  switch (toolName) {
    case 'get_team_roster':
      return { ok: true, result: await describeRoster(ctx.userId) };

    case 'create_bot': {
      const name = String(args.name || '').trim();
      const roleTitle = String(args.role_title || '').trim();
      const systemPrompt = String(args.system_prompt || '').trim();

      if (!name || !roleTitle || !systemPrompt) {
        return { ok: false, result: { error: 'name, role_title and system_prompt are all required.' } };
      }

      if (await resolveBot(ctx.userId, name)) {
        return { ok: false, result: { error: `A Bot named "${name}" already exists.` } };
      }

      // A new Bot starts with no tools; the user grants them afterwards with
      // set_bot_tools so nothing is enabled by surprise.
      const created = await createBot({
        userId: ctx.userId,
        name,
        roleTitle,
        systemPrompt,
        avatar: String(args.avatar || 'blob'),
        color: String(args.color || '#6366f1'),
        allowedTools: [],
        isChiefOfStaff: false,
      });

      // If the Chief named tools, grant them straight away where they exist
      const wantedTools = parseList(args.tools);
      if (wantedTools.length > 0) {
        await grantToolsForNewBot(ctx.userId, created.id, wantedTools);
      }

      return {
        ok: true,
        result: {
          created: true,
          bot: { name: created.name, roleTitle: created.roleTitle, id: created.id },
          tools: wantedTools,
          note: 'The Bot has no AI provider key yet. Ask the user to set its API key and model in bot settings before it can answer.',
        },
      };
    }

    case 'update_bot': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return { ok: false, result: { error: `No Bot named "${args.bot_name}".` } };

      if (isChiefOfStaffBot(target) && (args.name || args.role_title || args.system_prompt)) {
        // Renaming the front door would break routing, so only cosmetics move
        const updated = await updateBot(target.id, {
          ...(args.avatar ? { avatar: String(args.avatar) } : {}),
          ...(args.color ? { color: String(args.color) } : {}),
        });
        return {
          ok: true,
          result: {
            updated: true,
            name: updated?.name,
            note: 'The Chief of Staff keeps its identity; only its appearance changed.',
          },
        };
      }

      const updated = await updateBot(target.id, {
        ...(args.name ? { name: String(args.name).trim() } : {}),
        ...(args.role_title ? { roleTitle: String(args.role_title).trim() } : {}),
        ...(args.system_prompt ? { systemPrompt: String(args.system_prompt).trim() } : {}),
        ...(args.avatar ? { avatar: String(args.avatar) } : {}),
        ...(args.color ? { color: String(args.color) } : {}),
      });

      return { ok: true, result: { updated: true, name: updated?.name, roleTitle: updated?.roleTitle } };
    }

    case 'delete_bot': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return { ok: false, result: { error: `No Bot named "${args.bot_name}".` } };
      if (isChiefOfStaffBot(target)) {
        return { ok: false, result: { error: 'The Chief of Staff cannot be deleted â€” it is the workspace front door.' } };
      }

      const removed = target.name;
      await deleteBot(target.id);
      return { ok: true, result: { deleted: true, name: removed } };
    }

    case 'set_bot_tools': {
      const target = await resolveBot(ctx.userId, args.bot_name);
      if (!target) return { ok: false, result: { error: `No Bot named "${args.bot_name}".` } };

      const slug = String(args.plugin_slug || '').trim();
      const installation = await findInstallationByUserAndPlugin(ctx.userId, slug);
      if (!installation) {
        return { ok: false, result: { error: `The "${slug}" plugin is not connected. Connect it first.` } };
      }

      const definition = await findPluginDefinitionBySlug(slug);
      const known = new Set((definition?.tools ?? []).map((t: any) => t.name));
      const wanted = parseList(args.tools);
      const invalid = wanted.filter((t) => !known.has(t));
      if (invalid.length > 0) {
        return { ok: false, result: { error: `Not tools of ${slug}: ${invalid.join(', ')}` } };
      }

      await upsertBotAccess(target.id, installation.id, wanted);
      return {
        ok: true,
        result: {
          updated: true,
          bot: target.name,
          plugin: slug,
          enabledTools: wanted,
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
          requiredFields: (definition.requiredCredentials ?? []).map((c: any) => ({
            field: c.key,
            ask_user_for: c.label,
            secret: c.secret,
            example: c.placeholder,
          })),
          // Credentials are the one thing a bot genuinely cannot supply itself,
          // so collecting these is a legitimate reason to talk to the user.
          instruction:
            'These credentials cannot be guessed — ask the user for each field above, then call connect_plugin with those values. Everything else you should decide yourself.',
        },
      };
    }

    case 'connect_plugin': {
      const slug = String(args.plugin_slug || '').trim();
      const definition = await findPluginDefinitionBySlug(slug);
      if (!definition) return { ok: false, result: { error: `Unknown plugin "${slug}".` } };

      let credential: Record<string, any> = {};
      try {
        credential = typeof args.credentials === 'string' ? JSON.parse(args.credentials) : args.credentials || {};
      } catch {
        return { ok: false, result: { error: 'credentials must be a JSON object.' } };
      }

      // Validate against what the plugin says it needs, rather than a hardcoded list
      const specs = definition.requiredCredentials ?? [];
      const missing = specs.filter((s: any) => !String(credential[s.key] ?? '').trim());
      if (missing.length > 0) {
        return {
          ok: false,
          result: {
            error: `Missing required field(s): ${missing.map((m: any) => m.label).join(', ')}`,
            requiredFields: specs.map((s: any) => ({ field: s.key, ask_user_for: s.label })),
          },
        };
      }

      const installation = await createInstallation({
        userId: ctx.userId,
        pluginId: definition.id,
        credential,
        metadata: slug === 'jira' ? { site: String(credential.site || '') } : {},
      });

      // Account-wide: give the new capability to the user's bots (safe tools on)
      for (const bot of await listBotsForUser(ctx.userId)) {
        await grantPluginToBot(bot.id, installation.id, definition.id);
      }

      return {
        ok: true,
        result: {
          connected: true,
          plugin: definition.name,
          toolCount: definition.tools.length,
          note: 'Sensitive tools stay off until the user enables them per Bot.',
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

    default:
      return { ok: false, result: { error: `Unknown workspace tool "${toolName}".` } };
  }
}

/** Enables the named tools on a freshly created bot where they exist. */
async function grantToolsForNewBot(userId: string, botId: string, toolNames: string[]): Promise<void> {
  for (const toolName of toolNames) {
    const installation = await installationForTool(userId, toolName);
    if (!installation) continue;

    const current = await listBotAccess(botId);
    const existing = current.find((a) => a.installationId === installation.id);
    const merged = new Set(existing?.enabledTools ?? []);
    merged.add(toolName);
    await upsertBotAccess(botId, installation.id, [...merged]);
  }
}

async function installationForTool(userId: string, toolName: string) {
  const installations = await listInstallations(userId);
  const definitions = await listPluginDefinitions();
  const owner = definitions.find((d) => (d.tools ?? []).some((t: any) => t.name === toolName));
  if (!owner) return null;
  return installations.find((i) => i.pluginSlug === owner.slug) || null;
}

export { findBotById };
