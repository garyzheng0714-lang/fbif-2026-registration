import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { csrfRouter } from './routes/csrf.js';
import { submissionsRouter } from './routes/submissions.js';
import { logger } from './utils/logger.js';

export function createServer() {
  const app = express();

  app.set('trust proxy', 1);
  const httpLogger = pinoHttp as unknown as (options: { logger: typeof logger }) => express.RequestHandler;
  app.use(httpLogger({ logger }));
  app.use(helmet());
  app.use(cors({
    origin: env.WEB_ORIGIN,
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));

  app.use('/api', apiLimiter);
  app.use('/api/csrf', csrfRouter);
  app.use('/api/submissions', submissionsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
