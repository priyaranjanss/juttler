import { sql } from '../config/db';
import { generateId } from '../utils/id';
import { PLUGINS, registry, resolveTool, canonicalToolId, listPluginTools } from '../plugins';
import { ApprovalRequest } from '../types';
import { encryptToken, decryptTokenSafe, tokenFingerprint } from '../services/tokenCrypto';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export interface PluginRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  is_official: boolean;
  auth_type: string;
  tools: any;
  required_credentials: any;
}

export interface InstallationRow {
  id: string;
  user_id: string;
  plugin_id: string;
  status: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  metadata: any;
  connected_at: Date;
  updated_at: Date;
}

export interface BotAccessRow {
  id: string;
  bot_id: string;
  installation_id: string;
  enabled_tools: string[];
}

/** Shape returned by listInstallations' join. */
interface InstallationJoinRow {
  id: string;
  user_id: string;
  plugin_id: string;
  status: string;
  access_token: string | null;
  metadata: any;
  connected_at: Date;
  plugin_slug: string;
}

export interface PluginDefinition {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  isOfficial: boolean;
  authType: string;
  tools: any[];
  requiredCredentials: any[];
}

export interface InstallationView {
  id: string;
  pluginSlug: string;
  status: 'connected' | 'needs_reauth';
  /** Non-reversible fingerprint so the UI can confirm a token is stored. */
  tokenHint: string;
  metadata: Record<string, any>;
  connectedAt: string;
}

function mapDefinition(row: PluginRow): PluginDefinition {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    isOfficial: row.is_official,
    authType: row.auth_type,
    tools: row.tools || [],
    requiredCredentials: row.required_credentials || [],
  };
}

// ---------------------------------------------------------------------------
// Catalog (account-wide, upserted from src/plugins/)
// ---------------------------------------------------------------------------

/** Seeds or refreshes the official catalog. Safe to run on every migration. */
export async function syncPluginCatalog(): Promise<number> {
  for (const plugin of PLUGINS) {
    await sql`
      insert into plugins (id, slug, name, description, category, is_official, auth_type, tools, required_credentials)
      values (
        ${generateId('plg_')},
        ${plugin.slug},
        ${plugin.name},
        ${plugin.description},
        ${plugin.category},
        ${plugin.isOfficial},
        ${plugin.authType},
        ${JSON.stringify(plugin.tools)}::jsonb,
        ${JSON.stringify(plugin.requiredCredentials || [])}::jsonb
      )
      on conflict (slug) do update set
        name = excluded.name,
        description = excluded.description,
        category = excluded.category,
        is_official = excluded.is_official,
        auth_type = excluded.auth_type,
        tools = excluded.tools,
        required_credentials = excluded.required_credentials,
        updated_at = now()
    `;
  }
  return PLUGINS.length;
}

export async function listPluginDefinitions(): Promise<PluginDefinition[]> {
  const rows = (await sql`select * from plugins order by name asc`) as unknown as PluginRow[];
  return rows.map(mapDefinition);
}

export async function findPluginDefinitionBySlug(slug: string): Promise<PluginDefinition | null> {
  const rows = (await sql`select * from plugins where slug = ${slug} limit 1`) as unknown as PluginRow[];
  return rows.length > 0 ? mapDefinition(rows[0]) : null;
}

export async function findPluginDefinitionById(id: string): Promise<PluginDefinition | null> {
  const rows = (await sql`select * from plugins where id = ${id} limit 1`) as unknown as PluginRow[];
  return rows.length > 0 ? mapDefinition(rows[0]) : null;
}

// ---------------------------------------------------------------------------
// Installations (per user)
// ---------------------------------------------------------------------------

export interface InstallationWithPlugin {
  id: string;
  userId: string;
  pluginId: string;
  pluginSlug: string;
  status: string;
  tokenHint: string;
  metadata: Record<string, any>;
  connectedAt: string;
}

