import { InvalidActorError, ValidationError } from './errors';

// Hardcoded by the brief; the UI reads this list from GET /api/actors so there is one source.
export const ACTORS = ['john.doe', 'jane.smith', 'budi.santoso', 'siti.rahma'] as const;
export type Actor = (typeof ACTORS)[number];

/** Exact, case-sensitive match; no trimming (docs/04 §1). */
export function assertActor(value: string): asserts value is Actor {
  if (!(ACTORS as readonly string[]).includes(value)) throw new InvalidActorError();
}

/** An assignee is one of the same predefined users; the message never echoes the input. */
export function assertAssignee(value: string): asserts value is Actor {
  if (!(ACTORS as readonly string[]).includes(value)) {
    throw new ValidationError('Invalid request', {
      formErrors: [],
      fieldErrors: { assignee: ['Choose a listed user'] },
    });
  }
}
