import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp } from '../integration/test-app';
import { consoleLogger } from './logger';

const ACTOR = { 'X-Actor': 'john.doe' };

function setup() {
  const ctx = createTestApp();
  return { ...ctx, api: request(ctx.app) };
}
const postRaw = (api: ReturnType<typeof request>, raw: string) =>
  api.post('/api/tasks').set('Content-Type', 'application/json').set(ACTOR).send(raw);

describe('security headers (S-05, S-21)', () => {
  it.each([
    ['success', (a: ReturnType<typeof request>) => a.get('/api/actors')],
    ['unknown route', (a: ReturnType<typeof request>) => a.get('/api/nope')],
    [
      'forbidden host',
      (a: ReturnType<typeof request>) => a.get('/api/actors').set('Host', 'evil.com'),
    ],
    [
      'validation error',
      (a: ReturnType<typeof request>) => a.post('/api/tasks').set(ACTOR).send({}),
    ],
  ])('should send hardening headers on a %s response', async (_n, call) => {
    const { api } = setup();
    const res = await call(api);
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
      'cache-control': 'no-store',
    });
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers.etag).toBeUndefined();
  });
});

describe('host guard (S-03)', () => {
  it.each(['evil.com', 'localhost.evil.com', 'evil.com:3001', 'xlocalhost', '127.0.0.1.evil.com'])(
    'should reject Host %s with 403 before routing',
    async (host) => {
      const { api, logger } = setup();
      const res = await api.get('/api/actors').set('Host', host).expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN_HOST');
      expect(logger.info).toHaveBeenCalledWith(expect.objectContaining({ status: 403 })); // still logged
    },
  );

  it('should reject a rebound host even for unknown routes (no probing)', async () => {
    const { api } = setup();
    expect((await api.get('/anything').set('Host', 'evil.com').expect(403)).body.error.code).toBe(
      'FORBIDDEN_HOST',
    );
  });

  it.each(['localhost', 'localhost:5173', 'LOCALHOST:3001', '127.0.0.1:3001', '[::1]:3001'])(
    'should allow Host %s',
    async (host) => {
      const { api } = setup();
      await api.get('/api/actors').set('Host', host).expect(200);
    },
  );
});

describe('cross-site requests (S-02)', () => {
  it('should never send CORS headers, so a preflight from another origin fails', async () => {
    const { api } = setup();
    const res = await api
      .options('/api/tasks')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'DELETE')
      .set('Access-Control-Request-Headers', 'x-actor,content-type');
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
    const plain = await api.get('/api/tasks').set('Origin', 'https://evil.example');
    expect(plain.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    ['text/plain', 'title=T'],
    ['application/x-www-form-urlencoded', 'title=T'],
  ])('should not accept a %s body as JSON', async (type, body) => {
    const { api, service } = setup();
    await api.post('/api/tasks').set('Content-Type', type).set(ACTOR).send(body).expect(400);
    expect(service.listTasks()).toEqual([]);
  });

  it('should take the actor only from X-Actor, never a cookie, query or body', async () => {
    const { api, service } = setup();
    const res = await api
      .post('/api/tasks?actor=john.doe')
      .set('Cookie', 'x-actor=john.doe; actor=john.doe')
      .send({ title: 'T', actor: 'john.doe' });
    expect(res.status).toBe(400);
    expect(service.listTasks()).toEqual([]);
  });

  it('should treat duplicate X-Actor headers as invalid', async () => {
    const { api } = setup();
    await api
      .post('/api/tasks')
      .set('X-Actor', 'john.doe')
      .set('X-Actor', 'jane.smith')
      .send({ title: 'T' });
    const raw = await api
      .post('/api/tasks')
      .set({ 'X-Actor': 'john.doe, jane.smith' })
      .send({ title: 'T' });
    expect(raw.status).toBe(400);
  });
});

