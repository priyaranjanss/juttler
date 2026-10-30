import { Bot, Message } from '../types';
import { AI_PROVIDERS } from '../constants';
import { AUTONOMY_RULES } from '../config/autonomy';
import {
  contentLooksLikeToolMarkup,
  extractEmbeddedToolCalls,
  stripEmbeddedToolMarkup,
} from './embeddedToolCalls';
import { sanitizeToolArgs } from './toolArgSanitize';

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
  provider: Bot['aiProvider'];
  endpoint: string;
  apiKey: string;
  model: string;
  /** Plans, reviews and writes replies while `model` makes the tool calls; the user sees one bot. */
  reasoningModel?: string;
}

export type LlmGap = 'ok' | 'no_key' | 'no_model' | 'no_key_or_model';

/**
 * What is actually missing on a bot, so callers can say so precisely instead of
 * blaming "the API key" when it is really an unselected model.
 */
export function describeLlmGap(bot: Bot): LlmGap {
  if (bot.aiProvider === 'free_endpoint') return 'ok';

  const hasKey = Boolean(bot.aiApiKey?.trim());
  const hasModel = Boolean(bot.aiModel?.trim());

  if (hasKey && hasModel) return 'ok';
  if (hasKey && !hasModel) return 'no_model';
  if (!hasKey && hasModel) return 'no_key';
  return 'no_key_or_model';
}

export function resolveLlmWiring(bot: Bot): LlmWiring | null {
  if (bot.aiProvider === 'free_endpoint') {
    return {
      provider: 'free_endpoint',
      endpoint: AI_PROVIDERS.free_endpoint.endpoint,
      apiKey: '',
      model: AI_PROVIDERS.free_endpoint.model,
      reasoningModel: AI_PROVIDERS.free_endpoint.reasoningModel,
    };
  }

  const apiKey = bot.aiApiKey?.trim();
  const model = resolveModel(bot);
  if (!apiKey || !model || !bot.aiEndpoint?.trim()) return null;
  return { provider: bot.aiProvider, endpoint: bot.aiEndpoint, apiKey, model };
}

export type ReasoningMode = 'think' | 'big_brain' | 'off';

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
  /** Which reasoning mode produced this reply, for the UI to display. */
  reasoningMode?: ReasoningMode;
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

// The model selects tools automatically and receives their results between calls.
// These limits bound a turn; exhausted turns still receive a model-generated reply.
const MAX_TOOL_ROUNDS = 18;
/** Hard wall so long agent turns still return a finish/blocker before the client gives up. */
const TURN_BUDGET_MS = 170_000;
const MAX_GATEWAY_ATTEMPTS = 3;
const MAX_CONTEXT_ITEM_CHARS = 8_000;
const MAX_TOOL_RESULT_CHARS = 16_000;

const PLAN_PROMPT =
  'Before acting, think this request through: the outcome the user wants, what you can find out or decide yourself, ' +
  'and the steps and tool calls that get there, in order. Reply with only that plan in a few short lines. ' +
  'Do not call tools, report results, or write the reply to the user yet.';

/** Marks a review that hands remaining tool work back instead of replying. */
const CONTINUE_MARKER = /(?:^|\n)\W*CONTINUE\W*:\s*/i;

