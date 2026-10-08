import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DEFAULT_DB_PATH = fileURLToPath(new URL('../../data/app.db', import.meta.url));

const EnvSchema = z.object({
  // Loopback only by default: other machines must not reach a self-asserted-actor API (docs/06 S-03).
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  ALLOWED_HOSTS: z
    .string()
    .default('localhost,127.0.0.1,[::1]')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    ),
  DB_PATH: z.string().min(1).default(DEFAULT_DB_PATH),
});

export type Config = z.output<typeof EnvSchema>;

/** Fails fast at boot. The error names the offending variables but never prints their values. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((i) => String(i.path[0])))].join(', ');
    throw new Error(`Invalid configuration: ${names}`);
  }
  return result.data;
}
