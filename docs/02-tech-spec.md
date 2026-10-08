# 02 — Technical specification

How the app is built and why. It ties back to the [PRD](01-PRD.md) (the FR, BR and IV ids), the [schema](03-database-schema.md), the [API contract](04-api-contract.md) and the [folder structure](05-folder-structure.md).

## 1. Stack

Versions were checked on npm on 2026-10-08. Use `^` ranges, and run `npm view <package> version` before bumping anything.

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 24 (`engines: >=22`) | `better-sqlite3` 13 needs Node 22 or newer |
| Monorepo | npm 11 workspaces | No extra tooling. Turborepo or Nx would be overkill for three packages |
| Language | TypeScript **~6.0.3**, `strict`, ESM (`"type": "module"`) | Required. Pinned below 7 because `typescript-eslint` 8 doesn't support TypeScript 7 yet |
| Shared code | `packages/shared` (TypeScript plus zod 4.6) | One source of truth for statuses, the flow rule, schemas and DTO types |
| API | Express 5.2 with `@types/express` 5 | Required. Express 5 passes thrown and async errors to the error middleware by itself |
| Database | SQLite through `better-sqlite3` 13 | Real transactions and triggers; a synchronous API |
| Web | React 19.3, Vite 8, `@vitejs/plugin-react` 6 | Required. No state library |
| Board | `@dnd-kit/core` 6.3 | Pointer and touch drag and drop. It's mature, works with React 19 and is small (the newer `@dnd-kit/react` is still 0.x). Keyboard and screen-reader users move cards with buttons instead of keyboard dragging |
| UI | Tailwind CSS 4.3 (`@tailwindcss/vite`, no config file) and shadcn/ui (CLI 4.21, `radix-ui`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`, `sonner`), with self-hosted fonts `@fontsource-variable/source-serif-4` and `@fontsource-variable/schibsted-grotesk` | The client's choice. The design is in [07](07-ui-design.md). shadcn components are source files we own |
| Tests | Vitest 5, Supertest 7, Testing Library (`react` 16, `jest-dom` 7, `user-event` 14), jsdom 30 | One test runner everywhere |
| Dev tools | `tsx` 4, ESLint 10 (flat config) with `typescript-eslint` 8, Prettier 3.9, Playwright 1.64 with `@axe-core/playwright` | `scripts/dev.mjs` starts the API and the web app together. I dropped `concurrently` because its `shell-quote` dependency has an open security advisory |

A few notes:
- After scaffolding, check right away that the TypeScript, Vite and Vitest combination works (`npm run typecheck && npm test`). If a plugin lags behind, pin the last version that works and write it down here.
- `better-sqlite3` 13 ships no types, so `@types/better-sqlite3` (9.x) is installed.
- Deliberately not used: an ORM, helmet, pino, TanStack Query, a router, a form library, a dark-mode toggle, Docker.

### 1.1 How the packages fit together

- `@tm/shared` is a **source package**. Its `package.json` points `exports` at `src/index.ts`, and Vite, Vitest and `tsx` all read TypeScript directly, so there's no build step to keep in sync.
- The API runs through `tsx` both in development and for `start`, so no JavaScript is emitted. `typecheck` is `tsc --noEmit` in each workspace, and the web `build` is `vite build`.
- The limit of this: there is no compiled API artefact. If this were ever deployed, bundle it with `tsup` or `esbuild`, or use Node's built-in type stripping. Deployment is out of scope; the README says development mode is the supported way to run it.
- The root `tsconfig.base.json` turns on `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`, uses `moduleResolution: "bundler"` and targets ES2023.
- Vitest uses one root config with `projects`: `shared` (node), `api` (node) and `web` (jsdom plus the `jest-dom` setup). `npm test` runs all of them.

## 2. Architecture

The API is layered, and dependencies only point inward.

```
presentation   (Express app, routes, middleware, zod parsing, mapping to HTTP)
     ↓
application    (TaskService use cases; depends on the TaskStore port, a Clock and an id generator)
     ↓
domain         (pure rules: actors, assertTransition, errors, the audit-log factory)  ← uses status from @tm/shared
     ↑ implements the port
infrastructure (SqliteTaskStore, database bootstrap, config)
```

- `domain` and `application` never import `express`, `better-sqlite3` or `node:fs`. That's what lets them be tested with an in-memory fake store.
- The composition root, `index.ts`, wires everything: `loadConfig` → `openDb` → `SqliteTaskStore` → `TaskService(store, clock, newId)` → `createApp({ service, logger, allowedHosts })` → `listen`. Dependencies are passed in as plain arguments; there's no container.

### 2.1 Types shared across layers

`Task`, `AuditLog` and `Status` come from `@tm/shared`; they are the public shapes. The store converts SQL rows (snake_case, with `deleted_at`) into them, and `deletedAt` never leaves the infrastructure layer.

```ts
type NewAuditLog = Omit<AuditLog, 'id'>;   // the database assigns the id
```

### 2.2 The storage port (`application/ports.ts`)

```ts
interface TaskStore {
  list(): Task[];                                   // active tasks only, newest first, then by id
  get(id: string): Task | undefined;                // active only
  exists(id: string): boolean;                      // true even if the task is soft-deleted
  insert(task: Task, log: NewAuditLog): void;
  updateStatus(id: string, status: Status, updatedAt: string, log: NewAuditLog): AuditLog;
  /** Writes the full resulting details (not a diff, so the SQL stays static) plus one log per changed field, atomically. */
  updateDetails(id: string, next: Pick<Task, 'title' | 'description' | 'assignee'>, updatedAt: string, logs: NewAuditLog[]): AuditLog[];
  softDelete(id: string, deletedAt: string, log: NewAuditLog): void;
  listLogs(taskId: string): AuditLog[];             // oldest first; includes deleted tasks
  transaction<T>(fn: () => T): T;                   // a write transaction (BEGIN IMMEDIATE)
}
interface Clock { now(): string }                   // ISO-8601 UTC with milliseconds
type IdGen = () => string;                          // uuid v4
```

Every implementation has to honour this contract, and one shared test suite checks both the fake store and the SQLite store against it:

1. Each write saves the task change **and** its audit entry atomically, even when it's called outside `transaction()`. (The SQLite version wraps each write in a nested transaction, which SQLite turns into a savepoint.)
2. `updateStatus`, `updateDetails` and `softDelete` throw if no row was changed (the task is missing or deleted). That's a safety net, not the main check.
3. Audit entries are never changed or removed. There is simply no method that could.

**An honest limitation:** the port is *synchronous* because `better-sqlite3` is. Moving to Postgres would mean making every method return a `Promise` and changing `transaction` to take an async function. The service and route changes are mechanical (add `await`), but they're real. I chose this on purpose: an async port in front of a synchronous driver adds ceremony and can't hold a transaction safely across an `await`.

### 2.3 Use cases (`application/task-service.ts`)

Every method that changes something takes the actor as a plain string and calls `assertActor` first (rule BR-6 / IV-6). That way the rule doesn't depend on the HTTP layer.

| Use case | What it does |
|---|---|
| `createTask(actor, input)` | Checks the actor, takes `now` from the clock, builds the task (status `to_do`) and a `created` entry with `buildLog`, saves both with `store.insert`, and returns the task |
| `changeStatus(actor, id, target)` | Checks the actor, then inside one transaction: loads the task (or throws not-found); if it already has `target`, returns `{ changed: false, auditLog: null }`; otherwise runs `assertTransition`, builds a `status_changed` entry, calls `store.updateStatus` and returns the new task with the saved entry |
| `updateTask(actor, id, patch)` | Checks the actor, and checks the assignee if one is given. Inside a transaction it loads the task and works out which of title, description and assignee really differ from the patch. If none do, it returns `{ changed: false, auditLogs: [] }` and **writes nothing**. Otherwise it builds one `edited` entry per changed field (all with the same `now`) and calls `store.updateDetails` |
| `deleteTask(actor, id)` | Checks the actor, then inside a transaction loads the task (or throws not-found) and calls `softDelete` with a `deleted` entry. The entry records the status the task had, and the store sets `deleted_at` and `updated_at` to the same `now` |
| `listTasks()` | `store.list()` |
| `getTask(id)` | `store.get(id)`, or not-found |
| `listAuditLogs(id)` | The entries if the task exists (even if deleted), not-found otherwise |
| `listActors()` | The `ACTORS` list |

Why `changeStatus` uses a transaction: the read, the check and the write have to be a single unit, so two requests can't both pass the check. `BEGIN IMMEDIATE` takes the write lock up front. With the synchronous driver nothing can sneak in between the read and the write inside one process anyway, so the transaction is really there for rollback and to protect against a second process.

`buildLog` (in the domain) is the **only** place an audit entry object is created, so its shape rules aren't repeated in three places. The same `now` is used for the task's `updatedAt` and the entry's `createdAt`, so they match exactly.

### 2.4 The domain

```ts
// @tm/shared/status.ts
export const STATUSES = ['to_do', 'pending', 'in_progress', 'done'] as const;
export type Status = typeof STATUSES[number];
export const nextStatus = (s: Status): Status | null => STATUSES[STATUSES.indexOf(s) + 1] ?? null;

// api/domain/transitions.ts
assertTransition(from, to): void   // throws InvalidTransitionError{from, to, allowed: nextStatus(from)} unless to === nextStatus(from)

// api/domain/actors.ts
export const ACTORS = ['john.doe', 'jane.smith', 'budi.santoso', 'siti.rahma'] as const;
assertActor(a: string): asserts a is Actor        // throws InvalidActorError
assertAssignee(a: string): asserts a is Actor     // throws a validation error naming the field, never the value
```

`nextStatus` lives in `shared` because the UI uses it too: for the card's "Move to" button, for the one enabled option in the Status dropdown and for the drop rule. The UI only offers the valid action; the **backend still enforces it**. `ACTORS` stays on the server and the UI reads it from `GET /api/actors` (FR-12), so there is one list and nothing to keep in sync.

Errors (`domain/errors.ts`) are a small base class `AppError { code, httpStatus, details? }` plus `ValidationError`, `InvalidActorError`, `ForbiddenHostError`, `TaskNotFoundError`, `InvalidTransitionError` and `RouteNotFoundError`. Classes are used only here, because each error carries a code.

## 3. The HTTP layer

### 3.1 The request pipeline (the order matters)

1. `requestId` creates a `crypto.randomUUID()`, stores it on the response and sends it back as `X-Request-Id`. **An `X-Request-Id` sent by the client is never trusted or reused** (it could be used to forge log lines).
2. `requestLogger` writes one **JSON line** per request when it finishes: `{ id, method, path, status, ms }`. `JSON.stringify` escapes control characters, so nobody can inject fake log lines. The path is cut to 200 characters, and bodies and headers are never logged. The logger is passed in and is silent in tests. It runs this early so requests rejected for their `Host` are logged too.
3. `securityHeaders` sets the headers listed in doc 04, section 1 (five of them, written by hand; `helmet` would be overkill for an API that only returns JSON), including `Cache-Control: no-store`. They're fixed values, so this runs before the guard and **every** response, even a 403 or 404, carries them.
4. `hostGuard` requires `req.hostname` (without the port) to exactly match an entry of `ALLOWED_HOSTS`; otherwise it fails with `FORBIDDEN_HOST` (403). There's no wildcard or suffix matching. It runs before anything routes or parses a body.
5. `express.json({ limit: '10kb' })`.
6. The routes under `/api`.
7. `notFound` throws `RouteNotFoundError` for any unknown route or method, including attempts to change audit entries.
8. `errorHandler`, the four-argument kind.

### 3.2 Routes (thin: parse, call the service, shape the response)

| Route | Parses | Calls |
|---|---|---|
| `GET /api/actors` | nothing | `listActors` |
| `GET /api/tasks` | nothing | `listTasks` |
| `POST /api/tasks` | actor header; body against `CreateTaskSchema` | `createTask` |
| `GET /api/tasks/:id` | id | `getTask` |
| `PUT /api/tasks/:id/status` | actor; id; body against `ChangeStatusSchema` | `changeStatus` |
| `PATCH /api/tasks/:id` | actor; id; body against `UpdateTaskSchema` | `updateTask` |
| `DELETE /api/tasks/:id` | actor; id | `deleteTask`, answering 204 |
| `GET /api/tasks/:id/audit-logs` | id | `listAuditLogs` |

`getTask` exists on the service so routes never touch the store directly.

- **The actor.** For POST, PUT, PATCH and DELETE the route calls `assertActor(req.get('x-actor') ?? '')` **first**. That keeps the documented order of checks, and a caller who isn't identified learns nothing about ids or bodies. The service asserts it again, so no other entry point can skip the rule. Duplicate `X-Actor` headers arrive joined with a comma and fail the exact match.
- **Order of checks:** host, then actor header, then id format, then body, then whether the task exists, then the transition. A malformed id is a 404 *before* the body is looked at. A well-formed id that doesn't exist, with a bad body, is a 400.
- **Ids.** If `z.uuid()` fails the answer is 404, not 400, because a malformed id simply doesn't name any task.
- **Input is cleaned inside the schemas.** `CreateTaskSchema` trims the title; it also trims the description and turns an empty one into `null`. Schemas are `.strict()`, so unknown keys give a 400.
- **A successful `POST`** sets `Location: /api/tasks/{id}`.
- **Bodies** are parsed with `schema.safeParse`. A failure becomes a `ValidationError` whose `details` are the field errors. A missing body or the wrong content type leaves `req.body` undefined, which takes the same path to a 400.
- **Responses** aren't validated on the server (they're our own data). The client validates them (section 5).

### 3.3 Errors

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "…", "details": {…} } }
```

| Code | HTTP | When |
|---|---|---|
| VALIDATION_ERROR | 400 | A schema failure, malformed JSON (`entity.parse.failed`) or a body that's too large (`entity.too.large`) |
| INVALID_ACTOR | 400 | A missing or unknown `X-Actor` on a change (the message never repeats the value) |
| FORBIDDEN_HOST | 403 | A `Host` that isn't in `ALLOWED_HOSTS` |
| TASK_NOT_FOUND | 404 | An unknown, malformed or soft-deleted id |
| ROUTE_NOT_FOUND | 404 | An unknown route or method |
| INVALID_TRANSITION | 422 | A skip or a move back |
| INTERNAL_ERROR | 500 | Anything else, with a generic message and the `requestId`; the full error is logged on the server |

The `errorHandler` turns an `AppError` into its own status and code. Errors from the body parser become `VALIDATION_ERROR` with a **fixed** message ("Invalid JSON body" or "Request body too large"), never the parser's own text, which can quote what the client sent. Everything else is logged with its stack and answered with a 500. A stack trace or SQL never reaches the client.

## 4. Infrastructure

### 4.1 Config (`infrastructure/config.ts`)

- `HOST`: defaults to `127.0.0.1` (loopback only, never `0.0.0.0` by default).
- `PORT`: defaults to 3001.
- `ALLOWED_HOSTS`: a comma-separated list, defaulting to `localhost,127.0.0.1,[::1]`.
- `DB_PATH`: defaults to `apps/api/data/app.db`, resolved relative to the source file so it doesn't depend on where you start the server. `:memory:` is allowed.

None of these is a secret, and the loader never prints raw environment values. They're parsed once with zod, and an invalid value stops the server at boot with a clear message.

### 4.2 Database bootstrap (`infrastructure/db.ts`)

1. For a file database: call `process.umask(0o077)` **before** anything is created (so the folder, the database and the `-wal` and `-shm` files are never readable by others, even briefly), create the folder with mode `0o700`, and afterwards check that the file mode is `0600`. This is POSIX only and skipped on Windows.
2. Open the database. Turn on `journal_mode = WAL` (not for `:memory:`), `foreign_keys = ON` (and **check** that it reads back as 1), `busy_timeout = 5000` and `trusted_schema = OFF`.
3. In **one transaction**: run every migration newer than the database's `user_version` (see doc 03, section 8), then apply `schema.sql`: tables and indexes if missing, and every trigger dropped and re-created, so a tampered trigger is repaired. A database newer than the app is refused. If anything fails the transaction rolls back, the error is logged and the process exits non-zero. The server never starts listening with a trigger missing. `db.exec` is only used for these static files.
4. In `index.ts`, on `SIGINT` or `SIGTERM`: close the HTTP server, then the database.

### 4.3 `SqliteTaskStore`

- Prepared statements are created once, in the constructor, and are **parameterised only**.
- Rows are converted to the DTOs in one place.
- `transaction(fn)` is `db.transaction(fn).immediate()`.
- `updateStatus` runs `UPDATE … WHERE id = ? AND deleted_at IS NULL`, checks that exactly one row changed, then runs `INSERT INTO audit_logs … RETURNING *` so the saved entry (with its id) comes back.

## 5. The frontend

- **`api/client.ts`** is a typed fetch wrapper. It adds `X-Actor` to changes and `Content-Type: application/json` when there's a body. It validates every successful response with the shared zod schemas (so the two sides can't drift apart silently). For an error response it parses the error shape and throws `ApiError { code, message, status }`; a network failure becomes `ApiError { code: 'NETWORK_ERROR' }`. It accepts an `AbortSignal`, and `fetch` can be injected for tests.
- **Components.** `App` renders `ActorSelect`, `ErrorBanner` and the `Board`. The `Board` sets up `DndContext` and renders four `BoardColumn`s (each a drop target; the first also holds the `InlineComposer`), each with its `TaskCard`s (draggable; clicking opens the popup; there's a "Move to" icon button and a `ConfirmDelete`). `Board` also renders the `TaskDialog` popup, made of `StatusSelect`, `InlineTitle`, `AssigneeField`, `DescriptionEditor` and the activity pane (`AuditLogPanel`, which renders `AuditLogEntry` items). `TaskCardPreview` is what you see while dragging, and `lib/board.ts` has `dropDecision`, the pure drop rule. These are built from shadcn primitives (`button`, `input`, `textarea`, `label`, `badge`, `alert`, `alert-dialog`, `dialog`, `skeleton`, `sonner`). The look, wording, states and accessibility rules are in [07](07-ui-design.md).
- **One vocabulary for statuses.** `STATUS_LABEL` in `web/src/lib/status.ts` maps the raw values to the words people see ("In progress"). The API and database keep the raw values, and so does `data-status`.
- **Drag and drop.** A `MouseSensor` with a 6 px activation distance (so clicks on a card's buttons still work) and a `TouchSensor` with a 200 ms press-and-hold (so a swipe still scrolls). Only the columns are drop targets, and **the column under the pointer wins**; how much the preview overlaps a column is just a fallback. `dropDecision(task, column)` returns `move`, `stay` or `rejected(message)`. A rejected drop never reaches the server (which would answer 422 anyway). No drag attributes or roles are put on the card: keyboard and screen-reader users open it with the title button and move it with "Move to" or the popup's Status dropdown. After a drop the card shows in its new column at once (the `moving` map in `useTaskBoard`; this is only about *where it is drawn*), while the request runs. The reload that follows every request, whether it worked or not, is still what decides the final state.
- **Editing in the popup.** `InlineTitle` saves on Enter or when you leave the field, and cancels on Escape. `DescriptionEditor` has explicit Save and Discard changes buttons and shows an "Unsaved changes" hint. Both mark themselves with `data-editing`, which makes the dialog ignore Escape so it cancels the edit instead of closing the popup. Saves go through `useTaskBoard.update`: validation errors appear next to the field, other errors in the banner. The activity pane reloads when the task's `updatedAt` changes.
- **Confirming a delete** uses the shadcn `AlertDialog`, not `window.confirm`.
- **Feedback:** success shows a Sonner toast, and errors show an `Alert` banner or an inline message. The text for each error code is in 07, section 6.
- **State, with no library:**
  - `useActor()` keeps the chosen actor in `localStorage` (inside a try/catch, since storage can throw). The saved name is only used after it's matched against `/api/actors`.
  - `useTaskBoard()` holds `{ tasks, phase, loadError, actionError, pending, moving }` and the actions `createTask`, `move`, `update` and `remove`. Each action marks the task as pending, calls the API and then **reloads the list**, whether it worked or failed, so a stale tab repairs itself.
  - Out-of-order responses are handled by aborting the previous request with an `AbortController` and ignoring results from aborted ones.
- **Protection while saving.** A saving card is marked busy and can't be dragged or clicked again. The composer and the popup use `readOnly` and `aria-disabled` instead of `disabled`, because a disabled control throws away keyboard focus.
- **Formatting.** `lib/formatAuditLog.ts` is a pure function with its own tests. It's the single source of the full sentence for each entry, which is used as the entry's accessible text and in the tests. The visible entry lays out the same facts more compactly. Times are shown in local time as `YYYY-MM-DD HH:mm`, with the exact UTC value as a tooltip.
- **Security.** Text is only ever rendered as React text. `dangerouslySetInnerHTML`, `innerHTML` and `eval` are banned by ESLint. No URL is built from data, and `localStorage` is treated as untrusted. The UI says plainly that the actor choice is "Not authenticated".
- **Dev wiring.** The Vite proxy forwards `/api` to `http://127.0.0.1:3001` (or `API_URL`). The client only ever uses relative `/api` URLs, so there is no CORS and no configuration.

## 6. Why the audit log can be trusted (the answer to README Q1)

Several layers, so one failing doesn't expose the log:

1. **No code path** changes or deletes entries. The store has no such method, and no such route exists (an unknown route is a 404).
2. **Database triggers** abort any `UPDATE` or `DELETE` on `audit_logs`, even for a buggy future query.
3. **Soft delete is enforced by the database:** the `tasks_no_delete` trigger (which doesn't depend on the foreign-key setting), plus the foreign key with `ON DELETE RESTRICT`. `tasks_frozen_after_delete` blocks edits and un-deleting, and `tasks_status_flow` repeats the transition rule so a bad query can't corrupt state. That duplication is deliberate and tested.
4. **One transaction** for the change and its entry: no state without an entry and no entry without a state.
5. **CHECK constraints** reject impossible rows (for example a status change from a status to itself).
6. **Tests cover each layer:** the store contract suite, the trigger tests and the property test.
7. **What's left:** anyone with raw access to the database file could drop the triggers or edit the file. The next steps would be hash-chaining the rows, a database role without `UPDATE` and `DELETE`, or copying the log to write-once storage. I left those out on purpose.

## 7. Test plan

The principle: test each behaviour at the cheapest layer that can prove it, and never mock the thing you're testing.

| Layer | Environment | What it covers |
|---|---|---|
| shared | unit | `nextStatus` for all four statuses (including `done` giving `null`); the zod schemas (title trimming and length, description length, unknown status rejected, unknown keys rejected, hostile characters rejected, the update schema's "absent means unchanged") |
| domain | unit | `assertTransition` allows the three forward steps and rejects skips and moving back; `assertActor` and `assertAssignee` with valid, unknown and empty values; the shape of each audit entry from `buildLog` |
| service | unit, with the fake store and a fixed clock and ids | Create writes the task and its entry; the three valid moves; the same status gives `changed: false` and no new entry; a skip or a move back gives an error and writes nothing; not-found; changes after a delete are not-found; a delete keeps its history; edits write one entry per changed field and nothing when nothing changed; a bad actor or assignee is rejected without writing; **a store failure halfway leaves nothing saved** |
| store contract | one suite run against **the fake and SQLite `:memory:`** | The task and its entry are saved together; missing or deleted tasks throw; ordering; `exists` stays true after a delete; entries are in id order; transactions roll back |
| SQLite-specific (`schema.test.ts`) | `:memory:`, raw SQL | Every item in doc 03, section 9: the triggers, the CHECKs, the foreign key, the pragmas, applying the schema twice, tampered triggers being restored, file permissions |
| migrations (`migration.test.ts`) | `:memory:` and a real file | A v1 database with data upgrades to v2 with nothing lost; failure rolls back; a newer database is refused |
| property (`integration/consistency.property.test.ts`) | `:memory:`, a seeded random generator | Four seeds of 400 random operations (create, move, edit, assign, delete). After each: a task's status matches its last entry, entries are in id order, each move is exactly one step forward, each edit continues from the previous value (PRD M2, M7, IV-2, IV-4, IV-7, IV-9) |
| API | Supertest on `createApp`, real SQLite | Every endpoint's success and every error path, the order of checks, idempotency, stale-tab cases, entries after a delete, `X-Request-Id`, a generic 500 body |
| security (`presentation/security.test.ts`) | Supertest and log capture | A wrong `Host` gives 403 *with* the headers, a request id and a log line; no CORS headers; text and form bodies rejected; the actor only from the header; SQL and script payloads stay inert; `__proto__` and unknown keys rejected; control and bidi characters rejected; errors never echo input; logs can't be forged |
| web | Testing Library and user-event, with an in-memory fake of the API | Columns and counts, the composer, the popup (editing, assigning, the Status dropdown, Escape rules), busy states, optimistic placement, errors and empty states. Real drag and drop is left to Playwright because jsdom has no layout |
| conformance (`integration/assessment.conformance.test.ts`) | Supertest, real SQLite | The assessment brief clause by clause (17 tests): the CRUD, the status order, the audit log answering who, what and when, immutability through the API and through raw SQL, chronological order, idempotency, consistency on failure, persistence across a restart, validation in the backend |
| end-to-end | Playwright (Chromium) against the real API and Vite, with a temporary database | Real mouse drag and drop (valid, refused, done cards), the inline composer, popup editing and attribution, Escape and Discard rules, click versus drag, a stale tab, hostile text, security headers, and axe accessibility checks at 360, 768 and 1280 px in light and dark |

Quality gates: `npm test`, `npm run typecheck` and `npm run lint` must pass from a clean clone. `npm run coverage` reports coverage (about 95% of statements) but isn't a gate. The real gate is the list of rules IV-1 to IV-9.

## 8. Config, scripts and running it

- Root scripts: `dev` (`node scripts/dev.mjs`, which starts the API and the web app), `test`, `test:watch`, `test:e2e`, `coverage`, `typecheck`, `lint`, `format`, `build` (web only) and `start` (the API through `tsx`).
- Ports: the API on 3001 and the web app (Vite) on 5173. The database file is `apps/api/data/app.db`, which git ignores.
- Hardening (the full reasoning is in [06](06-security-review.md)): loopback bind plus `hostGuard`; a 10 kb body limit; timeouts of `requestTimeout=10_000`, `headersTimeout=10_000` and `keepAliveTimeout=5_000`; no CORS; parameterised SQL only (enforced by lint); strict schemas; the security headers; `x-powered-by` and `etag` turned off; `trust proxy` left `false`; request ids; JSON logs; generic 500s; a graceful shutdown. Never start Vite with `--host`.
- Schema changes: `schema.sql` always describes the latest shape and is applied on every start. A database from an older version is first upgraded by the numbered files in `migrations/` (see doc 03, section 8).
- There is no seed data; the app starts empty.
- It assumes a single process owns the database file.

## 9. Trade-offs

| Choice | What it gives | What it costs, and when to revisit |
|---|---|---|
| SQLite with triggers | Integrity you can prove, no operations work | One writer. Move to Postgres for many users or several instances |
| A synchronous store port | Simple, safe transactions | The port has to become async for Postgres (a mechanical change) |
| Soft delete | History survives | The tables grow. Archive or partition later |
| The actor from a dropdown and a header | Meets the brief | Can be faked by design. Real auth should take the actor from a session |
| `assertActor` in the service as well | No entry point can skip the rule | A little duplication with the header check |
| A shared package read as source, with `tsx` | No build graph to maintain | No deployable API build. Add a bundler to deploy |
| Reloading after every change, no state library | Less code, always correct | Extra requests. Revisit with many views or caching needs |
| Optimistic *placement* only | A dropped card appears in its new column immediately | A brief flicker back when a move is refused |
| Edits: the last write wins | No version column or conflict dialog | Add optimistic locking if lost updates matter |
| A hand-written logger | No dependency | No log levels or redaction. Use pino in production |

## 10. What breaks first when many people use it (README Q2 and Q3)

- **Riskiest:** (1) the actor isn't authenticated, so the history's trustworthiness is limited; (2) SQLite's single writer and the synchronous driver blocking the event loop; (3) the task list and the audit lists are unpaginated; (4) the audit table keeps growing.
- **What to refactor first:** replace the store (an async port in front of Postgres) and add auth so the actor comes from the session. Both protect the product's core promise. Pagination comes next. Later the audit log could become its own module with an outbox for other consumers.

## 11. Security

The threat model, the 30 findings, the controls and the remaining risks are in [06-security-review.md](06-security-review.md). Requirements SR-1 to SR-11 are binding on the implementation. The accepted limitations (a self-asserted actor, no authorization, no TLS, no rate limit) must be stated in the README, and they are.

## 12. AI usage (for the README)

Say which parts AI helped draft (docs, boilerplate, tests) and how each was checked: tests written against the PRD rules, deliberately breaking a rule or trigger to see a test fail, running the stale-tab scenarios by hand, and the author reading every line.

## 13. Which part of this spec covers which requirement

| PRD | Where in this spec |
|---|---|
| FR-1 to FR-4, FR-7 | 2.3, 3.2 |
| FR-5, FR-6, FR-11 | 2.3 (`buildLog` and the no-op branch) |
| FR-8, BR-3, IV-3 | 6 |
| FR-9, FR-10, FR-12, BR-6 | 2.4, 3.2, 5 |
| BR-4, IV-4 | 2.2, 2.3, 4.3 |
| BR-5, IV-5, IV-8 | 2.3, 6 |
| BR-7 | the shared schemas (7) and the CHECK constraints |
| M2, IV-7 | the property test in 7 |
| SR-1 to SR-11 | 3.1, 4, 5, 8, 11, and doc 06 |
