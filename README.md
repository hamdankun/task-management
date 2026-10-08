# Task log

A small Trello-style task board (React and Express, all TypeScript) built around one idea: you should always be able to answer **who changed what, from what to what, and when**, and nobody should be able to quietly rewrite that answer.

Tasks move through four statuses, one step at a time, and every change is written to an audit log that can't be edited or deleted.

```
to_do ──▶ pending ──▶ in_progress ──▶ done      (forward only, as the brief says)
```

## Run it

You need Node 22 or newer (`.nvmrc` pins 24) and npm.

```bash
npm install
npm run dev     # API on http://127.0.0.1:3001, web app on http://localhost:5173
```

Open <http://localhost:5173>, choose who you are under **Acting as**, and add a task. Data lives in `apps/api/data/app.db`. SQLite creates it on first start, and deleting the file resets everything.

| Command | What it does |
| --- | --- |
| `npm test` | 412 unit and integration tests (shared package, API, web app) |
| `npx playwright install chromium`, then `npm run test:e2e` | 26 end-to-end tests in a real browser: drag and drop, popup editing, stale tabs, security headers, accessibility checks |
| `npm run typecheck` and `npm run lint` | Strict TypeScript, and ESLint with the architecture and security rules |
| `npm run coverage` | Tests with a coverage report (about 95% of statements) |
| `npm run build` | Production build of the web app. The API runs through `tsx`, so it needs no build |

Optional settings: `HOST` (default `127.0.0.1`), `PORT` (3001), `ALLOWED_HOSTS` and `DB_PATH`.

## What you can do

- **Move cards.** Drag a card to the next column. Skipping a column or going back is refused, and the app tells you why. There's also a "Move to …" button on each card and a Status dropdown in the popup, for keyboard and touch users.
- **Add tasks in place.** "Add a task" sits at the bottom of the To do column. Enter adds the task and keeps the box open, and Escape closes it.
- **Open a card.** Click it to edit the title and description in place, assign someone, and read the Activity history.
- **See the history.** Every change is recorded (`created`, `status_changed`, `edited`, `deleted`) with who did it, what changed and when. An edit writes one entry per field it changed, and an edit that changes nothing writes nothing.

The "who" comes from a fixed list in a dropdown, which the brief allows (see _Accepted risks_). Assignees come from the same list.

## How it's built

```
apps/api         Express 5, TypeScript, SQLite (better-sqlite3)
  domain          the pure rules: status flow, actors, errors, how audit entries are made
  application     TaskService (the use cases) and the TaskStore interface
  infrastructure  the SQLite store, schema and config
  presentation    the Express app, middleware and routes
apps/web         React 19, Vite, Tailwind v4, shadcn/ui, @dnd-kit
packages/shared  statuses, zod schemas and types used by both sides
e2e/             Playwright tests
docs/            PRD, tech spec, schema, API contract, security review, UI design, build log
```

- **Dependencies point inward.** `domain` and `application` never import Express or SQLite. ESLint fails the build if they do.
- **One contract.** The API validates requests with the same zod schemas the web app uses to validate responses, so they can't drift apart.
- **The backend decides.** The status flow lives in `domain` and again as a database trigger. The UI only offers the valid next step.
- **Reload, don't guess.** After every change the UI reloads the list. A stale second tab fixes itself and says why.

The full reasoning is in [`docs/`](docs): PRD (`01`), tech spec (`02`), schema (`03`), API contract (`04`), folder structure (`05`), security review (`06`), UI design (`07`) and the build log (`08`).

## How it maps to the brief

