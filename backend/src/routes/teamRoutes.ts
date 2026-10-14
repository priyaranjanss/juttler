import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { findUserById, findUserByEmail } from '../repositories/users';
import {
  addMember,
  canManageTeam,
  ensureOwnedTeam,
  findMembership,
  findPrimaryTeam,
  listMembers,
} from '../repositories/teams';

const router = Router();

router.get('/mine', asyncHandler(async (req: Request, res: Response) => {
  const found = await findPrimaryTeam(req.user!.id);
  if (!found) {
    res.json({ team: null });
    return;
  }
  const members = await listMembers(found.team.id);
  const me = members.find((member) => member.userId === req.user!.id);
  res.json({
    team: {
      id: found.team.id,
      name: found.team.name,
      role: found.role,
      slackLinked: Boolean(me?.slackUserId),
      slackDisplayName: me?.slackDisplayName ?? null,
      slackTeamId: me?.slackTeamId ?? null,
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name,
        email: member.email,
        role: member.role,
        slackLinked: Boolean(member.slackUserId),
        slackDisplayName: member.slackDisplayName,
      })),
    },
  });
}));

router.post('/', asyncHandler(async (req: Request, res: Response) => {
  const user = await findUserById(req.user!.id);
  const requested = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const team = await ensureOwnedTeam(req.user!.id, requested || user?.name || 'My');
  res.json({ id: team.id, name: team.name });
}));

router.post('/:id/members', asyncHandler(async (req: Request, res: Response) => {
  const teamId = req.params.id;
  const actor = await findMembership(teamId, req.user!.id);
  if (!actor || !canManageTeam(actor.role)) {
    return res.status(403).json({ error: 'Only the team owner or a manager can invite people.' });
  }
  const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
  if (!email) return res.status(400).json({ error: 'An email address is required.' });

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(404).json({ error: 'That person needs a Juttler account before they can join the team.' });
  }
  if (user.id === req.user!.id) {
    return res.status(400).json({ error: 'You are already on this team.' });
  }
  const existing = await findMembership(teamId, user.id);
  if (existing) return res.status(409).json({ error: `${user.name} is already on this team.` });

  await addMember(teamId, user.id, 'member');
  res.json({ userId: user.id, name: user.name, email: user.email, role: 'member', slackLinked: false });
}));

export default router;
