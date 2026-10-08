import { vi } from 'vitest';
import { TaskService } from '../application/task-service';
import type { TaskStore } from '../application/ports';
import { openDb } from '../infrastructure/db';
import { SqliteTaskStore } from '../infrastructure/sqlite-task-store';
import { createApp } from '../presentation/app';
import type { Logger } from '../presentation/logger';

/** Real SQLite :memory: + deterministic clock/ids behind the real Express app. */
export function createTestApp(opts: { store?: (real: TaskStore) => TaskStore } = {}) {
  const db = openDb(':memory:');
  const real = new SqliteTaskStore(db);
  let tick = 0;
  let seq = 0;
  const service = new TaskService({
    store: opts.store ? opts.store(real) : real,
    clock: { now: () => new Date(Date.UTC(2025, 0, 1, 0, 0, 0, tick++)).toISOString() },
    newId: () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`,
  });
  const logger = { info: vi.fn(), error: vi.fn() } satisfies Logger;
  const app = createApp({ service, logger, allowedHosts: ['localhost', '127.0.0.1', '[::1]'] });
  return { app, service, db, logger };
}
