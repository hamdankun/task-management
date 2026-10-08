# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project state

This is a take-home assessment (`assessment-context.md`, written in Indonesian): a Mini Task Manager in React and Express, both in TypeScript. What matters most is a **trustworthy, append-only audit log of every change to a task** (status moves, title and description edits, assignment). The UI is a Trello-style board with drag and drop, an inline composer and a card popup.

It's graded on clarity, consistency between front and back end, trade-offs, and whether the author can explain every line. It is not graded on how many features it has.

The code follows the specs in `docs/`, which are the source of truth. If a request conflicts with them, say so before you write code. `docs/08-implementation-plan.md` has the plan and every deviation found while building.

| Doc | Read it for |
| --- | --- |
| `00-assessment-analysis` | The requirements checklist and assumptions |
| `01-PRD` | Scope, the FR, BR and IV ids, and acceptance criteria |
| `02-tech-spec` | The stack and versions, layering, service logic and the test plan |
| `03-database-schema` | The DDL, the triggers, and which constraint enforces which rule |
| `04-api-contract` | Endpoints, errors and the names of the shared zod schemas |
| `05-folder-structure` | The tree, dependencies per workspace, lint boundary rules and build order |
| `06-security-review` | The binding security requirements SR-1 to SR-11, and the accepted risks |
| `07-ui-design` | The shadcn and Tailwind v4 design system, wording and states |

## Commands

This is an npm workspaces monorepo (`apps/api`, `apps/web`, `packages/shared`) and needs Node 22 or newer.

```
npm install
npm run dev            # API (tsx watch, 127.0.0.1:3001) and web (vite, localhost:5173), started by scripts/dev.mjs
npm test               # vitest run, all projects (shared, api, web)
npm run coverage       # the same, with a coverage report
npm run typecheck      # tsc --noEmit in every workspace
npm run lint           # ESLint flat config, including the layer-boundary and SQL/HTML-sink rules
npm run build          # vite build (web only; the API has no build step, it runs through tsx)
npx playwright install chromium   # once
npm run test:e2e       # Playwright: starts its own API (:3101, temp SQLite) and Vite (:5174)
npx vitest run apps/api/src/application/task-service.test.ts      # one file
npx vitest run -t "should reject skipping"                        # one test by name
npx vitest run --project web                                      # one project
npx playwright test e2e/tasks.spec.ts -g "stale tab"              # one end-to-end test
```

The environment variables are all optional: `HOST` (127.0.0.1), `PORT` (3001), `ALLOWED_HOSTS` (`localhost,127.0.0.1,[::1]`) and `DB_PATH` (`apps/api/data/app.db`). The web proxy target is `API_URL`.

Two things are pinned on purpose. `typescript` stays at `~6.0` because typescript-eslint 8 doesn't support 7 yet (bump them together). `concurrently` is not used, because its `shell-quote` dependency has an open advisory, and `scripts/dev.mjs` replaces it. Before bumping anything, check the version with `npm view <pkg> version` and run `npm audit --omit=dev`.

## Architecture (the parts that span several files)

