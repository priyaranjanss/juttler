import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { listBotsForUser, findBotById, createBot, updateBot, deleteBot, clearChiefOfStaff } from '../repositories/bots';
import {
  listInstallations,
  findPluginDefinitionById,
  grantPluginToBot,
  listBotAvailableTools,
} from '../repositories/plugins';
import { verifyAiConfig, listAvailableModels } from '../services/aiService';
import { Bot, AI_PROVIDERS } from '../../../frontend/src/types/index';
import { CHIEF_BOT_CONFIG, CHIEF_SYSTEM_PROMPT } from '../config/chiefOfStaff';

const router = Router();

// The default bot every new account gets. Its prompt lives in
// config/chiefOfStaff.ts so registration and the API share one definition.
const CHIEF_BOT = {
  ...CHIEF_BOT_CONFIG,
  systemPrompt: CHIEF_SYSTEM_PROMPT,
};

async function ensureChiefBot(userId: string): Promise<void> {
  const bots = await listBotsForUser(userId);
  const chief = bots.find(b => b.isChiefOfStaff);
  if (!chief) {
    await createBot({ userId, ...CHIEF_BOT });
  }
}

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const isAdmin = req.query.isAdmin === 'true';

  if (isAdmin) {
    // For admin, return all bots (but we'll keep this simple for now)
    return res.json([]);
  }
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  // Guarantee the default Chief bot exists, then return the full roster for this account
  await ensureChiefBot(userId);
  res.json(await listBotsForUser(userId));
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const { userId, name, roleTitle, systemPrompt, avatar, color, allowedTools, isChiefOfStaff, memoryEnabled } =
    req.body;
  if (!userId || !name || !roleTitle) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (isChiefOfStaff) {
    await clearChiefOfStaff(userId);
  }

  const newBot = await createBot({
    userId,
    name,
    roleTitle,
    systemPrompt,
    avatar,
    color,
    allowedTools,
    isChiefOfStaff,
    memoryEnabled,
  });

  // Plugins are account-wide: a new Bot inherits the safe tools of everything
  // already connected (sensitive tools stay off until explicitly enabled).
  const installations = await listInstallations(userId);
  for (const installation of installations) {
    const plugin = await findPluginDefinitionById(installation.pluginId);
    if (plugin) {
      await grantPluginToBot(newBot.id, installation.id, plugin.id);
    }
  }

  res.json(newBot);
}));

router.patch('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const bot = await findBotById(id);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  if (req.body.isChiefOfStaff) {
    await clearChiefOfStaff(bot.userId, bot.id);
  }

  const updated = await updateBot(id, req.body);
  res.json(updated);
}));

// Verify a bot's AI provider credentials by issuing a minimal completion.
// The key is taken from the request so it can be checked before it's saved.
router.post('/:id/verify-ai', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const bot = await findBotById(id);
  if (!bot) {
    return res.status(404).json({ error: 'Bot not found' });
  }

  const { apiKey, endpoint, provider, model } = req.body as {
    apiKey?: string;
    endpoint?: string;
    provider?: string;
    model?: string;
  };

  const result = await verifyAiConfig(apiKey ?? bot.aiApiKey, endpoint ?? bot.aiEndpoint, model ?? bot.aiModel);
  res.json(result);
}));

// Lists the models a bot's own gateway key can use, for the model dropdown.
router.get('/models', asyncHandler(async (req: Request, res: Response) => {
  const provider = (req.query.provider as Bot['aiProvider']) || 'kilo_gateway';
  const apiKey = (req.query.apiKey as string) || '';
  const endpoint = AI_PROVIDERS[provider]?.endpoint;

  if (!endpoint) {
    return res.status(400).json({ ok: false, models: [], message: `Unknown provider: ${provider}` });
  }

  const result = await listAvailableModels(endpoint, apiKey);
  res.json(result);
}));

router.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const deleted = await deleteBot(id);
  if (!deleted) {
    return res.status(404).json({ error: 'Bot not found' });
  }
  res.json({ success: true });
}));

export default router;