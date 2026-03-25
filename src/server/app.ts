import express from 'express';
import { join } from 'path';
import { correlationMiddleware } from './middleware/correlation';
import { errorHandler } from './middleware/error-handler';
import { pipelineRouter } from './routes/pipeline';
import { editorialRouter } from './routes/editorial';
import { promptsRouter } from './routes/prompts';
import { subscribersRouter } from './routes/subscribers';
import { editionsRouter } from './routes/editions';
import { testDiscoveryRouter } from './routes/test-discovery';

export function createApp() {
  const app = express();

  // Middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(correlationMiddleware);

  // Serve static editorial UI
  app.use(express.static(join(__dirname, '..', 'public')));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'morning-signal-v2', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/api/pipeline', pipelineRouter);
  app.use('/api/editorial', editorialRouter);
  app.use('/api/prompts', promptsRouter);
  app.use('/api/subscribers', subscribersRouter);
  app.use('/api/editions', editionsRouter);
  app.use('/api/test', testDiscoveryRouter);

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
