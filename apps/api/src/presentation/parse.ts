import type { Request } from 'express';
import { z } from 'zod';
import { assertActor } from '../domain/actors';
import { TaskNotFoundError, ValidationError } from '../domain/errors';

/** A malformed id simply names no task: 404, never 400/500 (docs/04 §5). */
export function parseId(raw: string | undefined): string {
  const parsed = z.uuid().safeParse(raw);
  if (!parsed.success) throw new TaskNotFoundError();
  return parsed.data;
}

/** Actor comes only from the X-Actor header: never cookie, query or body (docs/06 S-02). */
export function actorOf(req: Request): string {
  const actor = req.get('x-actor') ?? '';
  assertActor(actor);
  return actor;
}

/**
 * Field errors for the client. Messages come from our schemas; zod's "unrecognized key" text
 * quotes the key the client sent, so it is replaced to avoid echoing input (docs/06 S-08).
 */
function toDetails(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  const formErrors: string[] = [];
  for (const issue of error.issues) {
    const message = issue.code === 'unrecognized_keys' ? 'Unknown field' : issue.message;
    const field = issue.path.join('.');
    if (field) (fieldErrors[field] ??= []).push(message);
    else formErrors.push(message);
  }
  return { formErrors, fieldErrors };
}

export function parseBody<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new ValidationError('Invalid request', toDetails(parsed.error));
  return parsed.data;
}
