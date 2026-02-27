import express from 'express';
import crypto from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { apiLimiter, csrfLimiter } from './middleware/rateLimit.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { csrfRouter } from './routes/csrf.js';
import { ossRouter } from './routes/oss.js';
import { submissionsRouter } from './routes/submissions.js';
import { idVerifyRouter } from './routes/idVerify.js';
import { feishuSyncQueue } from './queue/index.js';
import { logger } from './utils/logger.js';
import {
  httpRequestDurationSeconds,
  httpRequestsTotal,
  renderMetrics,
  register as metricsRegistry,
  updateQueueMetrics
} from './metrics.js';

function normalizeMetricsPath(rawUrl: string) {
  const path = rawUrl.split('?')[0] || '/';
  if (path === '/api/csrf') return '/api/csrf';
  if (path === '/api/oss/policy') return '/api/oss/policy';
  if (path === '/api/id-verify') return '/api/id-verify';
  if (path === '/api/submissions') return '/api/submissions';
  if (/^\/api\/submissions\/[^/]+\/status$/.test(path)) return '/api/submissions/:id/status';
  if (path === '/health') return '/health';
  if (path === '/metrics') return '/metrics';
  return path;
}

export function createServer() {
  const app = express();

  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    const traceId = crypto.randomUUID();
    (res.locals as any).traceId = traceId;
    res.setHeader('X-Trace-Id', traceId);
    // Allow downstream (pino-http, handlers) to read trace id.
    (req as any).traceId = traceId;
    next();
  });

  const httpLogger = pinoHttp as unknown as (options: any) => express.RequestHandler;
  app.use(httpLogger({
    logger,
    customProps: (_req: any, res: any) => ({
      traceId: res?.locals?.traceId
    })
  }));
  app.use(helmet());
  app.use(cors({
    origin: env.WEB_ORIGIN,
    credentials: true
  }));
  app.use(cookieParser());

  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      const durationSec = Number(process.hrtime.bigint() - started) / 1e9;
      const labels = {
        method: req.method,
        path: normalizeMetricsPath(req.originalUrl || req.url || ''),
        status: String(res.statusCode || 0)
      };
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSec);
    });
    next();
  });

  app.use(express.json({ limit: '16kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/metrics', async (_req, res, next) => {
    try {
      await updateQueueMetrics(feishuSyncQueue);
      res.setHeader('Content-Type', metricsRegistry.contentType);
      res.end(await renderMetrics());
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/csrf', csrfLimiter, csrfRouter);
  app.use('/api', apiLimiter);
  app.use('/api/oss', ossRouter);
  app.use('/api/id-verify', idVerifyRouter);
  app.use('/api/submissions', submissionsRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
