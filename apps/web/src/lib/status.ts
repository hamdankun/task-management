import type { Status } from '@tm/shared';

/** The UI's one vocabulary for statuses. API/DB keep the raw values (docs/07 §5.3). */
export const STATUS_LABEL: Record<Status, string> = {
  to_do: 'To do',
  pending: 'Pending',
  in_progress: 'In progress',
  done: 'Done',
};
