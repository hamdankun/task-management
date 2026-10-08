import { ApiError } from '@/api/client';

/** Anything thrown becomes an ApiError so the UI has one error shape to render. */
export const toApiError = (e: unknown): ApiError =>
  e instanceof ApiError ? e : new ApiError('UNEXPECTED_RESPONSE', 'Unexpected error');

const requestIdOf = (error: ApiError): string | undefined => {
  const d = error.details;
  return typeof d === 'object' && d !== null && 'requestId' in d && typeof d.requestId === 'string'
    ? d.requestId
    : undefined;
};

/** User-facing text by error code (docs/07 §6). Raw server text is never shown for 5xx. */
export function errorMessage(error: ApiError): string {
  switch (error.code) {
    case 'VALIDATION_ERROR':
      return 'The request was not valid. Check your input and try again.';
    case 'INVALID_ACTOR':
      return 'Choose who you are, then try again.';
    case 'TASK_NOT_FOUND':
      return 'That task no longer exists. The list was refreshed.';
    case 'INVALID_TRANSITION':
      return 'This task was changed in another tab. The list was refreshed.';
    case 'FORBIDDEN_HOST':
    case 'ROUTE_NOT_FOUND':
      return "Can't reach the task service. Check the address and try again.";
    case 'NETWORK_ERROR':
      return "Can't reach the task service. Check your connection and try again.";
    case 'INTERNAL_ERROR': {
      const ref = requestIdOf(error);
      return `Something went wrong on our side. Try again.${ref ? ` (Ref: ${ref})` : ''}`;
    }
    case 'UNEXPECTED_RESPONSE':
      return 'The task service sent an unexpected response. Try again.';
  }
}

/** Field messages come from our shared schemas (they never echo input), so they are shown as-is. */
export function fieldErrorsOf(error: ApiError): Record<string, string[]> {
  const d = error.details;
  if (typeof d !== 'object' || d === null || !('fieldErrors' in d)) return {};
  const raw = d.fieldErrors;
  if (typeof raw !== 'object' || raw === null) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (e): e is [string, string[]] =>
        Array.isArray(e[1]) && e[1].every((m) => typeof m === 'string'),
    ),
  );
}
