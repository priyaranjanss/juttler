import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  listBotsForUser,
  findBotById,
  createBot,
  updateBot,
  deleteBot,
  clearChiefOfStaff,
  toPublicBot,
} from '../repositories/bots';
import { verifyAiConfig, listAvailableModels } from '../services/aiService';
import { Bot } from '../types';
import { AI_PROVIDERS } from '../constants';
import { CHIEF_BOT_CONFIG, CHIEF_SYSTEM_PROMPT } from '../config/chiefOfStaff';
import { findUserById } from '../repositories/users';
import { ensureOwnedTeam } from '../repositories/teams';
import { removeSlackApp, syncSlackProfile } from '../services/slackTeam/install';
import { normalizeProject, normalizeRepos } from '../services/workScope';

const router = Router();

// The default bot every new account gets. Its prompt lives in
// config/chiefOfStaff.ts so registration and the API share one definition.
const CHIEF_BOT = {
  ...CHIEF_BOT_CONFIG,
  systemPrompt: CHIEF_SYSTEM_PROMPT,
};

function providerEndpoint(provider: unknown): string | null {
  if (typeof provider !== 'string' || !Object.prototype.hasOwnProperty.call(AI_PROVIDERS, provider)) {
    return null;
  }
  return AI_PROVIDERS[provider as keyof typeof AI_PROVIDERS].endpoint;
}

async function ensureChiefBot(userId: string): Promise<void> {
  const bots = await listBotsForUser(userId);
  const chief = bots.find(b => b.isChiefOfStaff);
  if (!chief) {
    await createBot({ userId, ...CHIEF_BOT });
  }
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const isAdmin = req.query.isAdmin === 'true';

  if (isAdmin) {
    // For admin, return all bots (but we'll keep this simple for now)
    return res.json([]);
  }
  // Guarantee the default Chief bot exists, then return the full roster for this account
  await ensureChiefBot(userId);
  res.json((await listBotsForUser(userId)).map(toPublicBot));
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const {
    userId,
    name,
    roleTitle,
    systemPrompt,
    avatar,
    color,
    allowedTools,
    isChiefOfStaff,
    memoryEnabled,
    aiProvider,
    aiEndpoint,
    aiModel,
    aiApiKey,
    reasoningMode,
  } = req.body;
  if (!name || !roleTitle) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (userId && userId !== req.user!.id) {
    return res.status(403).json({ error: 'Cannot create a bot for another user' });
  }
  const expectedEndpoint = providerEndpoint(aiProvider || 'kilo_gateway');
  if (!expectedEndpoint) {
    return res.status(400).json({ error: `Unknown AI provider: ${aiProvider}` });
  }
  if (aiEndpoint && aiEndpoint !== expectedEndpoint) {
    return res.status(400).json({ error: 'Endpoint does not match the selected AI provider' });
  }
  if (aiEndpoint !== undefined && typeof aiEndpoint !== 'string') {
    return res.status(400).json({ error: 'aiEndpoint must be a string' });
  }
  if (aiModel !== undefined && aiModel !== null && typeof aiModel !== 'string') {
    return res.status(400).json({ error: 'aiModel must be a string' });
  }
  if (aiApiKey !== undefined && aiApiKey !== null && typeof aiApiKey !== 'string') {
    return res.status(400).json({ error: 'aiApiKey must be a string' });
  }

  const ownerId = req.user!.id;
  const isTeamBot = req.body.isTeamBot === true;
  if (isTeamBot && isChiefOfStaff) {
    return res.status(400).json({ error: 'A Team Bot cannot be the Chief.' });
  }

  let teamId: string | null = null;
  if (isTeamBot) {
    const owner = await findUserById(ownerId);
    const team = await ensureOwnedTeam(ownerId, owner?.name || 'My');
    teamId = team.id;
  }

  if (isChiefOfStaff) {
    await clearChiefOfStaff(ownerId);
  }

  const newBot = await createBot({
    userId: ownerId,
    name,
    roleTitle,
    systemPrompt,
    avatar,
    color,
    allowedTools,
    isChiefOfStaff,
    memoryEnabled,
    aiProvider,
    aiEndpoint: expectedEndpoint,
    aiModel,
    aiApiKey,
    isTeamBot,
    teamId,
    reasoningMode: ['think', 'big_brain', 'off'].includes(reasoningMode) ? reasoningMode : 'off',
  });

  res.json(toPublicBot(newBot));
}));

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const bot = await findBotById(id);
  if (!bot || bot.userId !== req.user!.id) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  const expectedEndpoint = providerEndpoint(req.body.aiProvider || bot.aiProvider);
  if (!expectedEndpoint) {
    return res.status(400).json({ error: `Unknown AI provider: ${req.body.aiProvider}` });
  }
  if (req.body.aiEndpoint && req.body.aiEndpoint !== expectedEndpoint) {
    return res.status(400).json({ error: 'Endpoint does not match the selected AI provider' });
  }
  if (req.body.aiEndpoint !== undefined && typeof req.body.aiEndpoint !== 'string') {
    return res.status(400).json({ error: 'aiEndpoint must be a string' });
  }
  if (
    req.body.aiModel !== undefined &&
    req.body.aiModel !== null &&
    typeof req.body.aiModel !== 'string'
  ) {
    return res.status(400).json({ error: 'aiModel must be a string' });
  }
  if (
    req.body.aiApiKey !== undefined &&
    req.body.aiApiKey !== null &&
    typeof req.body.aiApiKey !== 'string'
  ) {
    return res.status(400).json({ error: 'aiApiKey must be a string' });
  }

  if (req.body.isChiefOfStaff) {
    await clearChiefOfStaff(bot.userId, bot.id);
  }

  if (req.body.githubRepos !== undefined) {
    try {
      req.body.githubRepos = normalizeRepos(req.body.githubRepos);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid GitHub repositories' });
    }
  }
  if (req.body.jiraProject !== undefined) {
    try {
      req.body.jiraProject = normalizeProject(req.body.jiraProject);
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid Jira project' });
    }
  }

  const updated = await updateBot(id, req.body);
  if (updated && (req.body.name !== undefined || req.body.color !== undefined || req.body.roleTitle !== undefined)) {
    void syncSlackProfile(updated).catch((err) => console.error('Slack profile sync failed:', err));
  }
  res.json(updated ? toPublicBot(updated) : null);
}));

