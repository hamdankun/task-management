import { describe, expect, it } from 'vitest';
import { AppError } from '../domain/errors';
import { FakeTaskStore } from './fake-task-store';
import type { Clock } from './ports';
import { TaskService } from './task-service';
import { taskStoreContract } from './task-store.contract';

taskStoreContract('FakeTaskStore', () => new FakeTaskStore());

function setup() {
  const store = new FakeTaskStore();
  let tick = 0;
  let seq = 0;
  const clock: Clock = {
    now: () =>
      `2025-01-01T09:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}.000Z`,
  };
  const service = new TaskService({
    store,
    clock,
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  });
  return { store, service };
}
const create = (s: TaskService, title = 'Prepare Invoice') =>
  s.createTask('john.doe', { title, description: null });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof AppError ? e.code : `non-app:${String(e)}`;
  }
  return 'no-error';
};

describe('TaskService.createTask', () => {
  it('should create a to_do task and write a created log', () => {
    const { service } = setup();
    const t = create(service);
    expect(t).toMatchObject({ status: 'to_do', title: 'Prepare Invoice', createdAt: t.updatedAt });
    expect(service.listAuditLogs(t.id)).toMatchObject([
      {
        action: 'created',
        actor: 'john.doe',
        fromStatus: null,
        toStatus: 'to_do',
        taskTitle: 'Prepare Invoice',
      },
    ]);
  });

  it('should reject an unknown actor and write nothing', () => {
    const { service } = setup();
    expect(code(() => service.createTask('mallory', { title: 'x', description: null }))).toBe(
      'INVALID_ACTOR',
    );
    expect(service.listTasks()).toEqual([]);
  });
});

describe('TaskService.changeStatus', () => {
  it('should advance through the whole flow, one log per step', () => {
    const { service } = setup();
    const t = create(service);
    for (const [target, from] of [
      ['pending', 'to_do'],
      ['in_progress', 'pending'],
      ['done', 'in_progress'],
    ] as const) {
      const r = service.changeStatus('jane.smith', t.id, target);
      expect(r).toMatchObject({
        changed: true,
        task: { status: target },
        auditLog: { actor: 'jane.smith', fromStatus: from, toStatus: target },
      });
    }
    expect(service.listAuditLogs(t.id).map((l) => l.action)).toEqual([
      'created',
      'status_changed',
      'status_changed',
      'status_changed',
    ]);
  });

  it('should set updatedAt to the log timestamp', () => {
    const { service } = setup();
    const t = create(service);
    const r = service.changeStatus('john.doe', t.id, 'pending');
    expect(r.task.updatedAt).toBe(r.auditLog?.createdAt);
    expect(r.task.updatedAt > t.updatedAt).toBe(true);
  });

  it('should be idempotent: same status changes nothing and writes no log', () => {
    const { service } = setup();
    const t = create(service);
    service.changeStatus('john.doe', t.id, 'pending');
    const before = service.listAuditLogs(t.id).length;
    expect(service.changeStatus('john.doe', t.id, 'pending')).toMatchObject({
      changed: false,
      auditLog: null,
      task: { status: 'pending' },
    });
    expect(service.changeStatus('john.doe', t.id, 'pending').changed).toBe(false);
    expect(service.listAuditLogs(t.id)).toHaveLength(before);
  });

  it('should treat a stale duplicate request as a no-op, not a second log', () => {
    const { service } = setup();
    const t = create(service);
    service.changeStatus('john.doe', t.id, 'pending'); // tab A
    const r = service.changeStatus('jane.smith', t.id, 'pending'); // tab B, stale
    expect(r.changed).toBe(false);
    expect(service.listAuditLogs(t.id).filter((l) => l.action === 'status_changed')).toHaveLength(
      1,
    );
  });

  it.each([
    ['to_do', 'in_progress', []],
    ['to_do', 'done', []],
    ['pending', 'done', ['pending']],
    ['pending', 'to_do', ['pending']],
    ['in_progress', 'pending', ['pending', 'in_progress']],
    ['in_progress', 'to_do', ['pending', 'in_progress']],
    ['done', 'in_progress', ['pending', 'in_progress', 'done']],
    ['done', 'to_do', ['pending', 'in_progress', 'done']],
  ] as const)(
    'should reject %s -> %s (a skip or a move back) and write nothing',
    (_from, to, path) => {
      const { service } = setup();
      const t = create(service);
      path.forEach((s) => service.changeStatus('john.doe', t.id, s));
      const logs = service.listAuditLogs(t.id).length;
      const status = service.getTask(t.id).status;
      expect(code(() => service.changeStatus('john.doe', t.id, to))).toBe('INVALID_TRANSITION');
      expect(service.listAuditLogs(t.id)).toHaveLength(logs);
      expect(service.getTask(t.id).status).toBe(status);
    },
  );

  it('should reject a stale request after a newer move', () => {
    const { service } = setup();
    const t = create(service);
    service.changeStatus('john.doe', t.id, 'pending');
    service.changeStatus('john.doe', t.id, 'in_progress'); // tab A moved on
    expect(code(() => service.changeStatus('jane.smith', t.id, 'pending'))).toBe(
      'INVALID_TRANSITION',
    ); // tab B stale
  });

  it('should reject an unknown actor before touching anything', () => {
    const { service } = setup();
    const t = create(service);
    expect(code(() => service.changeStatus('', t.id, 'pending'))).toBe('INVALID_ACTOR');
    expect(service.getTask(t.id).status).toBe('to_do');
  });

  it('should report TASK_NOT_FOUND for an unknown id', () => {
    const { service } = setup();
    expect(
      code(() =>
        service.changeStatus('john.doe', '00000000-0000-4000-8000-0000000000ff', 'pending'),
      ),
    ).toBe('TASK_NOT_FOUND');
  });

  it('should leave state and log unchanged when the store fails mid-write', () => {
    const { store, service } = setup();
    const t = create(service);
    const original = store.updateStatus.bind(store);
    store.updateStatus = (...args) => {
      original(...args); // write happens, then the failure
      throw new Error('disk full');
    };
    expect(() => service.changeStatus('john.doe', t.id, 'pending')).toThrow('disk full');
    expect(service.getTask(t.id).status).toBe('to_do');
    expect(service.listAuditLogs(t.id)).toHaveLength(1);
  });
});

