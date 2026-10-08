import type { RequestHandler } from 'express';
import { ForbiddenHostError } from '../../domain/errors';

// Static values, so this runs before the host guard and every response (403/404 included) has them.
// ponytail: five hand-written headers instead of helmet; this API only returns JSON.
export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Cache-Control': 'no-store',
  });
  next();
};

/** DNS-rebinding defence: exact hostname match, no wildcard/suffix matching (docs/06 S-03). */
export const hostGuard = (allowedHosts: readonly string[]): RequestHandler => {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return (req, _res, next) => {
    const hostname = req.hostname?.toLowerCase();
    next(hostname && allowed.has(hostname) ? undefined : new ForbiddenHostError());
  };
};
