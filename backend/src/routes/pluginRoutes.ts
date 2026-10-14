import { Router, Request, Response } from 'express';
import { linkSlackAccount } from '../repositories/teams';
import { asyncHandler } from '../utils/asyncHandler';
import { randomBytes } from 'crypto';
import {
  listPluginDefinitions,
  findPluginDefinitionBySlug,
  listInstallations,
  findInstallationByUserAndPlugin,
  createInstallation,
  deleteInstallation,
  listBotAccess,
  upsertBotAccess,
  syncAllBotGrants,
} from '../repositories/plugins';
import { tokenFingerprint } from '../services/tokenCrypto';
import { PLUGINS, getPluginOauth, resolveTool, listAllTools, registry, canonicalToolId } from '../plugins';
import { PluginOAuthSpec } from '../plugins/types';
import { putOauthState, consumeOauthState } from '../config/oauthState';
import { runToolDirectly, listEnabledToolsForBot } from '../services/toolRunner';
import { findBotById } from '../repositories/bots';
import { requireAdmin } from '../middleware/auth';
import {
  listAllInstallations,
  getPluginUsageStats,
  updateInstallationCredential,
  getInstallationCredential,
} from '../repositories/plugins';

const router = Router();

// ---------------------------------------------------------------------------
// OAuth 2.0 configuration
//
// Providers declare their own OAuth details in their plugin module (see
// plugins/types.ts -> PluginOAuthSpec). This only resolves the client
// credentials from env and builds the callback URL, so adding a provider is
// declaring it in its plugin, never editing this file.
// ---------------------------------------------------------------------------

type ResolvedOAuth = PluginOAuthSpec & {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

function oauthConfigs(provider: string): ResolvedOAuth | null {
  const spec = getPluginOauth(provider);
  if (!spec) return null;

  const clientId = process.env[`${spec.envPrefix}_CLIENT_ID`];
  const clientSecret = process.env[`${spec.envPrefix}_CLIENT_SECRET`];
  if (!clientId || !clientSecret) return null;

  // Strip trailing slashes so a value like "https://api.example.com/" cannot
  // build a "//api/plugins/..." callback the provider would reject.
  const publicBase = (process.env.PUBLIC_BACKEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  // Slack sign-in opens in the browser, so it returns to localhost. The ngrok
  // origin is only for events Slack's servers must reach. Slack rejects a
  // redirect URL that was not saved on the app.
  const slackBase = (process.env.SLACK_OAUTH_BASE_URL || '').trim().replace(/\/+$/, '');
  const base = provider === 'slack' && slackBase ? slackBase : publicBase;

  return {
    ...spec,
    clientId,
    clientSecret,
    redirectUri: `${base}/api/plugins/${spec.callbackSlug}/callback`,
  };
}

// Single-use OAuth state store (CSRF protection + user binding). Backed by
// Redis when configured, so an in-flight flow survives a restart and reaches
// whichever replica receives the callback; falls back to memory for local dev.
function mintState(userId: string, pluginSlug: string): string {
  return randomBytes(24).toString('base64url');
}

// ---------------------------------------------------------------------------
// Marketplace & installation
// ---------------------------------------------------------------------------

/** GET /api/plugins â€” the full marketplace catalog. */
router.get('/', asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listPluginDefinitions());
}));

/** GET /api/plugins/installed â€” what this user has connected. */
router.get('/installed', asyncHandler(async (req: Request, res: Response) => {
  res.json(await listInstallations(req.user!.id));
}));

/**
 * GET /api/plugins/available-tools - tools a specific bot may actually call.
 * Tool names are canonical "plugin.tool" ids, whatever spelling is stored.
 */
