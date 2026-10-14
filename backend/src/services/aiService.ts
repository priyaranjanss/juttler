import { Bot, Message } from '../types';
import { AUTONOMY_RULES } from '../config/autonomy';
import {
  contentLooksLikeToolMarkup,
  extractEmbeddedToolCalls,
  stripEmbeddedToolMarkup,
} from './embeddedToolCalls';

// Every bot must have its own explicit model and key. Never fall back to a
// workspace credential: that would make bots share both identity and billing.
function resolveModel(bot: Bot): string | null {
  return bot.aiModel?.trim() || null;
}

/**
 * The LLM wiring for this bot only.
 *
 * Only reasoning needs an LLM. Tool execution goes through the Tool Gateway with
 * the stored OAuth credentials and never touches an LLM key.
 */
export interface LlmWiring {
  endpoint: string;
  apiKey: string;
  model: string;
}

export type LlmGap = 'ok' | 'no_key' | 'no_model' | 'no_key_or_model';

/**
 * What is actually missing on a bot, so callers can say so precisely instead of
 * blaming "the API key" when it is really an unselected model.
 */
export function describeLlmGap(bot: Bot): LlmGap {
  const hasKey = Boolean(bot.aiApiKey?.trim());
  const hasModel = Boolean(bot.aiModel?.trim());

  if (hasKey && hasModel) return 'ok';
  if (hasKey && !hasModel) return 'no_model';
  if (!hasKey && hasModel) return 'no_key';
  return 'no_key_or_model';
}

export function resolveLlmWiring(bot: Bot): LlmWiring | null {
  const apiKey = bot.aiApiKey?.trim();
  const model = resolveModel(bot);
  if (!apiKey || !model || !bot.aiEndpoint?.trim()) return null;
  return { endpoint: bot.aiEndpoint, apiKey, model };
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
// A single turn may need several steps in sequence: enable a tool, delegate to a
// specialist, then answer. Five rounds runs out mid-flow and leaves the user
// with an error instead of a reply, so keep this generous; rounds now stop early
// on their own when a round gains nothing useful.
const MAX_TOOL_ROUNDS = 18;
const MAX_GATEWAY_ATTEMPTS = 3;
const MAX_CONTEXT_ITEM_CHARS = 8_000;
/** Keep tool payloads small so the model still has room to answer. */
const MAX_TOOL_RESULT_CHARS = 2_500;
const EXPLORE_TOOLS = new Set([
  'github.list_files',
  'github.get_file',
  'github.list_commits',
  'github.list_prs',
  'jira.search_tickets',
  'jira.list_projects',
  'jira.list_transitions',
  'jira.get_ticket',
]);
const ACT_TOOLS = new Set([
  'github.write_file',
  'github.create_branch',
  'github.create_pull_request',
  'github.comment_pr',
  'github.create_issue',
  'jira.create_ticket',
  'jira.update_ticket',
  'jira.change_status',
  'jira.add_comment',
  'jira.assign_ticket',
]);

function stringifyContext(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? null) ?? String(value);
}

