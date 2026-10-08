import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

// Layer boundaries and security sinks are enforced here, not just documented (docs/05 §5, docs/06).
const noFramework = ['express', 'better-sqlite3', 'node:fs', 'fs'];
const restrict = (names, groups, message) => ({
  'no-restricted-imports': [
    'error',
    { paths: names.map((name) => ({ name, message })), patterns: [{ group: groups, message }] },
  ],
});

const dynamicSql = [
  {
    selector:
      'CallExpression[callee.property.name=/^(prepare|exec)$/] > TemplateLiteral[expressions.length>0]',
    message: 'SQL must be a static string with bound parameters (docs/06 S-04).',
  },
  {
    selector: 'CallExpression[callee.property.name=/^(prepare|exec)$/] > BinaryExpression',
    message: 'SQL must be a static string with bound parameters (docs/06 S-04).',
  },
];

const htmlSinks = [
  {
    selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
    message: 'Render data as React text only (docs/06 S-05).',
  },
  {
    selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
    message: 'No HTML injection sinks (docs/06 S-05).',
  },
  { selector: "CallExpression[callee.name='eval']", message: 'eval is banned.' },
  { selector: "NewExpression[callee.name='Function']", message: 'new Function is banned.' },
];

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },

  // node-run tooling files
  {
    files: ['scripts/**', 'e2e/**', '*.config.{js,ts}'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },

  // api: no frontend, no dynamic SQL
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      ...restrict(['react', 'react-dom'], ['@tm/web', '@tm/web/*'], 'api must not depend on web.'),
      'no-restricted-syntax': ['error', ...dynamicSql],
    },
  },
  // domain: pure
  {
    files: ['apps/api/src/domain/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: restrict(
      noFramework,
      ['**/application/**', '**/infrastructure/**', '**/presentation/**'],
      'domain must stay pure (docs/05 §5).',
    ),
  },
  // application: ports only
  {
    files: ['apps/api/src/application/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: restrict(
      noFramework,
      ['**/infrastructure/**', '**/presentation/**'],
      'application depends on ports, not adapters (docs/05 §5).',
    ),
  },
  // presentation gets the service injected
  {
    files: ['apps/api/src/presentation/**/*.ts'],
    ignores: ['**/*.test.ts'],
    rules: restrict(
      ['better-sqlite3'],
      ['**/infrastructure/**'],
      'presentation must not reach infrastructure (docs/05 §5).',
    ),
  },
  // web: no backend, no HTML sinks
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      ...restrict(
        ['express', 'better-sqlite3'],
        ['@tm/api', '@tm/api/*'],
        'web must not depend on api.',
      ),
      'no-restricted-syntax': ['error', ...htmlSinks],
    },
  },
);
