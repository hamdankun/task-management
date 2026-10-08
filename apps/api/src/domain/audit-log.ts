import type { AuditLog, EditableField, Status, Task } from '@tm/shared';

export type NewAuditLog = Omit<AuditLog, 'id'>;

export type LogEvent =
  | { action: 'created'; task: Task }
  | { action: 'status_changed'; task: Task; to: Status } // task = state *before* the change
  | { action: 'edited'; task: Task; field: EditableField; from: string | null; to: string | null } // task = state *after*
  | { action: 'deleted'; task: Task };

/** The only place an audit log object is constructed (shape rules mirror the DB CHECKs). */
export function buildLog(event: LogEvent, actor: string, now: string): NewAuditLog {
  const { task } = event;
  const base = {
    taskId: task.id,
    taskTitle: task.title,
    actor,
    createdAt: now,
    field: null,
    fromValue: null,
    toValue: null,
  } as const;
  switch (event.action) {
    case 'created':
      return { ...base, action: 'created', fromStatus: null, toStatus: task.status };
    case 'status_changed':
      return { ...base, action: 'status_changed', fromStatus: task.status, toStatus: event.to };
    case 'edited':
      return {
        ...base,
        action: 'edited',
        fromStatus: null,
        toStatus: null,
        field: event.field,
        fromValue: event.from,
        toValue: event.to,
      };
    case 'deleted':
      return { ...base, action: 'deleted', fromStatus: task.status, toStatus: null };
  }
}
