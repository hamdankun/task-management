import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, RouteNotFoundError } from '../../domain/errors';
import type { Logger } from '../logger';

export const notFound: RequestHandler = (_req, _res, next) => next(new RouteNotFoundError());

// body-parser errors carry a `type`; their own message can quote the offending input, so we
// replace it with a fixed string (docs/06 S-08).
const BODY_PARSER_MESSAGES: Record<string, string> = {
  'entity.parse.failed': 'Invalid JSON body',
  'entity.too.large': 'Request body too large',
};
const bodyParserType = (e: unknown): string | undefined =>
  typeof e === 'object' &&
  e !== null &&
  'type' in e &&
  'statusCode' in e &&
  typeof e.type === 'string'
    ? e.type
    : undefined;

export const errorHandler =
  (logger: Logger): ErrorRequestHandler =>
  (error, _req, res, next) => {
    if (res.headersSent) return next(error);

    if (error instanceof AppError) {
      res.status(error.httpStatus).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }

    const parserType = bodyParserType(error);
    if (parserType) {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: BODY_PARSER_MESSAGES[parserType] ?? 'Invalid request body',
        },
      });
      return;
    }

    // Full cause stays server-side; the client gets a generic message and the request id.
    const requestId = res.locals.requestId as string | undefined;
    logger.error({
      id: requestId,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side',
        details: { requestId },
      },
    });
  };