router.get('/available-tools', asyncHandler(async (req: Request, res: Response) => {
  const botId = req.query.botId as string;
  if (!botId) return res.status(400).json({ error: 'botId is required' });

  const bot = await findBotById(botId);
  if (!bot || bot.userId !== req.user!.id) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  const access = await listBotAccess(botId);
  res.json(
    access.map((entry) => ({
      ...entry,
      // Stored names may be legacy; every client sees canonical ids.
      enabledTools: (entry.enabledTools ?? []).map((name) => canonicalToolId(registry, name) ?? name),
    }))
  );
}));
/** GET /api/plugins/github/repos — repositories the connected GitHub account can use. */
router.get('/github/repos', asyncHandler(async (req: Request, res: Response) => {
  const installation = await findInstallationByUserAndPlugin(req.user!.id, 'github');
  if (!installation || installation.status !== 'connected') {
    return res.status(400).json({ error: 'Connect GitHub first.' });
  }
  const credential = await getInstallationCredential(installation.id);
  const token = credential.token;
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'GitHub is connected but has no token. Connect it again.' });
  }

  const response = await fetch(
    'https://api.github.com/user/repos?per_page=100&sort=full_name&affiliation=owner,collaborator,organization_member',
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'juttler-bot',
      },
    }
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body ? String((body as { message: unknown }).message) : 'GitHub did not list repositories.';
    return res.status(502).json({ error: message });
  }
  const repos = (Array.isArray(body) ? body : [])
    .map((repo) => ({
      name: typeof repo?.full_name === 'string' ? repo.full_name : '',
      private: Boolean(repo?.private),
    }))
    .filter((repo) => repo.name);
  res.json({ repos });
}));

/**
 * POST /api/plugins/:slug/connect
 * Stores the credential for a plugin. Real API keys/tokens only â€” nothing is
 * fabricated, and a bad credential surfaces as a real error when used.
 */
router.post('/:slug/connect', asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const plugin = await findPluginDefinitionBySlug(slug);
  if (!plugin) return res.status(404).json({ error: `Unknown plugin "${slug}"` });

  const { credential, metadata } = req.body as {
    credential?: Record<string, any>;
    metadata?: Record<string, any>;
  };

  // OAuth-only plugins have nothing to paste — send the user down the flow
  if (plugin.authType === 'oauth') {
    return res.status(400).json({
      error: `${plugin.name} connects with sign-in. Use Connect ${plugin.name} instead of pasting a token.`,
    });
  }

  if (!credential || typeof credential !== 'object') {
    return res.status(400).json({ error: 'A credential object is required' });
  }

  // A credential with no usable secret is rejected up front
  const hasSecret = Object.values(credential).some((v) => typeof v === 'string' && v.trim().length > 0);
  if (!hasSecret) {
    return res.status(400).json({ error: 'Credential is empty - paste a real token or key' });
  }

  const installation = await createInstallation({
    userId: req.user!.id,
    pluginId: plugin.id,
    credential,
    metadata: metadata || {},
  });

  res.json({
    id: installation.id,
    pluginSlug: slug,
    status: installation.status,
    tokenHint: tokenFingerprint(installation.access_token),
    metadata: installation.metadata || {},
    connectedAt: installation.connected_at.toISOString(),
  });
}));

/** Env var prefix for a plugin's OAuth app credentials, from the plugin itself. */
function oauthEnvPrefix(slug: string): string {
  return getPluginOauth(slug)?.envPrefix ?? slug.toUpperCase();
}