function selfReviewPrompt(events: ToolEvent[], handBackWork: boolean): string {
  const remainingWork = handBackWork
    ? 'If work within your tools remains, reply with only a line starting "CONTINUE:" that says what to do next; it is carried out with tool calls before anything is sent.'
    : 'If work within your tools remains, do it now with tool calls.';
  const ledger = events.length
    ? events.map((event) => `- ${event.toolName} ${truncateForModel(event.args, 300)}: ${event.status}`).join('\n')
    : '- none';
  return (
    'Check your draft reply above before it is sent. Compare it with the user\'s latest request and the tool results in this conversation. ' +
    'A draft that describes steps you intend to take is a plan, not a result. ' +
    'A draft that asks the user for something you could find out with your tools or decide with reasonable judgement is not a result either. ' +
    `${remainingWork} ` +
    'Finding out what the request needs is remaining work; changes the user did not ask for are not, so recommend them in a sentence instead of making them. ' +
    'End the reply with the result, not with questions or offers; ask only for what only the user can give. ' +
    'If the requested outcome is complete and every action or result the draft reports is confirmed by a tool result, respond with the final reply for the user. ' +
    'The user has not seen the draft: the reply is the whole message they will read, so do not refer to the draft or to having already answered. ' +
    'If it cannot be done, or needs information or approval only the user can give, respond with what was done, what was not, and why. ' +
    'The list below is every tool call made this turn; an action that is not on it as a success did not happen, so the reply must not report it as done. ' +
    'Every fact the reply states (errors, causes, numbers, names) must appear in a tool result or the supplied context; leave out or correct anything that does not, and say what could not be found out.' +
    `\n\nTool calls this turn:\n${ledger}`
  );
}

function stringifyContext(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value ?? null) ?? String(value);
}

/**
 * Internal context markers we inject into the model's history
 * (`[Previous tool call: ...]`, `[Previous tool result from ...]`) are not
 * meant for the user. A model can echo them back verbatim, leaking raw JSON
 * into its reply. Strip those blocks (and any orphaned JSON they leave
 * behind) so the final text is clean.
 */
const LEAKED_CONTEXT_RE =
  /\[Previous tool (?:call|result from [^\]]+)\][\s\S]*?(?=\n\s*\n|\n\[Previous|$)/gi;

function stripLeakedContext(text: string): string {
  if (!text) return '';
  return text
    .replace(LEAKED_CONTEXT_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function truncateForModel(value: unknown, max = MAX_TOOL_RESULT_CHARS): string {
  const text = stringifyContext(value);
  if (text.length <= max) return text;
  const half = Math.floor((max - 32) / 2);
  return `${text.slice(0, half)}…[truncated ${text.length - half * 2} characters]…${text.slice(-half)}`;
}

function formatToolResultForModel(result: unknown): string {
  return truncateForModel(result ?? {});
}

/** Compact, tool-agnostic outcome context for a final model response. */
function summarizeToolEvents(events: ToolEvent[]): string {
  if (events.length === 0) return 'No tools ran.';
  return events
    .map((event) => {
      const outcome =
        event.status === 'failed' || event.status === 'unavailable'
          ? { status: event.status, error: event.error }
          : event.status === 'needs_approval'
            ? { status: event.status, action: event.actionName, reason: event.reason }
            : { status: event.status, result: event.result };
      return `- ${event.toolName}: ${truncateForModel(outcome, 2_000)}`;
    })
    .join('\n');
}

function contentLooksLikeToolCallDump(text: string): boolean {
  let cursor = 0;
  let calls = 0;

  while (cursor < text.length) {
    while (/\s/.test(text[cursor] ?? '')) cursor++;
    if (text[cursor] !== '{') return false;

    const start = cursor;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; cursor < text.length; cursor++) {
      const character = text[cursor];
      if (inString) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') inString = true;
      else if (character === '{') depth++;
      else if (character === '}' && --depth === 0) {
        cursor++;
        break;
      }
    }

    if (depth !== 0) return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start, cursor));
    } catch {
      return false;
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('name' in parsed) ||
      typeof parsed.name !== 'string' ||
      !('arguments' in parsed)
    ) {
      return false;
    }
    calls++;
  }

  return calls > 0;
}

/** Same tool + same error three times → stop looping and report the blockage. */
function isStuckOnSameFailure(events: ToolEvent[]): boolean {
  const fails = events.filter((e) => e.status === 'failed' || e.status === 'unavailable');
  if (fails.length < 3) return false;
  const last = fails.slice(-3);
  const key = `${last[0].toolName}::${(last[0].error || '').slice(0, 160)}`;
  return last.every((e) => `${e.toolName}::${(e.error || '').slice(0, 160)}` === key);
}

