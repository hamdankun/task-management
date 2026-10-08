# Task log: a Trello-style task board with an audit log you can trust

This is a small full-stack app (React and Express, both in TypeScript) where a team keeps its tasks on a board, moves them through a fixed set of statuses, edits and assigns them, and can always see **who changed what, from what to what, and when**.

The point isn't the number of features. It's a change history that can't be quietly rewritten and that always agrees with each task's current state.

```
to_do ──▶ pending ──▶ in_progress ──▶ done      (exactly as the brief says: forward only, one step at a time)
```

## Run it

You need Node 22 or newer (`.nvmrc` pins 24) and npm.

```bash
npm install
npm run dev          # the API on http://127.0.0.1:3001 and the web app on http://localhost:5173
```

Open <http://localhost:5173>, pick who you are in **Acting as**, and add a task. The data is stored in `apps/api/data/app.db` (SQLite, created the first time the API starts; delete the file to start over).

| Command | What it does |
| --- | --- |
| `npm test` | Runs 412 unit and integration tests: the shared package, the API (with Supertest, the brief-conformance suite, the migration tests and a property test) and the web app (with Testing Library) |
| `npx playwright install chromium` (once), then `npm run test:e2e` | Runs 26 end-to-end tests against the real API and Vite: real mouse drag and drop, editing in the popup, stale tabs, security headers, and accessibility (axe) checks at 360, 768 and 1280 px in light and dark |
| `npm run typecheck` and `npm run lint` | Strict TypeScript in every workspace, and ESLint including the architecture and security rules |
| `npm run coverage` | Runs the tests with a coverage report (about 95% of statements) |
| `npm run build` | A production build of the web app (the API runs through `tsx`, so it has no build step) |

You can optionally set `HOST` (default `127.0.0.1`), `PORT` (3001), `ALLOWED_HOSTS` and `DB_PATH`.

## What it does

