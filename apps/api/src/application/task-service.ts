import {
  EDITABLE_FIELDS,
  type AuditLog,
  type ChangeStatusResponse,
  type CreateTask,
  type Status,
  type Task,
  type UpdateTask,
  type UpdateTaskResponse,
} from '@tm/shared';
import { ACTORS, assertActor, assertAssignee } from '../domain/actors';
import { buildLog } from '../domain/audit-log';
import { TaskNotFoundError } from '../domain/errors';
import { assertTransition } from '../domain/transitions';
import type { Clock, IdGen, TaskStore } from './ports';

export interface TaskServiceDeps {
  store: TaskStore;
  clock: Clock;
  newId: IdGen;
}

/**
 * Use cases. Every mutation re-asserts the actor so the rule (BR-6) cannot be bypassed by a
 * different entry point than HTTP.
 */
export class TaskService {
  private readonly store: TaskStore;
  private readonly clock: Clock;
  private readonly newId: IdGen;

  constructor({ store, clock, newId }: TaskServiceDeps) {
    this.store = store;
    this.clock = clock;
    this.newId = newId;
  }

  listActors(): readonly string[] {
    return ACTORS;
  }

  listTasks(): Task[] {
    return this.store.list();
  }

  getTask(id: string): Task {
    return this.store.get(id) ?? raise(new TaskNotFoundError());
  }

  createTask(actor: string, input: CreateTask): Task {
    assertActor(actor);
    const now = this.clock.now();
    const task: Task = {
      id: this.newId(),
      title: input.title,
      description: input.description,
      status: 'to_do',
      assignee: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insert(task, buildLog({ action: 'created', task }, actor, now));
    return task;
  }

  changeStatus(actor: string, id: string, target: Status): ChangeStatusResponse {
    assertActor(actor);
    // Read, check and write must be one unit so two requests cannot both pass the check.
    return this.store.transaction(() => {
      const task = this.getTask(id);
      if (task.status === target) return { task, changed: false, auditLog: null }; // idempotent
      assertTransition(task.status, target);
      const now = this.clock.now();
      const auditLog: AuditLog = this.store.updateStatus(
        id,
        target,
        now,
        buildLog({ action: 'status_changed', task, to: target }, actor, now),
      );
      return { task: { ...task, status: target, updatedAt: now }, changed: true, auditLog };
    });
  }

  /**
   * Partial update of title / description / assignee. Each field that actually changes gets its own
   * audit entry with the old and new value, all in one transaction. Nothing changes => no entries.
   * The previous values come from the re-read inside the transaction, so history stays accurate
   * even if two people edit at once (last write wins, both writes are logged).
   */
  updateTask(actor: string, id: string, patch: UpdateTask): UpdateTaskResponse {
    assertActor(actor);
    if (typeof patch.assignee === 'string') assertAssignee(patch.assignee);
    return this.store.transaction(() => {
      const task = this.getTask(id);
      const changed = EDITABLE_FIELDS.filter((f) => patch[f] !== undefined && patch[f] !== task[f]);
      if (changed.length === 0) return { task, changed: false, auditLogs: [] };

      const now = this.clock.now();
      const next: Task = { ...task, updatedAt: now };
      for (const f of changed) Object.assign(next, { [f]: patch[f] });
      const logs = changed.map((f) =>
        buildLog(
          { action: 'edited', task: next, field: f, from: task[f], to: next[f] },
          actor,
          now,
        ),
      );
      const auditLogs = this.store.updateDetails(
        id,
        { title: next.title, description: next.description, assignee: next.assignee },
        now,
        logs,
      );
      return { task: next, changed: true, auditLogs };
    });
  }

  deleteTask(actor: string, id: string): void {
    assertActor(actor);
    this.store.transaction(() => {
      const task = this.getTask(id);
      const now = this.clock.now();
      this.store.softDelete(id, now, buildLog({ action: 'deleted', task }, actor, now));
    });
  }

  listAuditLogs(id: string): AuditLog[] {
    if (!this.store.exists(id)) throw new TaskNotFoundError();
    return this.store.listLogs(id);
  }
}

function raise(error: Error): never {
  throw error;
}
