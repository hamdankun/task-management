import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API_PORT = 3101;
const WEB_PORT = 5174;
// One throwaway database per run, shared by the main process and workers via the environment.
process.env.TM_E2E_DB ??= join(mkdtempSync(join(tmpdir(), 'tm-e2e-')), 'app.db');

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false, // one shared backend: tests run in order and use unique titles
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Real API (tsx) + real Vite dev server proxying /api, exactly like `npm run dev`.
  webServer: [
    {
      command: 'npm run start -w @tm/api',
      url: `http://127.0.0.1:${API_PORT}/api/actors`,
      env: { PORT: String(API_PORT), DB_PATH: process.env.TM_E2E_DB },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `npm run dev -w @tm/web -- --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