| The brief says | Where it lives | How it's checked |
| --- | --- | --- |
| React and TypeScript front end, Node, Express and TypeScript back end | `apps/web`, `apps/api`, `packages/shared` | `npm run typecheck` |
| Create, list and delete tasks | `POST`, `GET`, `DELETE` on `/api/tasks` | Conformance and end-to-end tests |
| Status only follows `to_do → pending → in_progress → done` | `assertTransition`, the `tasks_status_flow` trigger, a UI that offers only the next step | Conformance, schema and end-to-end tests |
| Each status change logs the task, who, from → to, and when | A `status_changed` entry with the actor, both statuses, the time, and the task's id and title | Conformance test |
| The actor comes from a predefined dropdown | `GET /api/actors`, the "Acting as" dropdown, the `X-Actor` header | Conformance and end-to-end tests |
| The audit log can't be changed or deleted, and shows in time order | No route, no store method, database triggers, ordering by id | Conformance tests (API and raw SQL), property test |
| Updating to the same status is idempotent | The service's no-op branch | Conformance and unit tests |
| Status and audit log always agree | One transaction | Conformance test (a forced failure rolls both back), property test |
| Persistence | A SQLite file | Conformance test ("survives a restart") |
| Validation in the backend | The domain and the database | Conformance and API tests |
| A per-task audit log in the UI | The Activity pane in the card popup | End-to-end and component tests |
| No auth, roles or complex UI | None built | See _Accepted risks_ |
| README, answers, AI note | This file and `ANSWER.md` | |

**A note on scope.** The brief asks for something simple and says it doesn't grade on features. The core is small: the API, the shared package, the audit log and the activity view. On top of that, at the product owner's request, I built the board, drag and drop, inline editing, assignment and the Tailwind and shadcn interface. They reuse the same audited, forward-only core and are tested, but they're extras.

## Assumptions

1. The brief doesn't define a task, so mine has an `id`, `title`, optional `description`, `status`, optional `assignee`, `createdAt` and `updatedAt`.
2. **Delete is a soft delete.** "The audit log can never be deleted" and "delete a task" pull in opposite directions. The task disappears from the board, and its history stays readable at `GET /api/tasks/:id/audit-logs`.
3. Everything that changes a task is logged, not only status moves. "Who changed what" is the whole point, so leaving out edits and assignments would defeat it.
4. **The status flow is exactly the brief's.** One step forward at a time. Skipping or going back gets a `422`, and `done` is the end. Asking for the status a task already has is a harmless no-op: `200`, `changed: false`, nothing written.
5. The actor is sent as an `X-Actor` header with every change, and the server checks it against the same fixed list the UI shows.
6. One server process, little concurrency. Timestamps are stored in UTC and shown in the viewer's local time.
7. A task has at most one assignee. New tasks always start in To do, so only that column has the inline composer. Cards are shown oldest first, so a new card lands right above it.
8. If two people edit the same card, the last write wins on the task. Each write still records the value it replaced, so the history stays accurate.
9. Dragging is a convenience. The server enforces the flow regardless.

## Trade-offs

| Choice | What I get | What it costs, and when to revisit |
| --- | --- | --- |
| SQLite with triggers and CHECK constraints | The database enforces integrity itself, with nothing to operate | One writer at a time. Move to Postgres for many users or several instances |
| A synchronous store interface | Read, check and write fit in one simple transaction | It becomes async with Postgres (a mechanical change) |
| Soft delete | History survives | Tables keep growing, so archive later |
| Optimistic placement only | A dropped card moves at once, while the reload still decides the final state | A brief flicker back if the move is refused |
| Last write wins on edits | No version column, no conflict dialog | Add optimistic locking if lost updates start to matter |
| No state library or router | Less to explain | Revisit with more views or caching needs |
| Shared package read as source, run with `tsx` | No build graph to keep in sync | No deployable API build yet. Add a bundler to deploy |
| Hand-written logger and five security headers | No extra dependencies | Use pino and helmet in production |

## If I had more time

Real authentication (the actor from a session), roles, optimistic locking for edits, comments and labels, several assignees, pagination, rate limiting and a cap on tasks, hash-chaining the audit entries, a deployable build behind a server that sets a CSP, CI, and more migrations as the schema grows.

## Questions from the brief

_The same four answers, in Indonesian and in more detail, are in [ANSWER.md](ANSWER.md)._

