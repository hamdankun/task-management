import { describe, expect, it } from 'vitest';
import { STATUSES, type Status } from '@tm/shared';
import { TaskService } from '../application/task-service';
import { AppError } from '../domain/errors';
import { openDb } from '../infrastructure/db';
import { SqliteTaskStore } from '../infrastructure/sqlite-task-store';

// Small seeded PRNG so a failure is reproducible.
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

describe('consistency under random operations (PRD M2, IV-2/4/7)', () => {
  it.each([1, 7, 42, 1234])('should keep task state and audit log in sync (seed %i)', (seed) => {
    const rand = mulberry32(seed);
    const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
    const store = new SqliteTaskStore(openDb(':memory:'));
    let n = 0;
    let tick = 0;
    const service = new TaskService({
      store,
      newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
      clock: { now: () => new Date(Date.UTC(2025, 0, 1, 0, 0, 0, tick++)).toISOString() },
    });
    const actors = service.listActors();
    const ids: string[] = [];
    const expectedTransitions = new Map<string, number>();
    const deleted = new Set<string>();
    const expectedEdits = new Map<string, number>();

    for (let step = 0; step < 400; step++) {
      const roll = rand();
      const actor = pick(actors);
      if (roll >= 0.9 && ids.length > 0 && rand() < 0.5) {
        // random edit of title / description / assignee (may be a no-op, may clear a value)
        const id = pick(ids);
        const patch = {
          ...(rand() < 0.5 ? { title: `Title ${Math.floor(rand() * 3)}` } : {}),
          ...(rand() < 0.5 ? { description: pick(['', 'Text A', 'Text B']) || null } : {}),
          ...(rand() < 0.5 ? { assignee: pick([null, ...actors]) } : {}),
        };
        if (Object.keys(patch).length === 0) continue;
        try {
          const r = service.updateTask(actor, id, patch);
          if (r.changed) expectedEdits.set(id, (expectedEdits.get(id) ?? 0) + r.auditLogs.length);
        } catch (e) {
          if (!(e instanceof AppError) || e.code !== 'TASK_NOT_FOUND') throw e;
        }
      } else if (roll < 0.25 || ids.length === 0) {
        const t = service.createTask(actor, { title: `Task ${step}`, description: null });
        ids.push(t.id);
        expectedTransitions.set(t.id, 0);
      } else if (roll < 0.9) {
        const id = pick(ids);
        const target = pick(STATUSES) as Status;
        try {
          const r = service.changeStatus(actor, id, target);
          if (r.changed) expectedTransitions.set(id, (expectedTransitions.get(id) ?? 0) + 1);
        } catch (e) {
          if (
            !(e instanceof AppError) ||
            !['INVALID_TRANSITION', 'TASK_NOT_FOUND'].includes(e.code)
          )
            throw e;
        }
      } else {
        const id = pick(ids);
        try {
          service.deleteTask(actor, id);
          deleted.add(id);
        } catch (e) {
          if (!(e instanceof AppError) || e.code !== 'TASK_NOT_FOUND') throw e;
        }
      }

      for (const id of ids) {
        const logs = service.listAuditLogs(id);
        // ordering and shape
        expect(logs.map((l) => l.id)).toEqual([...logs.map((l) => l.id)].sort((a, b) => a - b));
        expect(logs[0]?.action).toBe('created');
        const chain = logs.filter((l) => l.action === 'created' || l.action === 'status_changed');
        // every status_changed continues exactly where the previous entry ended, one step forward
        chain.slice(1).forEach((l, i) => {
          const prev = chain[i]!;
          expect(l.fromStatus).toBe(prev.toStatus);
          expect(STATUSES.indexOf(l.toStatus!)).toBe(STATUSES.indexOf(l.fromStatus!) + 1); // exactly one step forward
        });
        // count: created + transitions (+ deleted)
        expect(logs.length).toBe(
          1 +
            (expectedTransitions.get(id) ?? 0) +
            (expectedEdits.get(id) ?? 0) +
            (deleted.has(id) ? 1 : 0),
        );
        // every edit continues from the value the previous edit of that field left behind
        const value: Record<string, string | null> = {
          title: logs[0]!.taskTitle,
          description: null,
          assignee: null,
        };
        for (const l of logs.filter((x) => x.action === 'edited')) {
          expect(l.fromValue).toBe(value[l.field!]);
          expect(l.toValue).not.toBe(l.fromValue);
          value[l.field!] = l.toValue;
        }
        if (!deleted.has(id)) expect(service.getTask(id)).toMatchObject(value);
        // state matches the last non-delete log
        if (!deleted.has(id)) expect(service.getTask(id).status).toBe(chain.at(-1)?.toStatus);
        else
          expect(logs.at(-1)).toMatchObject({
            action: 'deleted',
            fromStatus: chain.at(-1)?.toStatus,
          });
      }
    }
    // the list never contains deleted tasks
    expect(new Set(service.listTasks().map((t) => t.id))).toEqual(
      new Set(ids.filter((id) => !deleted.has(id))),
    );
  });
});
