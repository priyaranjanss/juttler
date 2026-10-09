/**
 * The Tool Gateway â€” the single path every bot tool call goes through.
 *
 * Order of checks:
 *   1. Is the plugin connected for this user?
 *   2. Is the tool enabled for this specific bot?
 *   3. Is the tool sensitive? -> require human approval before executing
 *   4. Execute with the stored credential (tokens never leave the backend)
 *   5. Record a real tool-call log row
 *
 * There are no simulated outcomes: a failure returns the real error.
 */

import { ApprovalRequest } from '../types';
import { PLUGINS } from '../config/pluginCatalog';
import { generateId } from '../utils/id';
import { sql } from '../config/db';
import {
  getToolPermission,
  getInstallationCredential,
  findInstallationByUserAndPlugin,
  createApprovalRecord,
  recordToolCallLog,
  listBotAvailableTools,
  markInstallationNeedsReauth,
} from '../repositories/plugins';
import { runTool } from './toolExecutors';
import { isWorkspaceTool, executeWorkspaceTool } from './workspaceTools';

export interface GatewayRequest {
  userId: string;
  botId: string;
  botName: string;
  conversationId?: string;
  toolName: string;
  args: Record<string, any>;
}

export type GatewayOutcome =
  | { kind: 'approved'; approval: ApprovalRequest }
  | { kind: 'not_installed'; pluginSlug: string; toolName: string }
  | { kind: 'not_enabled'; toolName: string; pluginSlug: string }
  | {
      kind: 'result';
      toolName: string;
      ok: boolean;
      result: any;
      durationMs: number;
      /** The plugin's credential was rejected and needs re-authorising. */
      needsReauth?: boolean;
    };

/** Which catalog plugin owns a tool, if any. */
function ownerPluginOf(toolName: string) {
  return PLUGINS.find((p) => p.tools.some((t) => t.name === toolName));
}

/**
 * Runs the gateway checks and executes the tool when permitted.
 * Sensitive tools return `{ kind: 'approved' }` â€” the caller shows the user an
 * approval card and calls `executeApprovedTool` once they approve.
 */
export async function callTool(req: GatewayRequest): Promise<GatewayOutcome> {
  const { toolName } = req;
  const owner = ownerPluginOf(toolName);

  if (!owner) {
    // Unknown tool: nothing can execute it, so say so plainly
    return { kind: 'not_installed', pluginSlug: '', toolName };
  }

  const permission = await getToolPermission(req.userId, req.botId, toolName);

  // 1. Not connected
  if (!permission.installed) {
    return { kind: 'not_installed', pluginSlug: owner.slug, toolName };
  }

  // 2. Not enabled for this bot
  if (!permission.enabled) {
    return { kind: 'not_enabled', toolName, pluginSlug: owner.slug };
  }

  // 3. Sensitive -> approval gate (nothing runs until the user approves)
  if (permission.sensitive) {
    const toolDef = owner.tools.find((t) => t.name === toolName);
    const approval = await createApprovalRecord({
      userId: req.userId,
      botId: req.botId,
      botName: req.botName,
      conversationId: req.conversationId,
      toolName,
      actionName: toolDef?.description || toolName,
      toolParams: req.args,
      reason: `${req.botName} wants to run ${owner.name} â†’ ${toolName}. Approve to execute it with your connected account.`,
    });
    return { kind: 'approved', approval };
  }

  // 4 + 5
  return executeApprovedTool(req);
}

/**
 * Executes a tool the user has already approved (or one that never needed
 * approval), logging the real call and its outcome.
 */
