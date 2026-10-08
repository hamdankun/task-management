import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { TaskService } from '../application/task-service';
import { openDb } from '../infrastructure/db';
import { SqliteTaskStore } from '../infrastructure/sqlite-task-store';
import { createApp } from '../presentation/app';
import { silentLogger } from '../presentation/logger';
import { createTestApp } from './test-app';

/**
 * The assessment brief (assessment-context.md), clause by clause, as executable checks against the
 * real HTTP API and the real SQLite database. If one of these fails, the app no longer does what
 * the brief asks. Section numbers follow the brief; the Indonesian wording is quoted in the titles.
 */

const JOHN = { 'X-Actor': 'john.doe' };

function setup() {
  const ctx = createTestApp();
  const api = request(ctx.app);
  const create = async (title = 'Prepare Invoice', actor = 'john.doe') =>
    (await api.post('/api/tasks').set({ 'X-Actor': actor }).send({ title }).expect(201)).body
      .task as { id: string };
  const put = (id: string, status: string, actor = 'john.doe') =>
    api.put(`/api/tasks/${id}/status`).set({ 'X-Actor': actor }).send({ status });
  const logs = async (id: string) =>
    (await api.get(`/api/tasks/${id}/audit-logs`).expect(200)).body.auditLogs as {
      id: number;
      taskId: string;
      taskTitle: string;
      action: string;
      actor: string;
      fromStatus: string | null;
      toStatus: string | null;
      createdAt: string;
    }[];
  return { ...ctx, api, create, put, logs };
}

