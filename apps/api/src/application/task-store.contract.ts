import type { Task } from '@tm/shared';
import { describe, expect, it } from 'vitest';
import { buildLog } from '../domain/audit-log';
import type { TaskStore } from './ports';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ts = (n: number) => `2025-01-01T09:00:${String(n).padStart(2, '0')}.000Z`;
const task = (n: number, over: Partial<Task> = {}): Task => ({
  id: id(n),
  title: `Task ${n}`,
  description: null,
  status: 'to_do',
  assignee: null,
  createdAt: ts(n),
  updatedAt: ts(n),
  ...over,
});

/** Behaviour every TaskStore must provide; run against the fake and the SQLite store. */
export function taskStoreContract(name: string, make: () => TaskStore): void {
  describe(`TaskStore contract: ${name}`, () => {
    const seed = (store: TaskStore, n = 1) => {
      const t = task(n);
      store.insert(t, buildLog({ action: 'created', task: t }, 'john.doe', t.createdAt));
      return t;
    };

    it('should persist a task together with its created log', () => {
      const store = make();
      const t = seed(store);
      expect(store.get(t.id)).toEqual(t);
      expect(store.list()).toEqual([t]);
      const logs = store.listLogs(t.id);
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        action: 'created',
        actor: 'john.doe',
        fromStatus: null,
        toStatus: 'to_do',
      });
      expect(logs[0]?.id).toBeGreaterThan(0);
    });

    it('should list active tasks newest first', () => {
      const store = make();
      seed(store, 1);
      seed(store, 3);
      seed(store, 2);
      expect(store.list().map((t) => t.id)).toEqual([id(3), id(2), id(1)]);
    });

    it('should update status and updatedAt and return the saved log with an id', () => {
      const store = make();
      const t = seed(store);
      const saved = store.updateStatus(
        t.id,
        'pending',
        ts(30),
        buildLog({ action: 'status_changed', task: t, to: 'pending' }, 'jane.smith', ts(30)),
      );
      expect(saved).toMatchObject({
        action: 'status_changed',
        fromStatus: 'to_do',
        toStatus: 'pending',
        actor: 'jane.smith',
      });
      expect(store.get(t.id)).toMatchObject({
        status: 'pending',
        updatedAt: ts(30),
        createdAt: t.createdAt,
      });
    });

    it('should save new details with one log per field and return the saved logs', () => {
      const store = make();
      const t = seed(store);
      const next = { title: 'Renamed', description: 'Details', assignee: 'jane.smith' };
      const after = { ...t, ...next, updatedAt: ts(15) };
      const saved = store.updateDetails(t.id, next, ts(15), [
        buildLog(
          { action: 'edited', task: after, field: 'title', from: t.title, to: 'Renamed' },
          'john.doe',
          ts(15),
        ),
        buildLog(
          { action: 'edited', task: after, field: 'assignee', from: null, to: 'jane.smith' },
          'john.doe',
          ts(15),
        ),
      ]);
      expect(saved.map((l) => [l.field, l.fromValue, l.toValue])).toEqual([
        ['title', t.title, 'Renamed'],
        ['assignee', null, 'jane.smith'],
      ]);
      expect(store.get(t.id)).toMatchObject({
        ...next,
        status: 'to_do',
        updatedAt: ts(15),
        createdAt: t.createdAt,
      });
      expect(store.listLogs(t.id).map((l) => l.action)).toEqual(['created', 'edited', 'edited']);
    });

    it('should throw and write no log when editing a missing or deleted task', () => {
      const store = make();
      const t = seed(store);
      const log = buildLog(
        { action: 'edited', task: t, field: 'title', from: t.title, to: 'X' },
        'john.doe',
        ts(5),
      );
      expect(() =>
        store.updateDetails(id(77), { title: 'X', description: null, assignee: null }, ts(5), [
          log,
        ]),
      ).toThrow();
      store.softDelete(t.id, ts(40), buildLog({ action: 'deleted', task: t }, 'john.doe', ts(40)));
      expect(() =>
        store.updateDetails(t.id, { title: 'X', description: null, assignee: null }, ts(50), [log]),
      ).toThrow();
      expect(store.listLogs(t.id)).toHaveLength(2);
    });

    it('should return logs in id order, oldest first', () => {
      const store = make();
      const t = seed(store);
      store.updateStatus(
        t.id,
        'pending',
        ts(10),
        buildLog({ action: 'status_changed', task: t, to: 'pending' }, 'john.doe', ts(10)),
      );
      store.updateStatus(
        t.id,
        'in_progress',
        ts(20),
        buildLog(
          { action: 'status_changed', task: { ...t, status: 'pending' }, to: 'in_progress' },
          'john.doe',
          ts(20),
        ),
      );
      const logs = store.listLogs(t.id);
      expect(logs.map((l) => l.toStatus)).toEqual(['to_do', 'pending', 'in_progress']);
      expect(logs.map((l) => l.id)).toEqual([...logs.map((l) => l.id)].sort((a, b) => a - b));
    });

    it('should hide a soft-deleted task but keep it existing and keep its logs', () => {
      const store = make();
      const t = seed(store);
      store.softDelete(t.id, ts(40), buildLog({ action: 'deleted', task: t }, 'john.doe', ts(40)));
      expect(store.get(t.id)).toBeUndefined();
      expect(store.list()).toEqual([]);
      expect(store.exists(t.id)).toBe(true);
      expect(store.listLogs(t.id).map((l) => l.action)).toEqual(['created', 'deleted']);
    });

    it('should report a never-created task as non-existent with no logs', () => {
      const store = make();
      expect(store.exists(id(99))).toBe(false);
      expect(store.get(id(99))).toBeUndefined();
      expect(store.listLogs(id(99))).toEqual([]);
    });

    it('should throw and write no log when updating a missing task', () => {
      const store = make();
      const ghost = task(7);
      expect(() =>
        store.updateStatus(
          ghost.id,
          'pending',
          ts(1),
          buildLog({ action: 'status_changed', task: ghost, to: 'pending' }, 'john.doe', ts(1)),
        ),
      ).toThrow();
      expect(store.listLogs(ghost.id)).toEqual([]);
    });

    it('should throw and write no extra log when updating or deleting a deleted task', () => {
      const store = make();
      const t = seed(store);
      store.softDelete(t.id, ts(40), buildLog({ action: 'deleted', task: t }, 'john.doe', ts(40)));
      expect(() =>
        store.updateStatus(
          t.id,
          'pending',
          ts(50),
          buildLog({ action: 'status_changed', task: t, to: 'pending' }, 'john.doe', ts(50)),
        ),
      ).toThrow();
      expect(() =>
        store.softDelete(
          t.id,
          ts(51),
          buildLog({ action: 'deleted', task: t }, 'john.doe', ts(51)),
        ),
      ).toThrow();
      expect(store.listLogs(t.id)).toHaveLength(2);
    });

    it('should return the value of a committed transaction', () => {
      const store = make();
      expect(store.transaction(() => 42)).toBe(42);
    });

    it('should roll back every write in a transaction that throws', () => {
      const store = make();
      const t = seed(store);
      expect(() =>
        store.transaction(() => {
          store.updateStatus(
            t.id,
            'pending',
            ts(10),
            buildLog({ action: 'status_changed', task: t, to: 'pending' }, 'john.doe', ts(10)),
          );
          seed(store, 2);
          throw new Error('boom');
        }),
      ).toThrow('boom');
      expect(store.get(t.id)?.status).toBe('to_do');
      expect(store.get(id(2))).toBeUndefined();
      expect(store.listLogs(t.id)).toHaveLength(1);
    });
  });
}
