import { nextStatus, type AuditLog, type Status, type Task } from '@tm/shared';
import { vi } from 'vitest';
import { ApiError, type Api } from '@/api/client';

type Extra = Pick<AuditLog, 'field' | 'fromValue' | 'toValue'>;
const NONE: Extra = { field: null, fromValue: null, toValue: null };

/** In-memory backend behind the Api boundary; each method is a vi.fn so tests can override/inspect. */
export function createFakeApi() {
  const tasks: Task[] = [];
  const logs: AuditLog[] = [];
  let seq = 0;
  let tick = 0;
  const now = () => new Date(Date.UTC(2025, 0, 1, 9, tick++, 0)).toISOString();
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
  const log = (
    t: Task,
    action: AuditLog['action'],
    actor: string,
    from: Status | null,
    to: Status | null,
    extra: Extra = NONE,
  ) => {
    const entry: AuditLog = {
      id: logs.length + 1,
      taskId: t.id,
      taskTitle: t.title,
      action,
      actor,
      fromStatus: from,
      toStatus: to,
      ...extra,
      createdAt: t.updatedAt,
    };
    logs.push(entry);
    return entry;
  };
  const find = (taskId: string) => tasks.find((t) => t.id === taskId);

  const api = {
    actors: vi.fn(async () => ['john.doe', 'jane.smith']),
    listTasks: vi.fn(async () => [...tasks].reverse().map((t) => ({ ...t }))),
    createTask: vi.fn(async (actor, input) => {
      const title = input.title.trim();
      if (!title) {
        throw new ApiError('VALIDATION_ERROR', 'Invalid request', 400, {
          formErrors: [],
          fieldErrors: { title: ['Title is required'] },
        });
      }
      const at = now();
      const t: Task = {
        id: id(),
        title,
        description: input.description?.trim() || null,
        status: 'to_do',
        assignee: null,
        createdAt: at,
        updatedAt: at,
      };
      tasks.push(t);
      log(t, 'created', actor, null, 'to_do');
      return { ...t };
    }),
    changeStatus: vi.fn(async (actor, taskId, status) => {
      const t = find(taskId);
      if (!t) throw new ApiError('TASK_NOT_FOUND', 'Task not found', 404);
      if (t.status === status) return { task: { ...t }, changed: false, auditLog: null };
      if (nextStatus(t.status) !== status) {
        throw new ApiError('INVALID_TRANSITION', `Cannot move from ${t.status} to ${status}`, 422, {
          from: t.status,
          to: status,
          allowed: nextStatus(t.status),
        });
      }
      const from = t.status;
      t.status = status;
      t.updatedAt = now();
      return {
        task: { ...t },
        changed: true,
        auditLog: log(t, 'status_changed', actor, from, status),
      };
    }),
    updateTask: vi.fn(async (actor, taskId, patch) => {
      const t = find(taskId);
      if (!t) throw new ApiError('TASK_NOT_FOUND', 'Task not found', 404);
      if (patch.title !== undefined && !patch.title.trim()) {
        throw new ApiError('VALIDATION_ERROR', 'Invalid request', 400, {
          formErrors: [],
          fieldErrors: { title: ['Title is required'] },
        });
      }
      const next = {
        title: patch.title === undefined ? t.title : patch.title.trim(),
        description:
          patch.description === undefined ? t.description : patch.description?.trim() || null,
        assignee: patch.assignee === undefined ? t.assignee : patch.assignee,
      };
      const changed = (['title', 'description', 'assignee'] as const).filter(
        (f) => next[f] !== t[f],
      );
      if (changed.length === 0) return { task: { ...t }, changed: false, auditLogs: [] };
      const before = { ...t };
      Object.assign(t, next, { updatedAt: now() });
      const auditLogs = changed.map((f) =>
        log(t, 'edited', actor, null, null, { field: f, fromValue: before[f], toValue: t[f] }),
      );
      return { task: { ...t }, changed: true, auditLogs };
    }),
    deleteTask: vi.fn(async (actor, taskId) => {
      const t = find(taskId);
      if (!t) throw new ApiError('TASK_NOT_FOUND', 'Task not found', 404);
      t.updatedAt = now();
      log(t, 'deleted', actor, t.status, null);
      tasks.splice(tasks.indexOf(t), 1);
    }),
    listAuditLogs: vi.fn(async (taskId) =>
      logs.filter((l) => l.taskId === taskId).map((l) => ({ ...l })),
    ),
  } satisfies Api;

  /** Seed through the real code path so logs exist; returns the task. */
  const seed = async (
    title: string,
    moves: Status[] = [],
    description?: string,
    assignee?: string,
  ) => {
    const t = await api.createTask('john.doe', { title, description });
    for (const s of moves) await api.changeStatus('john.doe', t.id, s);
    if (assignee) await api.updateTask('john.doe', t.id, { assignee });
    for (const m of [api.createTask, api.changeStatus, api.updateTask]) m.mockClear();
    return find(t.id) as Task;
  };

  return { api: api as Api & typeof api, seed, tasks };
}
