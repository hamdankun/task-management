import type { AuditLog, Status, Task } from '@tm/shared';
import type { NewAuditLog } from '../domain/audit-log';

export type { NewAuditLog };

export type TaskDetails = Pick<Task, 'title' | 'description' | 'assignee'>;

/**
 * Persistence port. Deliberately synchronous because better-sqlite3 is: it lets a transaction
 * span read-check-write without `await` (docs/02 §2.2). Postgres would make this async.
 *
 * Contract (verified by task-store.contract.ts against every implementation):
 *  - every write persists the task change AND its audit log atomically, even outside transaction()
 *  - updateStatus/updateDetails/softDelete throw when the task is missing or already deleted
 *  - audit logs are never changed or removed; there is no method that could
 */
export interface TaskStore {
  /** Active tasks, createdAt desc then id. */
  list(): Task[];
  /** Active (non-deleted) task. */
  get(id: string): Task | undefined;
  /** True even for soft-deleted tasks. */
  exists(id: string): boolean;
  insert(task: Task, log: NewAuditLog): void;
  updateStatus(id: string, status: Status, updatedAt: string, log: NewAuditLog): AuditLog;
  /**
   * Writes the full resulting detail values (not a diff, so SQL stays static) plus one audit log
   * per changed field, atomically. Returns the saved logs.
   */
  updateDetails(id: string, next: TaskDetails, updatedAt: string, logs: NewAuditLog[]): AuditLog[];
  softDelete(id: string, deletedAt: string, log: NewAuditLog): void;
  /** Ordered by log id ascending; includes logs of soft-deleted tasks. */
  listLogs(taskId: string): AuditLog[];
  /** Write transaction: returns fn's value, rolls everything back if fn throws. */
  transaction<T>(fn: () => T): T;
}

export interface Clock {
  /** ISO-8601 UTC with milliseconds. */
  now(): string;
}

export type IdGen = () => string;
