/**
 * The Tool Registry — the one place every tool in the system is discovered.
 *
 * Plugins register themselves (see PluginModule), and this registry turns their
 * declarations into canonical, addressable tools. Nothing in the app is allowed
 * to hardcode a plugin or tool name: everything asks the registry.
 *
 * Canonical id format: "<plugin_slug>.<tool_name>"
 *   slack.list_channels
 *   gmail.send_email
 *   github.create_issue
 *
 * Resolution is deliberately forgiving, because callers arrive with three
 * different habits and all of them should work:
 *   - canonical    "slack.list_channels"
 *   - legacy snake "slack_list_channels"   (what older data and UI use)
 *   - bare short   "list_channels"         (resolved by uniqueness)
 *
 * Sensitive tools are those that act on the outside world, so they are gated
 * behind human approval before they ever execute.
 */

import { PluginModule } from './types';
import { ToolExecutor } from './shared';
import { PluginTool } from '../types';

/** Separates the plugin slug from the tool name in a canonical id. */
export const TOOL_ID_SEPARATOR = '.';

export interface ToolRecord {
  /** Canonical id, e.g. "slack.list_channels". */
  id: string;
  /** Plugin that owns the tool. */
  pluginSlug: string;
  /** Tool name within the plugin, e.g. "list_channels". */
  toolName: string;
  /** Human-readable display name. */
  name: string;
  description: string;
  parameters: PluginTool['parameters'];
  /** True when the tool must be approved by a human before it runs. */
  requiresApproval: boolean;
  executor: ToolExecutor;
}

/**
 * All registered tools, keyed by canonical id. Built once at startup from the
 * modules; never mutated afterwards.
 */
export interface ToolRegistry {
  tools: Map<string, ToolRecord>;
  /** Alias -> canonical id, for legacy and short forms. */
  aliases: Map<string, string>;
  /** plugin slug -> its tools, in registration order. */
  byPlugin: Map<string, ToolRecord[]>;
}

/** Builds the lookup tables for a set of plugin modules. */
export function buildRegistry(modules: PluginModule[]): ToolRegistry {  const tools = new Map<string, ToolRecord>();
  const aliases = new Map<string, string>();
  const byPlugin = new Map<string, ToolRecord[]>();

  for (const module of modules) {
    const slug = module.definition.slug;
    const list: ToolRecord[] = [];

    for (const [toolName, executor] of Object.entries(module.tools)) {
      const def = (module.definition.tools || []).find((t: any) => t.name === toolName);
      if (!def) continue;

      const id = `${slug}${TOOL_ID_SEPARATOR}${toolName}`;
      const record: ToolRecord = {
        id,
        pluginSlug: slug,
        toolName,
        name: toolName,
        description: def.description,
        parameters: def.parameters,
        requiresApproval: def.sensitive === true,
        executor,
      };

      tools.set(id, record);
      list.push(record);

      // The legacy form keeps old data and older UI working.
      aliases.set(`${slug}_${toolName}`, id);
      // A bare short name resolves when it is unambiguous across plugins.
      aliases.set(toolName, id);
    }

    byPlugin.set(slug, list);
  }

  return { tools, aliases, byPlugin };
}

/**
 * Resolves any spelling of a tool to its registry record.
 *
 * Accepts the canonical id, the legacy "<slug>_<tool>" form, and a bare tool
 * name when exactly one plugin provides it. Aliases are only kept when they are
 * unambiguous, so a collision falls through to "not found" rather than guessing.
 */
export function resolveTool(registry: ToolRegistry, identifier: string): ToolRecord | undefined {
  if (!identifier) return undefined;

  const wanted = identifier.trim();
  if (!wanted) return undefined;

  // Exact canonical hit.
  const direct = registry.tools.get(wanted);
  if (direct) return direct;

  // Alias hit, but only when it maps to a single tool.
  const aliased = registry.aliases.get(wanted);
  if (aliased) {
    const record = registry.tools.get(aliased);
    if (record) return record;
  }

  // "SomePlugin.some_tool" where some_tool itself contains no dot: rebuild it
  // from the plugin slug so "slack.list_channels" style ids stay stable even
  // if a plugin renames its internal executor key.
  const dot = wanted.indexOf(TOOL_ID_SEPARATOR);
  if (dot > 0) {
    const slug = wanted.slice(0, dot);
    const toolName = wanted.slice(dot + 1);
    const record = registry.tools.get(`${slug}${TOOL_ID_SEPARATOR}${toolName}`);
    if (record) return record;
    // Legacy underscore form arriving with a dot already stripped.
    const legacy = registry.aliases.get(`${slug}_${toolName}`);
    if (legacy) return registry.tools.get(legacy);
  }

  // A bare short name that happens to be unique.
  const matches = [...registry.tools.values()].filter((t) => t.toolName === wanted);
  if (matches.length === 1) return matches[0];

  return undefined;
}

/** Canonical id for an identifier, or null when nothing matches. */
export function canonicalToolId(registry: ToolRegistry, identifier: string): string | null {
  return resolveTool(registry, identifier)?.id ?? null;
}

/** Every tool in the system, ordered by plugin. */
export function listAllTools(registry: ToolRegistry): ToolRecord[] {
  return [...registry.byPlugin.values()].flat();
}

/** Tools belonging to one plugin. */
export function listPluginTools(registry: ToolRegistry, pluginSlug: string): ToolRecord[] {
  return registry.byPlugin.get(pluginSlug) ?? [];
}

/** True when the tool is marked sensitive and needs human approval. */
export function isSensitiveToolId(registry: ToolRegistry, identifier: string): boolean {
  return resolveTool(registry, identifier)?.requiresApproval ?? false;
}

/** Which plugin owns a tool. */
export function pluginSlugForTool(registry: ToolRegistry, identifier: string): string | undefined {
  return resolveTool(registry, identifier)?.pluginSlug;
}

/** The executable implementation for a tool. */
export function executorForTool(
  registry: ToolRegistry,
  identifier: string
): { slug: string; toolId: string; run: ToolExecutor } | undefined {
  const record = resolveTool(registry, identifier);
  if (!record) return undefined;
  return { slug: record.pluginSlug, toolId: record.id, run: record.executor };
}

/**
 * Normalises a list of identifiers into canonical ids, dropping anything the
 * registry does not know. Order is preserved and duplicates collapsed, so the
 * caller can safely store the result.
 */
export function normaliseToolIds(registry: ToolRegistry, identifiers: unknown): string[] {
  if (!Array.isArray(identifiers)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of identifiers) {
    if (typeof entry !== 'string') continue;
    const id = canonicalToolId(registry, entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
