import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { sessionMiddleware } from './auth.js';
import { HttpError } from './lib/util.js';
import authRoutes from './routes/auth.js';
import workspaceRoutes from './routes/workspaces.js';
import pageRoutes from './routes/pages.js';
import databaseRoutes from './routes/databases.js';
import commentRoutes from './routes/comments.js';
import notificationRoutes from './routes/notifications.js';
import uploadRoutes from './routes/uploads.js';
import publicRoutes from './routes/public.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '10mb' }));
  app.use(sessionMiddleware);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  // Routers with their own prefixes first: the '/api' routers below require a
  // signed-in user for everything that reaches them.
  app.use('/api/auth', authRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/api/workspaces', workspaceRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/uploads', uploadRoutes);
  app.use('/api', pageRoutes);
  app.use('/api', databaseRoutes);
  app.use('/api', commentRoutes);

  fs.mkdirSync(config.uploadDir, { recursive: true });
  app.use('/uploads', express.static(config.uploadDir, { maxAge: '7d', fallthrough: false }));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Unknown API route')));

  // Serve the built client (production mode) with SPA fallback.
  if (fs.existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
  } else {
    app.get('/', (_req, res) =>
      res.type('text').send('API server is running. Build the client (npm run build) or use the Vite dev server (npm run dev).'),
    );
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Something went wrong' : err.message, ...(err.extra || {}) });
  });
  return app;
}
