# 03 — Database schema (SQLite)

This follows the [PRD](01-PRD.md) rules BR-1 to BR-9 and IV-1 to IV-9, and the [tech spec](02-tech-spec.md), section 4. The SQL lives in `apps/api/src/infrastructure/schema.sql` and is applied every time the API starts (it's safe to apply repeatedly).

## 1. Connection settings (set in `db.ts`, not in SQL)

| Setting | Value | Why |
|---|---|---|
| `foreign_keys` | `ON`, and **checked** to read back as `1` at startup | SQLite turns it off by default for every new connection |
| `journal_mode` | `WAL` (file databases only) | Readers don't block the writer |
| `busy_timeout` | `5000` | Wait for a lock instead of failing straight away |
| `trusted_schema` | `OFF` | A swapped-in database file can't run SQL functions hidden in its schema (06, S-11) |
| Write transactions | `BEGIN IMMEDIATE` (`db.transaction(fn).immediate()`) | Take the write lock up front, so there's no read-then-write upgrade failure |
| `user_version` | `2` once the schema is applied (`SCHEMA_VERSION`) | Tells the app which migrations to run (section 8) |
| Path | `DB_PATH` (default `apps/api/data/app.db`); tests use `:memory:` | |
| File permissions (POSIX) | `umask 077` before the first file is created, so the data folder is `0700` and the database and its `-wal` / `-shm` files are `0600`, with no moment when they're readable by others. It's checked at startup and skipped on Windows | Other users on the machine can't read or alter the audit log (06, S-11) |
| Applying the schema | Tables are created if missing and triggers are dropped and re-created, all in one transaction. On failure it rolls back and the process exits | Repairs tampered triggers and never serves with one missing (06, S-11) |

## 2. The SQL

```sql
-- NOTE: a CHECK passes when its expression is NULL, so every branch below uses IS / IS NOT
-- (never bare = on a nullable column) or a NULL to_status would slip through.
-- Timestamps are ISO-8601 UTC with milliseconds (Date#toISOString): lexicographic order == time order.

CREATE TABLE IF NOT EXISTS tasks (
  id          TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),     -- uuid v4
  title       TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
  description TEXT          CHECK (description IS NULL OR length(description) <= 1000),
  status      TEXT NOT NULL DEFAULT 'to_do'
              CHECK (status IN ('to_do','pending','in_progress','done')),
  created_at  TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  updated_at  TEXT NOT NULL CHECK (updated_at GLOB '????-??-??T??:??:??.???Z'),
  deleted_at  TEXT          CHECK (deleted_at  GLOB '????-??-??T??:??:??.???Z'),  -- NULL = active
  assignee    TEXT          CHECK (assignee IS NULL OR length(assignee) BETWEEN 1 AND 64)  -- a predefined user
) STRICT;

-- Serves GET /tasks (active only, newest first)
CREATE INDEX IF NOT EXISTS idx_tasks_active
  ON tasks (created_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,                      -- monotonic => canonical order
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  task_title  TEXT NOT NULL,                                          -- snapshot at event time
  action      TEXT NOT NULL CHECK (action IN ('created','status_changed','edited','deleted')),
  actor       TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 64),
  from_status TEXT          CHECK (from_status IN ('to_do','pending','in_progress','done')),
  to_status   TEXT          CHECK (to_status   IN ('to_do','pending','in_progress','done')),
  created_at  TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  field       TEXT          CHECK (field IN ('title','description','assignee')),  -- only for 'edited'
  from_value  TEXT          CHECK (from_value IS NULL OR length(from_value) <= 1000),
  to_value    TEXT          CHECK (to_value   IS NULL OR length(to_value)   <= 1000),
  CHECK (
    (action = 'created'        AND from_status IS NULL     AND to_status IS 'to_do'
                               AND field IS NULL AND from_value IS NULL AND to_value IS NULL)         OR
    (action = 'status_changed' AND from_status IS NOT NULL AND to_status IS NOT NULL
                               AND from_status <> to_status
                               AND field IS NULL AND from_value IS NULL AND to_value IS NULL)         OR
    (action = 'edited'         AND from_status IS NULL     AND to_status IS NULL
                               AND field IS NOT NULL AND from_value IS NOT to_value
                               AND (field <> 'title' OR (from_value IS NOT NULL AND to_value IS NOT NULL))) OR
    (action = 'deleted'        AND from_status IS NOT NULL AND to_status IS NULL
                               AND field IS NULL AND from_value IS NULL AND to_value IS NULL)
  )
) STRICT;

-- Serves GET /tasks/:id/audit-logs
CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_logs (task_id, id);

-- Triggers are CODE, not data: each is DROPped and re-CREATEd on every boot (inside one
-- transaction, see db.ts) so a tampered/edited trigger is restored to the canonical definition.
-- ── Audit log is append-only (BR-3 / IV-3) ─────────────────────────────
DROP TRIGGER IF EXISTS audit_logs_no_update;
CREATE TRIGGER audit_logs_no_update
BEFORE UPDATE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

DROP TRIGGER IF EXISTS audit_logs_no_delete;
CREATE TRIGGER audit_logs_no_delete
BEFORE DELETE ON audit_logs
BEGIN SELECT RAISE(ABORT, 'audit_logs is append-only'); END;

-- ── Tasks: soft delete only, frozen once deleted (BR-5 / IV-5, IV-8) ───
DROP TRIGGER IF EXISTS tasks_no_delete;
CREATE TRIGGER tasks_no_delete
BEFORE DELETE ON tasks
BEGIN SELECT RAISE(ABORT, 'tasks are soft-deleted only'); END;

DROP TRIGGER IF EXISTS tasks_frozen_after_delete;
CREATE TRIGGER tasks_frozen_after_delete
BEFORE UPDATE ON tasks
WHEN OLD.deleted_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'task is deleted'); END;

-- ── Status flow, defence in depth (BR-1 / IV-1) ────────────────────────
-- Deliberate duplication of the domain rule so a bad query cannot corrupt state.
-- Same-status UPDATE is allowed (no-op); anything else must be exactly one step forward.
DROP TRIGGER IF EXISTS tasks_status_flow;
CREATE TRIGGER tasks_status_flow
BEFORE UPDATE OF status ON tasks
WHEN NEW.status <> OLD.status AND NOT (
     (OLD.status = 'to_do'       AND NEW.status = 'pending')
  OR (OLD.status = 'pending'     AND NEW.status = 'in_progress')
  OR (OLD.status = 'in_progress' AND NEW.status = 'done'))
BEGIN SELECT RAISE(ABORT, 'invalid status transition'); END;
```

> This SQL was run on SQLite 3.53 to check it: it applies twice without trouble, every rejection listed in section 9 raised the expected error, and the "list tasks" query uses `idx_tasks_active`. Those same checks are now `schema.test.ts`.

## 3. Which constraint enforces which rule

| Constraint | What it enforces | Its twin in the application code |
|---|---|---|
| `STRICT` tables | Columns hold real types (no `'abc'` in an integer column) | TypeScript types |
| The title and description CHECKs | The bounds in BR-7. The API trims the title before saving, and the database only checks that the trimmed length is 1 to 120 | zod `CreateTaskSchema` |
| The status CHECK and `tasks_status_flow` | IV-1: exactly one step forward (no skip, no moving back, `done` is the end) | `assertTransition` |
| The `actor` length CHECK (1–64) | A last line of defence against oversized or log-injection input. The actor *list* itself is checked in code | `assertActor` |
| The `edited` branch of the audit CHECK | An `edited` row has no statuses and does have a `field`, and its `from_value` differs from `to_value` (so an edit that changes nothing can't be written). A title is never null. Other actions carry no `field` or values | `buildLog` and the no-op branch of `updateTask` |
| The `action` CHECK | The shape of each kind of entry. A `status_changed` entry has different `from` and `to` (this backs IV-2), and `created` always ends in `to_do` | `buildLog` |
| `audit_logs_no_update` and `audit_logs_no_delete` | IV-3 | No code path exists |
| `tasks_no_delete` and the `RESTRICT` foreign key | IV-5. The foreign key also stops entries from pointing at a task that doesn't exist | Soft delete |
| The `tasks.assignee` CHECK | One to 64 characters, or null. The list of valid users is checked in code, like actors | `assertAssignee` |
| `tasks_frozen_after_delete` | IV-8, and it also prevents "un-deleting" | The store's `WHERE deleted_at IS NULL` plus its check that one row changed |
| The timestamp pattern | A consistent format that sorts correctly | `Clock.now()` |

What the database deliberately **can't** enforce: "every change to a task has a matching entry" (BR-4 / IV-4). That is guaranteed by the single transaction in the store, plus the property test. It also can't check that an actor is on the list, because the list lives in code (section 6).

## 4. Columns and the DTO fields (converted in one place, the store's row mapper)

| `tasks` column | `Task` field | | `audit_logs` column | `AuditLog` field |
|---|---|---|---|---|
| `id` | `id` | | `id` | `id` |
| `title` | `title` | | `task_id` | `taskId` |
| `description` | `description` | | `task_title` | `taskTitle` |
| `status` | `status` | | `action` | `action` |
| `created_at` | `createdAt` | | `actor` | `actor` |
| `updated_at` | `updatedAt` | | `from_status` | `fromStatus` |
| `assignee` | `assignee` | | `to_status` | `toStatus` |
| `deleted_at` | *(never sent to clients)* | | `field` | `field` |
| | | | `from_value` | `fromValue` |
| | | | `to_value` | `toValue` |
| | | | `created_at` | `createdAt` |

## 5. The statements (one per `TaskStore` method, all parameterised)

```sql
-- list()
SELECT id, title, description, status, assignee, created_at, updated_at
FROM tasks WHERE deleted_at IS NULL ORDER BY created_at DESC, id;

-- get(id)
SELECT id, title, description, status, assignee, created_at, updated_at
FROM tasks WHERE id = ? AND deleted_at IS NULL;

-- exists(id)
SELECT 1 AS one FROM tasks WHERE id = ?;

-- insert(task, log)                 -- one transaction
INSERT INTO tasks (id, title, description, status, assignee, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?);
INSERT INTO audit_logs (task_id, task_title, action, actor, from_status, to_status, created_at, field, from_value, to_value)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *;

-- updateStatus(id, status, updatedAt, log)   -- one transaction; checks that exactly one row changed
UPDATE tasks SET status = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;
INSERT INTO audit_logs (...) VALUES (...) RETURNING *;

-- updateDetails(id, {title, description, assignee}, updatedAt, logs)   -- one transaction; checks that exactly one row changed
-- The full resulting values are written (not a diff), so the SQL stays static. One log INSERT per changed field.
UPDATE tasks SET title = ?, description = ?, assignee = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;
INSERT INTO audit_logs (...) VALUES (...) RETURNING *;

-- softDelete(id, deletedAt, log)    -- one transaction; checks that exactly one row changed
UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;   -- updated_at = deleted_at
INSERT INTO audit_logs (...) VALUES (...) RETURNING *;

-- listLogs(taskId)
SELECT * FROM audit_logs WHERE task_id = ? ORDER BY id ASC;
```

An entry's `created_at` equals the task's `updated_at` for the same event, because both use the same `now`.

## 6. Why there is no `users` or `actors` table

The actors are a hardcoded list (the brief says that's fine). A table would need seeding and would have to stay in sync with the code, which is more machinery than it's worth. The list lives in `domain/actors.ts` and is checked before anything is written.

The consequence: the database can't reject an unknown actor name (it only checks the length). That's accepted and documented (06, S-01), and it's the first thing real authentication would replace.

## 7. An example: one task's life

```
tasks   id 3f2c…  title "Prepare Invoice"  description "Send to finance"  status in_progress
        assignee jane.smith  created 09:00  updated 11:30  deleted_at NULL

audit_logs
 id │ action         │ actor        │ from        │ to          │ field       │ from → to value              │ at
  1 │ created        │ john.doe     │ NULL        │ to_do       │ NULL        │                              │ 09:00
  2 │ status_changed │ jane.smith   │ to_do       │ pending     │ NULL        │                              │ 09:30
  3 │ status_changed │ john.doe     │ pending     │ in_progress │ NULL        │                              │ 10:00
  4 │ edited         │ john.doe     │ NULL        │ NULL        │ description │ NULL → "Send to finance"     │ 10:20
  5 │ edited         │ john.doe     │ NULL        │ NULL        │ assignee    │ NULL → jane.smith            │ 11:30
```

If the task were deleted at 12:00, a sixth entry `deleted` (from `in_progress`, to nothing) would be added, and `deleted_at` would be set. All six entries would still be there to read.

## 8. Changing the schema over time

- **Versions.** `PRAGMA user_version` says which shape a database has. **1** is the original list-era schema, kept frozen in `migrations/001-initial.sql` and used only by the migration test. **2** is the current one, with card editing and assignment, which is the SQL in section 2.
- **What happens on startup** (`db.ts`, in one transaction): if the database already has a `tasks` table, every migration newer than its `user_version` runs. Then `schema.sql` is applied (tables and indexes if missing, triggers dropped and re-created), and `user_version` is set to 2. A brand-new database skips the migrations, because `schema.sql` already describes the latest shape. A database that's *newer* than the app refuses to start. Any failure rolls everything back.
- **Migration 002** (`migrations/002-edit-and-assign.sql`) adds the `assignee` column and rebuilds `audit_logs`, because SQLite can't change CHECK constraints in place. It creates `audit_logs_v2` with the new columns and constraints, copies every row **with its id**, drops the old table and renames the new one. `DROP TABLE` doesn't fire the append-only triggers (they're triggers for row changes), and they're re-created right afterwards. The existing history is kept exactly as it was, and the new columns are empty for the old rows.
- **What tests protect this** (`migration.test.ts`): data and ids are preserved, numbering carries on from the last id, triggers and indexes come back, the result has the same columns and triggers as a fresh database, the new constraints apply to the migrated tables, running it twice is harmless, a failure rolls back (including the `ALTER`), a newer database is refused, and a real file is migrated through `openDb`.
- **To add a migration 003 later:** add `migrations/003-….sql`, add it to the `MIGRATIONS` list, bump `SCHEMA_VERSION`, update `schema.sql` to the new latest shape, and write a test like the existing ones.
- **To reset a development database:** stop the API and delete `apps/api/data/app.db*` (including the `-wal` and `-shm` files).
- **How big it gets.** Each changed field adds one audit row. Edits are the only thing that can make a task's history grow without limit, since someone can keep editing, so the old "at most five entries per task" bound no longer holds. Values are capped at 1000 characters and the request size limit applies. The long-term answer is archiving old entries by task (README, question 3).
- **Porting to Postgres:** ids become `uuid`, timestamps become `timestamptz`, `AUTOINCREMENT` becomes `bigint GENERATED ALWAYS AS IDENTITY`, the `GLOB` checks go away, the triggers become `BEFORE UPDATE OR DELETE` functions that raise an error, the status-flow trigger becomes the same logic in plpgsql, and `UPDATE` and `DELETE` on `audit_logs` are revoked from the application's role, which is a stronger guarantee than a trigger.

## 9. What the tests for this schema must prove

- A raw `UPDATE` or `DELETE` on `audit_logs` aborts, `edited` rows included.
- A raw `DELETE FROM tasks` aborts.
- A raw update that skips a status or moves one backward aborts.
- Any `UPDATE` on a deleted task aborts, including setting `deleted_at` back to `NULL`.
- The CHECKs reject: `from = to`, a `created` row whose `to_status` isn't `to_do`, a 121-character title, a 1001-character description and a badly formatted timestamp.
- The foreign key rejects an entry for a task that doesn't exist.
- Every `edited` constraint holds: `from = to`, a missing field, a cleared title, statuses present, a value over 1000 characters, and a field on a row that isn't an edit.
- The assignee bounds hold.
- `foreign_keys` reads back as 1.
- Applying `schema.sql` twice changes nothing.
- **A trigger changed or dropped with raw SQL is restored the next time the schema is applied.**
- The file modes are `0600` and `0700` (POSIX).
- Payloads like `'); DROP TABLE tasks;--` and `<script>` come back exactly as stored and leave the schema intact.
