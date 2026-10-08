import {
  type ChangeStatusResponse,
  type CreateTaskInput,
  type Status,
  type Task,
  type UpdateTaskInput,
  type UpdateTaskResponse,
} from '@tm/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, isAbort, type Api } from '@/api/client';
import { toApiError } from '@/lib/errorCopy';

export type Result<T> = { ok: true; value: T } | { ok: false; error: ApiError };
export type Phase = 'loading' | 'ready' | 'error';

/**
 * List state + mutations. The server is the source of truth: every mutation, successful or not,
 * is followed by a refetch (no optimistic updates), so a stale tab heals itself.
 */
export function useTaskBoard(api: Api, actor: string | null) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  // Placement only: while a move request is in flight the card already shows in its target column.
  // The refetch that follows every request (success or failure) is still the source of truth.
  const [moving, setMoving] = useState<Readonly<Record<string, Status>>>({});
  const inflight = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    inflight.current?.abort(); // out-of-order responses are ignored
    const controller = new AbortController();
    inflight.current = controller;
    try {
      const list = await api.listTasks(controller.signal);
      if (controller.signal.aborted) return;
      setTasks(list);
      setPhase('ready');
      setLoadError(null);
    } catch (e) {
      if (controller.signal.aborted || isAbort(e)) return;
      setLoadError(toApiError(e));
      setPhase((p) => (p === 'loading' ? 'error' : p)); // keep showing the last good list
    }
  }, [api]);

  useEffect(() => {
    void reload();
    return () => inflight.current?.abort();
  }, [reload]);

  const run = useCallback(
    async <T>(key: string, fn: () => Promise<T>, inlineValidation = false): Promise<Result<T>> => {
      setActionError(null);
      setPending((p) => new Set(p).add(key));
      try {
        const value = await fn();
        await reload();
        return { ok: true, value };
      } catch (e) {
        const error = toApiError(e);
        // The form shows validation problems next to the fields instead of in the banner.
        if (!(inlineValidation && error.code === 'VALIDATION_ERROR')) setActionError(error);
        await reload();
        return { ok: false, error };
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(key);
          return next;
        });
      }
    },
    [reload],
  );

  const requireActor = (): string => {
    if (!actor) throw new ApiError('INVALID_ACTOR', 'No actor selected');
    return actor;
  };

  return {
    tasks: tasks.map((t) => (moving[t.id] ? { ...t, status: moving[t.id] as Status } : t)),
    phase,
    loadError,
    actionError,
    pending,
    reload,
    dismissActionError: () => setActionError(null),
    createTask: (input: CreateTaskInput): Promise<Result<Task>> =>
      run('new', () => api.createTask(requireActor(), input), true),
    /** Move to `target`; the server enforces the flow (anything but the next status is a 422). */
    move: async (task: Task, target: Status): Promise<Result<ChangeStatusResponse>> => {
      setMoving((m) => ({ ...m, [task.id]: target }));
      try {
        return await run(task.id, () => api.changeStatus(requireActor(), task.id, target));
      } finally {
        setMoving((m) => Object.fromEntries(Object.entries(m).filter(([id]) => id !== task.id)));
      }
    },
    // Validation problems (e.g. a blank title) are shown next to the field, other errors in the banner.
    update: (task: Task, patch: UpdateTaskInput): Promise<Result<UpdateTaskResponse>> =>
      run(task.id, () => api.updateTask(requireActor(), task.id, patch), true),
    remove: (task: Task): Promise<Result<void>> =>
      run(task.id, () => api.deleteTask(requireActor(), task.id)),
  };
}
