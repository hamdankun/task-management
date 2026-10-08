# 05 — Folder structure (an npm workspaces monorepo)

This goes with the [tech spec](02-tech-spec.md), section 1.1 (how the packages are built) and section 2 (the layers).

## 1. The tree

```
task-manager/
├── package.json              # private; workspaces ["apps/*","packages/*"]; engines.node >=22; scripts (section 4)
├── package-lock.json         # committed
├── .nvmrc                    # 24
├── .gitignore                # node_modules, dist, coverage, test-results, apps/api/data/, *.db, *.db-wal, *.db-shm, *.log, .env*, .claude/settings.local.json
├── .prettierrc  .prettierignore
├── tsconfig.base.json        # strict, noUncheckedIndexedAccess, verbatimModuleSyntax, moduleResolution bundler, target ES2023
├── vitest.config.ts          # projects: shared (node), api (node), web (its own vite.config.ts, jsdom)
├── playwright.config.ts      # end-to-end: starts the API (:3101, temporary SQLite) and Vite (:5174)
├── eslint.config.js          # flat config plus the layer-boundary and security rules (section 5)
├── e2e/                      # tasks.spec.ts, visual.spec.ts (axe checks and screenshots), helpers.ts
├── scripts/dev.mjs           # runs the API and the web app together
├── CLAUDE.md                 # rules for AI assistants working in this repo
├── README.md                 # how to run it, architecture, assumptions, trade-offs, the answers, AI disclosure
├── ANSWER.md                # the brief's questions answered in Indonesian
├── assessment-context.md     # the original brief (not edited)
├── docs/                     # 00 to 08 (06 is the security review, 07 the UI design, 08 the build notes)
├── .claude/agents/           # the react-fullstack-engineer helper agent
│
├── packages/
│   └── shared/               # @tm/shared: plain TypeScript; its only runtime dependency is zod
│       ├── package.json      # "exports": "./src/index.ts" (a source package, no build)
│       ├── tsconfig.json
│       └── src/
│           ├── status.ts         # STATUSES, Status, nextStatus()
│           ├── schemas.ts        # every zod schema listed in doc 04, section 2
│           ├── types.ts          # types inferred from the schemas (Task, AuditLog, ErrorCode, ...)
│           ├── index.ts          # the package's only barrel file
│           ├── status.test.ts
│           └── schemas.test.ts
│
└── apps/
    ├── api/                  # @tm/api
    │   ├── package.json      # scripts: dev (tsx watch), start (tsx), typecheck
    │   ├── tsconfig.json
    │   ├── data/             # the SQLite files at run time (ignored by git; created on first start)
    │   └── src/
    │       ├── index.ts                  # composition root: config, database, store, service, app, listen; graceful shutdown
    │       ├── domain/
    │       │   ├── errors.ts             # AppError and its subclasses (validation, actor, host, not found, transition, route)
    │       │   ├── actors.ts             # ACTORS, assertActor(), assertAssignee()
    │       │   ├── audit-log.ts          # buildLog(): the one place audit entries are created
    │       │   ├── transitions.ts        # assertTransition()
    │       │   └── domain.test.ts
    │       ├── application/
    │       │   ├── ports.ts              # TaskStore, Clock, IdGen
    │       │   ├── task-service.ts       # the use cases
    │       │   ├── task-service.test.ts  # uses the fake store with a fixed clock and ids
    │       │   ├── fake-task-store.ts    # an in-memory TaskStore for tests, kept next to the port
    │       │   └── task-store.contract.ts# the contract suite, run against the fake AND the SQLite store
    │       ├── infrastructure/
    │       │   ├── schema.sql                  # the latest full schema (v2): tables, indexes, triggers
    │       │   ├── migrations/001-initial.sql  # the frozen v1 schema (used only by the migration test)
    │       │   ├── migrations/002-edit-and-assign.sql   # v1 to v2
    │       │   ├── config.ts  config.test.ts   # zod-parsed HOST, PORT, ALLOWED_HOSTS, DB_PATH (fails fast)
    │       │   ├── db.ts                       # opens the database, sets pragmas, migrates, applies the schema
    │       │   ├── sqlite-task-store.ts        # the only file that contains SQL (besides db.ts)
    │       │   ├── sqlite-task-store.test.ts   # the contract suite plus atomicity and injection tests
    │       │   ├── schema.test.ts              # raw-SQL tests of doc 03, section 9
    │       │   └── migration.test.ts           # a v1 database with data upgrades to v2 without losing anything
    │       ├── presentation/
    │       │   ├── app.ts                # createApp({ service, logger, allowedHosts }): the pipeline from tech spec 3.1
    │       │   ├── logger.ts             # the Logger type, a console logger and a silent logger
    │       │   ├── parse.ts              # parseId (404 if malformed), actorOf (from X-Actor only), parseBody (never echoes input)
    │       │   ├── routes/tasks.ts  routes/actors.ts
    │       │   ├── middleware/security.ts# securityHeaders and hostGuard (after requestId and the logger, before routing)
    │       │   ├── middleware/request.ts # requestId and the JSON request logger
    │       │   ├── middleware/error.ts   # notFound and errorHandler
    │       │   ├── app.test.ts           # Supertest against a real in-memory SQLite database
    │       │   └── security.test.ts      # the tests from doc 06: Host, preflight, content type, injection, headers, leaks
    │       └── integration/
    │           ├── test-app.ts                     # a real in-memory SQLite database and a fixed clock behind the real Express app
    │           ├── assessment.conformance.test.ts  # the assessment brief, clause by clause
    │           └── consistency.property.test.ts    # random sequences of operations checking the invariants
    │
    └── web/                  # @tm/web
        ├── package.json      # scripts: dev (vite), build, preview, typecheck
        ├── tsconfig.json     # DOM types, jsx react-jsx, paths "@/*" to src/*
        ├── components.json   # shadcn configuration (aliases, css path)
        ├── vite.config.ts    # the react plugin and @tailwindcss/vite; alias @/ to src; proxies /api to the API
        ├── index.html
        └── src/
            ├── main.tsx
            ├── App.tsx  App.test.tsx
            ├── vite-env.d.ts
            ├── index.css                 # Tailwind import, fonts, light and dark tokens, @theme (doc 07, sections 2 and 10)
            ├── api/client.ts  client.test.ts   # typed fetch (injectable), ApiError, X-Actor, responses checked with the shared schemas
            ├── hooks/
            │   ├── useTaskBoard.ts       # the task list and its actions; reloads after every action
            │   └── useActor.ts           # the saved actor
            ├── components/
            │   ├── ui/                   # shadcn primitives (copied in): alert, alert-dialog, badge, button, dialog, input, label, skeleton, sonner, textarea
            │   ├── ActorSelect.tsx  ErrorBanner.tsx  ConfirmDelete.tsx  StatusBadge.tsx  StatusSelect.tsx  UserAvatar.tsx
            │   ├── Board.tsx  BoardColumn.tsx  TaskCard.tsx  InlineComposer.tsx   # the board, drag and drop, adding a task inline
            │   ├── TaskDialog.tsx  InlineTitle.tsx  DescriptionEditor.tsx  AssigneeField.tsx   # the card popup
            │   └── AuditLogPanel.tsx  AuditLogEntry.tsx                          # the activity ledger
            ├── lib/
            │   ├── utils.ts              # cn() = clsx + tailwind-merge (from shadcn)
            │   ├── status.ts             # STATUS_LABEL, the words the UI uses for statuses
            │   ├── board.ts              # dropDecision: the pure drop rule
            │   ├── errorCopy.ts          # turns an error code into the message people see (doc 07, section 6)
            │   ├── formatAuditLog.ts     # the sentence for each audit entry
            │   ├── board.test.ts  lib.test.ts   # lib.test.ts covers status labels, error copy and formatAuditLog
            └── test/
                ├── setup.ts              # jest-dom matchers and the browser APIs jsdom is missing
                └── fake-api.ts           # an in-memory API behind the same interface, used by App.test.tsx
```