describe('1. Task Management', () => {
  it('Create task, List semua task, Delete task', async () => {
    const { api, create } = setup();
    const t = await create('Prepare Invoice');
    expect(
      (await api.get('/api/tasks').expect(200)).body.tasks.map((x: { id: string }) => x.id),
    ).toEqual([t.id]);
    await api.delete(`/api/tasks/${t.id}`).set(JOHN).expect(204);
    expect((await api.get('/api/tasks').expect(200)).body.tasks).toEqual([]);
  });

  it('every task has a structure with at least id, title, status and timestamps', async () => {
    const { create, api } = setup();
    const t = await create();
    const task = (await api.get(`/api/tasks/${t.id}`)).body.task;
    expect(task).toMatchObject({ id: t.id, title: 'Prepare Invoice', status: 'to_do' });
    expect(Number.isNaN(Date.parse(task.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(task.updatedAt))).toBe(false);
  });

  it('Update task status (hanya mengikuti urutan: to_do → pending → in_progress → done)', async () => {
    const { create, put } = setup();
    const t = await create();
    for (const status of ['pending', 'in_progress', 'done']) {
      const res = await put(t.id, status).expect(200);
      expect(res.body).toMatchObject({ changed: true, task: { status } });
    }
  });
});

describe('2. Audit Log', () => {
  it('"Setiap perubahan status harus menghasilkan audit log baru"', async () => {
    const { create, put, logs } = setup();
    const t = await create();
    await put(t.id, 'pending');
    await put(t.id, 'in_progress');
    const statusLogs = (await logs(t.id)).filter((l) => l.action === 'status_changed');
    expect(statusLogs).toHaveLength(2);
  });

  it('can answer: which task, who (actor), from which status to which, and when', async () => {
    const { create, put, logs } = setup();
    const t = await create('Prepare Invoice');
    await put(t.id, 'pending');
    await put(t.id, 'in_progress', 'jane.smith');
    const entry = (await logs(t.id)).at(-1)!;
    expect(entry).toMatchObject({
      taskId: t.id, //            Task mana yang berubah
      taskTitle: 'Prepare Invoice',
      actor: 'jane.smith', //     Siapa yang melakukan perubahan
      fromStatus: 'pending', //   Dari status apa
      toStatus: 'in_progress', // ke status apa
    });
    expect(new Date(entry.createdAt).toISOString()).toBe(entry.createdAt); // Kapan perubahan terjadi
    // i.e. User "jane.smith" changed Task "Prepare Invoice" status from "pending" to "in_progress" at <time>
  });

  it('the actor is a hardcoded, predefined user list (offered to the UI as a dropdown)', async () => {
    const { api, create } = setup();
    const actors: string[] = (await api.get('/api/actors').expect(200)).body.actors;
    expect(actors.length).toBeGreaterThan(1);
    expect(actors).toContain('john.doe');
    await api
      .post('/api/tasks')
      .set({ 'X-Actor': 'someone.else' })
      .send({ title: 'x' })
      .expect(400);
    for (const actor of actors) await create(`by ${actor}`, actor); // every listed user is accepted
  });

  it('"Audit log tidak boleh diubah atau dihapus dalam keadaan apapun": no way through the API', async () => {
    const { api, create, logs } = setup();
    const t = await create();
    const before = await logs(t.id);
    for (const method of ['put', 'patch', 'post', 'delete'] as const) {
      await api[method](`/api/tasks/${t.id}/audit-logs`).set(JOHN).send({ actor: 'x' }).expect(404);
      await api[method]('/api/audit-logs/1').set(JOHN).send({ actor: 'x' }).expect(404);
    }
    expect(await logs(t.id)).toEqual(before);
  });

  it('"...dalam keadaan apapun": no way through the database either (even raw SQL)', async () => {
    const { create, put, db } = setup();
    const t = await create();
    await put(t.id, 'pending');
    expect(() => db.prepare("UPDATE audit_logs SET actor = 'evil'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM tasks').run()).toThrow(/soft-deleted only/);
  });

  it('"Update task tidak boleh menghapus log lama": status moves, edits and deletes only add entries', async () => {
    const { api, create, put, logs } = setup();
    const t = await create();
    const seen: unknown[][] = [];
    seen.push(await logs(t.id));
    await put(t.id, 'pending');
    seen.push(await logs(t.id));
    await api.patch(`/api/tasks/${t.id}`).set(JOHN).send({ title: 'Renamed' }).expect(200);
    seen.push(await logs(t.id));
    await api.delete(`/api/tasks/${t.id}`).set(JOHN).expect(204);
    seen.push(await logs(t.id));
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.length).toBeGreaterThan(seen[i - 1]!.length);
      expect(seen[i]!.slice(0, seen[i - 1]!.length)).toEqual(seen[i - 1]); // earlier entries are untouched
    }
  });

  it('a deleted task keeps its history readable', async () => {
    const { api, create, put, logs } = setup();
    const t = await create();
    await put(t.id, 'pending');
    await api.delete(`/api/tasks/${t.id}`).set(JOHN).expect(204);
    expect((await logs(t.id)).map((l) => l.action)).toEqual([
      'created',
      'status_changed',
      'deleted',
    ]);
  });

  it('"Audit log ditampilkan urut secara kronologi": oldest first', async () => {
    const { create, put, logs } = setup();
    const t = await create();
    for (const status of ['pending', 'in_progress', 'done']) await put(t.id, status);
    const entries = await logs(t.id);
    expect(entries.map((l) => l.toStatus)).toEqual(['to_do', 'pending', 'in_progress', 'done']);
    expect(entries.map((l) => l.createdAt)).toEqual([...entries.map((l) => l.createdAt)].sort());
    expect(entries.map((l) => l.id)).toEqual([...entries.map((l) => l.id)].sort((a, b) => a - b));
  });
});

describe('3. API Guidelines (the example endpoints exist)', () => {
  it('GET /tasks · POST /tasks · PUT /tasks/:id/status · GET /tasks/:id/audit-logs', async () => {
    const { api } = setup();
    expect((await api.get('/api/tasks')).status).toBe(200);
    const created = await api.post('/api/tasks').set(JOHN).send({ title: 'x' });
    expect(created.status).toBe(201);
    const id = created.body.task.id as string;
    expect(
      (await api.put(`/api/tasks/${id}/status`).set(JOHN).send({ status: 'pending' })).status,
    ).toBe(200);
    expect((await api.get(`/api/tasks/${id}/audit-logs`)).status).toBe(200);
  });
});

describe('5. Non-Functional Requirements', () => {
  it('Idempotent Update: the same status again creates no new audit log', async () => {
    const { create, put, logs } = setup();
    const t = await create();
    await put(t.id, 'pending');
    const before = (await logs(t.id)).length;
    const again = await put(t.id, 'pending').expect(200);
    expect(again.body).toMatchObject({ changed: false, auditLog: null });
    expect(await logs(t.id)).toHaveLength(before);
  });

  it('Data Consistency: if the audit log cannot be written, the status does not change either', async () => {
    const ctx = createTestApp({
      store: (real) =>
        Object.assign(Object.create(real), {
          // the task row is updated, then the failure happens: everything must roll back
          updateStatus: (...args: Parameters<typeof real.updateStatus>) => {
            real.updateStatus(...args);
            throw new Error('log write failed');
          },
        }),
    });
    const api = request(ctx.app);
    const t = (await api.post('/api/tasks').set(JOHN).send({ title: 'x' })).body.task;
    await api.put(`/api/tasks/${t.id}/status`).set(JOHN).send({ status: 'pending' }).expect(500);
    expect((await api.get(`/api/tasks/${t.id}`)).body.task.status).toBe('to_do');
    expect((await api.get(`/api/tasks/${t.id}/audit-logs`)).body.auditLogs).toHaveLength(1);
  });

  it('Persistence: tasks and history survive a restart (data is in a database file)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-persist-'));
    try {
      const file = join(dir, 'app.db');
      const boot = () => {
        const db = openDb(file);
        let n = 0;
        const service = new TaskService({
          store: new SqliteTaskStore(db),
          clock: { now: () => new Date(Date.UTC(2025, 0, 1, 10, 0, n++)).toISOString() },
          newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
        });
        return {
          db,
          api: request(createApp({ service, logger: silentLogger, allowedHosts: ['127.0.0.1'] })),
        };
      };
      const first = boot();
      const id = (await first.api.post('/api/tasks').set(JOHN).send({ title: 'Survives' })).body
        .task.id as string;
      await first.api
        .put(`/api/tasks/${id}/status`)
        .set(JOHN)
        .send({ status: 'pending' })
        .expect(200);
      first.db.close(); // "restart"

      const second = boot();
      expect((await second.api.get(`/api/tasks/${id}`)).body.task).toMatchObject({
        title: 'Survives',
        status: 'pending',
      });
      expect((await second.api.get(`/api/tasks/${id}/audit-logs`)).body.auditLogs).toHaveLength(2);
      second.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('Domain Validation (in the backend): skips and moving backward are rejected, nothing is written', async () => {
    const { create, put, logs, api } = setup();
    const t = await create();
    await put(t.id, 'pending');
    const before = await logs(t.id);

    for (const bad of ['done', 'to_do', 'in_progress_']) {
      const res = await put(t.id, bad);
      expect(res.status).toBeGreaterThanOrEqual(400); // 422 for a flow violation, 400 for a malformed status
    }
    expect((await put(t.id, 'done')).status).toBe(422); // skip pending -> done
    expect((await put(t.id, 'to_do')).status).toBe(422); // backward pending -> to_do
    await put(t.id, 'in_progress').expect(200);
    await put(t.id, 'done').expect(200);
    expect((await put(t.id, 'in_progress')).status).toBe(422); // nothing leaves "done"
    expect((await put(t.id, 'to_do')).status).toBe(422);

    expect((await logs(t.id)).map((l) => l.toStatus)).toEqual([
      ...before.map((l) => l.toStatus),
      'in_progress',
      'done',
    ]);
    expect((await api.get(`/api/tasks/${t.id}`)).body.task.status).toBe('done');
  });

  it('Domain Validation also holds at the database level (a bad query cannot corrupt the flow)', async () => {
    const { create, db } = setup();
    await create();
    expect(() => db.prepare("UPDATE tasks SET status = 'done'").run()).toThrow(
      /invalid status transition/,
    );
  });
});