export async function listInstallations(userId: string): Promise<InstallationWithPlugin[]> {
  const rows = (await sql`
    select i.id, i.user_id, i.plugin_id, i.status, i.access_token, i.metadata, i.connected_at, p.slug as plugin_slug
    from plugin_installations i
    join plugins p on p.id = i.plugin_id
    where i.user_id = ${userId}
    order by p.name asc
  `) as unknown as InstallationJoinRow[];

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    pluginId: row.plugin_id,
    pluginSlug: row.plugin_slug,
    status: row.status,
    tokenHint: tokenFingerprint(row.access_token),
    metadata: row.metadata || {},
    connectedAt: row.connected_at.toISOString(),
  }));
}

export async function findInstallation(userId: string, pluginSlug: string): Promise<InstallationRow | null> {
  const rows = (await sql`
    select i.* from plugin_installations i
    join plugins p on p.id = i.plugin_id
    where i.user_id = ${userId} and p.slug = ${pluginSlug}
    limit 1
  `) as unknown as InstallationRow[];
  return rows.length > 0 ? rows[0] : null;
}

export async function findInstallationById(id: string): Promise<InstallationRow | null> {
  const rows = (await sql`select * from plugin_installations where id = ${id} limit 1`) as unknown as InstallationRow[];
  return rows.length > 0 ? rows[0] : null;
}

/** Looks up an installation by user + plugin slug (used by the gateway). */
export async function findInstallationByUserAndPlugin(
  userId: string,
  pluginSlug: string
): Promise<InstallationRow | null> {
  const rows = (await sql`
    select i.* from plugin_installations i
    join plugins p on p.id = i.plugin_id
    where i.user_id = ${userId} and p.slug = ${pluginSlug}
    limit 1
  `) as unknown as InstallationRow[];
  return rows.length > 0 ? rows[0] : null;
}

export interface SlackUserInstallation {
  id: string;
  userId: string;
  slackTeamId: string;
  slackUserId: string;
  metadata: Record<string, any>;
}

/** Finds the Juttler OAuth installation that owns a Slack user identity. */
export async function findSlackUserInstallation(
  slackTeamId: string,
  slackUserId: string
): Promise<SlackUserInstallation | null> {
  const rows = (await sql`
    select i.id, i.user_id, i.metadata
    from plugin_installations i
    join plugins p on p.id = i.plugin_id
    where p.slug = 'slack'
      and i.status = 'connected'
      and i.metadata ->> 'team_id' = ${slackTeamId}
      and i.metadata ->> 'authed_user_id' = ${slackUserId}
    limit 2
  `) as unknown as Array<{ id: string; user_id: string; metadata: Record<string, any> | null }>;

  if (rows.length !== 1) return null;
  return {
    id: rows[0].id,
    userId: rows[0].user_id,
    slackTeamId,
    slackUserId,
    metadata: rows[0].metadata ?? {},
  };
}

export async function createInstallation(data: {
  userId: string;
  pluginId: string;
  credential: Record<string, any>;
  metadata?: Record<string, any>;
}): Promise<InstallationRow> {
  const rows = (await sql`
    insert into plugin_installations (id, user_id, plugin_id, status, access_token, metadata)
    values (${generateId('pin_')}, ${data.userId}, ${data.pluginId}, 'connected', ${encryptToken(JSON.stringify(data.credential))}, ${JSON.stringify(data.metadata || {})}::jsonb)
    on conflict (user_id, plugin_id) do update set
      status = 'connected',
      access_token = excluded.access_token,
      refresh_token = null,
      token_expires_at = null,
      metadata = excluded.metadata,
      updated_at = now()
    returning *
  `) as unknown as InstallationRow[];
  return rows[0];
}

/**
 * Flips an installation to needs_reauth. Called by the gateway when a provider
 * rejects the stored credential, so the user is prompted to fix it before the
 * next call rather than silently failing.
 */
export async function markInstallationNeedsReauth(id: string): Promise<void> {
  await sql`
    update plugin_installations set status = 'needs_reauth', updated_at = now()
    where id = ${id} and status <> 'needs_reauth'
  `;
}