/** Builds the provider authorize URL, minting a bound CSRF state. */
export async function startOauth(userId: string, slug: string): Promise<{ authorizeUrl: string }> {
  const config = oauthConfigs(slug);
  if (!config) {
    throw new Error(
      `OAuth is not configured for "${slug}". Add ${oauthEnvPrefix(slug)}_CLIENT_ID and ${oauthEnvPrefix(slug)}_CLIENT_SECRET to backend/.env.`
    );
  }

  // PUBLIC_BACKEND_URL is optional because it only feeds the callback URL. If
  // it is unset in production the provider would be told to redirect to
  // localhost, which fails confusingly later - so fail loudly here instead.
  if (process.env.NODE_ENV === 'production' && !process.env.PUBLIC_BACKEND_URL) {
    throw new Error(
      'PUBLIC_BACKEND_URL is not set. OAuth plugins need it to be this backend\'s public domain (e.g. https://your-backend.up.railway.app), otherwise the provider redirects to localhost.'
    );
  }

  const state = mintState(userId, slug);
  await putOauthState(state, { userId, pluginSlug: slug });
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);

  // Slack splits scopes: bot scopes go in `scope`, user scopes in `user_scope`.
  // Requesting only user_scope is what yields a user token, so the app acts as
  // the person rather than as a bot.
  if (config.userScope) {
    url.searchParams.set('user_scope', config.userScope);
  }
  if (config.scope) {
    url.searchParams.set('scope', config.scope);
  }

  url.searchParams.set('state', state);
  for (const [key, value] of Object.entries(config.extraAuthParams ?? {})) {
    url.searchParams.set(key, value);
  }

  // Google rejects the authorize URL outright when response_type is missing,
  // which surfaces as "invalid_request: Required parameter is missing". This is
  // per-provider on purpose: Slack's v2 endpoint and GitHub both omit it.
  if (config.requiresResponseType && !url.searchParams.get('response_type')) {
    throw new Error(
      `OAuth provider "${slug}" is missing response_type. Set extraAuthParams: { response_type: 'code' } for it.`
    );
  }

  return { authorizeUrl: url.toString() };
}

/** POST /api/plugins/:slug/oauth/start — returns the provider authorize URL. */
router.post('/:slug/oauth/start', asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;

  try {
    res.json(await startOauth(req.user!.id, slug));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not start OAuth' });
  }
}));

/** GET /api/plugins/:slug/callback â€” OAuth redirect target. */
router.get('/:slug/callback', asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const config = oauthConfigs(slug);

  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';

  if (error || !code || !state || !config) {
    if (state) {
      const failed = await consumeOauthState(state);
      if (failed?.pluginSlug === 'slack-link') {
        return res.redirect(`${frontend}/workspace?linkSlack=error`);
      }
    }
    return res.redirect(`${frontend}/workspace/chat?connect=error&plugin=${slug}`);
  }

  const bound = await consumeOauthState(state);
  if (!bound) {
    return res.redirect(`${frontend}/workspace/chat?connect=error&plugin=${slug}`);
  }

  try {
    // Slack's oauth.v2.access wants form-encoded bodies; the rest take JSON.
    const isForm = config.tokenBodyStyle === 'form';
    const payload: Record<string, string> = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    };

    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': isForm ? 'application/x-www-form-urlencoded' : 'application/json',
      },
      body: isForm ? new URLSearchParams(payload).toString() : JSON.stringify(payload),
    });

    const token = (await tokenResponse.json().catch(() => ({}))) as Record<string, any>;

    if (bound.pluginSlug === 'slack-link') {
      const slackUserId = token.authed_user?.id;
      const slackTeamId = token.team?.id;
      if (!tokenResponse.ok || token.ok === false || typeof slackUserId !== 'string' || typeof slackTeamId !== 'string') {
        return res.redirect(`${frontend}/workspace?linkSlack=error`);
      }
      const linked = await linkSlackAccount(bound.userId, slackUserId, slackTeamId);
      return res.redirect(`${frontend}/workspace?linkSlack=${linked ? 'linked' : 'noteam'}`);
    }

    const accessToken = config.extractToken(token);

    if (!tokenResponse.ok || !accessToken) {
      const reason =
        token.error_description || token.error || `Token exchange failed (${tokenResponse.status})`;
      throw new Error(String(reason));
    }

    // Identity: either from the token response itself (Slack) or an
    // authenticated profile fetch (GitHub, Gmail).
    let metadata: Record<string, any> = {};
    try {
      metadata = config.fetchIdentity
        ? await config.fetchIdentity(accessToken)
        : config.identity(token) || {};
    } catch {
      // Identity lookup is best-effort; the connection still works
    }

    const plugin = await findPluginDefinitionBySlug(slug);
    if (!plugin) return res.redirect(`${frontend}/workspace/chat?connect=error&plugin=${slug}`);

    const installation = await createInstallation({
      userId: bound.userId,
      pluginId: plugin.id,
      credential: config.toCredential(token),
      metadata,
    });

    return res.redirect(`${frontend}/workspace/chat?connect=success&plugin=${slug}`);
  } catch (err) {
    console.error('OAuth callback failed:', err);
    return res.redirect(`${frontend}/workspace/chat?connect=error&plugin=${slug}`);
  }
}));

