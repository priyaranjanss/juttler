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
import { listBotAvailableTools } from '../repositories/plugins';
import { runBotTurn, BotToolSpec, ToolEvent, ToolExecution } from './aiService';
import { callTool, executeApprovedTool } from './pluginGateway';
import { buildChiefSystemPrompt, isChiefOfStaffBot, RosterEntry } from '../config/chiefOfStaff';
import { WORKSPACE_TOOLS, isWorkspaceTool, executeWorkspaceTool } from './workspaceTools';

export const DELEGATE_TOOL = 'delegate_to_bot';

/** How deep delegation may nest. Chief (0) -> specialist (1) ... */
const MAX_DELEGATION_DEPTH = 2;

// Only the Chief of Staff manages the workspace; a specialist doing it would
// bypass the single-front-door rule.
function chiefPolicy(agent: Bot): { canDelegate: boolean; canManage: boolean } {
  const isChief = isChiefOfStaffBot(agent);
  return { canDelegate: isChief, canManage: isChief };
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
}

/** Tools a bot is allowed to call, as model-facing specs. */
async function toolSpecsFor(userId: string, botId: string): Promise<BotToolSpec[]> {
  const available = await listBotAvailableTools(userId, botId);
  return available.map((t) => ({
    name: t.toolName,
    description: `${t.description} (plugin: ${t.pluginSlug})`,
    parameters: { type: 'object', properties: {} },
  }));
}

/** Human-readable summary shown on the approval card. */
export function describeWorkspaceTool(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'create_bot':
      return `create a new Bot called "${String(args.name || '').trim()}"`;
    case 'update_bot':
      return `update the Bot "${String(args.bot_name || '').trim()}"`;
    case 'delete_bot':
      return `delete the Bot "${String(args.bot_name || '').trim()}"`;
    case 'set_bot_tools':
      return `set which tools "${String(args.bot_name || '').trim()}" may use`;
    case 'connect_plugin':
      return `connect the "${String(args.plugin_slug || '').trim()}" plugin`;
    case 'disconnect_plugin':
      return `disconnect the "${String(args.plugin_slug || '').trim()}" plugin`;
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

  // The Chief of Staff may hand work to specialists (but never recursively
  // forever, and never from inside a specialist's own turn).
  const policy = chiefPolicy(bot);
  const canDelegate = policy.canDelegate && specialists.length > 0 && depth < MAX_DELEGATION_DEPTH;
  if (canDelegate) {
    toolSpecs.push({
      name: DELEGATE_TOOL,
      description:
        'Assign a subtask to one of your specialist Bots and get its answer back. Use the exact bot name from your team roster.',
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
        }))
      )
    : undefined;

  const executor = async (toolName: string, args: Record<string, any>): Promise<ToolExecution> => {
    // --- Workspace management (Chief only) ---
    // These run immediately: the user asked the Chief to do this work, so
    // making them re-approve every step would defeat the point.
    if (isWorkspaceTool(toolName)) {
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
          result: { from: specialist.name, error: `${specialist.name} could not answer: ${sub.error.message}` },
        };
      }

      return {
        kind: 'result',
        ok: true,
        result: { from: specialist.name, answer: sub.text },
      };
    }

    // --- Normal plugin tools, through the gateway ---
    const outcome = await callTool({
      userId,
      botId: bot.id,
      botName: bot.name,
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

  const turn = await runBotTurn({
    bot,
    userName,
    history,
    messageContent,
    tools: toolSpecs,
    executor,
    overrideSystemPrompt: systemPrompt,
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
