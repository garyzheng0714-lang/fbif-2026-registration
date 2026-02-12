import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: 'Not Found', traceId: res.locals.traceId });
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'ValidationError',
      details: err.flatten(),
      traceId: res.locals.traceId
    });
  }

  if (err?.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({ error: 'Invalid CSRF token', traceId: res.locals.traceId });
  }

  // Prisma connection pool exhausted.
  // Surface as 503 so clients can retry instead of treating it as a permanent failure.
  if (err?.code === 'P2024') {
    return res.status(503).json({
      error: 'DatabaseBusy',
      message: 'Database connection pool exhausted. Please retry.',
      traceId: res.locals.traceId
    });
  }

  logger.error({ err, traceId: res.locals.traceId }, 'Unhandled error');
  res.status(500).json({ error: 'Internal Server Error', traceId: res.locals.traceId });
};