/** Replaces just the credential material, preserving the installation row. */
export async function updateInstallationCredential(
  id: string,
  credential: Record<string, any>
): Promise<InstallationRow | null> {
  const encrypted = encryptToken(JSON.stringify(credential));
  const refreshToken = credential.refreshToken ? encryptToken(String(credential.refreshToken)) : null;

  const rows = (await sql`
    update plugin_installations set
      status = 'connected',
      access_token = ${encrypted},
      refresh_token = ${refreshToken},
      token_expires_at = null,
      updated_at = now()
    where id = ${id}
    returning *
  `) as unknown as InstallationRow[];
  return rows.length > 0 ? rows[0] : null;
}

/** Every installation on the platform, for the admin views. */
export async function listAllInstallations(): Promise<
  Array<{
    installationId: string;
    userEmail: string;
    userName: string;
    pluginSlug: string;
    pluginName: string;
    status: string;
    tokenHint: string;
    connectedAt: string;
    botCount: number;
  }>
> {
  const rows = (await sql`
    select
      i.id as installation_id,
      u.email as user_email,
      u.name as user_name,
      p.slug as plugin_slug,
      p.name as plugin_name,
      i.status,
      i.access_token,
      i.connected_at,
      (select count(*)::int from bot_plugin_access a where a.installation_id = i.id) as bot_count
    from plugin_installations i
    join plugins p on p.id = i.plugin_id
    join users u on u.id = i.user_id
    order by i.connected_at desc
  `) as unknown as Array<{
    installation_id: string;
    user_email: string;
    user_name: string;
    plugin_slug: string;
    plugin_name: string;
    status: string;
    access_token: string | null;
    connected_at: Date;
    bot_count: number;
  }>;

  return rows.map((r) => ({
    installationId: r.installation_id,
    userEmail: r.user_email,
    userName: r.user_name,
    pluginSlug: r.plugin_slug,
    pluginName: r.plugin_name,
    status: r.status,
    tokenHint: tokenFingerprint(r.access_token),
    connectedAt: r.connected_at.toISOString(),
    botCount: r.bot_count,
  }));
}

/** Tool-call statistics per plugin, for the admin overview. */
export async function getPluginUsageStats(): Promise<
  Array<{
    pluginSlug: string;
    pluginName: string;
    installations: number;
    toolCalls: number;
    failures: number;
  }>
> {
  // tool_call_logs stores the bare tool name; match it against each plugin's
  // tool definitions via jsonb_array_elements.
  const rows = (await sql`
    with plugin_tools as (
      select p.id as plugin_id, tool ->> 'name' as tool_name
      from plugins p, jsonb_array_elements(p.tools) as tool
    )
    select
      p.slug as plugin_slug,
      p.name as plugin_name,
      (select count(*)::int from plugin_installations i where i.plugin_id = p.id) as installations,
      (select count(*)::int from tool_call_logs l
         join plugin_tools t on t.plugin_id = p.id and t.tool_name = l.tool_name) as tool_calls,
      (select count(*)::int from tool_call_logs l
         join plugin_tools t on t.plugin_id = p.id and t.tool_name = l.tool_name
        where l.status = 'failed') as failures
    from plugins p
    order by p.name asc
  `) as unknown as Array<{
    plugin_slug: string;
    plugin_name: string;
    installations: number;
    tool_calls: number;
    failures: number;
  }>;

  return rows.map((r) => ({
    pluginSlug: r.plugin_slug,
    pluginName: r.plugin_name,
    installations: r.installations,
    toolCalls: r.tool_calls,
    failures: r.failures,
  }));
}

/**
 * Stores a refreshed access token while preserving the rest of the credential
 * (notably the refresh token, which must survive to be reusable).
 *
 * OAuth access tokens rotate roughly hourly, so this runs often. If a caller
 * passes the full credential instead of a bare token, only its `token` field is
 * used.
 */
