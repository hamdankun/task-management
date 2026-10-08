import Database from 'better-sqlite3';
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
const SCHEMA_SQL = read('./schema.sql'); // latest tables + indexes + triggers
// Applied in order to databases created by an older version. A fresh database skips them
// because schema.sql already describes the latest shape.
const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 2, sql: read('./migrations/002-edit-and-assign.sql') },
];
export const SCHEMA_VERSION = 2;

const hasTasksTable = (db: Database.Database) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'tasks'").get() !==
  undefined;

/**
 * One transaction: (1) migrate an older database, (2) apply schema.sql. Tables are created if
 * missing; indexes are created if missing; triggers are DROPped and re-CREATEd every time, so a
 * tampered trigger is restored on the next boot. On failure nothing changes.
 */
export function applySchema(db: Database.Database): void {
  db.transaction(() => {
    const existing = hasTasksTable(db);
    const from = existing
      ? (db.pragma('user_version', { simple: true }) as number)
      : SCHEMA_VERSION;
    if (from > SCHEMA_VERSION)
      throw new Error(`database schema v${from} is newer than this app (v${SCHEMA_VERSION})`);
    for (const m of MIGRATIONS) if (m.version > from) db.exec(m.sql);
    db.exec(SCHEMA_SQL);
  })();
  db.pragma(`user_version = ${SCHEMA_VERSION}`); // constant, not user input
}

export function openDb(path: string): Database.Database {
  const inMemory = path === ':memory:';
  if (!inMemory) {
    // umask first: the dir, db, -wal and -shm are never briefly readable by others (docs/06 S-11).
    process.umask(0o077);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  }
  const db = new Database(path);
  try {
    if (!inMemory) db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    if (db.pragma('foreign_keys', { simple: true }) !== 1)
      throw new Error('foreign_keys is not enabled');
    db.pragma('busy_timeout = 5000');
    db.pragma('trusted_schema = OFF');
    applySchema(db);
    if (!inMemory && process.platform !== 'win32') {
      chmodSync(path, 0o600); // covers a file created before this hardening existed
      if ((statSync(path).mode & 0o777) !== 0o600) throw new Error('database file is not 0600');
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
