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
  deleted_at  TEXT          CHECK (deleted_at  GLOB '????-??-??T??:??:??.???Z')   -- NULL = active
) STRICT;

-- Serves GET /tasks (active only, newest first)
CREATE INDEX IF NOT EXISTS idx_tasks_active
  ON tasks (created_at DESC, id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,                      -- monotonic ⇒ canonical order
  task_id     TEXT NOT NULL REFERENCES tasks(id) ON DELETE RESTRICT,
  task_title  TEXT NOT NULL,                                          -- snapshot at event time
  action      TEXT NOT NULL CHECK (action IN ('created','status_changed','deleted')),
  actor       TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 64),
  from_status TEXT          CHECK (from_status IN ('to_do','pending','in_progress','done')),
  to_status   TEXT          CHECK (to_status   IN ('to_do','pending','in_progress','done')),
  created_at  TEXT NOT NULL CHECK (created_at GLOB '????-??-??T??:??:??.???Z'),
  CHECK (
    (action = 'created'        AND from_status IS NULL     AND to_status IS 'to_do')                 OR
    (action = 'status_changed' AND from_status IS NOT NULL AND to_status IS NOT NULL
                               AND from_status <> to_status)                                         OR
    (action = 'deleted'        AND from_status IS NOT NULL AND to_status IS NULL)
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
-- Same-status UPDATE is allowed (no-op); anything else must be one step forward.
DROP TRIGGER IF EXISTS tasks_status_flow;
CREATE TRIGGER tasks_status_flow
BEFORE UPDATE OF status ON tasks
WHEN NEW.status <> OLD.status AND NOT (
     (OLD.status = 'to_do'       AND NEW.status = 'pending')
  OR (OLD.status = 'pending'     AND NEW.status = 'in_progress')
  OR (OLD.status = 'in_progress' AND NEW.status = 'done'))
BEGIN SELECT RAISE(ABORT, 'invalid status transition'); END;
