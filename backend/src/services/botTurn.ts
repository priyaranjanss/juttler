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
import { WORKSPACE_TOOLS, isWorkspaceTool, executeWorkspaceTool } from './workspaceTools';
import { describeWorkDesk } from './workScope';
import { resolveThreadIssueKeys } from './issueKeys';
import { findSlackAppByBotId } from '../repositories/slackApps';

/** Turn free-text ticket mentions into concrete tool instructions (no ticket hardcoding). */
function ticketWorkHint(
  messageContent: string,
  history: Message[],
  preferredProject: string | null
): { hint: string; keys: string[] } {
  const recentUser = history
    .filter((m) => m.type === 'text' && m.senderType === 'user')
    .slice(-8)
    .map((m) => m.content);
  const keys = resolveThreadIssueKeys({
    preferredProject,
    message: messageContent,
    historyTexts: recentUser,
  });
  if (keys.length === 0) return { hint: '', keys: [] };
  return {
    keys,
    hint: [
      `Issue key(s) in this thread: ${keys.join(', ')}.`,
      `Call jira.get_ticket with issue_key=${keys[0]} (aliases key/issue/ticket are fine; bare numbers use the preferred project).`,
      `Short follow-ups like "continue", "do it", or just "9" still refer to that key — resolve from this thread, do not ask again.`,
      `Read the description, then implement with GitHub tools (search_code → get_file → edit_file → create_pull_request).`,
      `Do not ask whether to proceed — finish the work, then summarize with the PR URL or blocker.`,
    ].join(' '),
  };
}

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
          isChief: b.id === bot.id || isChiefOfStaffBot(b),
          tools: toolNamesByBot.get(b.id) ?? [],
        })),
        await describeServices(userId)
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
        // Tell the delegating bot to answer the user itself rather than retry
        // the hand-off, which is what causes a stalled multi-round loop.
        const isMissingLlm = sub.error.kind === 'not_configured';
        return {
          kind: 'result',
          ok: false,
          result: {
            from: specialist.name,
            error: `${specialist.name} could not complete this: ${sub.error.message}`,
            // A specialist with no LLM is not a dead end for the delegating
            // bot: if the Chief holds the tools itself it should use them
            // rather than reporting a blocker the user has to go and fix.
            next_step: isMissingLlm
              ? `${specialist.name} has no LLM configured to reason with. If you have a tool of your own that does this work, call it directly now instead of delegating again. Only if you have no such tool, tell the user exactly which setting to change and stop.`
              : 'Do not delegate this again. Answer the user with what you know, and say plainly that this part could not be completed and why.',
          },
        };
      }

      if (sub.waitingForApproval) {
        // The specialist is parked on an approval card. Do not report a void
        // answer - tell the delegating bot the work is paused.
        return {
          kind: 'result',
          ok: true,
          result: {
            from: specialist.name,
            answer: `${specialist.name} paused to request the user's approval before finishing this.`,
            status: 'waiting_for_user_approval',
            next_step: 'Stop here. Tell the user the work is waiting on their approval and what it is waiting for.',
          },
        };
      }

      return {
        kind: 'result',
        ok: true,
        result: {
          from: specialist.name,
          answer: sub.text,
          // Nudge the delegating bot to wrap up with this result.
          next_step: 'Use the result above to answer the user now. Do not delegate the same work again.',
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

  const accounts = new Set(
    toolSpecs
      .map((tool) => (tool.name.includes('.') ? tool.name.slice(0, tool.name.indexOf('.')) : ''))
      .filter(Boolean)
  );
  const slackApp = await findSlackAppByBotId(bot.id);
  const accountLine = accounts.size > 0
    ? `Accounts this bot can use right now: ${[...accounts].join(', ')}. Use them for whatever was asked. Do not say one of these is disconnected.`
    : 'No plugin tools are enabled for this bot on this turn. Do not invent live account data.';
  const slackInstall = slackApp?.status === 'connected' && !accounts.has('slack')
    ? `This bot is installed in Slack as itself (@${bot.name}).`
    : '';

  const ticket = ticketWorkHint(messageContent, history, bot.jiraProject);
  const turn = await runBotTurn({
    bot,
    userName,
    history,
    messageContent,
    tools: toolSpecs,
    executor,
    overrideSystemPrompt: systemPrompt,
    contextIssueKeys: ticket.keys,
    systemAddendum: [
      options.systemAddendum,
      describeWorkDesk(bot),
      accountLine,
      slackInstall,
      ticket.hint,
    ]
      .filter(Boolean)
      .join('\n\n'),
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