## 2. Dependencies per workspace

| Workspace | `dependencies` | `devDependencies` |
|---|---|---|
| root | none | `typescript`, `vitest`, `@vitest/coverage-v8`, `eslint`, `@eslint/js`, `typescript-eslint`, `prettier`, `@playwright/test`, `@axe-core/playwright` |
| `@tm/shared` | `zod` | none |
| `@tm/api` | `@tm/shared`, `express`, `better-sqlite3`, `zod` | `tsx`, `supertest`, `@types/express`, `@types/node`, `@types/supertest`, `@types/better-sqlite3` |
| `@tm/web` | `@tm/shared`, `react`, `react-dom`, `@dnd-kit/core`, `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `sonner`, `@fontsource-variable/source-serif-4`, `@fontsource-variable/schibsted-grotesk` | `vite`, `@vitejs/plugin-react`, `tailwindcss`, `@tailwindcss/vite`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `@types/react`, `@types/react-dom` |

Workspace packages depend on each other as `"@tm/shared": "*"`, which npm links to the local copy. shadcn components were added with `npx shadcn@latest add`, so the shadcn CLI isn't a dependency. Every version was looked up with `npm view` when it was added (see the tech spec, section 1).

For the supply chain: use exactly the package names listed (no look-alikes), commit the lockfile, install with `npm ci`, and run `npm audit --omit=dev` before submitting (doc 06, S-13). It's worth running a check for stray dependencies, too. The shadcn CLI once installed an unrelated package called `cn` by mistake while generating an import, and it had to be removed by hand.

## 3. Naming and style

| Thing | Convention |
|---|---|
| API files | `kebab-case.ts`, with tests as `*.test.ts` next to the code they test |
| React components | `PascalCase.tsx`, one exported component per file |
| Hooks | `useXxx.ts`, named after the hook |
| Types and interfaces | `PascalCase`, no `I` prefix |
| Constants | `UPPER_SNAKE` only for real constants (`STATUSES`, `ACTORS`) |
| Database columns | `snake_case`. JSON and TypeScript use `camelCase`, converted once in the store |
| Imports between packages | Only `@tm/shared`, through its root entry (no deep paths). Inside a package use relative imports. The exception is `apps/web`, which uses the `@/` alias because shadcn expects it |
| Exports | Named exports, no default exports (except config files that require one) |
| Test names | Sentences about behaviour, like `should reject skipping from to_do to done` |

## 4. Root scripts

| Script | What it does |
|---|---|
| `npm run dev` | Starts the API (`tsx watch`, on port 3001) and the web app (`vite`, on 5173) together, through `scripts/dev.mjs` |
| `npm test` | `vitest run` for all projects |
| `npm run test:watch` | `vitest` in watch mode |
| `npm run test:e2e` | Playwright against a freshly started API and web app |
| `npm run coverage` | `vitest run --coverage` |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` and `npm run format` | ESLint and Prettier |
| `npm run build` | `vite build` for the web app (the API has no build step) |
| `npm start` | Only the API, through `tsx` (the README says development mode is the supported way to run it) |

