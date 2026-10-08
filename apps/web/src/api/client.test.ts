import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from './client';

const TASK = {
  id: '3f2c8a54-0b1e-4c63-9a52-7d1f0e6b9a10',
  title: 'T',
  description: null,
  status: 'to_do',
  assignee: null,
  createdAt: '2025-01-01T09:00:00.000Z',
  updatedAt: '2025-01-01T09:00:00.000Z',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const make = (impl: (url: string, init: RequestInit) => Response | Promise<Response>) => {
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    impl(String(url), init ?? {}),
  );
  return { api: createApi(fetchMock as unknown as typeof fetch), fetchMock };
};
const headersOf = (fetchMock: ReturnType<typeof make>['fetchMock']) =>
  fetchMock.mock.calls[0]![1]!.headers as Record<string, string>;

describe('createApi', () => {
  it('should call relative /api URLs and send no actor or content type on reads', async () => {
    const { api, fetchMock } = make(() => json({ tasks: [TASK] }));
    expect(await api.listTasks()).toEqual([TASK]);
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/tasks');
    expect(headersOf(fetchMock)).toEqual({});
  });

  it('should send X-Actor and a JSON body on mutations', async () => {
    const { api, fetchMock } = make(() => json({ task: TASK }, 201));
    await api.createTask('john.doe', { title: 'T' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tasks');
    expect(init).toMatchObject({ method: 'POST', body: '{"title":"T"}' });
    expect(headersOf(fetchMock)).toEqual({
      'X-Actor': 'john.doe',
      'Content-Type': 'application/json',
    });
  });

  it('should PUT the status and parse the change result', async () => {
    const { api, fetchMock } = make(() =>
      json({ task: { ...TASK, status: 'pending' }, changed: false, auditLog: null }),
    );
    expect(await api.changeStatus('jane.smith', TASK.id, 'pending')).toMatchObject({
      changed: false,
      auditLog: null,
    });
    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/tasks/${TASK.id}/status`);
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      method: 'PUT',
      body: '{"status":"pending"}',
    });
  });

  it('should treat 204 as success for delete', async () => {
    const { api, fetchMock } = make(() => new Response(null, { status: 204 }));
    await expect(api.deleteTask('john.doe', TASK.id)).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({ method: 'DELETE' });
  });

  it('should encode ids placed in the path', async () => {
    const { api, fetchMock } = make(() => json({ auditLogs: [] }));
    await api.listAuditLogs('a/b?c');
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/tasks/a%2Fb%3Fc/audit-logs');
  });

  it('should turn an error body into an ApiError with code, status and details', async () => {
    const { api } = make(() =>
      json(
        {
          error: {
            code: 'INVALID_TRANSITION',
            message: 'Cannot move',
            details: { allowed: 'in_progress' },
          },
        },
        422,
      ),
    );
    await expect(api.changeStatus('john.doe', TASK.id, 'done')).rejects.toMatchObject({
      name: 'ApiError',
      code: 'INVALID_TRANSITION',
      status: 422,
      details: { allowed: 'in_progress' },
    });
  });

  it('should map a non-JSON error response to UNEXPECTED_RESPONSE', async () => {
    const { api } = make(() => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(api.listTasks()).rejects.toMatchObject({
      code: 'UNEXPECTED_RESPONSE',
      status: 502,
    });
  });

  it('should map a network failure to NETWORK_ERROR', async () => {
    const { api } = make(() => {
      throw new TypeError('Failed to fetch');
    });
    await expect(api.listTasks()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('should reject a response that does not match the shared schema', async () => {
    const { api } = make(() => json({ tasks: [{ ...TASK, status: 'archived' }] }));
    const error = await api.listTasks().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'UNEXPECTED_RESPONSE' });
  });

  it('should rethrow an abort untouched so callers can ignore it', async () => {
    const { api } = make(() => {
      throw new DOMException('aborted', 'AbortError');
    });
    await expect(api.listTasks()).rejects.toMatchObject({ name: 'AbortError' });
  });
});
