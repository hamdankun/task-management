import {
  ActorsResponseSchema,
  AuditLogsResponseSchema,
  ChangeStatusResponseSchema,
  TaskResponseSchema,
  TasksResponseSchema,
  UpdateTaskResponseSchema,
  ApiErrorBodySchema,
} from '@tm/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestApp } from '../integration/test-app';

const ACTOR = { 'X-Actor': 'john.doe' };
const MISSING = '00000000-0000-4000-8000-0000000000ff';

function setup() {
  const ctx = createTestApp();
  const api = request(ctx.app);
  const create = async (title = 'Prepare Invoice') => {
    const res = await api.post('/api/tasks').set(ACTOR).send({ title });
    return TaskResponseSchema.parse(res.body).task;
  };
  const move = (id: string, status: string, actor = ACTOR) =>
    api.put(`/api/tasks/${id}/status`).set(actor).send({ status });
  const errorOf = (res: request.Response) => ApiErrorBodySchema.parse(res.body).error;
  return { ...ctx, api, create, move, errorOf };
}

describe('GET /api/actors', () => {
  it('should list the predefined actors', async () => {
    const { api } = setup();
    const res = await api.get('/api/actors').expect(200);
    expect(ActorsResponseSchema.parse(res.body).actors).toEqual([
      'john.doe',
      'jane.smith',
      'budi.santoso',
      'siti.rahma',
    ]);
  });
});

