import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { findBotById, publishTeamBot, toPublicBot } from '../repositories/bots';
import { ensureOwnedTeam, findMembership, linkSlackAccount } from '../repositories/teams';
import { findUserById } from '../repositories/users';
import { findInstallationByUserAndPlugin } from '../repositories/plugins';
import {
  beginSlackInstall,
  buildAccountLinkUrl,
  disconnectSlackApp,
  finishSlackInstall,
  slackInstallView,
} from '../services/slackTeam/install';
import { acceptSlackEvent, slackChallenge } from '../services/slackTeam/inbound';
import { verifySlackLink } from '../config/jwt';

const router = Router();

router.post('/events', asyncHandler(async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { type?: string; challenge?: string };
  const challenge = slackChallenge(body);
  if (challenge) {
    res.json({ challenge });
    return;
  }

  if (!req.rawBody) {
    res.status(401).json({ ok: false });
    return;
  }

  const result = await acceptSlackEvent(
    req.rawBody.toString('utf8'),
    req.header('x-slack-request-timestamp'),
    req.header('x-slack-signature'),
    body
  );
  res.status(result.status).json({ ok: result.status === 200 });
}));

router.get('/team-bots/callback', asyncHandler(async (req: Request, res: Response) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const target = await finishSlackInstall({ code, state, error });
  res.redirect(target);
}));

router.get('/team-bots/:botId', asyncHandler(async (req: Request, res: Response) => {
  const bot = await findBotById(req.params.botId);
  if (!bot) return res.status(404).json({ error: 'Bot not found' });
  const member = bot.teamId ? await findMembership(bot.teamId, req.user!.id) : null;
  if (bot.userId !== req.user!.id && !member) return res.status(404).json({ error: 'Bot not found' });
  res.json(await slackInstallView(req.user!.id, bot));
}));

router.post('/team-bots/:botId/publish', asyncHandler(async (req: Request, res: Response) => {
  const bot = await findBotById(req.params.botId);
  if (!bot || !bot.isTeamBot) return res.status(404).json({ error: 'Team Bot not found' });
  const member = bot.teamId ? await findMembership(bot.teamId, req.user!.id) : null;
  if (bot.userId !== req.user!.id && (!member || (member.role !== 'owner' && member.role !== 'manager'))) {
    return res.status(403).json({ error: 'Only the team owner or a manager can publish this bot.' });
  }
  const published = await publishTeamBot(bot.id);
  if (!published) return res.status(400).json({ error: 'This bot cannot be published.' });
  res.json(toPublicBot(published));
}));

router.post('/team-bots/:botId/connect', asyncHandler(async (req: Request, res: Response) => {
  try {
    res.json(await beginSlackInstall(req.user!.id, req.params.botId));
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not connect Slack' });
  }
}));

router.delete('/team-bots/:botId', asyncHandler(async (req: Request, res: Response) => {
  try {
    await disconnectSlackApp(req.user!.id, req.params.botId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not disconnect Slack' });
  }
}));

router.post('/link/start', asyncHandler(async (req: Request, res: Response) => {
  const slackTeamId = typeof req.body?.slackTeamId === 'string' ? req.body.slackTeamId : undefined;
  try {
    res.json({ authorizeUrl: await buildAccountLinkUrl(req.user!.id, slackTeamId) });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not start Slack linking' });
  }
}));

router.post('/link/identity', asyncHandler(async (req: Request, res: Response) => {
  const proof = verifySlackLink(typeof req.body?.token === 'string' ? req.body.token : undefined);
  if (!proof || !/^[UW][A-Z0-9]+$/.test(proof.slackUserId) || !/^T[A-Z0-9]+$/.test(proof.slackTeamId)) {
    return res.status(400).json({ error: 'That link expired. Press Link account in Slack again.' });
  }
  let linked = await linkSlackAccount(req.user!.id, proof.slackUserId, proof.slackTeamId, proof.displayName);
  if (!linked) {
    const owner = await findUserById(req.user!.id);
    await ensureOwnedTeam(req.user!.id, owner?.name || 'My');
    linked = await linkSlackAccount(req.user!.id, proof.slackUserId, proof.slackTeamId, proof.displayName);
  }
  if (!linked) {
    return res.status(400).json({ error: 'Could not link this Slack account.' });
  }
  res.json({ linked: true, displayName: proof.displayName || null });
}));

router.post('/link/from-plugin', asyncHandler(async (req: Request, res: Response) => {
  const installation = await findInstallationByUserAndPlugin(req.user!.id, 'slack');
  const slackUserId = installation?.metadata?.authed_user_id;
  const slackTeamId = installation?.metadata?.team_id;
  if (installation?.status !== 'connected' || typeof slackUserId !== 'string' || typeof slackTeamId !== 'string') {
    return res.status(400).json({ error: 'Connect Slack in Plugins first, or use Link account.' });
  }
  const linked = await linkSlackAccount(req.user!.id, slackUserId, slackTeamId);
  if (!linked) {
    return res.status(400).json({ error: 'Create a Team Bot first so there is a team to link.' });
  }
  res.json({ linked: true, slackUserId, slackTeamId });
}));

export default router;