- **A board.** Four columns: To do, Pending, In progress and Done. **Drag a card to the next column** to move it. Any other drop (skipping a column or going back) is refused, with an explanation. Cards have a "Move to …" button, and the popup has a **Status dropdown** where only the next status can be chosen. Those are the alternatives for keyboard and touch users.
- **Add a task inline.** "Add a task" sits at the bottom of the To do column. Enter adds the task and keeps the box open for the next one, and Escape closes it.
- **A card popup.** Click a card to open it. You can edit the **title** in place, **assign** a user, edit the **description** (with Save and Discard changes), and read the **Activity** history.
- **An audit log.** Every change writes an entry (`created`, `status_changed`, `edited` or `deleted`) with the **actor**, what changed (the status from → to, or a field's old → new value), and the time. An edit writes one entry for each field it changed, and changing nothing writes nothing.
- The actor comes from a fixed list in a dropdown, which the brief allows (see _Accepted risks_). The assignee is picked from the same list.

## Architecture

```
apps/api         Express 5 · TypeScript · SQLite (better-sqlite3)
  domain          the pure rules: the status flow, actors, errors, the one place audit entries are created
  application     TaskService (the use cases) and the TaskStore port (plus an in-memory fake for tests)
  infrastructure  the SQLite store, the schema and config, which implement the port
  presentation    the Express app, middleware and routes
apps/web         React 19 · Vite · Tailwind v4 · shadcn/ui · @dnd-kit (drag and drop)
packages/shared  statuses, zod schemas and DTO types: the contract both sides use
e2e/             Playwright tests
docs/            the PRD, tech spec, database schema, API contract, security review, UI design and build notes
```

- **Dependencies only point inward.** `domain` and `application` never import Express or SQLite, and ESLint fails the build if they do. `index.ts` is the only place that wires the real classes together.
- **One contract for both sides.** The API checks requests with the same zod schemas the web app uses to check responses, so the two can't quietly drift apart.
- **The backend enforces, and the UI reflects.** The status flow lives in `domain` (and again as a database trigger). The UI only offers the one valid next step.
- **Reload instead of guessing.** After every change, successful or not, the UI reloads the list. A stale second tab repairs itself and says why.

The full design is in [`docs/`](docs): the PRD (`01`), tech spec (`02`), schema (`03`), API contract (`04`), folder structure (`05`), security review (`06`), UI design (`07`), and the build log (`08`).

## How this maps to the brief

| The brief says | Where it lives | How it's checked |
| --- | --- | --- |
| React and TypeScript on the front, Node, Express and TypeScript on the back | `apps/web`, `apps/api`, `packages/shared` | `npm run typecheck` (strict) |
| Create, list and delete tasks | `POST`, `GET` and `DELETE` on `/api/tasks` | The conformance tests and the end-to-end tests |
| Status only follows `to_do → pending → in_progress → done` | `assertTransition`, the `tasks_status_flow` database trigger, and a UI that only offers the next step | The conformance "Domain Validation" test, the schema tests, and the end-to-end tests with refused drags |
| Every status change writes an audit entry that answers which task, who, from → to, and when | A `status_changed` entry with `actor`, `fromStatus`, `toStatus`, `createdAt`, and the task's id and title | The conformance test for who, what and when |
| The actor comes from a predefined list, chosen in a dropdown | `GET /api/actors`, the "Acting as" dropdown, and the `X-Actor` header | The conformance and end-to-end tests |
| The audit log can never be changed or deleted, updates keep old entries, and entries show in time order | No route, no store method, database triggers, and ordering by id | The conformance tests (through the API and with raw SQL), and the property test |
| An update to the same status is idempotent | The service's no-op branch | The conformance and unit tests |
| A task's status and its audit log always agree | One transaction | The conformance "Data Consistency" test (a forced failure rolls both back) and the property test |
| Persistence | A SQLite file (`apps/api/data/app.db`) | The conformance "survives a restart" test |
| Validation in the backend | The domain and the database (UI validation is only a convenience) | The conformance and API tests |
| A per-task audit log in the UI | The **Activity** pane in the card popup | The end-to-end and component tests |
| No auth, roles or complicated UI | None built. The actor is a dropdown | See _Accepted risks_ |
| The README, the answers to the questions, and the AI note | This file, and `JAWABAN.md` | |

**About scope, honestly.** The brief asks for a simple app and says it doesn't grade by feature count. The core in the table above is small. On top of it I built, at the product owner's request, a Trello-style board with drag and drop, editing a card's title and description, assigning a user, and a Tailwind and shadcn interface. They all reuse the same audited, forward-only core (an edit or an assignment is itself audited), and each is tested, but they are extras. The core is the API, the shared package, the audit log and the activity view.

## Assumptions

1. The brief leaves a task's structure blank. A task here has an `id`, a `title`, an optional `description`, a `status`, an optional `assignee`, `createdAt` and `updatedAt`.
2. **Deleting is a soft delete.** "The audit log can never be deleted" and "delete a task" clash, so a deleted task is hidden but its history stays readable (`GET /api/tasks/:id/audit-logs`).
3. Everything that changes a task is logged, not only status changes: creating, deleting, editing and assigning (one entry for each field that changed, with the old and new value). "Who changed what" is the whole pain point, so it seemed wrong to leave those out.
4. **The status flow is exactly the brief's.** A task moves one step forward (`to_do → pending → in_progress → done`). Skipping and moving back are rejected with a `422`, and `done` is the end. Asking for the status a task already has is an **idempotent no-op**: it answers `200` with `changed: false` and writes nothing.
5. The actor is sent as an `X-Actor` header with every change, and the server checks it against the same fixed list the UI shows.
6. There's one server process and little concurrency. Timestamps are stored in UTC and shown in the viewer's local time.
7. A task has one assignee, taken from the same list of users. New tasks are always created in To do (that's where the flow starts), so only that column has the inline composer. Cards in a column are shown oldest first, so a new card appears right above the composer.
8. If two people edit the same card, the last write wins on the task, but each write records the value it actually replaced, so the history stays accurate.
9. Dragging is a convenience for mouse and touch users. The server enforces the flow regardless.
10. Beyond the brief's minimum, I also built the board, inline editing, assignment and drag and drop (see the scope note above). They sit on top of the same audited, forward-only core.

## Trade-offs

| Choice | What I gain | What it costs, and when to revisit it |
| --- | --- | --- |
| SQLite with triggers and CHECK constraints | The database itself enforces integrity, and there's nothing to operate | One writer at a time. Move to Postgres for many users or several instances |
| A synchronous store interface | Read, check and write fit in one simple transaction | It has to become async with Postgres (a mechanical change) |
| Soft delete | The history survives | The tables keep growing, so archive later |
| Optimistic *placement* only | A dropped card appears in its new column at once, and the reload after every request still decides the final state | A brief flicker back if a move is refused |
| Edits where the last write wins | No version column and no conflict dialog | Add optimistic locking if lost updates start to matter |
| No state library and no router | Less code to explain | Revisit with more views or caching needs |
| A shared package read as source, plus `tsx` | No build graph to keep in sync | No deployable API build. Add a bundler to deploy |
| A hand-written logger and five security headers | No extra dependencies | Use pino and helmet in production |

## If I had more time

Real authentication (taking the actor from a session), roles, optimistic locking for edits, comments and labels, more than one assignee, pagination for tasks and history, rate limiting and a cap on the number of tasks, hash-chaining the audit entries, a deployable build (a bundled API and a static web app behind a server that sets a CSP), CI, and more migrations as the schema grows.

## Questions from the brief

_The same four answers, in Indonesian and in more detail, are in [JAWABAN.md](JAWABAN.md)._

**How do I make sure the audit log can't be modified?** With several layers, so that one failing doesn't expose it:
1. No code path or route changes or deletes it. The store has no method that edits or removes an entry, and any `PUT`, `PATCH`, `POST` or `DELETE` to an audit URL gets a 404.
2. SQLite triggers abort any `UPDATE` or `DELETE` on `audit_logs`, even for a buggy future query.
3. Tasks are never physically deleted (a trigger plus `ON DELETE RESTRICT`), so entries can't be orphaned or cascaded away.
4. A task's change and its audit entry are written in **one transaction**, so there's never a state without an entry or an entry without a state.
5. CHECK constraints reject rows that can't be real, such as a status change from a status to itself.
6. Edits never touch earlier entries. Each entry stores the old and new value as they were, so renaming a task never changes what the history said.
7. The triggers are dropped and re-created from `schema.sql` every time the app starts, so a tampered trigger is repaired on restart, and the database file is `0600` inside a `0700` folder.

Tests cover each layer, including a property test of 1,600 random operations (status moves, edits, assignments and deletes) that checks every edit continues from the value the previous one left. **What's left:** someone who holds the database file *while the app is running* can still edit it. The next steps would be hash-chaining the rows and a database role without `UPDATE` and `DELETE`.

**What's riskiest if many people use it?** First, the actor is self-asserted, so the history records a *claim*, not a verified identity, and real auth has to come first. Second, SQLite's single writer and the synchronous driver would struggle under heavy write load. Third, concurrent edits are last-write-wins. Fourth, the task list and the history aren't paginated, and nothing limits how many tasks one person can create.

**What would I refactor first in a big system, and why?** The storage and the identity. I'd replace `SqliteTaskStore` with an async Postgres store (the interface already isolates it) and take the actor from the signed-in session. Both protect the product's core promise, a history you can trust. After that, pagination, and splitting the audit log into its own module with an outbox for other consumers.

## Accepted risks (by design, because the brief says "no auth, no roles")

- The actor is self-asserted. Any user can act as any other, and any actor can change or delete any task.
- There's no TLS (it's plain HTTP on localhost) and no encryption at rest.
- There's no rate limiting and no cap on how many tasks can be created.

Some protections are in place all the same: the server only listens on the loopback address and accepts an exact list of `Host` names (a defence against DNS rebinding); there's no CORS (a JSON content type plus the custom `X-Actor` header forces a preflight that fails); the input schemas are strict; SQL is parameterised only (and lint enforces it); the UI only renders text (lint bans anything that could inject HTML); errors and logs never repeat input or internals; and requests are limited in size and time. The threat model and all 31 findings are in [`docs/06-security-review.md`](docs/06-security-review.md).

## How AI was used, and how I checked it

I used Claude Code. It helped me analyse the brief; draft the PRD, tech spec, schema, API contract, security review and UI design; scaffold the monorepo; and write the implementation and the tests. The product decisions were mine (the board, the actor list, soft delete, a forward-only flow). I treated everything AI produced as unproven until I had checked it:

- **I compared the code with the plan.** The documents in `docs/` were written and reviewed several times before I built anything, including a round just for security. Later I compared the finished code against the PRD, the tech spec, the API contract and the database schema, and fixed what didn't match. That found stale user stories and file lists in the docs, a stray `cn` package the shadcn CLI had installed by mistake, an unused component, and a missing coverage script. Every deviation I found while building is listed in [`docs/08-implementation-plan.md`](docs/08-implementation-plan.md).
- **I ran things instead of reading them.** I ran the schema's SQL against a real SQLite and tried to break each rule. That found a real bug: a `CHECK` passes when its value is `NULL`, so a `created` row with no `to_status` would have been accepted.
- **I made sure the tests can fail.** I deliberately broke core rules (the idempotent branch, the transition check, the append-only trigger, the assignee check, the edit constraints) and confirmed the tests failed each time.
- **I tested the real thing.** Smoke-testing the actual server found a logging bug the unit tests had missed (routed requests logged the path `/`). Playwright drives real mouse drags (valid, refused and on done cards), editing in the popup and stale tabs, and runs accessibility checks (axe) in light and dark at 360, 768 and 1280 px. A migration test takes the real v1 schema with data through the upgrade, and an existing development database was upgraded in place by the app when it started.
- **I checked the dependencies.** I looked up versions on npm, and I resolved (instead of ignoring) a version conflict (TypeScript 7 against `typescript-eslint`) and a security advisory (`concurrently` pulling in `shell-quote`). I also reviewed and fixed the code the shadcn CLI generated.
- **I audited the result against the brief.** A conformance suite (`apps/api/src/integration/assessment.conformance.test.ts`) turns each clause of the brief into a test against the real API and database. That audit found one thing that went against the brief, a way to move a task backward, and I removed it.
- **I understand what's in here.** The code is deliberately small, and the reasoning behind each decision is written down in the docs, so I can explain every file.
