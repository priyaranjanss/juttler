import express from 'express';
import { asyncHandler } from './utils/asyncHandler';
import { authenticate, isPublicAuthPath } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import authRoutes from './routes/authRoutes';
import botRoutes from './routes/botRoutes';
import conversationRoutes from './routes/conversationRoutes';
import pluginRoutes from './routes/pluginRoutes';
import teamRoutes from './routes/teamRoutes';
import slackTeamRoutes from './routes/slackTeamRoutes';
import { syncPluginCatalog } from './repositories/plugins';

const app = express();

// Railway and similar hosts terminate TLS at one proxy hop. Trusting it makes
// req.ip the real client for auth rate limiting. Set TRUST_PROXY=0 when the API
// is exposed directly to the internet.
const trustProxy = process.env.TRUST_PROXY;
app.set('trust proxy', trustProxy === '0' ? false : Number(trustProxy) || 1);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  })
);
app.use(corsMiddleware);

// Auth guard: every /api route requires a valid session except public auth endpoints
app.use('/api', asyncHandler(async (req, res, next) => {
  if (isPublicAuthPath(req.path)) {
    next();
    return;
  }
  await authenticate(req, res, next);
}));

// API routers
app.use('/api/auth', authRoutes);
app.use('/api/bots', botRoutes);
app.use('/api', conversationRoutes);
app.use('/api/plugins', pluginRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/slack', slackTeamRoutes);

async function startServer() {
  // Railway (and most hosts) inject the port to bind. Fall back to 3000 locally.
  const rawPort = process.env.PORT;
  const port = rawPort && rawPort.trim() ? Number.parseInt(rawPort, 10) : 3000;

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`PORT is invalid: "${rawPort}"`);
  }

  // Keep the plugin marketplace catalog in sync with the built-in definitions.
  try {
    const count = await syncPluginCatalog();
    console.log(`Plugin catalog synced (${count} plugins)`);
  } catch (err) {
    console.error('Plugin catalog sync failed:', err);
  }

  // This is a pure API service. The frontend is deployed separately and points
  // at it via VITE_BACKEND_URL, so nothing is served statically here.

  app.listen(port, '0.0.0.0', () => {
    console.log(`Juttler API server running on http://0.0.0.0:${port}`);
  }).on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Another process is bound to it (a duplicate app.listen, or a previous run that did not exit).`);
    }
    console.error('Server failed to start:', err);
    process.exit(1);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Juttler server:', err);
});