/** Keep model output separate from execution errors; do not synthesize user-facing replies. */
function ensureTurnReply(
  text: string | undefined,
  events: ToolEvent[],
  error?: TurnResult['error']
): TurnResult {
  const trimmed = text?.trim();
  if (trimmed && !contentLooksLikeToolCallDump(trimmed)) {
    return { text: trimmed, tools: events, waitingForApproval: false, error };
  }
  return {
    tools: events,
    waitingForApproval: false,
    error: error ?? {
      kind: 'bad_response',
      message: 'The model did not return a usable response.',
    },
  };
}

function buildToolCapabilityContext(tools: BotToolSpec[]): string {
  const availableTools = tools
    .map((tool) => `- ${tool.name}: ${tool.description}`)
    .join('\n');
  return `\n\nAuthoritative tool access for this bot in this turn:
${
  availableTools || '- No external tools are currently enabled and connected for this bot.'
}
The list above is every tool this bot can use on this turn.`;
}

/** Each tool's argument names, types, and meanings, for endpoints that take no tool schemas. */
function describeToolArguments(tools: BotToolSpec[]): string {
  return tools
    .map((tool) => {
      const properties = Object.entries<{ type?: string; description?: string; enum?: string[] }>(
        tool.parameters?.properties ?? {}
      );
      if (properties.length === 0) return `- ${tool.name}: no arguments`;
      const required = new Set(tool.parameters?.required ?? []);
      const args = properties.map(([name, schema]) => {
        const options = schema.enum?.length ? ` one of ${schema.enum.join('|')}` : '';
        const description = schema.description ? ` - ${schema.description}` : '';
        return `${name} (${schema.type}${options}${required.has(name) ? ', required' : ''})${description}`;
      });
      return `- ${tool.name}: ${args.join('; ')}`;
    })
    .join('\n');
}

function buildSystemPrompt(bot: Bot, userName: string, tools: BotToolSpec[]): string {
  return `${bot.systemPrompt}\nUser Name: ${userName}. You are participating in workspace chat as ${bot.name} (${bot.roleTitle}). Keep responses concise, actionable, and aligned with your role.\n\n${AUTONOMY_RULES}${buildToolCapabilityContext(tools)}`;
}

