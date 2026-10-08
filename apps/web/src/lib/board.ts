import { nextStatus, type Status, type Task } from '@tm/shared';
import { STATUS_LABEL } from './status';

export type DropDecision =
  { kind: 'move' } | { kind: 'stay' } | { kind: 'rejected'; message: string };

/**
 * What dropping `task` on the `target` column means: the next status is a move, the same column is
 * nothing, anything else (a skip or going back) is refused with an explanation. Mirrors the server
 * rule from the brief (forward only, one step); the server still enforces it.
 */
export function dropDecision(task: Task, target: Status): DropDecision {
  if (target === task.status) return { kind: 'stay' };
  const next = nextStatus(task.status);
  if (target === next) return { kind: 'move' };
  return {
    kind: 'rejected',
    message: next
      ? `Tasks move one step at a time. This one can go to ${STATUS_LABEL[next]}.`
      : "Done tasks can't move.",
  };
}
