import express, { type Express } from 'express';
import type { TaskService } from '../application/task-service';
import { errorHandler, notFound } from './middleware/error';
import { requestId, requestLogger } from './middleware/request';
import { hostGuard, securityHeaders } from './middleware/security';
import type { Logger } from './logger';
import { actorsRouter } from './routes/actors';
import { tasksRouter } from './routes/tasks';

export interface AppDeps {
  service: TaskService;
  logger: Logger;
  allowedHosts: readonly string[];
}

/** Pipeline order matters (docs/02 §3.1). No CORS on purpose (docs/06 S-02). */
export function createApp({ service, logger, allowedHosts }: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false); // responses are no-store; ETag/304 only adds confusion
  // 'trust proxy' stays false: X-Forwarded-* is never trusted.

  app.use(requestId);
  app.use(requestLogger(logger));
  app.use(securityHeaders);
  app.use(hostGuard(allowedHosts));
  app.use(express.json({ limit: '10kb' }));

  app.use('/api/actors', actorsRouter(service));
  app.use('/api/tasks', tasksRouter(service));

  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