## 5. Layout rules (enforced by tooling, not just written down)

1. Dependencies point one way: `presentation → application → domain`, and `infrastructure` depends on the application's ports. The composition root, `index.ts`, may import anything.
2. ESLint's `no-restricted-imports` makes `npm run lint` fail if a rule is broken:
   - `domain/**` and `application/**` may not use `express`, `better-sqlite3` or `node:fs`, and may not import from `infrastructure/**` or `presentation/**`.
   - `domain/**` may not import from `application/**` either.
   - `presentation/**` may not use `better-sqlite3` or `infrastructure/**`; it gets the service injected.
   - `apps/web/**` may not use `@tm/api` or `express`, and `apps/api/**` may not use `@tm/web` or `react`.
   - The generated files in `components/ui/**` are exempt from style rules only, never from the security rules below.
   - Security lint (`no-restricted-syntax`, without an extra plugin): in `apps/web` the `dangerouslySetInnerHTML` attribute, assigning to `innerHTML` or `outerHTML`, and `eval` or `new Function` are banned. In `apps/api` a template literal with expressions, or `+` concatenation, is banned as the argument of `.prepare()` or `.exec()`, so SQL must always be a static string.
3. Tests sit next to the code they test, except tests that cross layers, which live in `integration/`.
4. Only `sqlite-task-store.ts` and `db.ts` contain SQL or touch `better-sqlite3`. Only `domain/audit-log.ts` creates audit entries.
5. There are no `utils/`, `common/` or `helpers/` folders, and no barrel files except `packages/shared/src/index.ts`.
6. Anything both apps need (statuses, the flow, DTOs, schemas) lives in `@tm/shared`. Anything only one app needs stays in that app.

## 6. The order things were built in (each step ended with tests, typecheck and lint passing)

| # | Step | Done when |
|---|---|---|
| 1 | The root and `shared` (status and schemas) with tests; a smoke `typecheck && test` on the toolchain versions | The toolchain works and the schemas are tested |
| 2 | `api/domain` (errors, actors, transitions, buildLog) with tests | IV-1 and IV-6 are proven by unit tests |
| 3 | `application` (ports, service, fake store, contract suite) with tests | IV-2, IV-4, IV-5 and IV-8 are proven on the fake |
| 4 | `infrastructure` (schema, db, SQLite store) with contract, schema and property tests | The same contract passes on SQLite, the triggers are proven, and M2 holds |
| 5 | `presentation` with Supertest (including `security.test.ts`) | Every row of doc 04, section 4 passes, and the doc 06 tests pass |
| 6 | `web`: Tailwind and shadcn with the tokens, then the client, hooks and components, then Testing Library tests, then Playwright screenshots at 360, 768 and 1280 px in light and dark | The PRD user stories can be shown working, and the checks in doc 07, section 12 pass |
| 7 | The README, the answers, the AI disclosure, the accepted security risks, `npm audit`, the doc 06 checklist, and a final review against the PRD, section 18 | The definition of done is checked |
