import { Bot, Message } from '../../../frontend/src/types/index';
import { AUTONOMY_RULES } from '../config/autonomy';

// A bot must have an explicit model chosen in its settings — there is
// deliberately no default, so a misconfigured bot fails loudly instead of
// silently billing calls to an unintended model.
function resolveModel(bot: Bot): string | null {
  return bot.aiModel?.trim() || null;
}

export type AiErrorKind = 'not_configured' | 'http' | 'network' | 'bad_response';

// A tool the model is allowed to ask for this turn.
export interface BotToolSpec {
  name: string;
  description: string;
  parameters: any;
}

// What the gateway did with a tool request.
export type ToolExecution =
  | { kind: 'result'; ok: boolean; result: any; durationMs?: number }
  | { kind: 'approval'; approvalId: string; actionName: string; reason: string }
  | { kind: 'missing'; pluginSlug: string; toolName: string }
  | { kind: 'disabled'; toolName: string; pluginSlug: string };

export interface ToolEvent {
  callId: string;
  toolName: string;
  args: Record<string, any>;
  status: 'success' | 'failed' | 'needs_approval' | 'unavailable';
  result?: any;
  error?: string;
  durationMs?: number;
  approvalId?: string;
  actionName?: string;
  reason?: string;
  /** Set when the plugin needed for this tool isn't connected yet. */
  missingPluginSlug?: string;
}

export interface TurnResult {
  text?: string;
  error?: { kind: AiErrorKind; message: string };
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  tools: ToolEvent[];
  // True when the turn stopped to wait for a human approval.
  waitingForApproval: boolean;
}

// OpenAI-compatible chat completion response (only the fields we read).
interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface GatewayErrorBody {
  error?: { message?: string };
}

type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

// A tool-calling turn, so the model can chain tools and read their output.
const MAX_TOOL_ROUNDS = 5;

function buildSystemPrompt(bot: Bot, userName: string, tools: BotToolSpec[]): string {
  return `${bot.systemPrompt}\nUser Name: ${userName}. You are participating in workspace chat as ${bot.name} (${bot.roleTitle}). Keep responses concise, actionable, and aligned with your role.\n\n${AUTONOMY_RULES}`;
}

function buildInitialMessages(
  bot: Bot,
  userName: string,
  tools: BotToolSpec[],
  history: Message[],
  messageContent: string,
  overrideSystemPrompt?: string
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: 'system', content: overrideSystemPrompt || buildSystemPrompt(bot, userName, tools) },
  ];

  for (const m of history.slice(-20)) {
    if (m.type !== 'text') continue;
    messages.push({ role: m.senderType === 'user' ? 'user' : 'assistant', content: m.content });
  }

  messages.push({ role: 'user', content: messageContent });
  return messages;
}

function toOpenAiTools(tools: BotToolSpec[]) {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? { type: 'object', properties: {} },
    },
  }));
}

/**
 * Runs one bot turn against its configured gateway, executing any tools the
 * model asks for through `executor` (the Tool Gateway).
 *
 * Never fabricates a reply or a tool result — failures are returned verbatim.
 */