describe('POST /api/tasks', () => {
  it('should create a trimmed to_do task, set Location and write a created log', async () => {
    const { api } = setup();
    const res = await api
      .post('/api/tasks')
      .set(ACTOR)
      .send({ title: '  Prepare Invoice ', description: '  ' })
      .expect(201);
    const { task } = TaskResponseSchema.parse(res.body);
    expect(task).toMatchObject({ title: 'Prepare Invoice', description: null, status: 'to_do' });
    expect(task.createdAt).toBe(task.updatedAt);
    expect(res.headers.location).toBe(`/api/tasks/${task.id}`);
    const logs = AuditLogsResponseSchema.parse(
      (await api.get(`/api/tasks/${task.id}/audit-logs`)).body,
    ).auditLogs;
    expect(logs).toMatchObject([
      { action: 'created', actor: 'john.doe', fromStatus: null, toStatus: 'to_do' },
    ]);
  });

  it('should reject a blank title with field errors', async () => {
    const { api, errorOf } = setup();
    const res = await api.post('/api/tasks').set(ACTOR).send({ title: '   ' }).expect(400);
    expect(errorOf(res)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { title: ['Title is required'] } },
    });
  });

  it.each([
    ['over-long title', { title: 'x'.repeat(121) }],
    ['over-long description', { title: 'T', description: 'x'.repeat(1001) }],
    ['client-supplied status', { title: 'T', status: 'done' }],
    ['client-supplied id', { title: 'T', id: MISSING }],
    ['non-string title', { title: 7 }],
  ])('should reject %s', async (_n, body) => {
    const { api, errorOf } = setup();
    expect(errorOf(await api.post('/api/tasks').set(ACTOR).send(body).expect(400)).code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it('should reject a missing body', async () => {
    const { api, errorOf } = setup();
    expect(errorOf(await api.post('/api/tasks').set(ACTOR).expect(400)).code).toBe(
      'VALIDATION_ERROR',
    );
  });

  it.each([
    [{}],
    [{ 'X-Actor': 'mallory' }],
    [{ 'X-Actor': 'John.Doe' }],
    [{ 'X-Actor': 'john.doe x' }],
  ])('should reject a mutation with actor headers %j', async (headers) => {
    const { api, errorOf, service } = setup();
    const res = await api.post('/api/tasks').set(headers).send({ title: 'T' }).expect(400);
    expect(errorOf(res).code).toBe('INVALID_ACTOR');
    expect(service.listTasks()).toEqual([]);
  });
});

describe('GET /api/tasks and /api/tasks/:id', () => {
  it('should return an empty list, then tasks newest first', async () => {
    const { api, create } = setup();
    expect(TasksResponseSchema.parse((await api.get('/api/tasks').expect(200)).body).tasks).toEqual(
      [],
    );
    const a = await create('A');
    const b = await create('B');
    const { tasks } = TasksResponseSchema.parse((await api.get('/api/tasks')).body);
    expect(tasks.map((t) => t.id)).toEqual([b.id, a.id]);
  });

  it('should return one task, and 404 for unknown, malformed and deleted ids', async () => {
    const { api, create, errorOf } = setup();
    const t = await create();
    expect(
      TaskResponseSchema.parse((await api.get(`/api/tasks/${t.id}`).expect(200)).body).task.id,
    ).toBe(t.id);
    expect(errorOf(await api.get(`/api/tasks/${MISSING}`).expect(404)).code).toBe('TASK_NOT_FOUND');
    expect(errorOf(await api.get('/api/tasks/not-a-uuid').expect(404)).code).toBe('TASK_NOT_FOUND');
    await api.delete(`/api/tasks/${t.id}`).set(ACTOR).expect(204);
    expect(errorOf(await api.get(`/api/tasks/${t.id}`).expect(404)).code).toBe('TASK_NOT_FOUND');
  });
});

describe('PUT /api/tasks/:id/status', () => {
  it('should advance one step and return the audit log', async () => {
    const { create, move } = setup();
    const t = await create();
    const res = await move(t.id, 'pending', { 'X-Actor': 'jane.smith' }).expect(200);
    const body = ChangeStatusResponseSchema.parse(res.body);
    expect(body).toMatchObject({
      changed: true,
      task: { status: 'pending' },
      auditLog: {
        action: 'status_changed',
        actor: 'jane.smith',
        fromStatus: 'to_do',
        toStatus: 'pending',
        taskTitle: 'Prepare Invoice',
      },
    });
    expect(body.task.updatedAt).toBe(body.auditLog?.createdAt);
  });

  it('should be idempotent: same status returns changed:false and writes no log', async () => {
    const { api, create, move } = setup();
    const t = await create();
    await move(t.id, 'pending');
    const res = await move(t.id, 'pending').expect(200);
    expect(ChangeStatusResponseSchema.parse(res.body)).toMatchObject({
      changed: false,
      auditLog: null,
      task: { status: 'pending' },
    });
    const logs = AuditLogsResponseSchema.parse(
      (await api.get(`/api/tasks/${t.id}/audit-logs`)).body,
    ).auditLogs;
    expect(logs.filter((l) => l.action === 'status_changed')).toHaveLength(1);
  });

  it('should reject a skip with 422 and the only allowed next status', async () => {
    const { create, move, errorOf } = setup();
    const t = await create();
    await move(t.id, 'pending');
    const res = await move(t.id, 'done').expect(422);
    expect(errorOf(res)).toMatchObject({
      code: 'INVALID_TRANSITION',
      message: 'Cannot move from pending to done',
      details: { from: 'pending', to: 'done', allowed: 'in_progress' },
    });
  });

  it('should reject moving backward and moving on from done', async () => {
    const { api, create, move, errorOf } = setup();
    const t = await create();
    for (const s of ['pending', 'in_progress']) await move(t.id, s).expect(200);
    expect(errorOf(await move(t.id, 'pending').expect(422)).details).toMatchObject({
      allowed: 'done',
    });
    await move(t.id, 'done').expect(200);
    expect(errorOf(await move(t.id, 'in_progress').expect(422)).details).toMatchObject({
      allowed: null,
    });
    expect(errorOf(await move(t.id, 'to_do').expect(422)).code).toBe('INVALID_TRANSITION');
    const logs = AuditLogsResponseSchema.parse(
      (await api.get(`/api/tasks/${t.id}/audit-logs`)).body,
    ).auditLogs;
    expect(logs.map((l) => l.toStatus)).toEqual(['to_do', 'pending', 'in_progress', 'done']); // nothing written by the refusals
  });

  it('should cope with a stale tab: duplicate is a no-op, an outdated request is 422', async () => {
    const { api, create, move } = setup();
    const t = await create();
    await move(t.id, 'pending'); // tab A
    expect((await move(t.id, 'pending').expect(200)).body.changed).toBe(false); // tab B duplicate
    await move(t.id, 'in_progress'); // tab A moves on
    await move(t.id, 'pending').expect(422); // tab B, outdated: going back is not allowed
    const logs = AuditLogsResponseSchema.parse(
      (await api.get(`/api/tasks/${t.id}/audit-logs`)).body,
    ).auditLogs;
    expect(logs.map((l) => l.toStatus)).toEqual(['to_do', 'pending', 'in_progress']);
  });

  it.each([{}, { status: 'blocked' }, { status: 'done', extra: true }, { status: 2 }])(
    'should reject body %j',
    async (body) => {
      const { api, create, errorOf } = setup();
      const t = await create();
      const res = await api.put(`/api/tasks/${t.id}/status`).set(ACTOR).send(body).expect(400);
      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
    },
  );

  it('should apply checks in the documented order: actor, id, body, existence', async () => {
    const { api, errorOf } = setup();
    const bad = { status: 'nope' };
    expect(errorOf(await api.put('/api/tasks/not-a-uuid/status').send(bad).expect(400)).code).toBe(
      'INVALID_ACTOR',
    );
    expect(
      errorOf(await api.put('/api/tasks/not-a-uuid/status').set(ACTOR).send(bad).expect(404)).code,
    ).toBe('TASK_NOT_FOUND');
    expect(
      errorOf(await api.put(`/api/tasks/${MISSING}/status`).set(ACTOR).send(bad).expect(400)).code,
    ).toBe('VALIDATION_ERROR');
    expect(
      errorOf(
        await api
          .put(`/api/tasks/${MISSING}/status`)
          .set(ACTOR)
          .send({ status: 'pending' })
          .expect(404),
      ).code,
    ).toBe('TASK_NOT_FOUND');
  });

  it('should reject a deleted task', async () => {
    const { api, create, move, errorOf } = setup();
    const t = await create();
    await api.delete(`/api/tasks/${t.id}`).set(ACTOR);
    expect(errorOf(await move(t.id, 'pending').expect(404)).code).toBe('TASK_NOT_FOUND');
  });
});

describe('DELETE /api/tasks/:id', () => {
  it('should soft delete: gone from the list, history kept with a deleted entry', async () => {
    const { api, create, move } = setup();
    const t = await create();
    await move(t.id, 'pending');
    await api.delete(`/api/tasks/${t.id}`).set({ 'X-Actor': 'siti.rahma' }).expect(204).expect('');
    expect(TasksResponseSchema.parse((await api.get('/api/tasks')).body).tasks).toEqual([]);
    const logs = AuditLogsResponseSchema.parse(
      (await api.get(`/api/tasks/${t.id}/audit-logs`).expect(200)).body,
    ).auditLogs;
    expect(logs.map((l) => l.action)).toEqual(['created', 'status_changed', 'deleted']);
    expect(logs[2]).toMatchObject({ actor: 'siti.rahma', fromStatus: 'pending', toStatus: null });
  });

  it('should 404 a repeat delete and 400 a missing actor', async () => {
    const { api, create, errorOf } = setup();
    const t = await create();
    expect(errorOf(await api.delete(`/api/tasks/${t.id}`).expect(400)).code).toBe('INVALID_ACTOR');
    await api.delete(`/api/tasks/${t.id}`).set(ACTOR).expect(204);
    expect(errorOf(await api.delete(`/api/tasks/${t.id}`).set(ACTOR).expect(404)).code).toBe(
      'TASK_NOT_FOUND',
    );
  });
});

describe('GET /api/tasks/:id/audit-logs', () => {
  it('should list oldest first', async () => {
    const { api, create, move } = setup();
    const t = await create();
    await move(t.id, 'pending');
    await move(t.id, 'in_progress');
    const logs = AuditLogsResponseSchema.parse(
      (await api.get(`/api/tasks/${t.id}/audit-logs`).expect(200)).body,
    ).auditLogs;
    expect(logs.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(logs.map((l) => l.createdAt)).toEqual([...logs.map((l) => l.createdAt)].sort());
  });

  it('should 404 an id that never existed or is malformed', async () => {
    const { api, errorOf } = setup();
    expect(errorOf(await api.get(`/api/tasks/${MISSING}/audit-logs`).expect(404)).code).toBe(
      'TASK_NOT_FOUND',
    );
    expect(errorOf(await api.get('/api/tasks/%27%20OR%201=1/audit-logs').expect(404)).code).toBe(
      'TASK_NOT_FOUND',
    );
  });

  it.each(['put', 'post', 'patch', 'delete'] as const)(
    'should expose no route to %s audit logs',
    async (verb) => {
      const { api, create, errorOf, service } = setup();
      const t = await create();
      for (const path of [
        `/api/tasks/${t.id}/audit-logs`,
        '/api/audit-logs',
        '/api/audit-logs/1',
      ]) {
        expect(
          errorOf(await api[verb](path).set(ACTOR).send({ actor: 'x' }).expect(404)).code,
        ).toBe('ROUTE_NOT_FOUND');
      }
      expect(service.listAuditLogs(t.id)).toHaveLength(1);
    },
  );
});

describe('generic behaviour', () => {
  it('should return 404 ROUTE_NOT_FOUND for unknown routes', async () => {
    const { api, errorOf } = setup();
    expect(errorOf(await api.get('/api/nope').expect(404)).code).toBe('ROUTE_NOT_FOUND');
    expect(errorOf(await api.get('/').expect(404)).code).toBe('ROUTE_NOT_FOUND');
  });

  it('should send a unique X-Request-Id on every response', async () => {
    const { api } = setup();
    const a = (await api.get('/api/actors')).headers['x-request-id'];
    const b = (await api.get('/api/actors')).headers['x-request-id'];
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).not.toBe(b);
  });

  it('should set no-store caching', async () => {
    const { api } = setup();
    expect((await api.get('/api/tasks')).headers['cache-control']).toBe('no-store');
  });

  it('should answer a store failure with a generic 500 that carries only the request id', async () => {
    const { api, logger } = (() => {
      const ctx = createTestApp({
        store: (real) =>
          Object.assign(Object.create(real), {
            list: () => {
              throw new Error('SELECT * FROM secret_table at /srv/app.db');
            },
          }),
      });
      return { api: request(ctx.app), logger: ctx.logger };
    })();
    const res = await api.get('/api/tasks').expect(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side',
        details: { requestId: res.headers['x-request-id'] },
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/secret_table|\/srv|at \w+/);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('secret_table'),
        stack: expect.any(String),
      }),
    );
  });
});

