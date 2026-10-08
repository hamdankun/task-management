import { nextStatus, type Status } from '@tm/shared';
import { InvalidTransitionError } from './errors';

/**
 * Linear, forward-only, one step (BR-1; the brief: status follows to_do → pending → in_progress →
 * done). A skip or a move back is refused. Same-status is a no-op handled by the service first.
 */
export function assertTransition(from: Status, to: Status): void {
  if (to !== nextStatus(from)) throw new InvalidTransitionError(from, to);
}
