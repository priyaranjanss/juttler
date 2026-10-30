/**
 * Runs a bot turn end-to-end: collects the tools that bot may call, exposes
 * delegation to specialists when the bot is the Chief of Staff, and streams the
 * real tool activity back so the chat can render it.
 *
 * This is the single place describing how a bot "thinks", so the top-level
 * chat route and a delegated specialist turn behave identically.
 */

import { Bot, Message } from '../types';
import { listBotsForUser, findBotById } from '../repositories/bots';
import { listBotAvailableTools, listPluginDefinitions, listInstallations } from '../repositories/plugins';
import { PLUGINS } from '../plugins';
import { runBotTurn, BotToolSpec, ToolEvent, ToolExecution } from './aiService';
import { callTool, executeApprovedTool } from './pluginGateway';
import { buildChiefSystemPrompt, isChiefOfStaffBot, RosterEntry, WorkspaceService } from '../config/chiefOfStaff';
import { WORKSPACE_TOOLS, isWorkspaceTool, executeWorkspaceTool } from '../plugins/workspace';
import { describeWorkDesk } from './workScope';
import { findSlackAppByBotId } from '../repositories/slackApps';

export const DELEGATE_TOOL = 'delegate_to_bot';

/** How deep delegation may nest. Chief (0) -> specialist (1) ... */
const MAX_DELEGATION_DEPTH = 2;

// Only the Chief of Staff manages the workspace; a specialist doing it would
// bypass the single-front-door rule.
function chiefPolicy(agent: Bot): { canDelegate: boolean; canManage: boolean } {
  const isChief = isChiefOfStaffBot(agent);
  return { canDelegate: isChief, canManage: isChief };
}

/** Every plugin with its connection status, so the Chief never has to look it up. */
async function describeServices(userId: string): Promise<WorkspaceService[]> {
  const installations = await listInstallations(userId);
  const connected = new Set(
    installations.filter((installation) => installation.status === 'connected').map((i) => i.pluginSlug)
  );

  return PLUGINS.map((p) => ({
    name: p.name,
    slug: p.slug,
    connected: connected.has(p.slug),
    toolCount: p.tools.length,
    needs: connected.has(p.slug) ? [] : p.requiredCredentials.map((c) => c.label),
  }));
}

async function describeServiceAccess(userId: string, tools: BotToolSpec[]): Promise<string> {
  const installations = await listInstallations(userId);
  const byPlugin = new Map(installations.map((installation) => [installation.pluginSlug, installation]));

  const lines = PLUGINS.map((plugin) => {
    const installation = byPlugin.get(plugin.slug);
    const enabledTools = tools
      .filter((tool) => tool.name.startsWith(`${plugin.slug}.`))
      .map((tool) => tool.name);
    const status = installation?.status ?? 'not connected';
    const toolAccess = enabledTools.length > 0
      ? enabledTools.join(', ')
      : 'no tools enabled for this bot';
    return `- ${plugin.name} (${plugin.slug}): installation ${status}; tools available to this bot: ${toolAccess}`;
  });

  return [
    "Current space service context (connection state and this bot's enabled tools):",
    ...lines,
  ].join('\n');
}

/** Tool access per bot, keyed by bot id, as canonical "plugin.tool" ids. */
async function describeToolAccess(roster: Bot[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const b of roster) {
    const available = await listBotAvailableTools(b.userId, b.id);
    map.set(b.id, available.map((t) => t.toolId));
  }
  return map;
}

export interface TurnRun {
  text?: string;
  error?: { kind: string; message: string };
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  tools: ToolEvent[];
  waitingForApproval: boolean;
}

export interface RunTurnOptions {
  userId: string;
  bot: Bot;
  userName: string;
  messageContent: string;
  history?: Message[];
  /** Current nesting depth; the chief starts at 0. */
  depth?: number;
  /** Thread the approval result should be posted back into. */
  conversationId?: string;
  /** Extra system instructions for this turn only. */
  systemAddendum?: string;
  /** Grok-style reasoning mode for this turn. */
  reasoningMode?: 'think' | 'big_brain' | 'off';
}

