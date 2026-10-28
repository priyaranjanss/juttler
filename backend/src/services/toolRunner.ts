/**
 * Direct tool execution — runs a plugin tool with no LLM anywhere in the path.
 *
 * The model is only needed to decide which tool to call and to phrase an answer.
 * The action itself is plain backend work: check the plugin is connected, check
 * the bot may use that tool, gate it on approval, then run it with the stored
 * credential. None of that needs the bot to have an AI provider key.
 *
 * This is the path the orchestrator, the Chief of Staff, schedules and any
 * future automation should use when they already know which tool to run. It
 * deliberately reuses the Tool Gateway rather than reimplementing its checks.
 */

import { ApprovalRequest } from '../types';
import { PLUGINS, registry, resolveTool, runTool } from '../plugins';
import {
  getToolPermission,
  findInstallationByUserAndPlugin,
  getInstallationCredential,
  createApprovalRecord,
  recordToolCallLog,
  markInstallationNeedsReauth,
  updateInstallationAccessToken,
  listBotAvailableTools,
} from '../repositories/plugins';
import { findBotById } from '../repositories/bots';
import { assertWorkScope } from './workScope';

export interface DirectToolRequest {
  /** Owner of the connection the tool runs against. */
  userId: string;
  /** Bot the call is attributed to, for permissions and logging. */
  botId: string;
  /** Bot display name, for the approval record. */
  botName: string;
  /**
   * Tool identifier. Any spelling the registry understands works:
   * "slack.list_channels", "slack_list_channels", or "list_channels".
   */
  toolId: string;
  args: Record<string, any>;
  /** Thread the approval request should be posted back into. */
  conversationId?: string;
}

export type DirectToolOutcome =
  | { kind: 'unknown_tool'; toolId: string; available: string[] }
  | { kind: 'not_installed'; pluginSlug: string; toolId: string; pluginName: string; message: string }
  | { kind: 'not_enabled'; toolId: string; pluginSlug: string; pluginName: string; message: string }
  | { kind: 'needs_approval'; approval: ApprovalRequest; toolId: string; pluginSlug: string; pluginName: string }
  | {
      kind: 'result';
      toolId: string;
      pluginSlug: string;
      ok: boolean;
      result: any;
      durationMs: number;
      needsReauth?: boolean;
    };
/**
 * Runs one tool for a bot. No reasoning model is involved, so a bot that has no
 * AI provider key can still act on its connected accounts.
 */
export async function runToolDirectly(req: DirectToolRequest): Promise<DirectToolOutcome> {
  const available = listAvailableToolIds();

  // Resolve first, so an unrecoverable typo gets a list of real tools rather
  // than a generic "not connected" that sends the user looking in the wrong place.
  const record = resolveTool(registry, req.toolId);
  if (!record) return { kind: 'unknown_tool', toolId: req.toolId, available };

  const plugin = PLUGINS.find((p) => p.slug === record.pluginSlug);
  const pluginName = plugin?.name ?? record.pluginSlug;

  const permission = await getToolPermission(req.userId, req.botId, record.id);

  if (!permission.installed) {
    return {
      kind: 'not_installed',
      pluginSlug: record.pluginSlug,
      toolId: record.id,
      pluginName,
      message:
        `The ${pluginName} plugin is not connected for this account. ` +
        `Connect it in the Plugins panel to use ${record.id}.`,
    };
  }

  if (!permission.enabled) {
    return {
      kind: 'not_enabled',
      toolId: record.id,
      pluginSlug: record.pluginSlug,
      pluginName,
      message:
        `The tool ${record.id} is not enabled for this bot. ` +
        `Enable it in bot settings under ${pluginName}.`,
    };
  }

  if (record.pluginSlug === 'github' || record.pluginSlug === 'jira') {
    const bot = await findBotById(req.botId);
    try {
      if (!bot) throw new Error('Bot not found.');
      assertWorkScope(bot, record.pluginSlug, req.args);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'That call is outside this bot\'s work desk.';
      return {
        kind: 'result',
        toolId: record.id,
        pluginSlug: record.pluginSlug,
        ok: false,
        result: { error: message },
        durationMs: 0,
      };
    }
  }

  if (permission.sensitive) {
    const approval = await createApprovalRecord({
      userId: req.userId,
      botId: req.botId,
      botName: req.botName,
      conversationId: req.conversationId,
      toolName: record.id,
      actionName: record.description,
      toolParams: req.args,
      reason: `${req.botName} wants to run ${pluginName} → ${record.id}. Approve to execute it with your connected account.`,
    });
    return { kind: 'needs_approval', approval, toolId: record.id, pluginSlug: record.pluginSlug, pluginName };
  }

  const outcome = await executeAllowedTool(req, record.id, record.pluginSlug);

  const base = {
    kind: 'result' as const,
    toolId: record.id,
    pluginSlug: record.pluginSlug,
    ok: outcome.ok,
    result: outcome.result,
    durationMs: outcome.durationMs,
  };
  return outcome.needsReauth ? { ...base, needsReauth: true } : base;
}

/** Executes a tool the user approved, or one that never needed approval. */
async function executeAllowedTool(
  req: DirectToolRequest,
  canonicalId: string,
  pluginSlug: string
): Promise<{ ok: boolean; result: any; durationMs: number; needsReauth?: boolean }> {
  const installation = await findInstallationByUserAndPlugin(req.userId, pluginSlug);
  if (!installation) {
    return {
      ok: false,
      result: { error: `The ${pluginSlug} plugin is not connected for this account.` },
      durationMs: 0,
    };
  }

  const credential = await getInstallationCredential(installation.id);
  const metadata = installation.metadata || {};

  const outcome = await runTool(canonicalId, req.args, {
    credential,
    metadata,
    refreshAccessToken: (token, refreshToken) =>
      updateInstallationAccessToken(installation.id, token, credential, refreshToken),
  });

  if (!outcome.ok && outcome.authFailed) {
    await markInstallationNeedsReauth(installation.id);
  }

  await recordToolCallLog({
    userId: req.userId,
    botId: req.botId,
    botName: req.botName,
    toolName: canonicalId,
    inputArgs: req.args,
    outputResult: outcome.result,
    status: outcome.ok ? 'success' : 'failed',
    durationMs: outcome.durationMs,
  });

  return {
    ok: outcome.ok,
    result: outcome.result,
    durationMs: outcome.durationMs,
    needsReauth: Boolean(!outcome.ok && outcome.authFailed),
  };
}

/** Every canonical tool id in the system, for discovery and error messages. */
export function listAvailableToolIds(): string[] {
  return [...registry.tools.keys()];
}

/** Canonical ids a specific bot may actually call right now. */
export async function listEnabledToolsForBot(userId: string, botId: string): Promise<string[]> {
  const available = await listBotAvailableTools(userId, botId);
  return available.map((t) => t.toolId);
}
