-- v1 -> v2: card editing and assignment (docs/03 §8).
-- Tables only. Indexes and triggers are re-created from schema.sql right after this runs.
-- Existing audit rows are copied verbatim (same ids), so history is preserved.

ALTER TABLE tasks ADD COLUMN assignee TEXT CHECK (assignee IS NULL OR length(assignee) BETWEEN 1 AND 64);

-- CHECK constraints cannot be altered in SQLite, so audit_logs is rebuilt. DROP TABLE does not fire
-- the append-only triggers (they are DML triggers); they are restored by schema.sql afterwards.
CREATE TABLE audit_logs_v2 (
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

INSERT INTO audit_logs_v2 (id, task_id, task_title, action, actor, from_status, to_status, created_at)
  SELECT id, task_id, task_title, action, actor, from_status, to_status, created_at FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_v2 RENAME TO audit_logs;
