import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Logger } from '../logger';

const MAX_LOGGED = 200;
const clip = (value: string) => (value.length > MAX_LOGGED ? value.slice(0, MAX_LOGGED) : value);

/** Always generates its own id; an inbound X-Request-Id is never trusted (log forging). */
export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
};

/** One JSON line per request. Never logs bodies, headers or the query string. */
export const requestLogger =
  (logger: Logger): RequestHandler =>
  (req, res, next) => {
    const started = process.hrtime.bigint();
    // Captured now: routers rewrite req.url/req.path, so reading it on 'finish' yields "/".
    const path = clip(req.originalUrl.split('?')[0] ?? '');
    res.on('finish', () => {
      logger.info({
        id: res.locals.requestId,
        method: req.method,
        path,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
      });
    });
    next();
  };