// Verify a bot's AI provider credentials by issuing a minimal completion.
// The key is taken from the request so it can be checked before it's saved.
router.post('/:id/verify-ai', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const bot = await findBotById(id);
  if (!bot || bot.userId !== req.user!.id) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  const { apiKey, endpoint, provider, model } = req.body as {
    apiKey?: string;
    endpoint?: string;
    provider?: Bot['aiProvider'];
    model?: string;
  };

  if (
    (apiKey !== undefined && apiKey !== null && typeof apiKey !== 'string') ||
    (endpoint !== undefined && endpoint !== null && typeof endpoint !== 'string') ||
    (model !== undefined && model !== null && typeof model !== 'string')
  ) {
    return res.status(400).json({ ok: false, message: 'API key, endpoint, and model must be strings.' });
  }

  const expectedEndpoint = providerEndpoint(provider || bot.aiProvider);
  if (!expectedEndpoint) {
    return res.status(400).json({ ok: false, message: `Unknown AI provider: ${provider}` });
  }
  if (endpoint && endpoint !== expectedEndpoint) {
    return res.status(400).json({ ok: false, message: 'Endpoint does not match the selected AI provider' });
  }

  const selectedProvider = provider || bot.aiProvider;
  const key = apiKey?.trim() || bot.aiApiKey;
  if (selectedProvider !== 'free_endpoint' && !key) {
    return res.status(400).json({ ok: false, message: 'Add this bot’s API key first.' });
  }
  const result = await verifyAiConfig(key || '', expectedEndpoint, model ?? bot.aiModel, selectedProvider);
  res.json(result);
}));

// Lists the models a bot's own gateway key can use, for the model dropdown.
router.post('/models', asyncHandler(async (req: Request, res: Response) => {
  const { provider = 'kilo_gateway', apiKey, botId, endpoint: requestedEndpoint } = req.body as {
    provider?: Bot['aiProvider'];
    apiKey?: string;
    botId?: string;
    endpoint?: string;
  };
  const bot = botId ? await findBotById(botId) : null;
  if (botId && (!bot || bot.userId !== req.user!.id)) {
    return res.status(404).json({ ok: false, models: [], message: 'Bot not found' });
  }

  const endpoint = providerEndpoint(provider);
  if (!endpoint) {
    return res.status(400).json({ ok: false, models: [], message: `Unknown provider: ${provider}` });
  }
  if (requestedEndpoint && requestedEndpoint !== endpoint) {
    return res.status(400).json({ ok: false, models: [], message: 'Endpoint does not match the selected AI provider' });
  }
  if (provider === 'free_endpoint') {
    return res.json({
      ok: true,
      models: [],
      message: 'This endpoint does not require model selection.',
    });
  }
  const key = typeof apiKey === 'string' && apiKey.trim() ? apiKey.trim() : bot?.aiApiKey;
  if (!key) {
    return res.status(400).json({ ok: false, models: [], message: 'Add this bot’s API key first.' });
  }

  const result = await listAvailableModels(endpoint, key);
  res.json(result);
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const bot = await findBotById(id);
  if (!bot || bot.userId !== req.user!.id) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  await removeSlackApp(id);
  const deleted = await deleteBot(id);
  if (!deleted) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  res.json({ success: true });
}));

export default router;