function truncateForModel(value: unknown, max = MAX_TOOL_RESULT_CHARS): string {
  const text = stringifyContext(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Short notes for the model when forcing a final answer (not shown raw to users). */
function summarizeToolEvents(events: ToolEvent[]): string {
  if (events.length === 0) return 'No tools ran.';
  return events
    .map((event) => {
      if (event.status === 'failed' || event.status === 'unavailable') {
        return `- ${event.toolName}: failed — ${event.error || 'error'}`;
      }
      if (event.status === 'needs_approval') {
        return `- ${event.toolName}: waiting for approval`;
      }
      const highlight = highlightToolResult(event.toolName, event.result);
      return highlight ? `- ${event.toolName}: ok — ${highlight}` : `- ${event.toolName}: ok`;
    })
    .join('\n');
}

/** Pull a few useful fields so fallbacks stay readable. */
function highlightToolResult(toolName: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const row = result as Record<string, any>;
  const bits: string[] = [];
  if (row.key) bits.push(String(row.key));
  if (row.summary) bits.push(String(row.summary));
  if (row.status) bits.push(`status ${row.status}`);
  if (row.transition || row.to) bits.push(`→ ${row.to || row.transition}`);
  if (row.branch) bits.push(`branch ${row.branch}`);
  if (row.html_url || row.url || row.pr_url) bits.push(String(row.html_url || row.url || row.pr_url));
  if (row.path) bits.push(String(row.path));
  if (typeof row.returned === 'number') bits.push(`${row.returned} rows`);
  if (Array.isArray(row.entries)) bits.push(`${row.entries.length} entries`);
  if (row.error) bits.push(String(row.error));
  if (bits.length === 0 && toolName) return truncateForModel(result, 160);
  return bits.join(' · ');
}

/** User-facing fallback when the model returns an empty final message. */
function userFacingToolSummary(events: ToolEvent[]): string {
  if (events.length === 0) return 'I could not complete that.';
  const lines: string[] = [];
  for (const event of events) {
    if (event.status === 'needs_approval') {
      lines.push(`• ${event.toolName} is waiting for your approval.`);
      continue;
    }
    if (event.status === 'failed' || event.status === 'unavailable') {
      const err = (event.error || 'failed').replace(/\s+/g, ' ').trim();
      lines.push(`• ${event.toolName} failed: ${err.slice(0, 180)}`);
      continue;
    }
    const highlight = highlightToolResult(event.toolName, event.result);
    if (highlight) lines.push(`• ${highlight}`);
  }
  const unique = [...new Set(lines)].slice(0, 12);
  if (unique.length === 0) return 'I ran tools but have nothing useful to report yet.';
  return `Here is what I got so far:\n${unique.join('\n')}`;
}

function buildToolCapabilityContext(tools: BotToolSpec[]): string {
  const availableTools = tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join('\n');

  return `\n\nAuthoritative tool access for this bot in this turn:
${
  availableTools || '- No external tools are currently enabled and connected for this bot.'
}
The list above is every tool this bot can use on this turn, for any request. Call whichever tools the request needs, in whatever order, and answer from their results. Do not say a plugin is disconnected when its tools are listed. If a tool returns an error, report that error.`;
}

function buildSystemPrompt(bot: Bot, userName: string, tools: BotToolSpec[]): string {
  return `${bot.systemPrompt}\nUser Name: ${userName}. You are participating in workspace chat as ${bot.name} (${bot.roleTitle}). Keep responses concise, actionable, and aligned with your role.\n\n${AUTONOMY_RULES}${buildToolCapabilityContext(tools)}`;
}

function buildInitialMessages(
  bot: Bot,
  userName: string,
  tools: BotToolSpec[],
  history: Message[],
  messageContent: string,
  overrideSystemPrompt?: string,
  systemAddendum?: string
): ChatMessage[] {
  const base = overrideSystemPrompt
    ? `${overrideSystemPrompt}${buildToolCapabilityContext(tools)}`
    : buildSystemPrompt(bot, userName, tools);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: systemAddendum ? `${base}\n\n${systemAddendum}` : base,
    },
  ];

  for (const m of history.slice(-20)) {
    if (m.type === 'text') {
      messages.push({ role: m.senderType === 'user' ? 'user' : 'assistant', content: m.content });
      continue;
    }

    if (m.type === 'tool_call' && m.metadata?.toolCall) {
      const { toolName, args } = m.metadata.toolCall;
      const content = `[Previous tool call: ${toolName}]\n${stringifyContext(args)}`;
      messages.push({
        role: 'assistant',
        content: content.length > MAX_CONTEXT_ITEM_CHARS
          ? `${content.slice(0, MAX_CONTEXT_ITEM_CHARS)} [truncated]`
          : content,
      });
      continue;
    }

    if (m.type === 'tool_result' && m.metadata?.toolResult) {
      const { toolName, result, status } = m.metadata.toolResult;
      const content = `[Previous tool result from ${toolName} (${status})]\n${stringifyContext(result)}`;
      messages.push({
        role: 'assistant',
        content: content.length > MAX_CONTEXT_ITEM_CHARS
          ? `${content.slice(0, MAX_CONTEXT_ITEM_CHARS)} [truncated]`
          : content,
      });
      continue;
    }

    if (m.type === 'approval_request' || m.type === 'system') {
      messages.push({ role: 'assistant', content: `[${m.type}] ${m.content}` });
    }
  }

  messages.push({ role: 'user', content: messageContent });
  return messages;
}

function toolChoiceFor(round: number, tools: BotToolSpec[], message: string): 'auto' | 'required' {
  if (round > 0 || tools.length === 0) return 'auto';
  const text = message.trim().toLowerCase();
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|yo|sup|good morning|good night)[!.?\s]*$/.test(text)) {
    return 'auto';
  }
  return 'required';
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

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds)
      ? Date.now() + seconds * 1_000
      : Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, Math.min(3_000, retryAt - Date.now()));
    }
  }

  return 250 * (attempt + 1);
}

