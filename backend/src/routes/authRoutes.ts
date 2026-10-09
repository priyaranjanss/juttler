import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  emailExists,
  createUserRecord,
  findUserByEmail,
  hashPassword,
  verifyPassword,
  toSafeUser,
} from '../repositories/users';
import { createBot } from '../repositories/bots';
import { signAuthToken } from '../config/jwt';
import { CHIEF_BOT_CONFIG, CHIEF_SYSTEM_PROMPT } from '../config/chiefOfStaff';

const router = Router();

router.post('/register', asyncHandler(async (req: Request, res: Response) => {
  const { name, email, password } = req.body as { name?: string; email?: string; password?: string };

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (await emailExists(email)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const newUser = await createUserRecord({
    name: name.trim(),
    email: email.trim(),
    role: 'user',
    passwordHash: hashPassword(password),
  });

  // Every new account starts with the Chief of Staff: the single front door
  // that routes work to specialist bots.
  await createBot({
    userId: newUser.id,
    ...CHIEF_BOT_CONFIG,
    systemPrompt: CHIEF_SYSTEM_PROMPT,
  });

  const token = signAuthToken(newUser.id);
  res.json({ user: toSafeUser(newUser), token });
}));

router.post('/login', asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const record = await findUserByEmail(email);

  if (!record || !verifyPassword(password, record.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  if (record.status !== 'active') {
    return res.status(403).json({ error: 'This account has been disabled' });
  }

  const token = signAuthToken(record.id);
  res.json({ user: toSafeUser(record), token });
}));

router.post('/logout', (_req: Request, res: Response) => {
  // JWTs are stateless, so there is nothing to invalidate server-side.
  // The client discards its token; it simply stops being sent.
  res.json({ success: true });
});

router.get('/me', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.json({ user: toSafeUser(req.user) });
});

export default router;
