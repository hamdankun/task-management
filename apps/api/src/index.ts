import { randomUUID } from 'node:crypto';
import { TaskService } from './application/task-service';
import { loadConfig } from './infrastructure/config';
import { openDb } from './infrastructure/db';
import { SqliteTaskStore } from './infrastructure/sqlite-task-store';
import { createApp } from './presentation/app';
import { consoleLogger as logger } from './presentation/logger';

// Composition root: the only place that knows every concrete class.
let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Invalid configuration');
  process.exit(1);
}

const db = openDb(config.DB_PATH);
const service = new TaskService({
  store: new SqliteTaskStore(db),
  clock: { now: () => new Date().toISOString() },
  newId: randomUUID,
});
const app = createApp({ service, logger, allowedHosts: config.ALLOWED_HOSTS });

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info({ msg: 'listening', host: config.HOST, port: config.PORT });
});
server.requestTimeout = 10_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;

function shutdown(): void {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5_000).unref(); // do not hang on open keep-alive sockets
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
