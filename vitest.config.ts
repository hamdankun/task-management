import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared',
          root: 'packages/shared',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        test: { name: 'api', root: 'apps/api', environment: 'node', include: ['src/**/*.test.ts'] },
      },
      'apps/web', // its own vite.config.ts (React plugin, alias, jsdom)
    ],
  },
});
