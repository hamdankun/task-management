import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applySchema, openDb, SCHEMA_VERSION } from './db';

const T = '2025-01-01T09:00:00.000Z';
const ID = 'a'.repeat(36);
const LOG_SQL =
  'INSERT INTO audit_logs (task_id, task_title, action, actor, from_status, to_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)';

function seeded() {
  const db = openDb(':memory:');
  db.prepare(
    'INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ID, 'T', 'to_do', T, T);
  db.prepare(LOG_SQL).run(ID, 'T', 'created', 'john.doe', null, 'to_do', T);
  return db;
}

describe('connection settings', () => {
  it('should enable foreign keys, disable trusted_schema and set the schema version', () => {
    const db = openDb(':memory:');
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('trusted_schema', { simple: true })).toBe(0);
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION);
  });

  it('should apply the schema twice without error', () => {
    const db = openDb(':memory:');
    expect(() => applySchema(db)).not.toThrow();
  });
});

describe('audit_logs is append-only', () => {
  it('should abort any UPDATE', () => {
    expect(() => seeded().prepare("UPDATE audit_logs SET actor = 'x'").run()).toThrow(
      /append-only/,
    );
  });
  it('should abort any DELETE', () => {
    expect(() => seeded().prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
  });
});

describe('tasks lifecycle', () => {
  it('should abort a hard DELETE', () => {
    expect(() => seeded().prepare('DELETE FROM tasks').run()).toThrow(/soft-deleted only/);
  });

  it('should abort a status skip and a backward move, and allow a same-status write', () => {
    const db = seeded();
    expect(() => db.prepare("UPDATE tasks SET status = 'done'").run()).toThrow(
      /invalid status transition/,
    );
    expect(() => db.prepare("UPDATE tasks SET status = 'in_progress'").run()).toThrow(
      /invalid status transition/,
    );
    db.prepare("UPDATE tasks SET status = 'pending'").run();
    expect(() => db.prepare("UPDATE tasks SET status = 'pending'").run()).not.toThrow(); // same status
    expect(() => db.prepare("UPDATE tasks SET status = 'to_do'").run()).toThrow(
      /invalid status transition/,
    );
    db.prepare("UPDATE tasks SET status = 'in_progress'").run();
    db.prepare("UPDATE tasks SET status = 'done'").run();
    expect(() => db.prepare("UPDATE tasks SET status = 'in_progress'").run()).toThrow(
      /invalid status transition/,
    ); // done is terminal
  });

  it('should freeze a deleted task, including an attempt to undelete it', () => {
    const db = seeded();
    db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ?').run(T, T);
    expect(() => db.prepare("UPDATE tasks SET status = 'pending'").run()).toThrow(
      /task is deleted/,
    );
    expect(() => db.prepare('UPDATE tasks SET deleted_at = NULL').run()).toThrow(/task is deleted/);
  });
});

describe('CHECK constraints', () => {
  const insertTask = (
    db: Database.Database,
    id: string,
    title: string,
    desc: string | null,
    at = T,
  ) =>
    db
      .prepare(
        'INSERT INTO tasks (id, title, description, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, title, desc, 'to_do', at, at);

  it('should reject blank, over-long titles and over-long descriptions', () => {
    const db = openDb(':memory:');
    expect(() => insertTask(db, 'b'.repeat(36), '   ', null)).toThrow();
    expect(() => insertTask(db, 'b'.repeat(36), 'x'.repeat(121), null)).toThrow();
    expect(() => insertTask(db, 'b'.repeat(36), 'T', 'x'.repeat(1001))).toThrow();
    expect(() => insertTask(db, 'b'.repeat(36), 'x'.repeat(120), 'y'.repeat(1000))).not.toThrow();
  });

  it('should reject malformed timestamps and ids', () => {
    const db = openDb(':memory:');
    expect(() => insertTask(db, 'b'.repeat(36), 'T', null, '2025-01-01')).toThrow();
    expect(() => insertTask(db, 'short', 'T', null)).toThrow();
  });

  it.each([
    ['created without to_status', ['created', 'john.doe', null, null]],
    ['created to pending', ['created', 'john.doe', null, 'pending']],
    ['created with a from_status', ['created', 'john.doe', 'to_do', 'to_do']],
    ['status_changed from = to', ['status_changed', 'john.doe', 'pending', 'pending']],
    ['status_changed without from', ['status_changed', 'john.doe', null, 'pending']],
    ['deleted without from', ['deleted', 'john.doe', null, null]],
    ['deleted with a to_status', ['deleted', 'john.doe', 'to_do', 'done']],
    ['unknown action', ['renamed', 'john.doe', 'to_do', 'pending']],
    ['empty actor', ['created', '', null, 'to_do']],
    ['65-char actor', ['created', 'a'.repeat(65), null, 'to_do']],
  ])('should reject an audit row: %s', (_name, [action, actor, from, to]) => {
    const db = seeded();
    expect(() => db.prepare(LOG_SQL).run(ID, 'T', action, actor, from, to, T)).toThrow();
  });

  it('should reject a log for a task that does not exist', () => {
    const db = openDb(':memory:');
    expect(() => db.prepare(LOG_SQL).run(ID, 'T', 'created', 'john.doe', null, 'to_do', T)).toThrow(
      /FOREIGN KEY/,
    );
  });
});

describe('edited rows and assignee', () => {
  const EDIT_SQL =
    'INSERT INTO audit_logs (task_id, task_title, action, actor, from_status, to_status, created_at, field, from_value, to_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)';
  const edit = (
    db: Database.Database,
    field: string | null,
    from: string | null,
    to: string | null,
    extra: [string | null, string | null] = [null, null],
  ) =>
    db.prepare(EDIT_SQL).run(ID, 'T', 'edited', 'john.doe', extra[0], extra[1], T, field, from, to);

  it('should accept well-formed edit rows for each field', () => {
    const db = seeded();
    expect(() => edit(db, 'title', 'T', 'T2')).not.toThrow();
    expect(() => edit(db, 'description', null, 'Details')).not.toThrow();
    expect(() => edit(db, 'description', 'Details', null)).not.toThrow();
    expect(() => edit(db, 'assignee', null, 'jane.smith')).not.toThrow();
    expect(() => edit(db, 'assignee', 'jane.smith', null)).not.toThrow();
  });

  it.each([
    ['no change (from = to)', 'title', 'T', 'T', [null, null]],
    ['no field', null, 'a', 'b', [null, null]],
    ['unknown field', 'status', 'a', 'b', [null, null]],
    ['title cleared', 'title', 'T', null, [null, null]],
    ['title from null', 'title', null, 'T', [null, null]],
    ['both values null', 'assignee', null, null, [null, null]],
    ['carries a from_status', 'title', 'T', 'T2', ['to_do', null]],
    ['carries a to_status', 'title', 'T', 'T2', [null, 'pending']],
    ['value over 1000', 'description', null, 'x'.repeat(1001), [null, null]],
  ] as const)('should reject an edit row: %s', (_n, field, from, to, extra) => {
    const db = seeded();
    expect(() => edit(db, field, from, to, [...extra] as [string | null, string | null])).toThrow();
  });

  it.each([
    ['created', ['created', null, 'to_do']],
    ['status_changed', ['status_changed', 'to_do', 'pending']],
    ['deleted', ['deleted', 'to_do', null]],
  ] as const)('should reject a field or value on a %s row', (_n, [action, from, to]) => {
    const db = seeded();
    expect(() =>
      db.prepare(EDIT_SQL).run(ID, 'T', action, 'john.doe', from, to, T, 'title', 'a', 'b'),
    ).toThrow();
    expect(() =>
      db.prepare(EDIT_SQL).run(ID, 'T', action, 'john.doe', from, to, T, null, 'a', null),
    ).toThrow();
  });

  it('should keep edit rows append-only', () => {
    const db = seeded();
    edit(db, 'title', 'T', 'T2');
    expect(() => db.prepare("UPDATE audit_logs SET to_value = 'x'").run()).toThrow(/append-only/);
    expect(() => db.prepare('DELETE FROM audit_logs').run()).toThrow(/append-only/);
  });

  it('should bound the assignee length', () => {
    const db = seeded();
    expect(() => db.prepare('UPDATE tasks SET assignee = ?').run('x'.repeat(64))).not.toThrow();
    expect(() => db.prepare('UPDATE tasks SET assignee = ?').run('x'.repeat(65))).toThrow();
    expect(() => db.prepare("UPDATE tasks SET assignee = ''").run()).toThrow();
    expect(() => db.prepare('UPDATE tasks SET assignee = NULL').run()).not.toThrow();
  });
});

describe('self-healing triggers', () => {
  it('should restore a weakened trigger on the next schema apply', () => {
    const db = seeded();
    db.exec('DROP TRIGGER audit_logs_no_update');
    db.exec('CREATE TRIGGER audit_logs_no_update BEFORE UPDATE ON audit_logs BEGIN SELECT 1; END');
    db.prepare("UPDATE audit_logs SET actor = 'tampered'").run(); // tampering works...
    applySchema(db); // ...until the next boot
    expect(() => db.prepare("UPDATE audit_logs SET actor = 'again'").run()).toThrow(/append-only/);
  });

  it('should recreate a dropped trigger', () => {
    const db = seeded();
    db.exec('DROP TRIGGER tasks_status_flow');
    applySchema(db);
    expect(() => db.prepare("UPDATE tasks SET status = 'done'").run()).toThrow(
      /invalid status transition/,
    );
  });
});

describe.skipIf(process.platform === 'win32')('file permissions', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('should create the database directory 0700 and the file 0600', () => {
    const base = mkdtempSync(join(tmpdir(), 'tm-db-'));
    dirs.push(base);
    const file = join(base, 'nested', 'app.db');
    const db = openDb(file);
    db.prepare(
      'INSERT INTO tasks (id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    ).run(ID, 'T', 'to_do', T, T);
    expect(statSync(join(base, 'nested')).mode & 0o777).toBe(0o700);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    for (const side of ['-wal', '-shm']) {
      try {
        expect(statSync(file + side).mode & 0o077).toBe(0);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      }
    }
    db.close();
  });

  it('should tighten a pre-existing permissive database file', () => {
    const base = mkdtempSync(join(tmpdir(), 'tm-db-'));
    dirs.push(base);
    const file = join(base, 'app.db');
    openDb(file).close();
    // simulate an older, permissive file
    return import('node:fs').then(({ chmodSync }) => {
      chmodSync(file, 0o644);
      openDb(file).close();
      expect(statSync(file).mode & 0o777).toBe(0o600);
    });
  });
});