/** DELETE /api/plugins/:slug â€” disconnect, revoking every bot's access. */
router.delete('/:slug', asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const installation = await findInstallationByUserAndPlugin(req.user!.id, slug);
  if (!installation) return res.status(404).json({ error: `"${slug}" is not connected` });

  await deleteInstallation(installation.id);
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Per-bot tool access
// ---------------------------------------------------------------------------

/** PATCH /api/bots/:botId/plugins/:slug â€” set which tools a bot may use. */
router.patch('/bots/:botId/plugins/:slug', asyncHandler(async (req: Request, res: Response) => {
  const { botId, slug } = req.params;
  const { enabledTools } = req.body as { enabledTools?: string[] };

  const bot = await findBotById(botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== req.user!.id) return res.status(403).json({ error: 'Not your bot' });

  // Any spelling the registry understands is accepted; names are normalised
  // to canonical ids before they are stored.
  const selection = resolveToolSelection(slug, enabledTools);
  if (!selection.ok) {
    return res.status(selection.status).json({ error: selection.error });
  }

  const catalogPlugin = PLUGINS.find((p) => p.slug === slug)!;
  const installation = await findInstallationByUserAndPlugin(bot.userId, slug);
  if (!installation) return res.status(400).json({ error: `Connect ${catalogPlugin.name} first` });

  const access = await upsertBotAccess(botId, installation.id, selection.canonical);
  res.json({ id: access.id, pluginSlug: slug, enabledTools: access.enabled_tools });
}));

/**
 * GET /api/bots/:botId/plugins — every installed plugin plus what this Bot may
 * use from it. The spec's canonical "get plugin access for a Bot".
 */
router.get('/bots/:botId/plugins', asyncHandler(async (req: Request, res: Response) => {
  const { botId } = req.params;
  const bot = await findBotById(botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  // A bot may only be inspected by its owner
  if (bot.userId !== req.user!.id) return res.status(403).json({ error: 'Not your bot' });

  const installations = await listInstallations(bot.userId);
  const access = await listBotAccess(botId);

  res.json(
    installations.map((installation) => {
      const definition = PLUGINS.find((p) => p.slug === installation.pluginSlug);
      const grant = access.find((a) => a.installationId === installation.id);
      // Tools come from the registry, so every caller sees one naming scheme.
      // `name` stays the short form for UI back-compat; `id` is canonical.
      const tools = listAllTools(registry).filter((t) => t.pluginSlug === installation.pluginSlug);
      return {
        pluginSlug: installation.pluginSlug,
        pluginName: definition?.name ?? installation.pluginSlug,
        status: installation.status,
        tokenHint: installation.tokenHint,
        accessId: grant?.id ?? null,
        enabledTools: (grant?.enabledTools ?? []).map((name) => {
          const record = resolveTool(registry, name);
          return record && record.pluginSlug === installation.pluginSlug ? record.id : name;
        }),
        availableTools: tools.map((t) => ({
          id: t.id,
          name: t.toolName,
          description: t.description,
          sensitive: t.requiresApproval,
          requiresApproval: t.requiresApproval,
        })),
      };
    })
  );
}));

// ---------------------------------------------------------------------------
// Bot tool access
// ---------------------------------------------------------------------------

type ToolSelection =
  | { ok: true; canonical: string[] }
  | { ok: false; status: number; error: string };

/**
 * Turns whatever the caller sent back into canonical tool ids for this plugin.
 *
 * Callers may use the canonical "slack.list_channels", the legacy
 * "slack_list_channels", or the bare "list_channels" — all three resolve to the
 * same tool. Unknown names produce an error that lists exactly what is valid, so
 * the fix is obvious instead of a dead-end "not tools of X".
 */
function resolveToolSelection(pluginSlug: string, enabledTools: unknown): ToolSelection {
  if (!Array.isArray(enabledTools)) {
    return { ok: false, status: 400, error: 'enabledTools must be an array of tool names' };
  }

  const plugin = PLUGINS.find((p) => p.slug === pluginSlug);
  if (!plugin) {
    return { ok: false, status: 404, error: `Unknown plugin "${pluginSlug}"` };
  }

  const valid = listAllTools(registry)
    .filter((t) => t.pluginSlug === pluginSlug)
    .map((t) => t.id);

  const canonical: string[] = [];
  const rejected: string[] = [];

  for (const entry of enabledTools) {
    if (typeof entry !== 'string') {
      rejected.push(String(entry));
      continue;
    }

    const record = resolveTool(registry, entry);
    // A tool that exists but belongs to another plugin is a real mistake, so it
    // is reported rather than silently dropped.
    if (record && record.pluginSlug !== pluginSlug) {
      rejected.push(`${entry} (belongs to "${record.pluginSlug}", not "${pluginSlug}")`);
      continue;
    }
    if (!record) {
      rejected.push(entry);
      continue;
    }

    if (!canonical.includes(record.id)) canonical.push(record.id);
  }

  if (rejected.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `Not tools of ${pluginSlug}: ${rejected.join(', ')}. Valid tools: ${valid.join(', ')}`,
    };
  }

  return { ok: true, canonical };
}

/**
 * PATCH /api/bots/:botId/plugins/:slug — set which tools a Bot may use.
 */
router.patch('/bots/:botId/plugins', asyncHandler(async (req: Request, res: Response) => {
  const { botId } = req.params;
  const { pluginSlug, enabledTools } = req.body as { pluginSlug?: string; enabledTools?: string[] };

  if (!pluginSlug || !Array.isArray(enabledTools)) {
    return res.status(400).json({ error: 'pluginSlug and enabledTools are required' });
  }

  const bot = await findBotById(botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== req.user!.id) return res.status(403).json({ error: 'Not your bot' });

  const selection = resolveToolSelection(pluginSlug, enabledTools);
  if (!selection.ok) {
    return res.status(selection.status).json({ error: selection.error });
  }

  const catalogPlugin = PLUGINS.find((p) => p.slug === pluginSlug)!;
  const installation = await findInstallationByUserAndPlugin(bot.userId, pluginSlug);
  if (!installation) return res.status(400).json({ error: `Connect ${catalogPlugin.name} first` });

  const access = await upsertBotAccess(botId, installation.id, selection.canonical);
  res.json({ id: access.id, pluginSlug, enabledTools: access.enabled_tools });
}));

/**
 * POST /api/plugins/:slug/reauth — start a fresh authorisation for an
 * installation sitting in "needs_reauth".
 */
router.post('/:slug/reauth', asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;
  const plugin = await findPluginDefinitionBySlug(slug);
  if (!plugin) return res.status(404).json({ error: `Unknown plugin "${slug}"` });

  if (plugin.authType === 'oauth') {
    // startOauth throws synchronously when the app isn't configured
    try {
      const { authorizeUrl } = await startOauth(req.user!.id, slug);
      return res.json({ method: 'oauth', authorizeUrl });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Could not start OAuth' });
    }
  }

  return res.json({ method: 'token' });
}));

