import express from 'express';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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

  // The built frontend lives in backend/public (see frontend/vite.config.ts),
  // so serving it never reaches outside this service root.
  const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

  // Serve the built app whenever it's present, regardless of NODE_ENV, so a
  // missing production flag can't silently break the deployment.
  const hasBuiltApp = existsSync(path.resolve(distPath, 'index.html'));
  if (hasBuiltApp) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  } else {
    console.warn('No built frontend found in backend/public - run `npm run build` before `npm start`.');
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Juttler API server running on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Juttler server:', err);
});
