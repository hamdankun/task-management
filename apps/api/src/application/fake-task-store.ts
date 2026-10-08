import type { AuditLog, Status, Task } from '@tm/shared';
import type { NewAuditLog, TaskDetails, TaskStore } from './ports';

interface Row {
  task: Task;
  deleted: boolean;
}

/** In-memory TaskStore for unit tests; passes the same contract suite as the SQLite store. */
export class FakeTaskStore implements TaskStore {
  private rows = new Map<string, Row>();
  private logs: AuditLog[] = [];
  private nextLogId = 1;

  list(): Task[] {
    return [...this.rows.values()]
      .filter((r) => !r.deleted)
      .map((r) => r.task)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  get(id: string): Task | undefined {
    const row = this.rows.get(id);
    return row && !row.deleted ? { ...row.task } : undefined;
  }

  exists(id: string): boolean {
    return this.rows.has(id);
  }

  insert(task: Task, log: NewAuditLog): void {
    if (this.rows.has(task.id)) throw new Error('duplicate task id');
    this.rows.set(task.id, { task: { ...task }, deleted: false });
    this.appendLog(log);
  }

  updateStatus(id: string, status: Status, updatedAt: string, log: NewAuditLog): AuditLog {
    const row = this.activeRow(id);
    row.task = { ...row.task, status, updatedAt };
    return this.appendLog(log);
  }

  updateDetails(id: string, next: TaskDetails, updatedAt: string, logs: NewAuditLog[]): AuditLog[] {
    const row = this.activeRow(id);
    row.task = { ...row.task, ...next, updatedAt };
    return logs.map((log) => this.appendLog(log));
  }

  softDelete(id: string, deletedAt: string, log: NewAuditLog): void {
    const row = this.activeRow(id);
    row.deleted = true;
    row.task = { ...row.task, updatedAt: deletedAt };
    this.appendLog(log);
  }

  listLogs(taskId: string): AuditLog[] {
    return this.logs.filter((l) => l.taskId === taskId).map((l) => ({ ...l }));
  }

  transaction<T>(fn: () => T): T {
    const snapshot = {
      rows: new Map([...this.rows].map(([k, v]) => [k, { ...v, task: { ...v.task } }])),
      logs: [...this.logs],
      nextLogId: this.nextLogId,
    };
    try {
      return fn();
    } catch (error) {
      this.rows = snapshot.rows;
      this.logs = snapshot.logs;
      this.nextLogId = snapshot.nextLogId;
      throw error;
    }
  }

  private activeRow(id: string): Row {
    const row = this.rows.get(id);
    if (!row || row.deleted) throw new Error('task not found or deleted');
    return row;
  }

  private appendLog(log: NewAuditLog): AuditLog {
    const saved: AuditLog = { ...log, id: this.nextLogId++ };
    this.logs.push(saved);
    return saved;
  }
}
