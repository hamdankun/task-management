import {
  ActorsResponseSchema,
  ApiErrorBodySchema,
  AuditLogsResponseSchema,
  ChangeStatusResponseSchema,
  TaskResponseSchema,
  TasksResponseSchema,
  UpdateTaskResponseSchema,
  type AuditLog,
  type ChangeStatusResponse,
  type CreateTaskInput,
  type ErrorCode,
  type Status,
  type Task,
  type UpdateTaskInput,
  type UpdateTaskResponse,
} from '@tm/shared';

export type ClientErrorCode = ErrorCode | 'NETWORK_ERROR' | 'UNEXPECTED_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status = 0,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The only thing the UI knows about the backend (DIP): swap in a fake in tests. */
export interface Api {
  actors(signal?: AbortSignal): Promise<string[]>;
  listTasks(signal?: AbortSignal): Promise<Task[]>;
  createTask(actor: string, input: CreateTaskInput): Promise<Task>;
  changeStatus(actor: string, id: string, status: Status): Promise<ChangeStatusResponse>;
  updateTask(actor: string, id: string, patch: UpdateTaskInput): Promise<UpdateTaskResponse>;
  deleteTask(actor: string, id: string): Promise<void>;
  listAuditLogs(id: string, signal?: AbortSignal): Promise<AuditLog[]>;
}

interface Parser<T> {
  parse(data: unknown): T;
}
interface Call {
  method?: string;
  actor?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export const isAbort = (e: unknown): boolean =>
  e instanceof DOMException && e.name === 'AbortError';

/** Relative /api URLs only: same origin via the Vite proxy, no CORS, no user-supplied base URL. */
export function createApi(fetchImpl: typeof fetch = (...args) => fetch(...args)): Api {
  async function send(
    path: string,
    { method = 'GET', actor, body, signal }: Call,
  ): Promise<Response> {
    const headers: Record<string, string> = {};
    if (actor) headers['X-Actor'] = actor;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response: Response;
    try {
      response = await fetchImpl(`/api${path}`, {
        method,
        headers,
        signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      if (isAbort(error)) throw error;
      throw new ApiError('NETWORK_ERROR', 'Network request failed');
    }
    if (!response.ok) throw await toApiError(response);
    return response;
  }

  async function toApiError(response: Response): Promise<ApiError> {
    try {
      const { error } = ApiErrorBodySchema.parse(await response.json());
      return new ApiError(error.code, error.message, response.status, error.details);
    } catch {
      return new ApiError('UNEXPECTED_RESPONSE', 'Unexpected error response', response.status);
    }
  }

  async function call<T>(path: string, parser: Parser<T>, init: Call = {}): Promise<T> {
    const response = await send(path, init);
    try {
      return parser.parse(await response.json()); // guards FE/BE drift
    } catch {
      throw new ApiError('UNEXPECTED_RESPONSE', 'Unexpected response', response.status);
    }
  }

  return {
    actors: async (signal) => (await call('/actors', ActorsResponseSchema, { signal })).actors,
    listTasks: async (signal) => (await call('/tasks', TasksResponseSchema, { signal })).tasks,
    createTask: async (actor, input) =>
      (await call('/tasks', TaskResponseSchema, { method: 'POST', actor, body: input })).task,
    changeStatus: (actor, id, status) =>
      call(`/tasks/${encodeURIComponent(id)}/status`, ChangeStatusResponseSchema, {
        method: 'PUT',
        actor,
        body: { status },
      }),
    updateTask: (actor, id, patch) =>
      call(`/tasks/${encodeURIComponent(id)}`, UpdateTaskResponseSchema, {
        method: 'PATCH',
        actor,
        body: patch,
      }),
    deleteTask: async (actor, id) => {
      await send(`/tasks/${encodeURIComponent(id)}`, { method: 'DELETE', actor });
    },
    listAuditLogs: async (id, signal) =>
      (
        await call(`/tasks/${encodeURIComponent(id)}/audit-logs`, AuditLogsResponseSchema, {
          signal,
        })
      ).auditLogs,
  };
}