// ---------------------------------------------------------------------------
// OAuth availability, so the UI can offer the right path
// ---------------------------------------------------------------------------

/** GET /api/plugins/oauth/:slug — whether OAuth is configured for a provider. */
router.get('/oauth/:slug', asyncHandler(async (req: Request, res: Response) => {
  const configured = Boolean(oauthConfigs(req.params.slug));
  res.json({ configured });
}));

// ---------------------------------------------------------------------------
// Tool registry — discovery and direct execution
// ---------------------------------------------------------------------------

/**
 * POST /api/plugins/sync-grants — kept so older clients do not 404.
 * Connecting an account no longer turns it on for every bot.
 */
router.post('/sync-grants', asyncHandler(async (req: Request, res: Response) => {
  const result = await syncAllBotGrants(req.user!.id);
  res.json({
    synced: true,
    bots: result.bots,
    plugins: result.plugins,
  });
}));

/**
 * GET /api/plugins/tools — every tool the system knows about, straight from the
 * registry. Nothing here is hardcoded, so a new plugin appears automatically.
 */
router.get('/tools', asyncHandler(async (_req: Request, res: Response) => {
  res.json(listAllTools(registry).map((t) => ({
    id: t.id,
    toolId: t.id,
    pluginSlug: t.pluginSlug,
    toolName: t.toolName,
    description: t.description,
    requiresApproval: t.requiresApproval,
    parameters: t.parameters,
  })));
}));

