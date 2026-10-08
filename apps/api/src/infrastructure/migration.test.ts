import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySchema, openDb, SCHEMA_VERSION } from './db';

const V1_SQL = readFileSync(new URL('./migrations/001-initial.sql', import.meta.url), 'utf8');
const T = (n: number) => `2025-01-01T09:00:${String(n).padStart(2, '0')}.000Z`;
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** A database exactly as the previous release left it, with real history in it. */
function v1Database(path = ':memory:') {
  const db = new Database(path);
  db.pragma('foreign_keys = ON');
  db.exec(V1_SQL);
  db.pragma('user_version = 1');
  const task = db.prepare(
    'INSERT INTO tasks (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const log = db.prepare(
    'INSERT INTO audit_logs (task_id, task_title, action, actor, from_status, to_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  task.run(ID(1), 'Prepare invoice', 'Send to finance', 'in_progress', T(1), T(3));
  log.run(ID(1), 'Prepare invoice', 'created', 'john.doe', null, 'to_do', T(1));
  log.run(ID(1), 'Prepare invoice', 'status_changed', 'jane.smith', 'to_do', 'pending', T(2));
  log.run(ID(1), 'Prepare invoice', 'status_changed', 'jane.smith', 'pending', 'in_progress', T(3));
  task.run(ID(2), 'Gone', null, 'to_do', T(4), T(5));
  log.run(ID(2), 'Gone', 'created', 'john.doe', null, 'to_do', T(4));
  db.prepare('UPDATE tasks SET deleted_at = ? WHERE id = ?').run(T(5), ID(2));
  log.run(ID(2), 'Gone', 'deleted', 'budi.santoso', 'to_do', null, T(5));
  return db;
}

const columns = (db: Database.Database, table: string) =>
  (
    db.pragma(`table_info(${table})`) as {
      name: string;
      type: string;
      notnull: number;
      pk: number;
    }[]
  ).map(({ name, type, notnull, pk }) => ({ name, type, notnull, pk }));

describe('migrating a v1 database to v2', () => {
  it('should keep every existing task and audit entry exactly as it was', () => {
    const db = v1Database();
    const before = db.prepare('SELECT * FROM audit_logs ORDER BY id').all();
    const tasksBefore = db
      .prepare(
        'SELECT id, title, description, status, created_at, updated_at, deleted_at FROM tasks ORDER BY id',
      )
      .all();

    applySchema(db);

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
    const after = db
      .prepare(
        'SELECT id, task_id, task_title, action, actor, from_status, to_status, created_at FROM audit_logs ORDER BY id',
      )
      .all();
    expect(after).toEqual(before.map((r) => r)); // same ids, same content
    expect(
      db
        .prepare(
          'SELECT id, title, description, status, created_at, updated_at, deleted_at FROM tasks ORDER BY id',
        )
        .all(),
    ).toEqual(tasksBefore);
    expect(db.prepare('SELECT count(*) AS n FROM tasks WHERE assignee IS NOT NULL').get()).toEqual({
      n: 0,
    });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('should continue audit ids after the existing ones', () => {
    const db = v1Database();
    applySchema(db);
    db.prepare(
      "INSERT INTO audit_logs (task_id, task_title, action, actor, created_at, field, from_value, to_value) VALUES (?, 'Prepare invoice', 'edited', 'john.doe', ?, 'title', 'a', 'b')",
    ).run(ID(1), T(9));
    expect(db.prepare('SELECT max(id) AS m, count(*) AS n FROM audit_logs').get()).toEqual({
      m: 6,
      n: 6,
    });
  });

  it('should restore the append-only triggers and indexes after rebuilding audit_logs', () => {
    const db = v1Database();
    applySchema(db);
    expect(() => db.prepare("UPDATE audit_logs SET actor = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM tasks').run()).toThrow(/soft-deleted only/);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name",
      )
      .all();
    expect(indexes).toEqual([{ name: 'idx_audit_task' }, { name: 'idx_tasks_active' }]);
  });

  it('should end with the same structure as a freshly created database', () => {
    const migrated = v1Database();
    applySchema(migrated);
    const fresh = openDb(':memory:');
    expect(columns(migrated, 'tasks')).toEqual(columns(fresh, 'tasks'));
    expect(columns(migrated, 'audit_logs')).toEqual(columns(fresh, 'audit_logs'));
    const triggers = (db: Database.Database) =>
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all();
    expect(triggers(migrated)).toEqual(triggers(fresh));
  });

  it('should enforce the new constraints on the migrated tables too', () => {
    const db = v1Database();
    applySchema(db);
    const insert = db.prepare(
      "INSERT INTO audit_logs (task_id, task_title, action, actor, created_at, field, from_value, to_value) VALUES (?, 'T', 'edited', 'john.doe', ?, ?, ?, ?)",
    );
    expect(() => insert.run(ID(1), T(9), 'assignee', null, 'jane.smith')).not.toThrow();
    expect(() => insert.run(ID(1), T(9), 'title', 'same', 'same')).toThrow();
    expect(() => insert.run(ID(1), T(9), 'status', 'a', 'b')).toThrow();
    expect(() =>
      db.prepare('UPDATE tasks SET assignee = ? WHERE id = ?').run('x'.repeat(65), ID(1)),
    ).toThrow();
  });

  it('should be safe to run again', () => {
    const db = v1Database();
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
    expect(db.prepare('SELECT count(*) AS n FROM audit_logs').get()).toEqual({ n: 5 });
  });

  it('should leave the database untouched if the migration fails', () => {
    const db = v1Database();
    db.exec('CREATE TABLE audit_logs_v2 (x)'); // make the rebuild step collide
    expect(() => applySchema(db)).toThrow();
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    expect(columns(db, 'tasks').some((c) => c.name === 'assignee')).toBe(false); // the ALTER rolled back too
    expect(db.prepare('SELECT count(*) AS n FROM audit_logs').get()).toEqual({ n: 5 });
  });

  it('should refuse a database written by a newer version of the app', () => {
    const db = openDb(':memory:');
    db.pragma('user_version = 99');
    expect(() => applySchema(db)).toThrow(/newer than this app/);
  });

  it('should migrate a real file when the app opens it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tm-migrate-'));
    try {
      const file = join(dir, 'app.db');
      v1Database(file).close();
      const db = openDb(file);
      expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
      expect(db.prepare('SELECT count(*) AS n FROM audit_logs').get()).toEqual({ n: 5 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
