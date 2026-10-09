import { Router, Request, Response } from 'express';
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
  grantPluginToBot,
} from '../repositories/plugins';
import { tokenFingerprint } from '../services/tokenCrypto';
import { PLUGINS } from '../config/pluginCatalog';
import { listBotsForUser, findBotById } from '../repositories/bots';
import { requireAdmin } from '../middleware/auth';
import {
  listAllInstallations,
  getPluginUsageStats,
  updateInstallationCredential,
} from '../repositories/plugins';

const router = Router();

// ---------------------------------------------------------------------------
// OAuth 2.0 configuration (optional â€” connect by pasting a token always works)
// ---------------------------------------------------------------------------

interface OauthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  redirectUri: string;
  /** Pulls the account identity out of a fetched /user profile. */
  identity: (profile: any) => Record<string, any>;
  /** How the access token is shaped into our stored credential object. */
  toCredential: (token: any, extra?: Record<string, any>) => Record<string, any>;
}

function oauthConfigs(provider: string): OauthProviderConfig | null {
  const base = process.env.PUBLIC_BACKEND_URL || 'http://localhost:3000';

  switch (provider) {
    case 'github':
      return process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
        ? {
            authorizeUrl: 'https://github.com/login/oauth/authorize',
            tokenUrl: 'https://github.com/login/oauth/access_token',
            clientId: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            scope: 'repo read:user',
            redirectUri: `${base}/api/plugins/github/callback`,
            identity: (profile) => ({ login: profile.login, name: profile.name || profile.login }),
          toCredential: (token) => ({ token: token.access_token }),
        }
      : null;

    // Gmail (Google) — keyed by the plugin slug, so the callback path matches.
    case 'gmail':
      return process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
            tokenUrl: 'https://oauth2.googleapis.com/token',
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            // offline access so we can refresh without asking again
            scope: 'https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send',
            redirectUri: `${base}/api/plugins/gmail/callback`,
            identity: (profile) => ({ email: profile.email, name: profile.name || profile.email }),
            // Google needs the refresh token kept, not just the access token.
            toCredential: (token) => ({
              token: token.access_token,
              refreshToken: token.refresh_token,
            }),
          }
        : null;

    default:
      return null;
  }
}

// Single-use, in-memory OAuth state store (CSRF protection + user binding).
const oauthStates = new Map<string, { userId: string; pluginSlug: string; expiresAt: number }>();

