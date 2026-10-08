import { nextStatus, type ErrorCode, type Status } from '@tm/shared';

/** Every expected failure carries its API code + HTTP status; the error middleware only maps these. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly httpStatus: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Invalid request', details?: unknown) {
    super('VALIDATION_ERROR', 400, message, details);
  }
}

export class InvalidActorError extends AppError {
  // The message never echoes the supplied value (docs/06 S-08).
  constructor() {
    super('INVALID_ACTOR', 400, 'X-Actor must be one of the known users');
  }
}

export class ForbiddenHostError extends AppError {
  constructor() {
    super('FORBIDDEN_HOST', 403, 'Host not allowed');
  }
}

export class TaskNotFoundError extends AppError {
  constructor() {
    super('TASK_NOT_FOUND', 404, 'Task not found');
  }
}

export class RouteNotFoundError extends AppError {
  constructor() {
    super('ROUTE_NOT_FOUND', 404, 'Route not found');
  }
}

export class InvalidTransitionError extends AppError {
  constructor(from: Status, to: Status) {
    super('INVALID_TRANSITION', 422, `Cannot move from ${from} to ${to}`, {
      from,
      to,
      allowed: nextStatus(from), // the only valid next status (null once done)
    });
  }
}
