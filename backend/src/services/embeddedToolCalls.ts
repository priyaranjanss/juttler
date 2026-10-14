/**
 * Some gateways/models put tool requests in the assistant text as XML
 * (e.g. <dots_function_call><invoke ...>) instead of OpenAI tool_calls.
 * Parse those so we can execute them and never show the markup to the user.
 */

export interface EmbeddedToolCall {
  id: string;
  function: { name: string; arguments: string };
}

const BLOCK_RE =
  /<(?:[\w.-]+:)?(?:dots_function_call|tool_call|function_call)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?(?:dots_function_call|tool_call|function_call)>/gi;
const INVOKE_RE = /<invoke\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/invoke>/gi;
const PARAM_RE = /<parameter\s+name=["']([^"']+)["']\s*>([\s\S]*?)<\/parameter>/gi;

function parseParamValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return trimmed;
  }
}

function resolveToolName(raw: string, allowed: Set<string>): string | null {
  const exact = raw.trim();
  if (!exact) return null;
  if (allowed.has(exact)) return exact;
  const lower = exact.toLowerCase();
  for (const name of allowed) {
    if (name.toLowerCase() === lower) return name;
  }
  // Model sometimes omits the plugin prefix.
  const bareMatches = [...allowed].filter((name) => {
    const short = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name;
    return short.toLowerCase() === lower;
  });
  return bareMatches.length === 1 ? bareMatches[0] : null;
}

function parseInvokeBody(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  PARAM_RE.lastIndex = 0;
  for (const match of body.matchAll(PARAM_RE)) {
    args[match[1]] = parseParamValue(match[2]);
  }
  return args;
}

function parseJsonToolPayload(body: string, allowed: Set<string>): EmbeddedToolCall | null {
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as { name?: string; arguments?: unknown };
    if (typeof parsed.name !== 'string') return null;
    const name = resolveToolName(parsed.name, allowed);
    if (!name) return null;
    const args =
      parsed.arguments && typeof parsed.arguments === 'object' && !Array.isArray(parsed.arguments)
        ? (parsed.arguments as Record<string, unknown>)
        : typeof parsed.arguments === 'string'
          ? (JSON.parse(parsed.arguments) as Record<string, unknown>)
          : {};
    return {
      id: `embedded_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      function: { name, arguments: JSON.stringify(args) },
    };
  } catch {
    return null;
  }
}

/** Pull tool calls out of assistant text. Empty when none are present. */
export function extractEmbeddedToolCalls(content: string, allowedToolNames: string[]): EmbeddedToolCall[] {
  if (!content?.trim() || allowedToolNames.length === 0) return [];
  const allowed = new Set(allowedToolNames);
  const calls: EmbeddedToolCall[] = [];
  let seq = 0;

  const push = (name: string, args: Record<string, unknown>) => {
    calls.push({
      id: `embedded_${Date.now().toString(36)}_${seq++}`,
      function: { name, arguments: JSON.stringify(args) },
    });
  };

  BLOCK_RE.lastIndex = 0;
  let matchedBlock = false;
  for (const block of content.matchAll(BLOCK_RE)) {
    matchedBlock = true;
    const body = block[1];
    const jsonCall = parseJsonToolPayload(body, allowed);
    if (jsonCall) {
      calls.push(jsonCall);
      continue;
    }
    INVOKE_RE.lastIndex = 0;
    for (const invoke of body.matchAll(INVOKE_RE)) {
      const name = resolveToolName(invoke[1], allowed);
      if (!name) continue;
      push(name, parseInvokeBody(invoke[2]));
    }
  }

  if (!matchedBlock) {
    INVOKE_RE.lastIndex = 0;
    for (const invoke of content.matchAll(INVOKE_RE)) {
      const name = resolveToolName(invoke[1], allowed);
      if (!name) continue;
      push(name, parseInvokeBody(invoke[2]));
    }
  }

  return calls;
}

/** Remove tool markup so it is never shown to the user. */
export function stripEmbeddedToolMarkup(content: string): string {
  if (!content) return '';
  return content
    .replace(BLOCK_RE, '')
    .replace(INVOKE_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function contentLooksLikeToolMarkup(content: string): boolean {
  if (!content) return false;
  return (
    /<(?:[\w.-]+:)?(?:dots_function_call|tool_call|function_call)\b/i.test(content) ||
    /<invoke\s+name=/i.test(content)
  );
}