- **API layers.** `presentation → application → domain`, and `infrastructure` implements the `TaskStore` port in `application/ports.ts`. `domain` and `application` never import `express`, `better-sqlite3` or `node:fs`, and ESLint's `no-restricted-imports` enforces it. `index.ts` is the composition root (dependencies are passed as parameters: the store, the clock, the id generator).
- **`@tm/shared`** is the contract between front and back end: the statuses, `nextStatus()`, the zod schemas and the DTO types. It's consumed as source (`exports` points at `src/index.ts`, no build) and the API runs through `tsx`. Never redeclare these in `api` or `web`. A contract change updates `docs/04` and the shared package in the same change.
- **The status flow** is `to_do → pending → in_progress → done`: exactly one step forward, **never backward, never a skip, and `done` is the end**. The brief says "hanya mengikuti urutan" (only follows the order). A one-step-back variant was built and deliberately removed. The rule is enforced in the domain (`assertTransition`), repeated by the `tasks_status_flow` database trigger, and mirrored in the UI (the card's "Move to" button, a Status dropdown with only the next option enabled, and dragging only to the next column). A request for the status a task already has returns `200 {changed:false}` and writes no log. `integration/assessment.conformance.test.ts` is the brief clause by clause, so keep it green.
- **Schema versions** use `PRAGMA user_version` (now 2). `db.ts` migrates an older database (`migrations/00N-*.sql`, in one transaction) and then applies `schema.sql`, which is the latest shape, with the triggers dropped and re-created. Changing the schema means a new migration, a `SCHEMA_VERSION` bump, an updated `schema.sql`, a migration test and an updated `docs/03`. `migrations/001-initial.sql` is frozen because it's a test fixture.
- **Atomicity.** `TaskService.changeStatus` and `updateTask` re-read the task *inside* `store.transaction()` (`BEGIN IMMEDIATE`), and the store's write methods save the task change and its audit log together. The store interface is deliberately synchronous because better-sqlite3 is; moving to Postgres means making it async.
- **The audit log** (`audit_logs`) is append-only through three things: no code path changes it, database triggers (re-created on every boot) and CHECK constraints. Delete is **soft** (`deleted_at`), and the logs survive and stay readable at `GET /api/tasks/:id/audit-logs`. The actions are `created`, `status_changed`, `edited` and `deleted`. **An edit writes one `edited` entry for each changed field, with `from_value` and `to_value`** (`PATCH /api/tasks/:id`: title, description, assignee), in the same transaction, and unchanged values write nothing. The previous value comes from the read inside the transaction. Order by the log `id`, never by timestamp. Only `domain/audit-log.ts#buildLog` builds log objects, and only `sqlite-task-store.ts` and `db.ts` touch SQL.
- **The actor** comes from a hardcoded list in `domain/actors.ts`, exposed at `GET /api/actors` and sent as `X-Actor` on POST, PUT, PATCH and DELETE. The route checks it first and the service checks it again (`assertActor`). It's self-asserted, not authenticated, and that is an accepted risk.
- **Errors.** Typed `AppError` subclasses go through one error middleware and come out as `{error:{code,message,details?}}`. The middleware order matters: requestId, then the JSON logger, securityHeaders, hostGuard, `express.json({limit:'10kb'})`, the routes, notFound and errorHandler. Requests are checked in this order: host, actor, id format, body, existence, transition.
- **The frontend** is Vite and React 19, with no router and no state library. The board has four columns (`@dnd-kit/core`; only columns are droppable; `lib/board.ts#dropDecision` is the pure drop rule, where only the *next* status is a valid target). `useTaskBoard` reloads after every change, successful or not. The only optimistic thing is where a card is *placed* in its target column while its move request is in flight. Clicking a card opens a popup (`TaskDialog`) with an inline title, the assignee, the description (Save and Discard changes) and the activity. Every drag has a "Move to …" button as an alternative. Escape cancels an edit in progress before it closes the popup (the `data-editing` marker). The API client validates responses with the shared zod schemas. The UI shows the labels from `STATUS_LABEL` ("In progress"), while the raw values stay in the API, the database and `data-status`.

## Rules that are easy to break

- **Scope.** Build only what the PRD lists: no auth, roles, pagination, Docker or extra state libraries. Editing a card's title, description and assignee *is* in scope (PRD v2). Prefer the simplest solution, and mark deliberate shortcuts with `// ponytail: <ceiling + upgrade path>`.
- Never hard-delete tasks, weaken or remove the triggers, or add any route or SQL that updates or deletes `audit_logs`. Any new way to change a task must write its audit entries in the same transaction, and needs a case in the property test.
- SQL is only static strings with bound parameters, which is why `updateDetails` writes the *full* resulting values and never a built `SET` list. Never use `dangerouslySetInnerHTML`, `innerHTML` or `eval`. No CORS, and no `0.0.0.0` default bind (`HOST=127.0.0.1`). Never trust `X-Forwarded-*` or an incoming `X-Request-Id`. Schemas are strict (`.strict()`), and only the server sets the id, status and timestamps. Error bodies and logs never contain stacks, SQL, paths or echoed input, and body-parser error text is replaced with fixed messages.
- The database file is created under `umask 077`, `foreign_keys` is asserted ON, and `trusted_schema=OFF`.
- TypeScript is strict: no `any`, no unexplained `!`, and unknown data is parsed with zod at the boundaries. Classes are only for error types. Comments explain *why*.
- Timestamps are ISO-8601 UTC with milliseconds (`toISOString()`), and the CHECK constraints rely on that format. A SQL `CHECK` passes on NULL, so use `IS` and `IS NOT` on nullable columns.
- The composer exists only in the To do column, because every task starts there. Cards are listed oldest first, so new cards land above the composer.
- Tests ship with every change and are named by behaviour. Service tests use the in-memory fake store. The same contract suite runs against the fake and against SQLite `:memory:`. API tests use Supertest with real SQLite. UI tests use Testing Library with `fetch` or the client mocked at the boundary. Never mock the unit under test, and never say it's green without running the commands above.
- Keep docs and code in sync: a schema change updates `docs/03` and `schema.sql` together, and a contract change updates `docs/04` and the shared package.

## UI

The UI uses shadcn/ui and Tailwind CSS v4 (CSS-first, `@tailwindcss/vite`, no `tailwind.config`; add primitives with `npx shadcn@latest add`). **Load the `frontend-design` skill before designing or restyling anything**, and follow `docs/07`.

The look is "Trello-like, not Trello" (docs/07, section 2.5): an ink-blue canvas, a translucent top bar, light fixed-width columns, and white cards with quick actions on hover. Keep our serif titles and status dots, and don't add Trello features we don't have (labels, attachments, checklists, search).

Colours, fonts and radius only come from the tokens in `index.css`, with no hex values in components (use the `canvas` and `chrome` tokens on the bar). Serif is for record text and sans is for the interface. Use sentence case, never show status by colour alone, follow dark mode through `prefers-color-scheme`, and use self-hosted fonts only. After running the shadcn CLI, check what it generated (stray imports, extra packages, hard-coded colours). Frontend work can be handed to the `react-fullstack-engineer` subagent (`.claude/agents/react-fullstack-engineer.md`).

## README (a deliverable)

It must cover how to run the front and back end, the architecture, assumptions, trade-offs, what to improve, the written answers (how the audit log resists tampering, what's riskiest with many users, what to refactor first), the accepted security risks (a self-asserted actor, no authorization, no TLS, no rate limit), and an AI-usage note saying how each AI-assisted part was validated. `JAWABAN.md` has the same answers in Indonesian. Before submitting, run `npm audit --omit=dev` and the checklist in `docs/06`, section 6, and keep secrets, `.env` and `*.db*` files out of git.