**How do I make sure the audit log can't be modified?** I used several layers, so one failing doesn't expose the log:
1. No code path changes it. The store has no method to edit or remove an entry, and any `PUT`, `PATCH`, `POST` or `DELETE` on an audit URL gets a 404.
2. SQLite triggers abort any `UPDATE` or `DELETE` on `audit_logs`, even from a buggy future query.
3. Tasks are never physically deleted (a trigger plus `ON DELETE RESTRICT`), so entries can't be orphaned or cascaded away.
4. A task's change and its audit entry are written in **one transaction**, so there's never a state without an entry, or an entry without a state.
5. CHECK constraints reject impossible rows, like a status change from a status to itself.
6. Edits never touch older entries. Each one stores the old and new value as they were, so renaming a task doesn't change what the history said.
7. The triggers are dropped and re-created from `schema.sql` on every start, so a tampered trigger is repaired on restart. The database file is `0600` in a `0700` folder.

Tests cover each layer, including a property test of 1,600 random operations. **What's left:** someone with access to the database file *while the app runs* can still edit it. Next I'd hash-chain the rows and use a database role without `UPDATE` and `DELETE`.

**What's riskiest if many people use it?** First, the actor is self-asserted, so the history records a claim, not a verified identity. Real auth has to come first. Second, SQLite's single writer and the synchronous driver would struggle under heavy writes. Third, concurrent edits are last-write-wins. Fourth, nothing paginates the task list or the history, and nothing limits how many tasks one person can create.

**What would I refactor first in a big system?** Storage and identity. I'd swap `SqliteTaskStore` for an async Postgres store (the interface already isolates it) and take the actor from the signed-in session. Both protect the product's core promise: a history you can trust. After that, pagination, and giving the audit log its own module with an outbox for other consumers.

## Accepted risks

The brief says "no auth, no roles", so these are on purpose:

- The actor is self-asserted. Anyone can act as anyone, and any actor can change or delete any task.
- No TLS (plain HTTP on localhost) and no encryption at rest.
- No rate limiting and no cap on the number of tasks.

Some protections are in place anyway: the server only listens on loopback and accepts an exact list of `Host` names (against DNS rebinding); there's no CORS, and the JSON content type plus the custom `X-Actor` header forces a preflight that fails; schemas are strict; SQL is parameterised only, enforced by lint; the UI only renders text, and lint bans HTML injection; errors and logs never echo input or internals; and requests have size and time limits. The threat model and all 31 findings are in [`docs/06-security-review.md`](docs/06-security-review.md).

## How I used AI, and how I checked it

I used Claude Code to analyse the brief, draft the docs (PRD, tech spec, schema, API contract, security review, UI design), scaffold the monorepo, and write the code and tests. The product decisions were mine: the board, the actor list, soft delete, the forward-only flow. I treated everything the AI produced as unproven until I'd checked it.

- **Code against the plan.** I reviewed the docs several times before building, including a round just for security. Afterwards I compared the finished code with the PRD, tech spec, API contract and schema, and fixed what didn't match: stale user stories and file lists, a stray `cn` package the shadcn CLI installed by mistake, an unused component and a missing coverage script. Every deviation is in [`docs/08-implementation-plan.md`](docs/08-implementation-plan.md).
- **Running things.** I ran the schema's SQL against a real SQLite and tried to break each rule. That caught a real bug: a `CHECK` passes when its value is `NULL`, so a `created` row with no `to_status` would have been accepted.
- **Tests that can fail.** I deliberately broke core rules (the idempotent branch, the transition check, the append-only trigger, the assignee check, the edit constraints) and confirmed the tests went red each time.
- **The real thing.** Smoke-testing the actual server found a logging bug the unit tests missed (routed requests logged the path `/`). Playwright drives real mouse drags, popup editing and stale tabs, and runs axe accessibility checks at 360, 768 and 1280 px in light and dark. A migration test upgrades a real v1 database with data, and my existing dev database was upgraded in place on startup.
- **Dependencies.** I checked versions on npm and resolved, rather than ignored, a version conflict (TypeScript 7 against `typescript-eslint`) and a security advisory (`concurrently` pulling in `shell-quote`). I reviewed and fixed the code the shadcn CLI generated.
- **Against the brief.** A conformance suite (`apps/api/src/integration/assessment.conformance.test.ts`) turns each clause of the brief into a test against the real API and database. It caught one thing that contradicted the brief, a way to move a task backward, and I removed it.
- **Understanding it.** The code is deliberately small and the reasoning is written down, so I can explain every file.
