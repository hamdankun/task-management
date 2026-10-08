import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The browser only ever talks to relative /api URLs: same origin via this proxy, so no CORS.
// changeOrigin stays false so the API's Host allowlist sees the real browser host.
const apiTarget = process.env.API_URL ?? 'http://127.0.0.1:3001';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { proxy: { '/api': { target: apiTarget, changeOrigin: false } } },
  test: {
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    env: { TZ: 'UTC' },
    css: false,
  },
});