describe('TaskService.deleteTask', () => {
  it('should hide the task but keep its history, ending with a deleted entry', () => {
    const { service } = setup();
    const t = create(service);
    service.changeStatus('john.doe', t.id, 'pending');
    service.deleteTask('jane.smith', t.id);
    expect(service.listTasks()).toEqual([]);
    const logs = service.listAuditLogs(t.id);
    expect(logs.map((l) => l.action)).toEqual(['created', 'status_changed', 'deleted']);
    expect(logs.at(-1)).toMatchObject({
      actor: 'jane.smith',
      fromStatus: 'pending',
      toStatus: null,
    });
  });

  it('should reject every further mutation on a deleted task', () => {
    const { service } = setup();
    const t = create(service);
    service.deleteTask('john.doe', t.id);
    expect(code(() => service.changeStatus('john.doe', t.id, 'pending'))).toBe('TASK_NOT_FOUND');
    expect(code(() => service.deleteTask('john.doe', t.id))).toBe('TASK_NOT_FOUND');
    expect(code(() => service.getTask(t.id))).toBe('TASK_NOT_FOUND');
    expect(service.listAuditLogs(t.id)).toHaveLength(2);
  });

  it('should allow deleting a done task', () => {
    const { service } = setup();
    const t = create(service);
    ['pending', 'in_progress', 'done'].forEach((s) =>
      service.changeStatus('john.doe', t.id, s as 'done'),
    );
    expect(() => service.deleteTask('john.doe', t.id)).not.toThrow();
  });

  it('should require a valid actor', () => {
    const { service } = setup();
    const t = create(service);
    expect(code(() => service.deleteTask('nobody', t.id))).toBe('INVALID_ACTOR');
    expect(service.listTasks()).toHaveLength(1);
  });
});

describe('TaskService reads', () => {
  it('should 404 audit logs only for ids that never existed', () => {
    const { service } = setup();
    expect(code(() => service.listAuditLogs('00000000-0000-4000-8000-0000000000aa'))).toBe(
      'TASK_NOT_FOUND',
    );
    const t = create(service);
    service.deleteTask('john.doe', t.id);
    expect(code(() => service.listAuditLogs(t.id))).toBe('no-error');
  });

  it('should list newest tasks first and expose the actor list', () => {
    const { service } = setup();
    const a = create(service, 'A');
    const b = create(service, 'B');
    expect(service.listTasks().map((t) => t.id)).toEqual([b.id, a.id]);
    expect(service.listActors()).toContain('john.doe');
  });
});