export async function updateInstallationAccessToken(
  id: string,
  accessToken: string,
  currentCredential?: Record<string, any>,
  refreshToken?: string
): Promise<void> {
  const merged: Record<string, any> = {
    ...(currentCredential ?? {}),
    token: accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
  const encrypted = encryptToken(JSON.stringify(merged));
  const encryptedRefreshToken = refreshToken ? encryptToken(refreshToken) : null;

  await sql`
    update plugin_installations
    set access_token = ${encrypted},
        refresh_token = coalesce(${encryptedRefreshToken}, refresh_token),
        updated_at = now()
    where id = ${id}
  `;
}

export async function deleteInstallation(id: string): Promise<boolean> {
  // Drop bot grants first so a missing cascade cannot leave a disconnected
  // account usable.
  await sql`delete from bot_plugin_access where installation_id = ${id}`;
  const rows = await sql`delete from plugin_installations where id = ${id} returning id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Bot tool access
// ---------------------------------------------------------------------------

/** Shape returned by listBotAccess' join. */
interface BotAccessJoinRow {
  id: string;
  installation_id: string;
  enabled_tools: string[];
  plugin_slug: string;
}

export interface BotAccessView {
  id: string;
  installationId: string;
  pluginSlug: string;
  enabledTools: string[];
}

/** Tools a bot may use, keyed by plugin slug. */
export async function listBotAccess(botId: string): Promise<BotAccessView[]> {
  const rows = (await sql`
    select a.id, a.installation_id, a.enabled_tools, p.slug as plugin_slug
    from bot_plugin_access a
    join plugin_installations i on i.id = a.installation_id
    join plugins p on p.id = i.plugin_id
    where a.bot_id = ${botId}
    order by p.slug asc
  `) as unknown as BotAccessJoinRow[];
  return rows.map((r) => ({ id: r.id, installationId: r.installation_id, pluginSlug: r.plugin_slug, enabledTools: r.enabled_tools || [] }));
}

export async function findBotAccess(botId: string, installationId: string): Promise<BotAccessRow | null> {
  const rows = (await sql`
    select * from bot_plugin_access
    where bot_id = ${botId} and installation_id = ${installationId}
    limit 1
  `) as unknown as BotAccessRow[];
  return rows.length > 0 ? rows[0] : null;
}

export async function upsertBotAccess(
  botId: string,
  installationId: string,
  enabledTools: string[]
): Promise<BotAccessRow> {
  const rows = (await sql`
    insert into bot_plugin_access (id, bot_id, installation_id, enabled_tools)
    values (${generateId('bpa_')}, ${botId}, ${installationId}, ${enabledTools})
    on conflict (bot_id, installation_id) do update set
      enabled_tools = excluded.enabled_tools
    returning *
  `) as unknown as BotAccessRow[];
  return rows[0];
}

/**
 * Turns one plugin on for one bot.
 *
 * An existing row is that bot's own decision, including a switch left off
 * (an empty tool list). It is never merged or copied onto another bot.
 */
export async function grantPluginToBot(botId: string, installationId: string, pluginId: string): Promise<BotAccessRow> {
  const existing = await findBotAccess(botId, installationId);
  if (existing) return existing;

  const plugin = await findPluginDefinitionById(pluginId);
  const toolIds = listPluginTools(registry, plugin?.slug ?? '').map((t) => t.id);
  return upsertBotAccess(botId, installationId, toolIds);
}

/**
 * Reports how many bots and connected accounts this user has.
 *
 * It does not write grants. A connected account stays off for every bot until
 * that bot's own switch is turned on.
 */
export async function syncAllBotGrants(userId: string): Promise<{ bots: number; plugins: number }> {
  const installations = await listInstallations(userId);
  const botRows = (await sql`select id from bots where user_id = ${userId}`) as unknown as Array<{ id: string }>;
  return { bots: botRows.length, plugins: installations.length };
}

// ---------------------------------------------------------------------------
// Approvals & tool-call logs (real rows, no simulation)
// ---------------------------------------------------------------------------

export async function createApprovalRecord(data: {
  userId: string;
  botId: string;
  botName: string;
  conversationId?: string;
  toolName: string;
  actionName: string;
  toolParams: Record<string, any>;
  reason: string;
}): Promise<ApprovalRequest> {
  const id = generateId('apr_');
  const rows = (await sql`
    insert into approvals (id, user_id, bot_id, bot_name, conversation_id, action_name, tool_name, tool_params, reason)
    values (${id}, ${data.userId}, ${data.botId}, ${data.botName}, ${data.conversationId || null}, ${data.actionName}, ${data.toolName}, ${JSON.stringify(data.toolParams)}::jsonb, ${data.reason})
    returning *
  `) as unknown as ApprovalRowDb[];

  return mapApprovalDb(rows[0]);
}

export async function recordToolCallLog(data: {
  userId: string;
  botId: string;
  botName: string;
  toolName: string;
  inputArgs: Record<string, any>;
  outputResult: any;
  status: 'success' | 'failed' | 'blocked_by_approval';
  durationMs: number;
}): Promise<void> {
  await sql`
    insert into tool_call_logs (id, user_id, bot_id, bot_name, tool_name, input_args, output_result, status, duration_ms)
    values (
      ${generateId('tcl_')},
      ${data.userId},
      ${data.botId},
      ${data.botName},
      ${data.toolName},
      ${JSON.stringify(data.inputArgs)}::jsonb,
      ${JSON.stringify(data.outputResult ?? {})}::jsonb,
      ${data.status},
      ${data.durationMs}
    )
  `;
}

interface ApprovalRowDb {
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

function mapApprovalDb(row: ApprovalRowDb): ApprovalRequest {
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

// ---------------------------------------------------------------------------
// Gateway helpers
// ---------------------------------------------------------------------------

export interface ToolPermission {
  installed: boolean;
  installedButNoAccess: boolean;
  enabled: boolean;
  sensitive: boolean;
  pluginSlug?: string;
}

/**
 * Resolves whether a bot is allowed to run a tool. "not installed" is
 * distinct from "installed but disabled for this bot" so the UI can tell the
 * user whether to connect a plugin or flip a toggle.
 */
export async function getToolPermission(userId: string, botId: string, toolName: string): Promise<ToolPermission> {
  const record = resolveTool(registry, toolName);
  const sensitive = record?.requiresApproval ?? false;
  const empty: ToolPermission = { installed: false, installedButNoAccess: false, enabled: false, sensitive };

  // Which plugin owns this tool?
  if (!record) return empty;
  const ownerSlug = record.pluginSlug;

  const installation = await findInstallation(userId, ownerSlug);
  if (!installation || installation.status !== 'connected') return empty;

  const access = await findBotAccess(botId, installation.id);
  if (!access) {
    return { installed: true, installedButNoAccess: false, enabled: false, sensitive, pluginSlug: ownerSlug };
  }

  // A non-empty grant means the plugin is on for this bot — every current tool
  // of that plugin is allowed (same rule as listBotAvailableTools). New tools
  // added later must not appear "disabled" until someone re-toggles the switch.
  const enabled = (access.enabled_tools || []).length > 0;
  return {
    installed: true,
    installedButNoAccess: !enabled,
    enabled,
    sensitive,
    pluginSlug: ownerSlug,
  };
}

export async function getInstallationCredential(installationId: string): Promise<Record<string, any>> {
  const row = await findInstallationById(installationId);
  const raw = decryptTokenSafe(row?.access_token);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    // A token pasted as plaintext (rather than JSON) is still usable
    return { token: raw };
  }
}

/**
 * Tools a bot can actually call right now: the plugin must be connected for
 * this user, and the tool must be enabled for this specific bot.
 */
export async function listBotAvailableTools(
  userId: string,
  botId: string
): Promise<Array<{ toolId: string; toolName: string; pluginSlug: string; sensitive: boolean; description: string; parameters: any }>> {
  const installations = await listInstallations(userId);
  const access = await listBotAccess(botId);

  const available: Array<{ toolId: string; toolName: string; pluginSlug: string; sensitive: boolean; description: string; parameters: any }> = [];

  for (const installation of installations) {
    if (installation.status !== 'connected') continue;
    const pluginDef = PLUGINS.find((p) => p.slug === installation.pluginSlug);
    if (!pluginDef) continue;

    const grant = access.find((row) => row.installationId === installation.id);
    if (!grant) continue;

    // A non-empty grant means the plugin is on, so every current tool is available.
    if ((grant.enabledTools || []).length === 0) continue;

    for (const tool of listPluginTools(registry, installation.pluginSlug)) {
      available.push({
        toolId: tool.id,
        toolName: tool.toolName,
        pluginSlug: tool.pluginSlug,
        sensitive: tool.requiresApproval,
        description: tool.description,
        parameters: tool.parameters,
      });
    }
  }

  return available;
}
