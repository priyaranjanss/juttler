import express from 'express';
import { authenticate, isPublicAuthPath } from './middleware/auth';
import { corsMiddleware } from './middleware/cors';
import authRoutes from './routes/authRoutes';
import botRoutes from './routes/botRoutes';
import conversationRoutes from './routes/conversationRoutes';
import pluginRoutes from './routes/pluginRoutes';
import { syncPluginCatalog } from './repositories/plugins';

const app = express();
app.use(express.json());
app.use(corsMiddleware);

// Auth guard: every /api route requires a valid session except public auth endpoints
app.use('/api', (req, res, next) => {
  if (isPublicAuthPath(req.path)) {
    next();
    return;
  }
  authenticate(req, res, next);
});

// API routers
app.use('/api/auth', authRoutes);
app.use('/api/bots', botRoutes);
app.use('/api', conversationRoutes);
app.use('/api/plugins', pluginRoutes);

async function startServer() {
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

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
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`Juttler API server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Juttler server:', err);
});