function mintState(userId: string, pluginSlug: string): string {
  const state = randomBytes(24).toString('base64url');
  oauthStates.set(state, { userId, pluginSlug, expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

function consumeState(state: string): { userId: string; pluginSlug: string } | null {
  const entry = oauthStates.get(state);
  if (!entry) return null;
  oauthStates.delete(state);
  if (entry.expiresAt < Date.now()) return null;
  return { userId: entry.userId, pluginSlug: entry.pluginSlug };
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

/** GET /api/plugins/available-tools â€” tools a specific bot may actually call. */
router.get('/available-tools', asyncHandler(async (req: Request, res: Response) => {
  const botId = req.query.botId as string;
  if (!botId) return res.status(400).json({ error: 'botId is required' });
  res.json(await listBotAccess(botId));
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
      error: `${plugin.name} connects with OAuth. Use the "Connect with Google" button instead of pasting a token.`,
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

  // Make the new plugin immediately usable by the user's bots (safe tools on).
  for (const bot of await listBotsForUser(req.user!.id)) {
    await grantPluginToBot(bot.id, installation.id, plugin.id);
  }

  res.json({
    id: installation.id,
    pluginSlug: slug,
    status: installation.status,
    tokenHint: tokenFingerprint(installation.access_token),
    metadata: installation.metadata || {},
    connectedAt: installation.connected_at.toISOString(),
  });
}));

/** Env var prefix for a plugin's OAuth app credentials. */
function oauthEnvPrefix(slug: string): string {
  return slug === 'gmail' ? 'GOOGLE' : slug.toUpperCase();
}

/** Builds the provider authorize URL, minting a bound CSRF state. */
function startOauth(userId: string, slug: string): { authorizeUrl: string } {
  const config = oauthConfigs(slug);
  if (!config) {
    throw new Error(
      `OAuth is not configured for "${slug}". Add ${oauthEnvPrefix(slug)}_CLIENT_ID and ${oauthEnvPrefix(slug)}_CLIENT_SECRET to backend/.env.`
    );
  }

  const state = mintState(userId, slug);
  const url = new URL(config.authorizeUrl);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('scope', config.scope);
  url.searchParams.set('state', state);
  return { authorizeUrl: url.toString() };
}

/** POST /api/plugins/:slug/oauth/start — returns the provider authorize URL. */
router.post('/:slug/oauth/start', asyncHandler(async (req: Request, res: Response) => {
  const { slug } = req.params;

  try {
    res.json(startOauth(req.user!.id, slug));
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
    return res.redirect(`${frontend}/workspace/chat?connect=error&plugin=${slug}`);
  }

  const bound = consumeState(state);
  if (!bound) {
    return res.redirect(`${frontend}/workspace/chat?connect=error&plugin=${slug}`);
  }

  try {
    const tokenResponse = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const token = (await tokenResponse.json()) as { access_token?: string; error?: string; error_description?: string };
    if (!tokenResponse.ok || !token.access_token) {
      throw new Error(token.error_description || token.error || `Token exchange failed (${tokenResponse.status})`);
    }

    // Fetch identity so the UI can show whose account is connected
    let metadata: Record<string, any> = {};
    try {
      const profileUrl =
        slug === 'gmail'
          ? 'https://www.googleapis.com/oauth2/v3/userinfo'
          : 'https://api.github.com/user';
      const accept =
        slug === 'gmail' ? 'application/json' : 'application/vnd.github+json';

      const profile = await fetch(profileUrl, {
        headers: { Authorization: `Bearer ${token.access_token}`, Accept: accept },
      }).then((r) => r.json());
      metadata = config.identity(profile);
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

    for (const bot of await listBotsForUser(bound.userId)) {
      await grantPluginToBot(bot.id, installation.id, plugin.id);
    }

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

  if (!Array.isArray(enabledTools)) {
    return res.status(400).json({ error: 'enabledTools must be an array of tool names' });
  }

  const bot = await findBotById(botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });

  // Only tools that actually belong to this plugin are accepted
  const catalogPlugin = PLUGINS.find((p) => p.slug === slug);
  if (!catalogPlugin) return res.status(404).json({ error: `Unknown plugin "${slug}"` });
  const known = new Set(catalogPlugin.tools.map((t) => t.name));
  const invalid = enabledTools.filter((t) => !known.has(t));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Not tools of ${slug}: ${invalid.join(', ')}` });
  }

  const installation = await findInstallationByUserAndPlugin(bot.userId, slug);
  if (!installation) return res.status(400).json({ error: `Connect ${catalogPlugin.name} first` });

  const access = await upsertBotAccess(botId, installation.id, enabledTools);
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
      const grant = access.find((a) => a.id === installation.id);
      return {
        pluginSlug: installation.pluginSlug,
        pluginName: definition?.name ?? installation.pluginSlug,
        status: installation.status,
        tokenHint: installation.tokenHint,
        accessId: grant?.id ?? null,
        enabledTools: grant?.enabledTools ?? [],
        availableTools: (definition?.tools ?? []).map((t) => ({
          name: t.name,
          description: t.description,
          sensitive: t.sensitive,
        })),
      };
    })
  );
}));

/**
 * PATCH /api/bots/:botId/plugins — update which tools a Bot can use, keyed by
 * plugin slug in the body rather than the URL.
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

  const catalogPlugin = PLUGINS.find((p) => p.slug === pluginSlug);
  if (!catalogPlugin) return res.status(404).json({ error: `Unknown plugin "${pluginSlug}"` });

  const known = new Set(catalogPlugin.tools.map((t) => t.name));
  const invalid = enabledTools.filter((t) => !known.has(t));
  if (invalid.length > 0) {
    return res.status(400).json({ error: `Not tools of ${pluginSlug}: ${invalid.join(', ')}` });
  }

  const installation = await findInstallationByUserAndPlugin(bot.userId, pluginSlug);
  if (!installation) return res.status(400).json({ error: `Connect ${catalogPlugin.name} first` });

  const access = await upsertBotAccess(botId, installation.id, enabledTools);
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
      const { authorizeUrl } = startOauth(req.user!.id, slug);
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