describe('injection (S-04, S-05)', () => {
  const SQLI = `'); DROP TABLE tasks;--`;
  const XSS = '<img src=x onerror=alert(1)><script>alert(2)</script>';

  it('should store SQL metacharacters verbatim and leave the schema intact', async () => {
    const { api, db } = setup();
    const res = await api
      .post('/api/tasks')
      .set(ACTOR)
      .send({ title: SQLI, description: `" OR 1=1 --` })
      .expect(201);
    expect(res.body.task.title).toBe(SQLI);
    expect((await api.get('/api/tasks').expect(200)).body.tasks).toHaveLength(1);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('tasks','audit_logs')")
        .get(),
    ).toEqual({ n: 2 });
  });

  it('should treat SQL in ids and actor headers as plain invalid input', async () => {
    const { api } = setup();
    await api.get(`/api/tasks/${encodeURIComponent("1' OR '1'='1")}`).expect(404);
    await api
      .delete(`/api/tasks/${encodeURIComponent('x; DROP TABLE tasks')}`)
      .set(ACTOR)
      .expect(404);
    await api
      .post('/api/tasks')
      .set({ 'X-Actor': `john.doe' OR '1'='1` })
      .send({ title: 'T' })
      .expect(400);
  });

  it('should return script payloads as inert JSON text with nosniff', async () => {
    const { api } = setup();
    await api.post('/api/tasks').set(ACTOR).send({ title: XSS }).expect(201);
    const res = await api.get('/api/tasks');
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body.tasks[0].title).toBe(XSS);
  });
});

describe('mass assignment and hostile text (S-06, S-07)', () => {
  it('should reject __proto__ and constructor keys from raw JSON', async () => {
    const { api, service } = setup();
    await postRaw(api, '{"title":"T","__proto__":{"admin":true}}').expect(400);
    await postRaw(api, '{"title":"T","constructor":{"prototype":{"x":1}}}').expect(400);
    expect(service.listTasks()).toEqual([]);
    expect(({} as Record<string, unknown>).admin).toBeUndefined();
  });

  it.each([
    ['newline', 'a\nb'],
    ['tab', 'a\tb'],
    ['NUL', 'a\u0000b'],
    ['right-to-left override', 'a‮b'],
    ['isolate', 'a⁦b'],
    ['left-to-right mark', 'a‎b'],
  ])('should reject a title with %s', async (_n, title) => {
    const { api } = setup();
    await api.post('/api/tasks').set(ACTOR).send({ title }).expect(400);
  });

  it('should keep newlines in a description but reject bidi controls there', async () => {
    const { api } = setup();
    const ok = await api
      .post('/api/tasks')
      .set(ACTOR)
      .send({ title: 'T', description: 'line1\nline2' })
      .expect(201);
    expect(ok.body.task.description).toBe('line1\nline2');
    await api.post('/api/tasks').set(ACTOR).send({ title: 'T', description: 'a‮b' }).expect(400);
  });
});

