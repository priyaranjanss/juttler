/**
 * Plugin registry — the single place the rest of the app looks.
 *
 * Adding a plugin is a new folder under ./<slug>/ plus one import here. Nothing
 * else in the codebase may hardcode a plugin or tool name: everything asks the
 * Tool Registry in ./registry.
 *
 * Tool ids are canonical "<plugin_slug>.<tool_name>", e.g. "slack.list_channels".
 */

import { gmailPlugin } from './gmail';
import { githubPlugin } from './github';
import { jiraPlugin } from './jira';
import { slackPlugin } from './slack';
import { PluginModule, PluginOAuthSpec } from './types';
import { ToolExecutor, ToolOutcome, isAuthFailure } from './shared';
import {
  ToolRegistry,
  ToolRecord,
  buildRegistry,
  resolveTool,
  canonicalToolId,
  normaliseToolIds,
  listAllTools,
  listPluginTools,
  isSensitiveToolId,
  pluginSlugForTool,
  executorForTool,
  TOOL_ID_SEPARATOR as TOOL_SEP,
} from './registry';

const MODULES: PluginModule[] = [
  githubPlugin,
  jiraPlugin,
  slackPlugin,
  gmailPlugin,
];

// ---------------------------------------------------------------------------
// The Tool Registry, built once from the modules
// ---------------------------------------------------------------------------

export const registry: ToolRegistry = buildRegistry(MODULES);

/** The character that joins a plugin slug to a tool name in a canonical id. */
export const TOOL_ID_SEPARATOR = TOOL_SEP;

// ---------------------------------------------------------------------------
// Reasoning (LLM) wiring — kept here so nothing reaches into aiService directly
// ---------------------------------------------------------------------------

export { resolveLlmWiring, describeLlmGap } from '../services/aiService';
export type { LlmWiring, LlmGap } from '../services/aiService';

// ---------------------------------------------------------------------------
// Definitions (marketplace)
// ---------------------------------------------------------------------------

export const PLUGINS = MODULES.map((m) => m.definition);

export function findPluginBySlug(slug: string): PluginModule['definition'] | undefined {
  return MODULES.find((m) => m.definition.slug === slug)?.definition;
}

/** Alias kept for callers that historically imported from config/pluginCatalog. */
export const findCatalogPlugin = findPluginBySlug;

export function getPluginModule(slug: string): PluginModule | undefined {
  return MODULES.find((m) => m.definition.slug === slug);
}

/**
 * Which plugin owns a tool. Accepts any spelling the registry understands —
 * canonical "slack.list_channels", legacy "slack_list_channels", or bare
 * "list_channels".
 */
export function findPluginForTool(toolIdentifier: string): PluginModule | undefined {
  const slug = pluginSlugForTool(registry, toolIdentifier);
  if (!slug) return undefined;
  return MODULES.find((m) => m.definition.slug === slug);
}

/** True when the tool is marked sensitive and so needs human approval. */
export function isSensitiveTool(toolIdentifier: string): boolean {
  return isSensitiveToolId(registry, toolIdentifier);
}

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export function getPluginOauth(slug: string): PluginOAuthSpec | undefined {
  return MODULES.find((m) => m.definition.slug === slug)?.oauth;
}

// ---------------------------------------------------------------------------
// Tool discovery
// ---------------------------------------------------------------------------

export interface ToolRunContext {
  credential: Record<string, any>;
  metadata: Record<string, any>;
  refreshAccessToken?: (token: string) => void | Promise<void>;
}

/** Every tool in the system, ordered by plugin. */
export const ALL_TOOLS: ToolRecord[] = listAllTools(registry);

export const SUPPORTED_TOOLS = ALL_TOOLS.map((t) => ({
  toolName: t.id,
  toolId: t.id,
  pluginSlug: t.pluginSlug,
  shortName: t.toolName,
  description: t.description,
  requiresApproval: t.requiresApproval,
}));

/** Resolves any spelling of a tool name to its registry record. */
export const resolveToolId = (identifier: string): ToolRecord | undefined =>
  resolveTool(registry, identifier);

/** Canonical id for a tool name, or null if unknown. */
export const toCanonicalToolId = (identifier: string): string | null =>
  canonicalToolId(registry, identifier);

/** Normalises a whole list of tool names into canonical ids. */
export const canonicaliseToolNames = (identifiers: unknown): string[] =>
  normaliseToolIds(registry, identifiers);

export function getToolExecutor(toolIdentifier: string): { slug: string; run: ToolExecutor } | undefined {
  const entry = executorForTool(registry, toolIdentifier);
  if (!entry) return undefined;
  return { slug: entry.slug, run: entry.run };
}

/**
 * Model-facing spec for one tool. Every plugin's parameter schema is exposed so
 * the model can actually fill the arguments in, rather than guessing.
 */
export function toolSpecFor(identifier: string): { name: string; description: string; parameters: any } | undefined {
  const record = resolveTool(registry, identifier);
  if (!record) return undefined;
  return {
    name: record.id,
    description: `${record.description} (provided by the ${record.pluginSlug} plugin)`,
    parameters: record.parameters ?? { type: 'object', properties: {} },
  };
}

/** Model-facing specs for a list of tool identifiers. */
export function toolSpecsFor(identifiers: string[]): Array<{ name: string; description: string; parameters: any }> {
  const specs: Array<{ name: string; description: string; parameters: any }> = [];
  for (const identifier of identifiers) {
    const spec = toolSpecFor(identifier);
    if (spec) specs.push(spec);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

/**
 * Runs one tool against its provider, converting any thrown error into a result
 * so the caller always gets a structured outcome.
 */
export async function runTool(toolIdentifier: string, args: Record<string, any>, ctx: ToolRunContext): Promise<ToolOutcome> {
  const started = Date.now();
  const record = resolveTool(registry, toolIdentifier);

  if (!record) {
    const known = ALL_TOOLS.map((t) => t.id);
    return {
      ok: false,
      result: {
        error: `Unknown tool "${toolIdentifier}". Available tools: ${known.join(', ')}`,
      },
      durationMs: Date.now() - started,
    };
  }

  try {
    const result = await record.executor(args, ctx);
    return { ok: true, result, durationMs: Date.now() - started };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      result: { error: message },
      durationMs: Date.now() - started,
      authFailed: isAuthFailure(message),
    };
  }
}

export { isAuthFailure };
export {
  buildRegistry,
  resolveTool,
  canonicalToolId,
  normaliseToolIds,
  listAllTools,
  listPluginTools,
  isSensitiveToolId,
  pluginSlugForTool,
  executorForTool,
};
export type { ToolExecutor, ToolOutcome, PluginModule, PluginOAuthSpec, ToolRecord, ToolRegistry };
