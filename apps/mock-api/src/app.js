import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { createSubmission, getSubmission } from './store.js';
import { validateSubmission } from './validation.js';

const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:4173';
const latencyMs = Number(process.env.MOCK_API_LATENCY_MS || 120);
const jitterMs = Number(process.env.MOCK_API_JITTER_MS || 80);
const errorRate = Number(process.env.MOCK_API_HTTP_500_RATE || 0);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withLatency() {
  const ms = Math.max(0, latencyMs + Math.floor(Math.random() * jitterMs));
  return delay(ms);
}

function shouldInjectHttpError(req) {
  if (req.headers['x-mock-fail'] === '1') return true;
  if (req.query.fail === '1') return true;
  if (errorRate > 0 && Math.random() < errorRate) return true;
  return false;
}

export function createApp() {
  const app = express();

  app.use(cors({
    origin: webOrigin,
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '16kb' }));

  app.use(async (req, res, next) => {
    await withLatency();

    if (shouldInjectHttpError(req)) {
      return res.status(500).json({ error: 'mock injected error' });
    }

    return next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'mock-api' });
  });

  app.get('/api/csrf', (_req, res) => {
    const token = crypto.randomBytes(24).toString('base64url');

    res.cookie('mock_csrf', token, {
      httpOnly: false,
      sameSite: 'lax'
    });

    res.json({ csrfToken: token });
  });

  app.post('/api/submissions', (req, res) => {
    const csrfHeader = req.headers['x-csrf-token'];
    const csrfCookie = req.cookies.mock_csrf;

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }

    const result = validateSubmission(req.body || {});
    if (!result.ok) {
      return res.status(400).json({
        error: 'ValidationError',
        message: result.error
      });
    }

    const submission = createSubmission(result.data);

    return res.status(202).json({
      id: submission.id,
      syncStatus: submission.syncStatus
    });
  });

  app.get('/api/submissions/:id/status', (req, res) => {
    const submission = getSubmission(req.params.id);

    if (!submission) {
      return res.status(404).json({ error: 'Not Found' });
    }

    return res.json({
      id: submission.id,
      syncStatus: submission.syncStatus,
      syncError: submission.syncError,
      feishuRecordId: submission.feishuRecordId,
      createdAt: submission.createdAt
    });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