async function fetchGateway(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      if (attempt + 1 >= MAX_GATEWAY_ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      continue;
    }

    const retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
    if (!retryable || attempt + 1 >= MAX_GATEWAY_ATTEMPTS) return response;

    const delay = retryDelayMs(response, attempt);
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Runs one bot turn against its configured gateway, executing any tools the
 * model asks for through `executor` (the Tool Gateway).
 *
 * Never fabricates a reply or a tool result â€” failures are returned verbatim.
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
  /** Extra instructions appended for a specific channel, such as a Slack reply. */
  systemAddendum?: string;
}): Promise<TurnResult> {
  const { bot, tools, executor } = params;

  // Every bot reasons with its own LLM configuration. Tool credentials remain
  // independent in the Tool Gateway, but a turn needs a model to request tools.
  const wiring = resolveLlmWiring(bot);
  if (!wiring) {
    // Say precisely what is missing: "no model selected" is a different fix
    // from "no API key", and conflating them sends the user to the wrong place.
    const gap = describeLlmGap(bot);
    const detail =
      gap === 'no_model'
        ? `${bot.name} has an API key but no model selected. Open this bot's settings, pick a model, and press Verify.`
        : gap === 'no_key'
          ? `${bot.name} needs its own AI provider API key. Add it in this bot's settings.`
          : `${bot.name} needs its own AI provider API key and model. Add them in this bot's settings.`;

    return {
      tools: [],
      waitingForApproval: false,
      error: {
        kind: 'not_configured',
        message: `${detail} This blocks reasoning only - tools still run through the Tool Gateway with the connected account's credentials.`,
      },
    };
  }

  const model = wiring.model;
  const url = `${wiring.endpoint.replace(/\/+$/, '')}/chat/completions`;
  const messages = buildInitialMessages(
    bot,
    params.userName,
    tools,
    params.history,
    params.messageContent,
    params.overrideSystemPrompt,
    params.systemAddendum
  );

  const collected: ToolEvent[] = [];
  // Tools already reported as unavailable, so a stubborn model retrying the
  // same one stops the tool loop instead of burning every round.
  const unavailableSeen = new Set<string>();
  let usage: TurnResult['tokenUsage'];
  // Set when the tool loop should stop early and go straight to the final answer.
  let stopToolLoop = false;
  let exploreStreak = 0;

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS && !stopToolLoop; round++) {
      const res = await fetchGateway(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${wiring.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          ...(tools.length > 0
            ? { tools: toOpenAiTools(tools), tool_choice: toolChoiceFor(round, tools, params.messageContent) }
            : {}),
          max_tokens: 1024,
          temperature: tools.length > 0 ? 0.2 : 0.7,
        }),
      });

      if (!res.ok) {
        let detail = '';
        try {
          const body = (await res.json()) as GatewayErrorBody;
          detail = body?.error?.message ? ` â€” ${body.error.message}` : '';
        } catch {
          // no JSON body
        }
        const hint =
          res.status === 401 || res.status === 403
            ? ' (check the bot API key in bot settings)'
            : res.status === 402 || res.status === 503
              ? ' (gateway reports insufficient balance)'
              : res.status === 429
                ? ' (rate limited â€” try again shortly)'
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
      const rawContent = typeof message?.content === 'string' ? message.content : '';
      let toolCalls = message?.tool_calls ?? [];

      // Some models emit tool requests as XML in content instead of tool_calls.
      if (toolCalls.length === 0 && contentLooksLikeToolMarkup(rawContent)) {
        toolCalls = extractEmbeddedToolCalls(
          rawContent,
          tools.map((tool) => tool.name)
        );
      }

      // Final answer (no tools to run)
      if (toolCalls.length === 0) {
        const text = stripEmbeddedToolMarkup(rawContent);
        if (!text) {
          const digest = summarizeToolEvents(collected);
          if (digest && digest !== 'No tools ran.') {
            return {
              text: `I ran tools but the model returned an empty reply. Progress:\n${digest}`,
              tools: collected,
              tokenUsage: usage,
              waitingForApproval: false,
            };
          }
          return {
            tools: collected,
            tokenUsage: usage,
            waitingForApproval: false,
            error: { kind: 'bad_response', message: 'Gateway returned no content.' },
          };
        }
        return { text, tools: collected, tokenUsage: usage, waitingForApproval: false };
      }

      // The model wants to act: record its request, then execute through the gateway.
      // Never keep raw tool markup in the assistant content sent back to the model.
      const visibleContent = stripEmbeddedToolMarkup(rawContent);
      messages.push({
        role: 'assistant',
        content: visibleContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      });

      for (const call of toolCalls) {
        let args: Record<string, any>;
        try {
          const parsed: unknown = JSON.parse(call.function.arguments || '{}');
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new Error('Tool arguments must be a JSON object.');
          }
          args = parsed as Record<string, any>;
        } catch (error) {
          const reason = error instanceof Error ? error.message : 'Invalid JSON arguments.';
          const detail = `The model returned invalid arguments for ${call.function.name}: ${reason}`;
          collected.push({
            callId: call.id,
            toolName: call.function.name,
            args: {},
            status: 'failed',
            error: detail,
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: detail }),
          });
          continue;
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
          // Asking for the same unavailable tool twice means the model is stuck:
          // stop the loop and let the forced final answer take over.
          if (unavailableSeen.has(call.function.name)) {
            stopToolLoop = true;
            break;
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
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `${label} Answer the user with what you can do instead of asking for this tool again.`,
          });
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

        if (execution.ok && ACT_TOOLS.has(call.function.name)) exploreStreak = 0;
        else if (execution.ok && EXPLORE_TOOLS.has(call.function.name)) exploreStreak += 1;

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: `${truncateForModel(execution.result ?? {})}\nIf this does not finish the user's request, call the next tool before you reply.`,
        });
      }

      // A round where every tool was unavailable or disabled gained nothing.
      // Asking for more tools will not fix it, so go to the final answer.
      const gainedNothing = collected.length > 0 && collected.every((e) => e.status === 'unavailable');
      if (gainedNothing) {
        stopToolLoop = true;
      }

      // Too much browsing without acting — push the model to finish the work.
      if (!stopToolLoop && exploreStreak >= 5) {
        messages.push({
          role: 'system',
          content:
            'You already have enough read context. Stop listing or re-reading files. ' +
            'Take the next action that finishes the user request (write, create, update, transition, comment, or reply). ' +
            'If you cannot act, answer the user now with what you know.',
        });
        exploreStreak = 0;
      }
    }

    // Ran out of tool rounds â€” say so rather than looping forever
    // ---------------------------------------------------------------------
    // Forced final answer.
    //
    // Reaching here means the tool loop stopped early: the rounds ran out, a
    // tool was unavailable, or a whole round gained nothing. In every case the
    // model still owes the user an answer, so ask for one with tools removed -
    // it can no longer defer by calling another tool. This is what stops a turn
    // from dying as "stopped after N tool rounds".
    // ---------------------------------------------------------------------
    const toolDigest = summarizeToolEvents(collected);
    // Slim context: huge browse transcripts make the model return empty content.
    const slimHistory = messages.filter((m) => m.role === 'system' || m.role === 'user').slice(0, 6);
    const finalMessages: ChatMessage[] = [
      ...slimHistory,
      {
        role: 'system',
        content:
          'You cannot call any more tools. Write a clear reply for the user from these outcomes. ' +
          'No JSON dumps, no XML, no tool markup. Say what you did, what is left, and any blockers.\n\n' +
          `Outcomes:\n${toolDigest}`,
      },
      { role: 'user', content: params.messageContent },
    ];

    const finalRes = await fetchGateway(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${wiring.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        max_tokens: 1200,
        temperature: 0.3,
      }),
    });

    if (!finalRes.ok) {
      let detail = '';
      try {
        const body = (await finalRes.json()) as GatewayErrorBody;
        detail = body?.error?.message ? ` - ${body.error.message}` : '';
      } catch {
        // no JSON body
      }
      if (collected.length > 0) {
        return {
          text: userFacingToolSummary(collected),
          tools: collected,
          tokenUsage: usage,
          waitingForApproval: false,
        };
      }
      return {
        tools: collected,
        tokenUsage: usage,
        waitingForApproval: false,
        error: { kind: 'http', message: `Gateway returned ${finalRes.status}${detail}` },
      };
    }

    const finalData = (await finalRes.json()) as ChatCompletionResponse;
    if (finalData.usage) {
      usage = {
        promptTokens: finalData.usage.prompt_tokens ?? 0,
        completionTokens: finalData.usage.completion_tokens ?? 0,
        totalTokens: finalData.usage.total_tokens ?? 0,
      };
    }

    const finalText = stripEmbeddedToolMarkup(finalData.choices?.[0]?.message?.content ?? '');
    if (finalText.trim() && !contentLooksLikeToolMarkup(finalText)) {
      return { text: finalText, tools: collected, tokenUsage: usage, waitingForApproval: false };
    }

    if (collected.length > 0) {
      return {
        text: userFacingToolSummary(collected),
        tools: collected,
        tokenUsage: usage,
        waitingForApproval: false,
      };
    }

    return {
      tools: collected,
      tokenUsage: usage,
      waitingForApproval: false,
      error: {
        kind: 'bad_response',
        message: 'No answer was produced. Try rephrasing the request.',
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

  // A model must be chosen first â€” verification sends a real completion with it.
  const modelId = model?.trim();
  if (!modelId) {
    return { ok: false, message: 'Pick a model first (use Sync to load the list).' };
  }

  const url = `${endpoint.replace(/\/+$/, '')}/chat/completions`;

  try {
    const res = await fetchGateway(url, {
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
      return { ok: true, message: `${modelId} verified â€” this bot can chat.`, status: res.status };
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
    const res = await fetchGateway(url, {
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
