export type LogEntry = Record<string, unknown>;

export interface Logger {
  info(entry: LogEntry): void;
  error(entry: LogEntry): void;
}

// JSON lines: JSON.stringify escapes control characters, so user-controlled text cannot forge
// log lines (docs/06 S-09). ponytail: no levels/redaction, swap for pino in production.
const line = (level: string, entry: LogEntry) =>
  JSON.stringify({ level, time: new Date().toISOString(), ...entry });

export const consoleLogger: Logger = {
  info: (entry) => console.log(line('info', entry)),
  error: (entry) => console.error(line('error', entry)),
};

export const silentLogger: Logger = { info: () => undefined, error: () => undefined };
