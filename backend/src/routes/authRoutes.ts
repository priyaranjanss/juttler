import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  countUsers,
  createUserRecord,
  emailExists,
  findUserByEmail,
  hashPassword,
  verifyPassword,
  toSafeUser,
} from '../repositories/users';
import { createBot } from '../repositories/bots';
import { signAuthToken } from '../config/jwt';
import { CHIEF_BOT_CONFIG, CHIEF_SYSTEM_PROMPT } from '../config/chiefOfStaff';
import { rateLimit } from '../middleware/rateLimit';
import {
  normalizeEmail,
  validateEmail,
  validateName,
  validatePassword,
} from '../utils/authValidation';

const router = Router();

// A syntactically valid hash used when the email is unknown, so a failed login
// costs the same scrypt work whether or not the account exists.
const DUMMY_PASSWORD_HASH = `${'00'.repeat(16)}:${'00'.repeat(64)}`;

// Auth responses must never be cached by a browser or intermediary.
router.use((_req: Request, res: Response, next: () => void) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
});

const registerLimiter = rateLimit({ windowMs: 60 * 60_000, max: 5 });
const loginLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: 10,
  // Per IP *and* account, so one noisy address cannot lock out a user globally.
  key: (req) => `${req.ip || 'unknown'}:${normalizeEmail(String(req.body?.email ?? ''))}`,
});

router.post(
  '/register',
  registerLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    const validationError =
      validateName(name) || validateEmail(email) || validatePassword(password);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    if (await emailExists(email)) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // The first account owns the fresh workspace; later accounts are members.
    const role = (await countUsers()) === 0 ? 'admin' : 'user';

    const newUser = await createUserRecord({
      name,
      email,
      role,
      passwordHash: await hashPassword(password),
    });

    // Every new account starts with the Chief of Staff: the single front door
    // that routes work to specialist bots.
    await createBot({
      userId: newUser.id,
      ...CHIEF_BOT_CONFIG,
      systemPrompt: CHIEF_SYSTEM_PROMPT,
    });

    const token = signAuthToken(newUser.id);
    res.status(201).json({ user: toSafeUser(newUser), token });
  })
);

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required.' });
    }

    const record = await findUserByEmail(email);
    // Always perform the hash comparison, even for an unknown email.
    const passwordOk = await verifyPassword(password, record?.passwordHash || DUMMY_PASSWORD_HASH);

    if (!record || !record.passwordHash || !passwordOk) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    if (record.status !== 'active') {
      return res.status(403).json({ error: 'This account has been disabled.' });
    }

    const token = signAuthToken(record.id);
    res.json({ user: toSafeUser(record), token });
  })
);

// JWTs are stateless. Signing out means the client discards its token; this
// endpoint exists so the client always has a clean, auditable sign-out call.
router.post('/logout', (_req: Request, res: Response) => {
  res.json({ success: true });
});

router.get('/me', (req: Request, res: Response) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  res.json({ user: toSafeUser(req.user) });
});

export default router;