export async function executeApprovedTool(req: GatewayRequest): Promise<GatewayOutcome> {
  const { toolName } = req;
  const owner = ownerPluginOf(toolName);
  if (!owner) {
    return { kind: 'not_installed', pluginSlug: '', toolName };
  }

  const installation = await findInstallationByUserAndPlugin(req.userId, owner.slug);
  if (!installation) {
    return { kind: 'not_installed', pluginSlug: owner.slug, toolName };
  }

  const credential = await getInstallationCredential(installation.id);
  const metadata = installation.metadata || {};

  const outcome = await runTool(toolName, req.args, { credential, metadata });

  // A rejected credential means the user must re-authorise: flag it so the UI
  // prompts them instead of failing silently on every later call.
  if (!outcome.ok && outcome.authFailed) {
    await markInstallationNeedsReauth(installation.id);
  }

  await recordToolCallLog({
    userId: req.userId,
    botId: req.botId,
    botName: req.botName,
    toolName,
    inputArgs: req.args,
    outputResult: outcome.result,
    status: outcome.ok ? 'success' : 'failed',
    durationMs: outcome.durationMs,
  });

  return {
    kind: 'result',
    toolName,
    ok: outcome.ok,
    result: outcome.result,
    durationMs: outcome.durationMs,
    needsReauth: Boolean(!outcome.ok && outcome.authFailed),
  };
}

/** Resolves a pending approval to approved/rejected, executing when approved. */
export async function resolveApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  resolvedBy: string,
  editedParams?: Record<string, any>
): Promise<{ approval: ApprovalRequest | null; outcome?: GatewayOutcome }> {
  const rows = (await sql`select * from approvals where id = ${approvalId} limit 1`) as unknown as ApprovalRow[];
  if (rows.length === 0) return { approval: null };

  const row = rows[0];
  const params = editedParams ?? row.tool_params;

  if (status === 'rejected') {
    const updated = (await sql`
      update approvals set status = 'rejected', resolved_time = now(), resolved_by = ${resolvedBy}
      where id = ${approvalId} returning *
    `) as unknown as ApprovalRow[];
    return { approval: mapApproval(updated[0]) };
  }

  // Workspace-management approvals run their own executor, not the plugin gateway
  if (isWorkspaceTool(row.tool_name)) {
    const outcome = await executeWorkspaceTool(row.tool_name, params, {
      userId: row.user_id,
      botName: row.bot_name,
    });

    const updated = (await sql`
      update approvals set status = 'approved', resolved_time = now(), resolved_by = ${resolvedBy}, tool_params = ${JSON.stringify(params)}::jsonb
      where id = ${approvalId} returning *
    `) as unknown as ApprovalRow[];

    return {
      approval: mapApproval(updated[0]),
      outcome: {
        kind: 'result',
        toolName: row.tool_name,
        ok: outcome.ok,
        result: outcome.result,
        durationMs: 0,
      },
    };
  }

  const outcome = await executeApprovedTool({
    userId: row.user_id,
    botId: row.bot_id,
    botName: row.bot_name,
    conversationId: row.conversation_id || undefined,
    toolName: row.tool_name,
    args: params,
  });

  const updated = (await sql`
    update approvals set status = 'approved', resolved_time = now(), resolved_by = ${resolvedBy}, tool_params = ${JSON.stringify(params)}::jsonb
    where id = ${approvalId} returning *
  `) as unknown as ApprovalRow[];

  return { approval: mapApproval(updated[0]), outcome };
}

export interface ApprovalRow {
  id: string;
  user_id: string;
  bot_id: string;
  bot_name: string;
  conversation_id: string | null;
  action_name: string;
  tool_name: string;
  tool_params: any;
  status: 'pending' | 'approved' | 'rejected';
  reason: string | null;
  rejection_reason: string | null;
  created_time: Date;
  resolved_time: Date | null;
  resolved_by: string | null;
}

function mapApproval(row: ApprovalRow): ApprovalRequest {
  return {
    id: row.id,
    userId: row.user_id,
    botId: row.bot_id,
    botName: row.bot_name,
    conversationId: row.conversation_id || undefined,
    actionName: row.action_name,
    toolName: row.tool_name,
    toolParams: row.tool_params || {},
    status: row.status,
    reason: row.reason || undefined,
    rejectionReason: row.rejection_reason || undefined,
    createdTime: row.created_time.toISOString(),
    resolvedTime: row.resolved_time ? row.resolved_time.toISOString() : undefined,
    resolvedBy: row.resolved_by || undefined,
  };
}

export async function findApprovalById(id: string): Promise<ApprovalRequest | null> {
  const rows = (await sql`select * from approvals where id = ${id} limit 1`) as unknown as ApprovalRow[];
  return rows.length > 0 ? mapApproval(rows[0]) : null;
}

export { listBotAvailableTools, generateId };
