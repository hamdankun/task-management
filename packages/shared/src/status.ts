export const STATUSES = ['to_do', 'pending', 'in_progress', 'done'] as const;
export type Status = (typeof STATUSES)[number];

/**
 * The only status a task may move to from `status`; null when terminal. This is THE movement rule
 * of the brief ("hanya mengikuti urutan"): one step forward, never backward, never a skip.
 * The domain, the DB trigger and the UI all mirror it.
 */
export const nextStatus = (status: Status): Status | null =>
  STATUSES[STATUSES.indexOf(status) + 1] ?? null;
