import { Router, type RequestHandler } from 'express';
import csurf from 'csurf';
import { isProd } from '../config/env.js';

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd
  }
}) as unknown as RequestHandler;

export const csrfRouter = Router();

csrfRouter.get('/', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

export const csrfGuard = csrfProtection;
