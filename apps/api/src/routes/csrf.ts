import { Router, type RequestHandler } from 'express';
import csurf from 'csurf';

function parseEnvBool(value: string | undefined, fallback: boolean) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    // NOTE:
    // - Default false to support plain HTTP deployments (e.g. via IP:port).
    // - Set CSRF_COOKIE_SECURE=true when the site is served over HTTPS.
    secure: parseEnvBool(process.env.CSRF_COOKIE_SECURE, false)
  }
}) as unknown as RequestHandler;

export const csrfRouter = Router();

csrfRouter.get('/', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

export const csrfGuard = csrfProtection;
