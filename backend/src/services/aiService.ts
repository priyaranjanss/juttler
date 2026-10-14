import { Bot, Message } from '../types';
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
/** Default cap for tool JSON in the model context. File reads get a higher cap. */
const MAX_TOOL_RESULT_CHARS = 3_500;
const MAX_FILE_RESULT_CHARS = 16_000;
const EXPLORE_TOOLS = new Set([
  'github.list_files',
  'github.list_tree',
  'github.list_commits',
  'github.list_prs',
  'github.list_branches',
  'jira.search_tickets',
  'jira.list_projects',
  'jira.list_transitions',
]);
const ACT_TOOLS = new Set([
  'github.write_file',
  'github.delete_file',
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

/** Tool results for the model — keep get_file as valid JSON with usable content. */
function formatToolResultForModel(toolName: string, result: unknown): string {
  if (toolName === 'github.get_file' && result && typeof result === 'object') {
    const row = result as Record<string, any>;
    if (typeof row.content === 'string') {
      const overhead = JSON.stringify({
        path: row.path,
        type: row.type,
        size: row.size,
        sha: row.sha,
        truncated: true,
        content: '',
      }).length;
      const budget = Math.max(2_000, MAX_FILE_RESULT_CHARS - overhead);
      const cut = row.content.length > budget;
      return JSON.stringify({
        path: row.path,
        type: row.type ?? 'file',
        size: row.size,
        sha: row.sha ?? null,
        truncated: Boolean(row.truncated) || cut,
        content: cut ? row.content.slice(0, budget) : row.content,
      });
    }
  }
  return truncateForModel(result ?? {}, toolResultBudget(toolName));
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

/** Pull useful fields so fallbacks / forced finals still carry real substance. */
function highlightToolResult(toolName: string, result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const row = result as Record<string, any>;

  // Keep a short excerpt for the model digest — never dump whole files into user chat.
  if (toolName === 'github.get_file' && typeof row.content === 'string') {
    const body = row.content.length > 1_200 ? `${row.content.slice(0, 1_200)}…` : row.content;
    return `${row.path || 'file'} (${row.size ?? body.length} bytes): ${body.replace(/\s+/g, ' ').slice(0, 400)}`;
  }
  if (toolName === 'github.search_code' && Array.isArray(row.results)) {
    return row.results
      .slice(0, 12)
      .map((hit: any) => {
        const frag = hit.matches?.[0]?.fragment;
        return frag ? `${hit.path}: ${String(frag).slice(0, 240)}` : String(hit.path || '');
      })
      .filter(Boolean)
      .join('\n');
  }

  const bits: string[] = [];
  if (row.key) bits.push(String(row.key));
  if (row.summary) bits.push(String(row.summary));
  if (row.description && typeof row.description === 'string') {
    bits.push(row.description.length > 400 ? `${row.description.slice(0, 400)}…` : row.description);
  }
  if (row.status) bits.push(`status ${row.status}`);
  if (row.transition || row.to) bits.push(`→ ${row.to || row.transition}`);
  if (row.branch) bits.push(`branch ${row.branch}`);
  if (row.html_url || row.url || row.pr_url) bits.push(String(row.html_url || row.url || row.pr_url));
  if (row.path && toolName !== 'github.get_file') bits.push(String(row.path));
  if (typeof row.returned === 'number') bits.push(`${row.returned} rows`);
  if (Array.isArray(row.entries)) bits.push(`${row.entries.length} entries`);
  if (row.error) bits.push(String(row.error));
  if (bits.length === 0 && toolName) return truncateForModel(result, 160);
  return bits.join(' · ');
}

function toolResultBudget(toolName: string): number {
  if (
    toolName === 'github.get_file' ||
    toolName === 'github.search_code' ||
    toolName === 'github.list_tree' ||
    toolName === 'jira.get_ticket'
  ) {
    return MAX_FILE_RESULT_CHARS;
  }
  return MAX_TOOL_RESULT_CHARS;
}

/** Short line for Slack/UI when the model fails to write a real reply. */
function shortUserHighlight(toolName: string, result: unknown): string {
  if (!result || typeof result !== 'object') return toolName;
  const row = result as Record<string, any>;
  if (toolName === 'github.get_file' && row.path) {
    return `Read ${row.path}${typeof row.size === 'number' ? ` (${row.size} bytes)` : ''}`;
  }
  if (row.key && row.summary) return `${row.key}: ${row.summary}`;
  if (row.html_url || row.url || row.pr_url) return String(row.html_url || row.url || row.pr_url);
  if (row.branch) return `Branch ${row.branch}`;
  if (row.path) return String(row.path);
  if (Array.isArray(row.entries)) return `Listed ${row.entries.length} paths`;
  return toolName;
}

/**
 * Last-resort user reply — never a Progress / tool inventory dump.
 * Prefer a single outcome line from successful mutations, else a short blocker.
 */
function userFacingOutcome(events: ToolEvent[]): string {
  if (events.length === 0) return 'I could not complete that.';

  if (events.some((e) => e.status === 'needs_approval')) {
    return 'I need your approval in Juttler before I can finish that action.';
  }

  const wins = events.filter((e) => e.status === 'success' && ACT_TOOLS.has(e.toolName));
  if (wins.length > 0) {
    const lines = wins.map((e) => shortUserHighlight(e.toolName, e.result)).slice(0, 4);
    return `Done. ${lines.join(' · ')}`;
  }

  const fail = events.find((e) => e.status === 'failed' || e.status === 'unavailable');
  if (fail) {
    const err = (fail.error || 'failed').replace(/\s+/g, ' ').trim().slice(0, 220);
    return `I hit a blocker on ${fail.toolName}: ${err}`;
  }

  if (turnHasReads(events)) {
    return 'I gathered the context but did not finish applying the change. Say continue and I will write the patch and open a PR.';
  }

  return 'I could not finish that yet. Try asking again with a bit more detail.';
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
      // Prior Progress dumps teach the model to dump tools — skip them.
      if (/^here is what i got so far:/i.test(m.content.trim()) || /^progress:/i.test(m.content.trim())) {
        continue;
      }
      const content =
        m.content.length > 2_000 ? `${m.content.slice(0, 2_000)}…` : m.content;
      messages.push({ role: m.senderType === 'user' ? 'user' : 'assistant', content });
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

function toolChoiceFor(
  round: number,
  tools: BotToolSpec[],
  message: string,
  forceTools = false
): 'auto' | 'required' {
  if (tools.length === 0) return 'auto';
  if (forceTools) return 'required';
  if (round > 0) return 'auto';
  const text = message.trim().toLowerCase();
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|yo|sup|good morning|good night)[!.?\s]*$/.test(text)) {
    return 'auto';
  }
  return 'required';
}

function turnHasAction(events: ToolEvent[]): boolean {
  return events.some((event) => event.status === 'success' && ACT_TOOLS.has(event.toolName));
}

function turnHasReads(events: ToolEvent[]): boolean {
  return events.some(
    (event) =>
      event.status === 'success' &&
      (event.toolName === 'github.get_file' ||
        event.toolName === 'github.search_code' ||
        event.toolName === 'jira.get_ticket')
  );
}

const CHANGE_VERBS =
  /\b(fix|implement|write|create|update|change|add|remove|delete|refactor|patch|ship|build|code|pr\b|pull request|commit|resolve|close|transition|assign|do the|finish|complete|handle|do it|do now|do this|do that|go ahead|continue|retry|again)\b/i;

const PURE_QUESTION =
  /^(what|what's|whats|who|where|when|why|how|which|show|explain|summarize|summarise|describe|list|find|look)\b/i;

const SHORT_FOLLOW_UP =
  /^(do(\s+(it|now|that|this))?|go(\s+ahead)?|yes|yep|yeah|please|continue|retry|again|fix(\s+it)?|ship(\s+it)?|ok|okay)[.!]*$/i;

function priorUserWantedWork(history: Message[]): boolean {
  for (const m of [...history].reverse().slice(0, 12)) {
    if (m.type !== 'text' || m.senderType !== 'user') continue;
    const text = m.content.trim();
    if (!text) continue;
    if (CHANGE_VERBS.test(text) || /\b[A-Za-z][A-Za-z0-9]+-\d+\b/.test(text)) return true;
  }
  return false;
}

/** True when the user wants changes applied, not just an explanation of existing code/tickets. */
function userAskedForChanges(message: string, history: Message[] = []): boolean {
  const text = message.trim();
  if (!text) return priorUserWantedWork(history);
  if (/^(hi|hey|hello|thanks|thank you|ok|okay|yo|sup|good morning|good night)[!.?\s]*$/i.test(text)) {
    return false;
  }
  if (SHORT_FOLLOW_UP.test(text)) return true;
  if (/\b[A-Za-z][A-Za-z0-9]+-\d+\b/.test(text) && !PURE_QUESTION.test(text)) return true;
  if (PURE_QUESTION.test(text) && !CHANGE_VERBS.test(text)) return false;
  if (CHANGE_VERBS.test(text)) return true;
  // Short Slack nudges inherit open work from the thread.
  if (text.length <= 40 && priorUserWantedWork(history)) return true;
  return text.length > 12;
}

/** Reads/failed reads without a write/PR/Jira mutation — keep the loop going. */
function needsActionAfterReads(events: ToolEvent[], message: string, history: Message[] = []): boolean {
  if (turnHasAction(events)) return false;
  if (!userAskedForChanges(message, history)) return false;
  if (turnHasReads(events)) return true;
  // Failed get_file / search still means we should retry and finish, not dump Progress.
  return events.some(
    (e) =>
      (e.status === 'failed' || e.status === 'success') &&
      (e.toolName.startsWith('github.') || e.toolName.startsWith('jira.'))
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
  let forceToolsNext = false;
  let emptyReplyRetries = 0;
  let actionNudges = 0;
  const wantsChanges = userAskedForChanges(params.messageContent, params.history);

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
            ? {
                tools: toOpenAiTools(tools),
                tool_choice: toolChoiceFor(round, tools, params.messageContent, forceToolsNext),
              }
            : {}),
          // write_file payloads need headroom; low caps yield empty / truncated tool calls.
          max_tokens: tools.length > 0 ? 8192 : 2048,
          temperature: tools.length > 0 ? 0.2 : 0.7,
        }),
      });
      forceToolsNext = false;

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
          content:
            'Your previous response was cut off. Call the next tool again with complete, valid JSON arguments. ' +
            'For file paths use a clean repo-relative path with no braces or quotes around it.',
        });
        forceToolsNext = true;
        continue;
      }

      // No structured tool calls this round.
      if (toolCalls.length === 0) {
        const text = stripEmbeddedToolMarkup(rawContent);
        const canContinue = tools.length > 0 && round < MAX_TOOL_ROUNDS - 1;
        const needsMoreWork = needsActionAfterReads(collected, params.messageContent, params.history);

        // Empty model output after tools: retry instead of dumping raw progress.
        if (!text.trim()) {
          if (canContinue && collected.length > 0 && emptyReplyRetries < 4) {
            emptyReplyRetries += 1;
            forceToolsNext = needsMoreWork || collected.length > 0;
            messages.push({
              role: 'system',
              content: needsMoreWork
                ? 'Your last message was empty. Continue with tools: create_branch / write_file / create_pull_request (or the Jira update tools) to finish the user request. Do not stop after only reading. Never reply with a Progress list.'
                : 'Your last message was empty. Call the next tool needed to finish the user request, or if the work is already done, write a short plain-language answer with no tool dumps.',
            });
            continue;
          }
          if (collected.length > 0) {
            stopToolLoop = true;
            break;
          }
          return {
            tools: collected,
            tokenUsage: usage,
            waitingForApproval: false,
            error: { kind: 'bad_response', message: 'Gateway returned no content.' },
          };
        }

        // Model tried to answer after only reading — push it to finish the work.
        if (canContinue && needsMoreWork && actionNudges < 5) {
          actionNudges += 1;
          messages.push({ role: 'assistant', content: text });
          messages.push({
            role: 'system',
            content:
              'That reply is premature. You have read context but have not applied changes yet. ' +
              'Call tools now to finish (for code: create_branch, write_file, create_pull_request as needed). ' +
              'Only after those tools succeed should you summarize for the user. Never list Progress or tool inventories.',
          });
          forceToolsNext = true;
          continue;
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
          sanitizeToolArgs(call.function.name, args);
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

        let toolContent = formatToolResultForModel(call.function.name, execution.result);
        if (!execution.ok) {
          toolContent +=
            '\nRetry with corrected arguments if needed (paths must be clean repo-relative paths, no braces). ' +
            'Then continue until the user request is finished.';
        } else {
          toolContent +=
            '\nIf this does not finish the user request, call the next tool before you reply. Do not post Progress lists.';
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolContent,
        });
      }

      // A round where every tool was unavailable or disabled gained nothing.
      // Asking for more tools will not fix it, so go to the final answer.
      const gainedNothing = collected.length > 0 && collected.every((e) => e.status === 'unavailable');
      if (gainedNothing) {
        stopToolLoop = true;
      }

      // Too much directory browsing without acting — push the model to finish.
      // Reading file contents does not count; that is real developer work.
      if (!stopToolLoop && exploreStreak >= 6) {
        messages.push({
          role: 'system',
          content:
            'You have listed enough paths. Read the specific files you need with get_file if you have not, then act ' +
            '(write_file, create_branch, create_pull_request, update/comment/transition, or answer). ' +
            'Do not claim you cannot see code if get_file already returned content.',
        });
        exploreStreak = 0;
        forceToolsNext = true;
      }

      // After reading code for a change request, push for write/branch/PR before chat.
      if (
        !stopToolLoop &&
        wantsChanges &&
        turnHasReads(collected) &&
        !turnHasAction(collected) &&
        actionNudges < 5 &&
        round < MAX_TOOL_ROUNDS - 1
      ) {
        actionNudges += 1;
        messages.push({
          role: 'system',
          content:
            'You have file/ticket context. Next call tools that apply the change ' +
            '(create_branch, write_file, delete_file, create_pull_request, or Jira update/comment/status). ' +
            'Do not reply to the user until those tools have run or a tool error blocks you. Never post Progress lists.',
        });
        forceToolsNext = true;
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
    const toolDigest = summarizeToolEvents(collected)
      .split('\n')
      .map((line) => (line.length > 280 ? `${line.slice(0, 280)}…` : line))
      .join('\n');
    // Compact code excerpts only — full dumps make the final call return empty.
    const recentReads = collected
      .filter(
        (event) =>
          event.status === 'success' &&
          (event.toolName === 'github.get_file' || event.toolName === 'jira.get_ticket')
      )
      .slice(-3)
      .map((event) => {
        const row = event.result as Record<string, any> | undefined;
        if (!row) return '';
        if (event.toolName === 'github.get_file' && typeof row.content === 'string') {
          const body = row.content.length > 2_500 ? `${row.content.slice(0, 2_500)}…` : row.content;
          return `${row.path}:\n${body}`;
        }
        if (event.toolName === 'jira.get_ticket') {
          return `${row.key || ''}: ${row.summary || ''} — ${String(row.description || '').slice(0, 800)}`;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n');
    const slimHistory = messages.filter((m) => m.role === 'system' || m.role === 'user').slice(0, 4);
    const finalMessages: ChatMessage[] = [
      ...slimHistory,
      {
        role: 'system',
        content:
          'You cannot call any more tools. Write a clear short reply for the user. ' +
          'No JSON, no XML, no code dumps, no "Progress:" lists. ' +
          'Say what changed (or what blocked you) in plain language.\n\n' +
          `Outcomes:\n${toolDigest}` +
          (recentReads ? `\n\nKey excerpts you already read:\n${recentReads}` : ''),
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
        max_tokens: 1500,
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
          text: userFacingOutcome(collected),
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
    if (
      finalText.trim() &&
      !contentLooksLikeToolMarkup(finalText) &&
      !/^here is what i got so far:/i.test(finalText.trim()) &&
      !/^progress:/i.test(finalText.trim())
    ) {
      return { text: finalText, tools: collected, tokenUsage: usage, waitingForApproval: false };
    }

    if (collected.length > 0) {
      return {
        text: userFacingOutcome(collected),
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