describe('PATCH /api/tasks/:id', () => {
  const patch = (
    api: ReturnType<typeof request>,
    id: string,
    body: unknown,
    headers: Record<string, string> = ACTOR,
  ) =>
    api
      .patch(`/api/tasks/${id}`)
      .set(headers)
      .send(body as object);

  it('should edit fields, return the saved audit logs and keep the status', async () => {
    const { api, create, move } = setup();
    const t = await create();
    await move(t.id, 'pending');
    const res = await patch(
      api,
      t.id,
      { title: '  Renamed ', description: 'Details', assignee: 'jane.smith' },
      { 'X-Actor': 'budi.santoso' },
    ).expect(200);
    const body = UpdateTaskResponseSchema.parse(res.body);
    expect(body).toMatchObject({
      changed: true,
      task: { title: 'Renamed', description: 'Details', assignee: 'jane.smith', status: 'pending' },
    });
    expect(body.auditLogs.map((l) => [l.field, l.fromValue, l.toValue, l.actor])).toEqual([
      ['title', 'Prepare Invoice', 'Renamed', 'budi.santoso'],
      ['description', null, 'Details', 'budi.santoso'],
      ['assignee', null, 'jane.smith', 'budi.santoso'],
    ]);
    const list = TasksResponseSchema.parse((await api.get('/api/tasks')).body).tasks;
    expect(list[0]).toMatchObject({ title: 'Renamed', assignee: 'jane.smith', status: 'pending' });
    const logs = AuditLogsResponseSchema.parse(
      (await api.get(`/api/tasks/${t.id}/audit-logs`)).body,
    ).auditLogs;
    expect(logs.map((l) => l.action)).toEqual([
      'created',
      'status_changed',
      'edited',
      'edited',
      'edited',
    ]);
  });

  it('should treat a partial body as "leave the rest alone", and an empty description as clear', async () => {
    const { api, create } = setup();
    const t = await create();
    await patch(api, t.id, { description: 'Text', assignee: 'john.doe' }).expect(200);
    const res = await patch(api, t.id, { description: '   ' }).expect(200);
    expect(UpdateTaskResponseSchema.parse(res.body)).toMatchObject({
      task: { title: 'Prepare Invoice', description: null, assignee: 'john.doe' },
    });
    const unassign = await patch(api, t.id, { assignee: null }).expect(200);
    expect(UpdateTaskResponseSchema.parse(unassign.body).task.assignee).toBeNull();
  });

  it('should be idempotent: unchanged values return changed:false and no logs', async () => {
    const { api, create } = setup();
    const t = await create();
    const res = await patch(api, t.id, { title: 'Prepare Invoice', assignee: null }).expect(200);
    expect(UpdateTaskResponseSchema.parse(res.body)).toMatchObject({
      changed: false,
      auditLogs: [],
    });
    expect(
      AuditLogsResponseSchema.parse((await api.get(`/api/tasks/${t.id}/audit-logs`)).body)
        .auditLogs,
    ).toHaveLength(1);
  });

  it.each([
    ['empty body', {}],
    ['blank title', { title: '   ' }],
    ['over-long title', { title: 'x'.repeat(121) }],
    ['over-long description', { description: 'x'.repeat(1001) }],
    ['newline in title', { title: 'a\nb' }],
    ['status smuggled in', { title: 'T', status: 'done' }],
    ['id smuggled in', { id: MISSING }],
    ['createdAt smuggled in', { createdAt: '2020-01-01T00:00:00.000Z' }],
    ['non-string assignee', { assignee: 5 }],
  ])('should reject %s', async (_n, body) => {
    const { api, create, errorOf } = setup();
    const t = await create();
    expect(errorOf(await patch(api, t.id, body).expect(400)).code).toBe('VALIDATION_ERROR');
    expect((await api.get(`/api/tasks/${t.id}`)).body.task).toMatchObject({
      title: 'Prepare Invoice',
      status: 'to_do',
    });
  });

  it('should reject an assignee that is not a listed user, naming the field but not the value', async () => {
    const { api, create, errorOf } = setup();
    const t = await create();
    const res = await patch(api, t.id, { assignee: 'hunter2-user' }).expect(400);
    expect(errorOf(res)).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: { fieldErrors: { assignee: ['Choose a listed user'] } },
    });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('should apply checks in order: actor, id, body, existence', async () => {
    const { api, errorOf } = setup();
    expect(errorOf(await patch(api, 'not-a-uuid', {}, {}).expect(400)).code).toBe('INVALID_ACTOR');
    expect(errorOf(await patch(api, 'not-a-uuid', {}).expect(404)).code).toBe('TASK_NOT_FOUND');
    expect(errorOf(await patch(api, MISSING, {}).expect(400)).code).toBe('VALIDATION_ERROR');
    expect(errorOf(await patch(api, MISSING, { title: 'X' }).expect(404)).code).toBe(
      'TASK_NOT_FOUND',
    );
  });

  it('should refuse a deleted task and a missing actor', async () => {
    const { api, create, errorOf } = setup();
    const t = await create();
    expect(
      errorOf(await patch(api, t.id, { title: 'X' }, { 'X-Actor': 'mallory' }).expect(400)).code,
    ).toBe('INVALID_ACTOR');
    await api.delete(`/api/tasks/${t.id}`).set(ACTOR);
    expect(errorOf(await patch(api, t.id, { title: 'X' }).expect(404)).code).toBe('TASK_NOT_FOUND');
  });

  it('should still expose no route to change audit logs', async () => {
    const { api, create, errorOf } = setup();
    const t = await create();
    expect(
      errorOf(
        await api
          .patch(`/api/tasks/${t.id}/audit-logs`)
          .set(ACTOR)
          .send({ actor: 'x' })
          .expect(404),
      ).code,
    ).toBe('ROUTE_NOT_FOUND');
  });
});