describe('TaskService.updateTask', () => {
  const edit = (
    s: TaskService,
    id: string,
    patch: Parameters<TaskService['updateTask']>[2],
    actor = 'jane.smith',
  ) => s.updateTask(actor, id, patch);
  const edits = (s: TaskService, id: string) =>
    s.listAuditLogs(id).filter((l) => l.action === 'edited');

  it('should rename a task and log the old and new title', () => {
    const { service } = setup();
    const t = create(service);
    const r = edit(service, t.id, { title: 'Prepare invoice v2' });
    expect(r).toMatchObject({
      changed: true,
      task: { title: 'Prepare invoice v2', status: 'to_do' },
    });
    expect(r.task.updatedAt > t.updatedAt).toBe(true);
    expect(r.auditLogs).toMatchObject([
      {
        action: 'edited',
        actor: 'jane.smith',
        field: 'title',
        fromValue: 'Prepare Invoice',
        toValue: 'Prepare invoice v2',
        taskTitle: 'Prepare invoice v2',
        fromStatus: null,
        toStatus: null,
        createdAt: r.task.updatedAt,
      },
    ]);
    expect(service.getTask(t.id).title).toBe('Prepare invoice v2');
  });

  it('should write one log per changed field, atomically, in a fixed order', () => {
    const { service } = setup();
    const t = create(service);
    const r = edit(service, t.id, {
      assignee: 'budi.santoso',
      title: 'New',
      description: 'Details',
    });
    expect(r.auditLogs.map((l) => [l.field, l.fromValue, l.toValue])).toEqual([
      ['title', 'Prepare Invoice', 'New'],
      ['description', null, 'Details'],
      ['assignee', null, 'budi.santoso'],
    ]);
    expect(new Set(r.auditLogs.map((l) => l.createdAt)).size).toBe(1);
    expect(service.getTask(t.id)).toMatchObject({
      title: 'New',
      description: 'Details',
      assignee: 'budi.santoso',
    });
  });

  it('should log only the fields that actually differ', () => {
    const { service } = setup();
    const t = create(service);
    edit(service, t.id, { title: 'Same', assignee: 'john.doe' });
    const r = edit(service, t.id, { title: 'Same', description: 'Added', assignee: 'john.doe' });
    expect(r.auditLogs.map((l) => l.field)).toEqual(['description']);
  });

  it('should be idempotent: unchanged values write no log and do not touch updatedAt', () => {
    const { service } = setup();
    const t = create(service);
    const before = service.listAuditLogs(t.id).length;
    expect(
      edit(service, t.id, { title: 'Prepare Invoice', description: null, assignee: null }),
    ).toMatchObject({ changed: false, auditLogs: [], task: { updatedAt: t.updatedAt } });
    expect(service.listAuditLogs(t.id)).toHaveLength(before);
    expect(service.getTask(t.id).updatedAt).toBe(t.updatedAt);
  });

  it('should assign, reassign and unassign, logging each step', () => {
    const { service } = setup();
    const t = create(service);
    edit(service, t.id, { assignee: 'john.doe' });
    edit(service, t.id, { assignee: 'jane.smith' });
    edit(service, t.id, { assignee: null });
    expect(edits(service, t.id).map((l) => [l.fromValue, l.toValue])).toEqual([
      [null, 'john.doe'],
      ['john.doe', 'jane.smith'],
      ['jane.smith', null],
    ]);
    expect(service.getTask(t.id).assignee).toBeNull();
  });

  it('should clear a description and log the removal', () => {
    const { service } = setup();
    const t = service.createTask('john.doe', { title: 'T', description: 'Had text' });
    const r = edit(service, t.id, { description: null });
    expect(r.auditLogs).toMatchObject([
      { field: 'description', fromValue: 'Had text', toValue: null },
    ]);
    expect(service.getTask(t.id).description).toBeNull();
  });

  it('should chain history: each edit starts from the value the previous one set', () => {
    const { service } = setup();
    const t = create(service);
    for (const title of ['A', 'B', 'C']) edit(service, t.id, { title });
    expect(edits(service, t.id).map((l) => [l.fromValue, l.toValue])).toEqual([
      ['Prepare Invoice', 'A'],
      ['A', 'B'],
      ['B', 'C'],
    ]);
  });

  it('should keep the status flow and the older history untouched', () => {
    const { service } = setup();
    const t = create(service);
    service.changeStatus('john.doe', t.id, 'pending');
    const before = service.listAuditLogs(t.id);
    edit(service, t.id, { title: 'Renamed', assignee: 'siti.rahma' });
    expect(service.getTask(t.id).status).toBe('pending');
    expect(service.listAuditLogs(t.id).slice(0, before.length)).toEqual(before);
    expect(() => service.changeStatus('john.doe', t.id, 'in_progress')).not.toThrow();
  });

  it('should reject an unknown assignee without writing anything, even for other fields in the patch', () => {
    const { service } = setup();
    const t = create(service);
    expect(code(() => edit(service, t.id, { title: 'Changed', assignee: 'mallory' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(service.getTask(t.id).title).toBe('Prepare Invoice');
    expect(service.listAuditLogs(t.id)).toHaveLength(1);
  });

  it('should reject an unknown actor, a missing task and a deleted task', () => {
    const { service } = setup();
    const t = create(service);
    expect(code(() => edit(service, t.id, { title: 'X' }, 'nobody'))).toBe('INVALID_ACTOR');
    expect(code(() => edit(service, '00000000-0000-4000-8000-0000000000ff', { title: 'X' }))).toBe(
      'TASK_NOT_FOUND',
    );
    service.deleteTask('john.doe', t.id);
    expect(code(() => edit(service, t.id, { title: 'X' }))).toBe('TASK_NOT_FOUND');
    expect(service.listAuditLogs(t.id).map((l) => l.action)).toEqual(['created', 'deleted']);
  });

  it('should leave state and logs unchanged when the store fails mid-write', () => {
    const { store, service } = setup();
    const t = create(service);
    const original = store.updateDetails.bind(store);
    store.updateDetails = (...args) => {
      original(...args);
      throw new Error('disk full');
    };
    expect(() => edit(service, t.id, { title: 'Changed', assignee: 'john.doe' })).toThrow(
      'disk full',
    );
    expect(service.getTask(t.id)).toMatchObject({ title: 'Prepare Invoice', assignee: null });
    expect(service.listAuditLogs(t.id)).toHaveLength(1);
  });
});