/**
 * Tools a bot is allowed to call, as model-facing specs.
 *
 * Names are the registry's canonical "plugin.tool" ids, and every plugin's real
 * parameter schema is passed through so the model can fill the arguments in
 * instead of guessing at them.
 */
async function toolSpecsFor(userId: string, botId: string): Promise<BotToolSpec[]> {
  const available = await listBotAvailableTools(userId, botId);
  return available.map((t) => ({
    name: t.toolId,
    description: `${t.description} (provided by the ${t.pluginSlug} plugin)`,
    parameters: t.parameters ?? { type: 'object', properties: {} },
  }));
}

/** Human-readable summary shown on the approval card. */
export function describeWorkspaceTool(toolName: string, args: Record<string, any>): string {
  const text = (key: string) => String(args[key] || '').trim();
  switch (toolName) {
    case 'get_bot':
      return `read the settings of "${text('bot_name')}"`;
    case 'create_bot':
      return `create a new Bot called "${text('name')}"`;
    case 'update_bot':
      return `update the Bot "${text('bot_name')}"`;
    case 'delete_bot':
      return `delete the Bot "${text('bot_name')}"`;
    case 'set_bot_tools':
      return `set which tools "${text('bot_name')}" may use`;
    case 'disconnect_plugin':
      return `disconnect the "${text('plugin_slug')}" plugin`;
    case 'invite_team_member':
      return `invite ${text('email')} to the team`;
    case 'publish_team_bot':
      return `publish "${text('bot_name')}" to the team`;
    case 'create_group_chat':
      return `start the chat "${text('title')}"`;
    default:
      return toolName;
  }
}

