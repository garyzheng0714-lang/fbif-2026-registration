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

  // Temporary: read-only Feishu record verification (remove after testing)
  app.get('/debug/feishu-records', async (_req, res) => {
    try {
      const appId = process.env.FEISHU_APP_ID || '';
      const appSecret = process.env.FEISHU_APP_SECRET || '';
      const appToken = process.env.FEISHU_APP_TOKEN || '';
      const tableId = process.env.FEISHU_TABLE_ID || '';
      if (!appId || !appSecret || !appToken || !tableId) {
        return res.status(503).json({ error: 'Missing Feishu credentials' });
      }
      const tokenResp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
      });
      const tokenData = await tokenResp.json() as any;
      if (!tokenData?.tenant_access_token) {
        return res.status(502).json({ error: 'Token fetch failed', detail: tokenData });
      }
      const recordsResp = await fetch(
        `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=8`,
        { headers: { Authorization: `Bearer ${tokenData.tenant_access_token}` } }
      );
      const recordsData = await recordsResp.json() as any;
      const items = (recordsData?.data?.items || []).map((item: any) => ({
        record_id: item.record_id,
        fields: Object.fromEntries(
          Object.entries(item.fields || {}).map(([k, v]: [string, any]) => {
            if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
              return [k, v.text || v.value || v];
            }
            return [k, v];
          })
        )
      }));
      res.json({ total: items.length, items });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
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
