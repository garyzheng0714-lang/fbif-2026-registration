import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { createSubmission, getSubmission } from './store.js';
import { validateSubmission } from './validation.js';

const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:4173';
const latencyMs = Number(process.env.MOCK_API_LATENCY_MS || 120);
const jitterMs = Number(process.env.MOCK_API_JITTER_MS || 80);
const errorRate = Number(process.env.MOCK_API_HTTP_500_RATE || 0);
const uploadDir = process.env.MOCK_API_UPLOAD_DIR || '/tmp/fbif-form-uploads';
const maxUploadMb = Number(process.env.MOCK_API_MAX_UPLOAD_MB || 50);
const maxUploadBytes = Math.max(1, maxUploadMb) * 1024 * 1024;
const maxUploadFiles = Number(process.env.MOCK_API_MAX_UPLOAD_FILES || 5);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function logError(...args) {
  console.error(new Date().toISOString(), ...args);
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

  fs.mkdirSync(uploadDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadDir,
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname || '').slice(0, 16);
        cb(null, `${crypto.randomUUID()}${ext}`);
      }
    }),
    limits: {
      fileSize: maxUploadBytes,
      files: maxUploadFiles
    }
  });

  app.use(cors({
    origin: webOrigin,
    credentials: true
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '16kb' }));

  app.use(async (req, res, next) => {
    res.locals.traceId = crypto.randomUUID();
    res.setHeader('X-Trace-Id', res.locals.traceId);

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

  app.post(
    '/api/submissions',
    (req, res, next) => {
      if (!req.is('multipart/form-data')) return next();
      return upload.array('proofFiles', maxUploadFiles)(req, res, (err) => {
        if (!err) return next();

        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'PayloadTooLarge' });
          }
          return res.status(400).json({ error: 'BadRequest', message: err.code });
        }

        return next(err);
      });
    },
    (req, res) => {
    const csrfHeader = req.headers['x-csrf-token'];
    const csrfCookie = req.cookies.mock_csrf;

    if (!csrfHeader || !csrfCookie || csrfHeader !== csrfCookie) {
      for (const file of req.files || []) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // Ignore cleanup errors.
        }
      }
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }

    const result = validateSubmission(req.body || {});
    if (!result.ok) {
      for (const file of req.files || []) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // Ignore cleanup errors.
        }
      }
      return res.status(400).json({
        error: 'ValidationError',
        message: result.error
      });
    }

    const files = Array.isArray(req.files)
      ? req.files.map((file) => ({
          path: file.path,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size
        }))
      : [];

    if (result.data.role === 'industry' && files.length === 0) {
      return res.status(400).json({
        error: 'ValidationError',
        message: '请上传专业观众证明材料'
      });
    }

    let submission;
    try {
      submission = createSubmission({
        ...result.data,
        proofUploads: files,
        traceId: res.locals.traceId
      });
    } catch (error) {
      for (const file of req.files || []) {
        try {
          fs.unlinkSync(file.path);
        } catch {
          // Ignore cleanup errors.
        }
      }
      throw error;
    }

    const idSuffix = String(submission.idNumber || '').slice(-4);
    const totalBytes = files.reduce((sum, file) => sum + Number(file?.size || 0), 0);
    log(
      'submission upload accepted:',
      `[trace=${submission.traceId}] [idSuffix=${idSuffix}] [sub=${submission.id}]`,
      `role=${submission.role || ''}`,
      `files=${files.length}`,
      `bytes=${totalBytes}`
    );

    return res.status(202).json({
      id: submission.id,
      traceId: submission.traceId,
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
      traceId: submission.traceId,
      syncStatus: submission.syncStatus,
      syncError: submission.syncError,
      feishuRecordId: submission.feishuRecordId,
      createdAt: submission.createdAt,
      syncTimings: submission.syncTimings
    });
  });

  app.use((err, _req, res, _next) => {
    const trace = res?.locals?.traceId ? `[trace=${res.locals.traceId}]` : '';
    logError('request error:', trace, err);
    res.status(500).json({
      error: 'Internal Server Error',
      traceId: res?.locals?.traceId || null
    });
  });

  return app;
}