describe('error bodies never echo input or internals (S-08)', () => {
  it('should not echo an unknown key name', async () => {
    const { api } = setup();
    const res = await api
      .post('/api/tasks')
      .set(ACTOR)
      .send({ title: 'T', 'hunter2-secret-key': 1 })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('should not quote malformed JSON back', async () => {
    const { api } = setup();
    const res = await postRaw(api, '{"title": "hunter2-secret-value').expect(400);
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'Invalid JSON body' });
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('should not echo a rejected actor', async () => {
    const { api } = setup();
    const res = await api
      .post('/api/tasks')
      .set({ 'X-Actor': 'hunter2-actor' })
      .send({ title: 'T' })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('should not echo a rejected status value', async () => {
    const { api, create } = (() => {
      const ctx = setup();
      return {
        ...ctx,
        create: async () =>
          (await ctx.api.post('/api/tasks').set(ACTOR).send({ title: 'T' })).body.task.id as string,
      };
    })();
    const id = await create();
    const res = await api
      .put(`/api/tasks/${id}/status`)
      .set(ACTOR)
      .send({ status: 'hunter2-status' })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });
});

describe('resource limits (S-10, S-20)', () => {
  it('should reject a body over 10 kb with 400 and a fixed message', async () => {
    const { api } = setup();
    const res = await postRaw(
      api,
      JSON.stringify({ title: 'T', description: 'x'.repeat(11_000) }),
    ).expect(400);
    expect(res.body.error).toEqual({ code: 'VALIDATION_ERROR', message: 'Request body too large' });
  });

  it('should handle a maximum-size valid payload quickly', async () => {
    const { api } = setup();
    const started = Date.now();
    await api
      .post('/api/tasks')
      .set(ACTOR)
      .send({ title: 'x'.repeat(120), description: 'y'.repeat(1000) })
      .expect(201);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('request ids and logging (S-09)', () => {
  it('should ignore an inbound X-Request-Id', async () => {
    const { api } = setup();
    const res = await api.get('/api/actors').set('X-Request-Id', 'attacker-chosen-value');
    expect(res.headers['x-request-id']).not.toContain('attacker');
  });

  it('should log only id, method, path, status and ms, with the path clipped', async () => {
    const { api, logger } = setup();
    await api
      .post(`/api/tasks/${'a'.repeat(500)}`)
      .set(ACTOR)
      .set('Authorization', 'Bearer topsecret')
      .send({ title: 'secret-body' });
    const entry = logger.info.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(Object.keys(entry).sort()).toEqual(['id', 'method', 'ms', 'path', 'status']);
    expect(String(entry.path).length).toBeLessThanOrEqual(200);
    expect(JSON.stringify(entry)).not.toMatch(/topsecret|secret-body|john\.doe/);
  });

  it('should log the full request path even for routed requests', async () => {
    const { api, logger } = setup();
    await api.get('/api/tasks/not-a-uuid?x=1');
    expect(logger.info).toHaveBeenLastCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/tasks/not-a-uuid', status: 404 }),
    );
  });

  it('should not log the query string', async () => {
    const { api, logger } = setup();
    await api.get('/api/tasks?token=abc123');
    expect(JSON.stringify(logger.info.mock.calls.at(-1))).not.toContain('abc123');
  });
});

describe('console logger output (S-09)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('should emit one parseable JSON line even when a field contains CR/LF or ANSI escapes', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    consoleLogger.info({ path: '/a\r\n{"level":"error","forged":true}\u001b[31m' });
    const out = spy.mock.calls[0]?.[0] as string;
    expect(out.includes('\n') || out.includes('\r') || out.includes('\u001b')).toBe(false);
    expect(JSON.parse(out)).toMatchObject({
      level: 'info',
      path: expect.stringContaining('forged'),
    });
    expect(JSON.parse(out).forged).toBeUndefined();
  });
});

describe('editing a task (PATCH) is held to the same rules', () => {
  const create = async (api: ReturnType<typeof request>) =>
    (await api.post('/api/tasks').set(ACTOR).send({ title: 'T' })).body.task.id as string;

  it('should reject __proto__ / constructor keys and hostile characters', async () => {
    const { api } = setup();
    const id = await create(api);
    const raw = (body: string) =>
      api.patch(`/api/tasks/${id}`).set('Content-Type', 'application/json').set(ACTOR).send(body);
    await raw('{"title":"T2","__proto__":{"admin":true}}').expect(400);
    await raw('{"constructor":{"prototype":{"x":1}}}').expect(400);
    for (const title of ['a\nb', 'a\u202Eb', 'a\u0000b'])
      await api.patch(`/api/tasks/${id}`).set(ACTOR).send({ title }).expect(400);
    await api
      .patch(`/api/tasks/${id}`)
      .set(ACTOR)
      .send({ description: 'ok\nmultiline' })
      .expect(200);
  });

  it('should take SQL and script text as data and never echo rejected input', async () => {
    const { api, db } = setup();
    const id = await create(api);
    const evil = `'); DROP TABLE tasks;--<img src=x onerror=1>`;
    expect(
      (
        await api
          .patch(`/api/tasks/${id}`)
          .set(ACTOR)
          .send({ title: evil, description: evil })
          .expect(200)
      ).body.task.title,
    ).toBe(evil);
    expect(
      db
        .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('tasks','audit_logs')")
        .get(),
    ).toEqual({ n: 2 });
    const res = await api
      .patch(`/api/tasks/${id}`)
      .set(ACTOR)
      .send({ title: 'T', 'hunter2-key': 1 })
      .expect(400);
    expect(JSON.stringify(res.body)).not.toContain('hunter2');
  });

  it('should not accept JSON from a form or text content type, nor an actor from a cookie', async () => {
    const { api } = setup();
    const id = await create(api);
    await api
      .patch(`/api/tasks/${id}`)
      .set('Content-Type', 'text/plain')
      .set(ACTOR)
      .send('title=x')
      .expect(400);
    await api
      .patch(`/api/tasks/${id}?actor=john.doe`)
      .set('Cookie', 'x-actor=john.doe')
      .send({ title: 'x' })
      .expect(400);
  });

  it('should refuse a rebound Host', async () => {
    const { api } = setup();
    const id = await create(api);
    await api
      .patch(`/api/tasks/${id}`)
      .set('Host', 'evil.com')
      .set(ACTOR)
      .send({ title: 'x' })
      .expect(403);
  });

  it('should never let an edit rewrite or remove earlier audit entries', async () => {
    const { api, db } = setup();
    const id = await create(api);
    const before = db.prepare('SELECT * FROM audit_logs ORDER BY id').all();
    await api.patch(`/api/tasks/${id}`).set(ACTOR).send({ title: 'Renamed' }).expect(200);
    expect(
      db.prepare('SELECT * FROM audit_logs ORDER BY id').all().slice(0, before.length),
    ).toEqual(before);
  });
});
