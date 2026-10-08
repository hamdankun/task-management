import { describe, expect, it } from 'vitest';
import { taskStoreContract } from '../application/task-store.contract';
import { buildLog } from '../domain/audit-log';
import { openDb } from './db';
import { SqliteTaskStore } from './sqlite-task-store';

const make = () => new SqliteTaskStore(openDb(':memory:'));
taskStoreContract('SqliteTaskStore', make);

const T = '2025-01-01T09:00:00.000Z';
const task = {
  id: '00000000-0000-4000-8000-000000000001',
  title: 'T',
  description: null,
  status: 'to_do' as const,
  assignee: null,
  createdAt: T,
  updatedAt: T,
};

describe('SqliteTaskStore atomicity', () => {
  it('should not persist a task when its audit log is rejected by the database', () => {
    const store = make();
    const bad = { ...buildLog({ action: 'created', task }, 'john.doe', T), toStatus: null };
    expect(() => store.insert(task, bad)).toThrow();
    expect(store.exists(task.id)).toBe(false);
  });

  it('should not change status when the audit log is rejected by the database', () => {
    const store = make();
    store.insert(task, buildLog({ action: 'created', task }, 'john.doe', T));
    const bad = buildLog({ action: 'status_changed', task, to: 'to_do' }, 'john.doe', T); // from = to
    expect(() => store.updateStatus(task.id, 'pending', T, bad)).toThrow();
    expect(store.get(task.id)?.status).toBe('to_do');
    expect(store.listLogs(task.id)).toHaveLength(1);
  });

  it('should not delete a task when its audit log is rejected by the database', () => {
    const store = make();
    store.insert(task, buildLog({ action: 'created', task }, 'john.doe', T));
    const bad = { ...buildLog({ action: 'deleted', task }, 'john.doe', T), fromStatus: null };
    expect(() => store.softDelete(task.id, T, bad)).toThrow();
    expect(store.get(task.id)).toBeDefined();
  });

  it('should reject a status skip even if the service layer were bypassed', () => {
    const store = make();
    store.insert(task, buildLog({ action: 'created', task }, 'john.doe', T));
    const skip = buildLog({ action: 'status_changed', task, to: 'done' }, 'john.doe', T);
    expect(() => store.updateStatus(task.id, 'done', T, skip)).toThrow(/invalid status transition/);
    expect(store.get(task.id)?.status).toBe('to_do');
  });

  it('should keep nested store writes inside the outer transaction', () => {
    const store = make();
    expect(() =>
      store.transaction(() => {
        store.insert(task, buildLog({ action: 'created', task }, 'john.doe', T));
        throw new Error('outer failure');
      }),
    ).toThrow('outer failure');
    expect(store.exists(task.id)).toBe(false);
  });

  it('should treat SQL metacharacters in text as data', () => {
    const store = make();
    const evil = { ...task, title: `'); DROP TABLE tasks;--`, description: `" OR 1=1 --` };
    store.insert(evil, buildLog({ action: 'created', task: evil }, 'john.doe', T));
    expect(store.get(task.id)).toEqual(evil);
    expect(store.list()).toHaveLength(1);
    expect(store.get(`${task.id}' OR '1'='1`)).toBeUndefined();
  });
});
