import type { AuditLog, Status, Task } from '@tm/shared';
import type Database from 'better-sqlite3';
import type { NewAuditLog, TaskDetails, TaskStore } from '../application/ports';

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  assignee: string | null;
  created_at: string;
  updated_at: string;
}

interface LogRow {
  id: number;
  task_id: string;
  task_title: string;
  action: AuditLog['action'];
  actor: string;
  from_status: Status | null;
  to_status: Status | null;
  field: AuditLog['field'];
  from_value: string | null;
  to_value: string | null;
  created_at: string;
}

const toTask = (r: TaskRow): Task => ({
  id: r.id,
  title: r.title,
  description: r.description,
  status: r.status,
  assignee: r.assignee,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toLog = (r: LogRow): AuditLog => ({
  id: r.id,
  taskId: r.task_id,
  taskTitle: r.task_title,
  action: r.action,
  actor: r.actor,
  fromStatus: r.from_status,
  toStatus: r.to_status,
  field: r.field,
  fromValue: r.from_value,
  toValue: r.to_value,
  createdAt: r.created_at,
});

const logParams = (l: NewAuditLog): unknown[] => [
  l.taskId,
  l.taskTitle,
  l.action,
  l.actor,
  l.fromStatus,
  l.toStatus,
  l.createdAt,
  l.field,
  l.fromValue,
  l.toValue,
];

/**
 * The only file with SQL. Statements are static strings with bound parameters (docs/06 S-04).
 * Each write is its own (nested-safe) transaction, so task change + audit log are atomic even
 * when called outside TaskService's outer transaction.
 */
export class SqliteTaskStore implements TaskStore {
  private readonly selectList: Database.Statement<[], TaskRow>;
  private readonly selectOne: Database.Statement<[string], TaskRow>;
  private readonly selectExists: Database.Statement<[string], { one: number }>;
  private readonly insertTask: Database.Statement;
  private readonly updateTask: Database.Statement;
  private readonly updateDetailsStmt: Database.Statement;
  private readonly deleteTask: Database.Statement;
  private readonly insertLog: Database.Statement<unknown[], LogRow>;
  private readonly selectLogs: Database.Statement<[string], LogRow>;

  private readonly insertTx: (task: Task, log: NewAuditLog) => void;
  private readonly updateStatusTx: (
    id: string,
    status: Status,
    at: string,
    log: NewAuditLog,
  ) => AuditLog;
  private readonly updateDetailsTx: (
    id: string,
    next: TaskDetails,
    at: string,
    logs: NewAuditLog[],
  ) => AuditLog[];
  private readonly softDeleteTx: (id: string, at: string, log: NewAuditLog) => void;

  constructor(private readonly db: Database.Database) {
    this.selectList = db.prepare(
      'SELECT id, title, description, status, assignee, created_at, updated_at FROM tasks WHERE deleted_at IS NULL ORDER BY created_at DESC, id',
    );
    this.selectOne = db.prepare(
      'SELECT id, title, description, status, assignee, created_at, updated_at FROM tasks WHERE id = ? AND deleted_at IS NULL',
    );
    this.selectExists = db.prepare('SELECT 1 AS one FROM tasks WHERE id = ?');
    this.insertTask = db.prepare(
      'INSERT INTO tasks (id, title, description, status, assignee, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    this.updateTask = db.prepare(
      'UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    );
    this.updateDetailsStmt = db.prepare(
      'UPDATE tasks SET title = ?, description = ?, assignee = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    );
    this.deleteTask = db.prepare(
      'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    );
    this.insertLog = db.prepare(
      'INSERT INTO audit_logs (task_id, task_title, action, actor, from_status, to_status, created_at, field, from_value, to_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *',
    );
    this.selectLogs = db.prepare('SELECT * FROM audit_logs WHERE task_id = ? ORDER BY id ASC');

    this.insertTx = db.transaction((task: Task, log: NewAuditLog) => {
      this.insertTask.run(
        task.id,
        task.title,
        task.description,
        task.status,
        task.assignee,
        task.createdAt,
        task.updatedAt,
      );
      this.insertLog.get(...logParams(log));
    }).immediate;
    this.updateStatusTx = db.transaction(
      (id: string, status: Status, at: string, log: NewAuditLog) => {
        if (this.updateTask.run(status, at, id).changes !== 1)
          throw new Error('task not found or deleted');
        return toLog(this.insertLog.get(...logParams(log)) as LogRow);
      },
    ).immediate;
    this.updateDetailsTx = db.transaction(
      (id: string, next: TaskDetails, at: string, logs: NewAuditLog[]) => {
        if (
          this.updateDetailsStmt.run(next.title, next.description, next.assignee, at, id)
            .changes !== 1
        ) {
          throw new Error('task not found or deleted');
        }
        return logs.map((log) => toLog(this.insertLog.get(...logParams(log)) as LogRow));
      },
    ).immediate;
    this.softDeleteTx = db.transaction((id: string, at: string, log: NewAuditLog) => {
      if (this.deleteTask.run(at, at, id).changes !== 1)
        throw new Error('task not found or deleted');
      this.insertLog.get(...logParams(log));
    }).immediate;
  }

  list(): Task[] {
    return this.selectList.all().map(toTask);
  }

  get(id: string): Task | undefined {
    const row = this.selectOne.get(id);
    return row && toTask(row);
  }

  exists(id: string): boolean {
    return this.selectExists.get(id) !== undefined;
  }

  insert(task: Task, log: NewAuditLog): void {
    this.insertTx(task, log);
  }

  updateStatus(id: string, status: Status, updatedAt: string, log: NewAuditLog): AuditLog {
    return this.updateStatusTx(id, status, updatedAt, log);
  }

  updateDetails(id: string, next: TaskDetails, updatedAt: string, logs: NewAuditLog[]): AuditLog[] {
    return this.updateDetailsTx(id, next, updatedAt, logs);
  }

  softDelete(id: string, deletedAt: string, log: NewAuditLog): void {
    this.softDeleteTx(id, deletedAt, log);
  }

  listLogs(taskId: string): AuditLog[] {
    return this.selectLogs.all(taskId).map(toLog);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn).immediate();
  }
}
