import { Router, type RequestHandler } from 'express';
import csurf from 'csurf';

function parseEnvBool(value: string | undefined, fallback: boolean) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  return fallback;
}

const isHttpOrigin = /^http:\/\//i.test(String(process.env.WEB_ORIGIN || ''));
const secureFallback = !isHttpOrigin;

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    // Secure flag is auto-derived from WEB_ORIGIN protocol.
    // HTTP origins (e.g. preview via IP:port) → false.
    // HTTPS origins (e.g. production domain) → true.
    // CSRF_COOKIE_SECURE env var overrides when explicitly set.
    secure: parseEnvBool(process.env.CSRF_COOKIE_SECURE, secureFallback)
  }
}) as unknown as RequestHandler;

export const csrfRouter = Router();

csrfRouter.get('/', csrfProtection, (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

export const csrfGuard = csrfProtection;