/** GET /api/plugins/tools/bots/:botId — what this bot may actually call. */
router.get('/tools/bots/:botId', asyncHandler(async (req: Request, res: Response) => {
  const { botId } = req.params;
  const bot = await findBotById(botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== req.user!.id) return res.status(403).json({ error: 'Not your bot' });

  res.json({ botId, enabledTools: await listEnabledToolsForBot(req.user!.id, botId) });
}));

/**
 * POST /api/plugins/tools/execute — run a tool directly, with no LLM in the
 * path. This is how the orchestrator and automations act: they already know
 * which tool to call, and a bot's lack of an AI key must not stop the action.
 */
router.post('/tools/execute', asyncHandler(async (req: Request, res: Response) => {
  const { botId, toolId, args, conversationId } = req.body as {
    botId?: string;
    toolId?: string;
    args?: Record<string, any>;
    conversationId?: string;
  };

  if (!botId || !toolId) {
    return res.status(400).json({ error: 'botId and toolId are required' });
  }

  const bot = await findBotById(botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  if (bot.userId !== req.user!.id) return res.status(403).json({ error: 'Not your bot' });

  const outcome = await runToolDirectly({
    userId: req.user!.id,
    botId: bot.id,
    botName: bot.name,
    toolId,
    args: args ?? {},
    conversationId,
  });

  if (outcome.kind === 'unknown_tool') {
    return res.status(400).json({
      error: `Unknown tool "${outcome.toolId}". Available tools: ${outcome.available.join(', ')}`,
    });
  }
  if (outcome.kind === 'not_installed') {
    return res.status(409).json({ error: outcome.message, pluginSlug: outcome.pluginSlug });
  }
  if (outcome.kind === 'not_enabled') {
    return res.status(409).json({ error: outcome.message, pluginSlug: outcome.pluginSlug, toolId: outcome.toolId });
  }

  // Approval-gated tools park here until the user resolves the request.
  res.json(outcome);
}));

// ---------------------------------------------------------------------------
// Admin — platform-wide visibility and force-disconnect
// ---------------------------------------------------------------------------

/** GET /api/plugins/admin/installations — every connection across all users. */
router.get('/admin/installations', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await listAllInstallations());
}));

/** GET /api/plugins/admin/stats — usage per plugin. */
router.get('/admin/stats', requireAdmin, asyncHandler(async (_req: Request, res: Response) => {
  res.json(await getPluginUsageStats());
}));

/** DELETE /api/plugins/admin/installations/:id — force-disconnect any user's plugin. */
router.delete('/admin/installations/:id', requireAdmin, asyncHandler(async (req: Request, res: Response) => {
  const removed = await deleteInstallation(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Installation not found' });
  res.json({ success: true });
}));

export default router;