export async function runBotTurn(params: {
  bot: Bot;
  userName: string;
  history: Message[];
  messageContent: string;
  tools: BotToolSpec[];
  executor: (toolName: string, args: Record<string, any>) => Promise<ToolExecution>;
  /** Replaces the bot's stored system prompt (used to inject a live team roster). */
  overrideSystemPrompt?: string;
}): Promise<TurnResult> {
  const { bot, tools, executor } = params;

  if (!bot.aiApiKey) {
    return { tools: [], waitingForApproval: false, error: { kind: 'not_configured', message: 'No API key configured for this bot.' } };
  }

  const model = resolveModel(bot);
  if (!model) {
    return {
      tools: [],
      waitingForApproval: false,
      error: {
        kind: 'not_configured',
        message: 'No model selected for this bot. Open bot settings, sync the model list, and pick one.',
      },
    };
  }

  const url = `${bot.aiEndpoint.replace(/\/+$/, '')}/chat/completions`;
  const messages = buildInitialMessages(
    bot,
    params.userName,
    tools,
    params.history,
    params.messageContent,
    params.overrideSystemPrompt
  );

  const collected: ToolEvent[] = [];
  // Tools already reported as unavailable, so a stubborn model retrying the
  // same one gets a hard stop instead of five identical "connect this" cards.
  const unavailableSeen = new Set<string>();
  let usage: TurnResult['tokenUsage'];

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bot.aiApiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          ...(tools.length > 0 ? { tools: toOpenAiTools(tools), tool_choice: 'auto' } : {}),
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const body = (await res.json()) as GatewayErrorBody;
          detail = body?.error?.message ? ` — ${body.error.message}` : '';
        } catch {
          // no JSON body
        }
        const hint =
          res.status === 401 || res.status === 403
            ? ' (check the bot API key in bot settings)'
            : res.status === 402 || res.status === 503
              ? ' (gateway reports insufficient balance)'
              : res.status === 429
                ? ' (rate limited — try again shortly)'
                : '';
        return { tools: collected, waitingForApproval: false, error: { kind: 'http', message: `Gateway returned ${res.status}${detail}${hint}` } };
      }

      const data = (await res.json()) as ChatCompletionResponse;
      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        };
      }

      const choice = data.choices?.[0];
      const message = choice?.message;
      const toolCalls = message?.tool_calls ?? [];

      // Final answer
      if (toolCalls.length === 0) {
        const text = message?.content ?? '';
        if (!text) {
          return { tools: collected, tokenUsage: usage, waitingForApproval: false, error: { kind: 'bad_response', message: 'Gateway returned no content.' } };
        }
        return { text, tools: collected, tokenUsage: usage, waitingForApproval: false };
      }

      // The model wants to act: record its request, then execute through the gateway
      messages.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const call of toolCalls) {
        let args: Record<string, any> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          args = {};
        }

        const execution = await executor(call.function.name, args);

        if (execution.kind === 'approval') {
          collected.push({
            callId: call.id,
            toolName: call.function.name,
            args,
            status: 'needs_approval',
            approvalId: execution.approvalId,
            actionName: execution.actionName,
            reason: execution.reason,
          });
          // Stop the turn: the human decides next
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: 'Waiting for the user to approve this action.',
          });
          return { tools: collected, tokenUsage: usage, waitingForApproval: true };
        }

        if (execution.kind === 'missing' || execution.kind === 'disabled') {
          // Second attempt at the same unavailable tool: stop rather than loop.
          if (unavailableSeen.has(call.function.name)) {
            return { tools: collected, tokenUsage: usage, waitingForApproval: false };
          }
          unavailableSeen.add(call.function.name);

          const label =
            execution.kind === 'missing'
              ? `The ${execution.pluginSlug} plugin is not connected. Ask the user to connect it in the Plugins panel.`
              : `The ${execution.toolName} tool is disabled for this bot. Ask the user to enable it in bot settings.`;
          collected.push({
            callId: call.id,
            toolName: call.function.name,
            args,
            status: 'unavailable',
            error: label,
            // Lets the UI show a real "Connect this service" card
            missingPluginSlug: execution.kind === 'missing' ? execution.pluginSlug : undefined,
          });
          messages.push({ role: 'tool', tool_call_id: call.id, content: label });
          continue;
        }

        collected.push({
          callId: call.id,
          toolName: call.function.name,
          args,
          status: execution.ok ? 'success' : 'failed',
          result: execution.result,
          error: execution.ok ? undefined : String((execution.result as any)?.error ?? 'Tool failed'),
          durationMs: execution.durationMs,
        });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(execution.result ?? {}),
        });
      }
    }

    // Ran out of tool rounds — say so rather than looping forever
    return {
      tools: collected,
      tokenUsage: usage,
      waitingForApproval: false,
      error: {
        kind: 'bad_response',
        message: `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer. Try a more specific request.`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { tools: collected, tokenUsage: usage, waitingForApproval: false, error: { kind: 'network', message: `Could not reach the gateway: ${message}` } };
  }
}

/**
 * Checks a bot's provider credentials by issuing a minimal completion.
 * Returns a human-readable outcome plus the HTTP status for the UI.
 */
export async function verifyAiConfig(
  apiKey: string,
  endpoint: string,
  model?: string
): Promise<{
  ok: boolean;
  message: string;
  status?: number;
}> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { ok: false, message: 'Enter an API key first.' };
  }

  // A model must be chosen first — verification sends a real completion with it.
  const modelId = model?.trim();
  if (!modelId) {
    return { ok: false, message: 'Pick a model first (use Sync to load the list).' };
  }

  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${trimmedKey}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
    });

    if (res.ok) {
      return { ok: true, message: `${modelId} verified — this bot can chat.`, status: res.status };
    }

    let detail = '';
    try {
      const body = (await res.json()) as GatewayErrorBody;
      detail = body?.error?.message ? `: ${body.error.message}` : '';
    } catch {
      // no JSON body
    }

    return {
      ok: false,
      message: `Verification failed (${res.status})${detail}`,
      status: res.status,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Could not reach the endpoint: ${message}` };
  }
}

// OpenAI-compatible model list entry (only the fields we read).
interface GatewayModel {
  id: string;
  name?: string;
}

interface GatewayModelList {
  data?: GatewayModel[];
}

/**
 * Fetches the models the gateway offers, using the bot's own API key so the
 * list reflects exactly what that key is entitled to use. Populates the model
 * dropdown in bot settings.
 */
export async function listAvailableModels(
  endpoint: string,
  apiKey: string
): Promise<{
  ok: boolean;
  models: GatewayModel[];
  message?: string;
  status?: number;
}> {
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return { ok: false, models: [], message: 'Paste an API key first, then sync models.' };
  }

  const url = `${endpoint.replace(/\/+$/, '')}/models`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${trimmedKey}` },
    });

    if (!res.ok) {
      let detail = '';
      try {
        const body = (await res.json()) as GatewayErrorBody;
        detail = body?.error?.message ? `: ${body.error.message}` : '';
      } catch {
        // no JSON body
      }
      return {
        ok: false,
        models: [],
        message: `Couldn't load models (${res.status})${detail}`,
        status: res.status,
      };
    }

    const data = (await res.json()) as GatewayModelList;
    const models = (data?.data ?? [])
      .filter((m) => typeof m?.id === 'string' && m.id.length > 0)
      .map((m) => ({ id: m.id, name: m.name || m.id }))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (models.length === 0) {
      return { ok: false, models: [], message: 'The gateway returned no models for this key.' };
    }

    return { ok: true, models };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, models: [], message: `Could not reach the endpoint: ${message}` };
  }
}