/** Runs one turn for a bot, with plugins and (when allowed) delegation. */
export async function runBotTurnWithTools(options: RunTurnOptions): Promise<TurnRun> {
  const { userId, bot, userName, messageContent } = options;
  const depth = options.depth ?? 0;
  const history = options.history ?? [];
  const conversationId = options.conversationId;

  const roster = await listBotsForUser(userId);
  const specialists = roster.filter((b) => b.id !== bot.id);
  const toolSpecs = await toolSpecsFor(userId, bot.id);

  // "plugin.tool" each roster member may actually call, for the Chief's prompt.
  const toolNamesByBot = await describeToolAccess(roster);

  // The Chief of Staff may hand work to specialists (but never recursively
  // forever, and never from inside a specialist's own turn).
  const policy = chiefPolicy(bot);
  const canDelegate = policy.canDelegate && specialists.length > 0 && depth < MAX_DELEGATION_DEPTH;
  if (canDelegate) {
    toolSpecs.push({
      name: DELEGATE_TOOL,
      description:
        'Assign a subtask to one of your specialist Bots and get its answer back.',
      parameters: {
        type: 'object',
        properties: {
          bot_name: { type: 'string', description: 'Name of the specialist Bot, exactly as listed' },
          brief: { type: 'string', description: 'A self-contained brief: goal, context, and what to return' },
        },
        required: ['bot_name', 'brief'],
      },
    });
  }

  // Workspace management only for the top-level Chief, so a specialist's turn
  // can't quietly reconfigure the account.
  if (policy.canManage) {
    for (const tool of WORKSPACE_TOOLS) {
      toolSpecs.push({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      });
    }
  }

  const systemPrompt = isChiefOfStaffBot(bot)
    ? buildChiefSystemPrompt(
        userName,
        roster.map<RosterEntry>((b) => ({
          name: b.name,
          roleTitle: b.roleTitle,
          systemPrompt: b.systemPrompt,
          allowedTools: b.allowedTools,
          isChief: b.id === bot.id || isChiefOfStaffBot(b),
          tools: toolNamesByBot.get(b.id) ?? [],
        })),
        await describeServices(userId),
        bot.systemPrompt
      )
    : undefined;

  const executor = async (toolName: string, args: Record<string, any>): Promise<ToolExecution> => {
    // --- Workspace management (Chief only) ---
    // These run immediately: the user asked the Chief to do this work, so
    // making them re-approve every step would defeat the point.
    if (policy.canManage && isWorkspaceTool(toolName)) {
      const outcome = await executeWorkspaceTool(toolName, args, { userId, botName: bot.name });
      return {
        kind: 'result',
        ok: outcome.ok,
        result: outcome.result,
      };
    }

    // --- Delegation to a specialist sub-agent ---
    if (toolName === DELEGATE_TOOL) {
      const wanted = String(args.bot_name || '').trim();
      const brief = String(args.brief || '').trim();

      if (!brief) {
        return { kind: 'result', ok: false, result: { error: 'A brief is required to delegate work.' } };
      }

      const specialist = specialists.find((b) => b.name.toLowerCase() === wanted.toLowerCase());
      if (!specialist) {
        return {
          kind: 'result',
          ok: false,
          result: {
            error: `No specialist named "${wanted}". Your team: ${specialists.map((b) => b.name).join(', ')}`,
          },
        };
      }

      // A specialist gets a fresh, self-contained brief rather than the whole
      // thread, and may not delegate further (depth guard).
      const sub = await runBotTurnWithTools({
        userId,
        bot: specialist,
        userName,
        messageContent: brief,
        history: [],
        depth: depth + 1,
        conversationId,
      });

      if (sub.error) {
        return {
          kind: 'result',
          ok: false,
          result: {
            from: specialist.name,
            error_kind: sub.error.kind,
            error: `${specialist.name} could not complete this: ${sub.error.message}`,
            tools_run: sub.tools.map((tool) => ({ tool: tool.toolName, status: tool.status })),
          },
        };
      }

      if (sub.waitingForApproval) {
        const pending = sub.tools.find((tool) => tool.status === 'needs_approval');
        return {
          kind: 'result',
          ok: true,
          result: {
            from: specialist.name,
            status: 'waiting_for_user_approval',
            pending_action: pending?.actionName ?? pending?.toolName ?? null,
          },
        };
      }

      return {
        kind: 'result',
        ok: true,
        result: {
          from: specialist.name,
          answer: sub.text,
        },
      };
    }

    // --- Normal plugin tools, through the gateway ---
    const outcome = await callTool({
      userId,
      botId: bot.id,
      botName: bot.name,
      conversationId,
      toolName,
      args,
    });

    if (outcome.kind === 'approved') {
      return {
        kind: 'approval' as const,
        approvalId: outcome.approval.id,
        actionName: outcome.approval.actionName,
        reason: outcome.approval.reason || 'Approval required',
      };
    }
    if (outcome.kind === 'not_installed') {
      return { kind: 'missing' as const, pluginSlug: outcome.pluginSlug, toolName };
    }
    if (outcome.kind === 'not_enabled') {
      return { kind: 'disabled' as const, toolName, pluginSlug: outcome.pluginSlug };
    }
    return {
      kind: 'result' as const,
      ok: outcome.ok,
      result: outcome.result,
      durationMs: outcome.durationMs,
    };
  };

  const slackApp = await findSlackAppByBotId(bot.id);
  const serviceAccess = await describeServiceAccess(userId, toolSpecs);
  const slackInstall = slackApp?.status === 'connected' && !toolSpecs.some((tool) => tool.name.startsWith('slack.'))
    ? `This bot is installed in Slack as itself (@${bot.name}).`
    : '';

  const turn = await runBotTurn({
    bot,
    userName,
    history,
    messageContent,
    tools: toolSpecs,
    executor,
    overrideSystemPrompt: systemPrompt,
    systemAddendum: [
      options.systemAddendum,
      describeWorkDesk(bot),
      serviceAccess,
      slackInstall,
    ]
      .filter(Boolean)
      .join('\n\n'),
    reasoningMode: options.reasoningMode,
  });

  return {
    text: turn.text,
    error: turn.error,
    tokenUsage: turn.tokenUsage,
    tools: turn.tools,
    waitingForApproval: turn.waitingForApproval,
  };
}

/** Executes an approved tool for a bot, used by the approval resolve route. */
export async function runApprovedToolForBot(userId: string, botId: string, toolName: string, args: Record<string, any>) {
  const bot = await findBotById(botId);
  if (!bot) return null;
  return executeApprovedTool({ userId, botId, botName: bot.name, toolName, args });
}