function buildBotIdentityInstructions(bot: Bot): string {
  return `Authoritative bot identity: You are ${bot.name}, serving as ${bot.roleTitle}. Be transparent that you are an AI assistant; do not claim to be human.`;
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
    ? `${overrideSystemPrompt}\n\n${AUTONOMY_RULES}${buildToolCapabilityContext(tools)}`
    : buildSystemPrompt(bot, userName, tools);
  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        base,
        buildBotIdentityInstructions(bot),
        systemAddendum,
      ].filter(Boolean).join('\n\n'),
    },
  ];

  const recent = history.slice(-20);
  const resultsByCallId = new Map(
    recent
      .filter((m) => m.type === 'tool_result' && m.metadata?.toolResult?.callId)
      .map((m) => [m.metadata!.toolResult!.callId, m.metadata!.toolResult!])
  );
  const pairedResults = new Set<string>();

  for (const m of recent) {
    if (m.type === 'text') {
      const content =
        m.content.length > 2_000 ? `${m.content.slice(0, 2_000)}…` : m.content;
      messages.push({ role: m.senderType === 'user' ? 'user' : 'assistant', content });
      continue;
    }

    // An earlier call and its result keep the same call/result shape as calls made in this turn.
    const paired = m.type === 'tool_call' && m.metadata?.toolCall
      ? resultsByCallId.get(m.metadata.toolCall.callId)
      : undefined;
    if (m.type === 'tool_call' && m.metadata?.toolCall && paired) {
      const { toolName, args, callId } = m.metadata.toolCall;
      pairedResults.add(callId);
      messages.push({
        role: 'assistant',
        content: null,
        tool_calls: [{ id: callId, type: 'function', function: { name: toolName, arguments: JSON.stringify(args ?? {}) } }],
      });
      messages.push({
        role: 'tool',
        tool_call_id: callId,
        content: truncateForModel({ status: paired.status, result: paired.result }, MAX_CONTEXT_ITEM_CHARS),
      });
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

    if (m.type === 'tool_result' && m.metadata?.toolResult && pairedResults.has(m.metadata.toolResult.callId)) {
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

/** Rejects a call that omits a required argument, naming what the tool accepts. */
function assertRequiredArgs(spec: BotToolSpec | undefined, args: Record<string, any>): void {
  const required: string[] = Array.isArray(spec?.parameters?.required) ? spec!.parameters.required : [];
  const missing = required.filter((key) => args[key] == null);
  if (missing.length === 0) return;
  const accepted = Object.keys(spec?.parameters?.properties ?? {});
  throw new Error(
    `Missing required argument(s): ${missing.join(', ')}. Arguments this tool accepts: ${accepted.join(', ') || 'none'}.`
  );
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

const FREE_ENDPOINT_HEADERS = {
  'Content-Type': 'application/json',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36',
  Origin: 'https://rusherai.com',
  Referer: 'https://rusherai.com/',
  Accept: '*/*',
};

/**
 * This endpoint has no system role and weighs the latest turn far above an
 * opening message, so the turn's context travels with the latest user-role
 * message instead of sitting before the whole history.
 */
function toFreeEndpointMessages(
  messages: ChatMessage[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const context = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content || '')
    .filter(Boolean)
    .join('\n\n');
  const converted = toFreeEndpointTurns(messages.filter((message) => message.role !== 'system'));

  if (!context) return converted;
  const latestUser = converted.map((message) => message.role).lastIndexOf('user');
  if (latestUser === -1 || latestUser !== converted.length - 1) {
    return [...converted, { role: 'user', content: `Context for this turn:\n${context}` }];
  }
  const target = converted[latestUser];
  converted[latestUser] = {
    role: 'user',
    content: `Context for this turn:\n${context}\n\n---\nLatest message:\n${target.content}`,
  };
  return converted;
}

function toFreeEndpointTurns(
  messages: ChatMessage[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const toolNames = new Map<string, string>();
  return messages.map((message) => {
    if (message.role === 'tool') {
      const toolName = toolNames.get(message.tool_call_id || '') || 'tool';
      return {
        role: 'user',
        content: `Result from ${toolName}:\n${message.content || ''}`,
      };
    }

    if (message.role === 'assistant' && message.tool_calls?.length) {
      for (const call of message.tool_calls) toolNames.set(call.id, call.function.name);
      return {
        role: 'assistant',
        content: [
          message.content,
          ...message.tool_calls.map(
            (call) => `<tool_call>{"name":${JSON.stringify(call.function.name)},"arguments":${call.function.arguments || '{}'}}</tool_call>`
          ),
        ]
          .filter(Boolean)
          .join('\n'),
      };
    }

    return { role: message.role === 'assistant' ? 'assistant' : 'user', content: message.content || '' };
  });
}

interface CompletionRequestOptions {
  /** Overrides `wiring.model` for this request. */
  model?: string;
  maxTokens: number;
  temperature: number;
  tools?: BotToolSpec[];
  toolChoice?: 'auto' | 'required';
  reasoningEffort?: string;
}

async function fetchCompletion(
  wiring: LlmWiring,
  messages: ChatMessage[],
  options: CompletionRequestOptions
): Promise<Response> {
  if (wiring.provider === 'free_endpoint') {
    return fetchGateway(wiring.endpoint, {
      method: 'POST',
      headers: FREE_ENDPOINT_HEADERS,
      body: JSON.stringify({
        messages: toFreeEndpointMessages(messages),
        modelId: options.model ?? wiring.model,
        thinking: false,
        deepSearch: false,
        stream: false,
      }),
    });
  }

  return fetchGateway(`${wiring.endpoint.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${wiring.apiKey}`,
    },
    body: JSON.stringify({
      model: wiring.model,
      messages,
      ...(options.tools?.length
        ? {
            tools: toOpenAiTools(options.tools),
            tool_choice: options.toolChoice ?? 'auto',
          }
        : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      max_tokens: options.maxTokens,
      temperature: options.temperature,
    }),
  });
}

async function readCompletionResponse(response: Response): Promise<ChatCompletionResponse> {
  const responseText = await response.text();
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    const content: string[] = [];
    let usage: ChatCompletionResponse['usage'];

    for (const line of responseText.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const event = JSON.parse(data) as {
          choices?: Array<{
            message?: { content?: unknown };
            delta?: { content?: unknown };
          }>;
          usage?: ChatCompletionResponse['usage'];
        };
        const choice = event.choices?.[0];
        const text = choice?.message?.content ?? choice?.delta?.content;
        if (typeof text === 'string') content.push(text);
        if (event.usage) usage = event.usage;
      } catch {
        content.push(data);
      }
    }

    if (content.length === 0) {
      throw new Error('Endpoint returned an empty streaming response.');
    }
    return { choices: [{ message: { content: content.join('') } }], usage };
  }

  let result: unknown;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error('Endpoint returned invalid JSON.');
  }
  if (!result || typeof result !== 'object') {
    throw new Error('Endpoint returned an unsupported response format.');
  }

  const completion = result as ChatCompletionResponse & { content?: unknown };
  if (Array.isArray(completion.choices)) return completion;
  if (typeof completion.content === 'string') {
    return { choices: [{ message: { content: completion.content } }] };
  }
  throw new Error('Endpoint returned an unsupported response format.');
}

/** The reasoning model's plan for this turn, or undefined; the turn proceeds without one. */
async function planTurn(wiring: LlmWiring, model: string, messages: ChatMessage[]): Promise<string | undefined> {
  try {
    const res = await fetchCompletion(wiring, [...messages, { role: 'system', content: PLAN_PROMPT }], {
      model,
      maxTokens: 800,
      temperature: 0.2,
    });
    if (!res.ok) return undefined;
    const data = await readCompletionResponse(res);
    const content = data.choices?.[0]?.message?.content;
    const plan = stripLeakedContext(stripEmbeddedToolMarkup(typeof content === 'string' ? content : '')).trim();
    return plan || undefined;
  } catch {
    return undefined;
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
  /** Grok-style reasoning mode: think / big_brain / off. */
  reasoningMode?: ReasoningMode;
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
  const usesFreeEndpoint = wiring.provider === 'free_endpoint';
  const url = usesFreeEndpoint
    ? wiring.endpoint
    : `${wiring.endpoint.replace(/\/+$/, '')}/chat/completions`;
  const freeEndpointToolInstructions =
    usesFreeEndpoint && tools.length > 0
      ? 'This endpoint does not support structured function calls. When you need a tool, emit exactly one block in this format: <tool_call>{"name":"EXACT_TOOL_NAME","arguments":{"argument":"value"}}</tool_call>. Use only the exact tool names listed above, and wait for the tool result before continuing.\n\n' +
        `Arguments each tool accepts:\n${describeToolArguments(tools)}`
      : '';
  const messages = buildInitialMessages(
    bot,
    params.userName,
    tools,
    params.history,
    params.messageContent,
    params.overrideSystemPrompt,
    [params.systemAddendum, freeEndpointToolInstructions].filter(Boolean).join('\n\n') || undefined
  );

  const collected: ToolEvent[] = [];
  // Tools already reported as unavailable, so a stubborn model retrying the
  // same one stops the tool loop instead of burning every round.
  const unavailableSeen = new Set<string>();
  let usage: TurnResult['tokenUsage'];
  let stopToolLoop = false;
  let emptyReplyRetries = 0;
  let gatewayEmptyRetries = 0;
  let reviewedAtToolCount: number | null = null;
  let lastDraft: string | undefined;
  const turnStartedAt = Date.now();
  const reasoner = wiring.reasoningModel && wiring.reasoningModel !== model ? wiring.reasoningModel : undefined;
  let reasonNext = false;
  let reviewStart = 0;

  // Grok-style reasoning modes map to OpenAI-compatible reasoning_effort.
  // think = medium, big_brain = high, off = none. The gateway decides how
  // much extra compute that costs; we just ask and report what we got.
  const reasoningMode = params.reasoningMode ?? 'off';
  const reasoningEffort =
    reasoningMode === 'big_brain' ? 'high' :
    reasoningMode === 'think' ? 'medium' : undefined;

  try {
    if (reasoner && tools.length > 0) {
      const plan = await planTurn(wiring, reasoner, messages);
      if (plan) {
        messages.push({
          role: 'system',
          content: `Your plan for this turn, worked out before acting (adjust it as tool results come in):\n${plan}`,
        });
      }
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS && !stopToolLoop; round++) {
      // Leave headroom for the forced final answer before the client/proxy gives up.
      if (Date.now() - turnStartedAt > TURN_BUDGET_MS) {
        messages.push({
          role: 'system',
          content: 'The available time for tool execution has elapsed. Stop tool calls for this turn.',
        });
        stopToolLoop = true;
        break;
      }

      if (isStuckOnSameFailure(collected)) {
        stopToolLoop = true;
        break;
      }

      const reasoningRound = Boolean(reasoner) && (tools.length === 0 || reasonNext);
      reasonNext = false;

      const res = usesFreeEndpoint
        ? await fetchCompletion(wiring, messages, {
            model: reasoningRound ? reasoner : undefined,
            tools,
            toolChoice: 'auto',
            reasoningEffort,
            maxTokens: tools.length > 0 ? 8192 : 2048,
            temperature: tools.length > 0 ? 0.2 : 0.7,
          })
        : await fetchGateway(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${wiring.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          ...(tools.length > 0
            ? {
                tools: toOpenAiTools(tools),
                tool_choice: 'auto',
              }
            : {}),
          // Grok-style reasoning: think = medium, big_brain = high, off = none.
          // The gateway maps this to its own reasoning budget.
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          // Tool arguments can contain full content payloads, so allow room for complete calls.
          max_tokens: tools.length > 0 ? 8192 : 2048,
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
            ? usesFreeEndpoint ? '' : ' (check the bot API key in bot settings)'
            : res.status === 402 || res.status === 503
              ? ' (gateway reports insufficient balance)'
              : res.status === 429
                ? ' (rate limited â€” try again shortly)'
                : '';
        return { tools: collected, waitingForApproval: false, error: { kind: 'http', message: `${usesFreeEndpoint ? 'Endpoint' : 'Gateway'} returned ${res.status}${detail}${hint}` } };
      }

      const data = usesFreeEndpoint
        ? await readCompletionResponse(res)
        : ((await res.json()) as ChatCompletionResponse);
      if (data.usage) {
        usage = {
          promptTokens: data.usage.prompt_tokens ?? 0,
          completionTokens: data.usage.completion_tokens ?? 0,
          totalTokens: data.usage.total_tokens ?? 0,
        };
      }

      const choice = data.choices?.[0];
      // Empty choices from the LLM gateway — retry instead of failing the turn.
      if (!choice?.message) {
        if (gatewayEmptyRetries < 3 && round < MAX_TOOL_ROUNDS - 1) {
          gatewayEmptyRetries += 1;
          messages.push({
            role: 'system',
            content: 'The previous response was empty. Continue the conversation based on the request and available context.',
          });
          continue;
        }
        if (collected.length > 0) {
          stopToolLoop = true;
          break;
        }
        return {
          ...ensureTurnReply(undefined, collected, {
            kind: 'bad_response',
            message: 'The model returned no content.',
          }),
          tokenUsage: usage,
        };
      }

      const message = choice.message;
      const rawContent = typeof message?.content === 'string' ? message.content : '';
      let toolCalls = message?.tool_calls ?? [];
      const finishReason = choice?.finish_reason;

      // Some models emit tool requests as XML in content instead of tool_calls.
      if (toolCalls.length === 0 && contentLooksLikeToolMarkup(rawContent)) {
        toolCalls = extractEmbeddedToolCalls(
          rawContent,
          tools.map((tool) => tool.name)
        );
      }

      // Truncated tool-call JSON — ask the model to retry the same tool cleanly.
      if (
        toolCalls.length === 0 &&
        finishReason === 'length' &&
        tools.length > 0 &&
        round < MAX_TOOL_ROUNDS - 1
      ) {
        messages.push({
          role: 'system',
          content: 'The previous tool request was incomplete. Retry it with complete, valid arguments.',
        });
        continue;
      }

      // No structured tool calls this round.
      if (toolCalls.length === 0) {
        const text = stripLeakedContext(stripEmbeddedToolMarkup(rawContent));
        const canContinue = tools.length > 0 && round < MAX_TOOL_ROUNDS - 1;

        if (!text.trim()) {
          if (canContinue && collected.length > 0 && emptyReplyRetries < 4) {
            emptyReplyRetries += 1;
            messages.push({
              role: 'system',
              content: 'The previous response was empty. Continue or conclude based on the request and results so far.',
            });
            continue;
          }
          if (collected.length > 0) {
            stopToolLoop = true;
            break;
          }
          if (lastDraft) return { ...ensureTurnReply(lastDraft, collected), tokenUsage: usage };
          return {
            ...ensureTurnReply(undefined, collected, {
              kind: 'bad_response',
              message: 'The model returned no content.',
            }),
            tokenUsage: usage,
          };
        }

        const handBack = reasoningRound && tools.length > 0 ? CONTINUE_MARKER.exec(text) : null;
        if (handBack) {
          if (!canContinue) {
            stopToolLoop = true;
            break;
          }
          const next = text.slice(handBack.index + handBack[0].length).trim();
          // The draft was never sent; keeping it would let its unverified claims carry forward.
          messages.splice(reviewStart);
          messages.push({
            role: 'system',
            content: `Your review found more to do before replying: ${next || 'finish the remaining work.'}`,
          });
          continue;
        }

        // A draft is final only after the model has checked it against the request
        // and this turn's tool results; new tool activity since the last check needs another.
        const needsReview = canContinue && (reviewedAtToolCount === null || collected.length > reviewedAtToolCount);
        if (needsReview) {
          reviewedAtToolCount = collected.length;
          lastDraft = text;
          reviewStart = messages.length;
          messages.push({ role: 'assistant', content: text });
          messages.push({ role: 'system', content: selfReviewPrompt(collected, Boolean(reasoner)) });
          reasonNext = Boolean(reasoner);
          continue;
        }

        return { ...ensureTurnReply(text, collected), tokenUsage: usage };
      }

      // The model wants to act: record its request, then execute through the gateway.
      // Never keep raw tool markup in the assistant content sent back to the model.
      const visibleContent = stripLeakedContext(stripEmbeddedToolMarkup(rawContent));
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
          sanitizeToolArgs(call.function.name, args);
          assertRequiredArgs(tools.find((tool) => tool.name === call.function.name), args);
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
            content: JSON.stringify({ status: 'needs_approval', action: execution.actionName, reason: execution.reason }),
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

          const unavailable =
            execution.kind === 'missing'
              ? { status: 'unavailable', plugin: execution.pluginSlug }
              : { status: 'disabled', tool: execution.toolName };
          collected.push({
            callId: call.id,
            toolName: call.function.name,
            args,
            status: 'unavailable',
            error: JSON.stringify(unavailable),
            // Lets the UI show a real "Connect this service" card
            missingPluginSlug: execution.kind === 'missing' ? execution.pluginSlug : undefined,
          });
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(unavailable),
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

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: formatToolResultForModel(execution.result),
        });
      }

    }

    // Let the model summarize the observed outcomes when tool execution ends.
    const toolDigest = summarizeToolEvents(collected);
    const slimHistory = messages.filter((m) => m.role === 'system' || m.role === 'user').slice(0, 4);
    const finalMessages: ChatMessage[] = [
      ...slimHistory,
      {
        role: 'system',
        content:
          'No more tools can be called in this turn. Respond to the user using the observed outcomes below. ' +
          'Be accurate about what completed and what remains unresolved; do not claim unverified results.\n\n' +
          `Tool outcomes:\n${toolDigest}`,
      },
      { role: 'user', content: params.messageContent },
    ];

    const finalRes = usesFreeEndpoint
      ? await fetchCompletion(wiring, finalMessages, {
          model: reasoner,
          maxTokens: 1500,
          temperature: 0.3,
          reasoningEffort,
        })
      : await fetchGateway(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${wiring.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: finalMessages,
        max_tokens: 1500,
        temperature: 0.3,
        ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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
      return {
        ...ensureTurnReply(undefined, collected, {
          kind: 'http',
          message: `${usesFreeEndpoint ? 'Endpoint' : 'Gateway'} returned ${finalRes.status}${detail}`,
        }),
        tokenUsage: usage,
      };
    }

    const finalData = usesFreeEndpoint
      ? await readCompletionResponse(finalRes)
      : ((await finalRes.json()) as ChatCompletionResponse);
    if (finalData.usage) {
      usage = {
        promptTokens: finalData.usage.prompt_tokens ?? 0,
        completionTokens: finalData.usage.completion_tokens ?? 0,
        totalTokens: finalData.usage.total_tokens ?? 0,
      };
    }

    const finalText = stripLeakedContext(stripEmbeddedToolMarkup(finalData.choices?.[0]?.message?.content ?? ''));
    const safeFinal =
      finalText.trim() && !contentLooksLikeToolMarkup(finalText) ? finalText : undefined;
    return {
      ...ensureTurnReply(safeFinal, collected),
      tokenUsage: usage,
      reasoningMode,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...ensureTurnReply(undefined, collected, {
        kind: 'network',
        message: `Could not reach the ${usesFreeEndpoint ? 'endpoint' : 'gateway'}: ${message}`,
      }),
      tokenUsage: usage,
    };
  }
}

/**
 * Checks a bot's provider credentials by issuing a minimal completion.
 * Returns a human-readable outcome plus the HTTP status for the UI.
 */
export async function verifyAiConfig(
  apiKey: string,
  endpoint: string,
  model?: string,
  provider: Bot['aiProvider'] = 'kilo_gateway'
): Promise<{
  ok: boolean;
  message: string;
  status?: number;
}> {
  if (provider === 'free_endpoint') {
    try {
      const response = await fetchCompletion(
        {
          provider,
          endpoint: AI_PROVIDERS.free_endpoint.endpoint,
          apiKey: '',
          model: AI_PROVIDERS.free_endpoint.model,
        },
        [{ role: 'user', content: 'ping' }],
        { maxTokens: 1, temperature: 0 }
      );
      if (!response.ok) {
        return {
          ok: false,
          message: `Verification failed (${response.status}).`,
          status: response.status,
        };
      }
      const result = await readCompletionResponse(response);
      if (typeof result.choices?.[0]?.message?.content !== 'string') {
        return { ok: false, message: 'Endpoint returned no chat response.', status: response.status };
      }
      return { ok: true, message: 'Free Model Endpoint verified — this bot can chat.', status: response.status };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message: `Could not reach the endpoint: ${message}` };
    }
  }

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
