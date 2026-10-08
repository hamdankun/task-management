# 08 — Implementation plan and build log

The plan below is what I worked from, and the log underneath records everything I found while building that made me change a decision, a document or the code. The docs in this folder are the source of truth. When one turned out to be wrong, I fixed the doc and the code together and wrote it down here.

## The plan

Each step ended with `npm test`, `npm run typecheck` and `npm run lint` passing, and with a quick check of the code against the documents it relies on. The end-to-end tests were the final gate.

| # | Step | What it produced | Which docs it checks against |
|---|---|---|---|
| 0 | The toolchain | The root `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `eslint.config.js`, `.gitignore` and `.nvmrc`; `npm install`; a smoke `typecheck && test` on the TypeScript, Vite and Vitest versions | 02, section 1 |
| 1 | `@tm/shared` | The statuses and `nextStatus`, all the zod schemas (strict, trimming, control and bidi character rules), the DTO types, and tests | 04, section 2; 06, S-06 and S-07 |
| 2 | The API domain | Errors, actors, `assertTransition`, `buildLog`, and tests | IV-1, IV-6; 05 |
| 3 | The API application layer | The ports, `TaskService`, the fake store, the **store contract suite**, and service tests | IV-2, IV-4, IV-5, IV-8; 02, section 2 |
| 4 | The API infrastructure | `schema.sql` (matching doc 03), config, `db.ts` (umask, pragmas, trigger re-creation), `SqliteTaskStore`, and the schema, contract and property tests | 03; M2; S-11 |
| 5 | The API presentation layer | The logger, the request, security and host middleware, the error handler, the routes, `createApp` and `index.ts`; Supertest tests and `security.test.ts` | 04; 06 |
| 6 | The web app | Tailwind v4, shadcn primitives and tokens, the client, hooks, components, wording, and Testing Library tests | 07; the PRD user stories |
| 7 | End-to-end tests | Playwright (Chromium) against the real API, the web app and a temporary SQLite database | PRD section 8; 06 |
| 8 | The final review | The README, `npm audit --omit=dev`, the doc 06 checklist, the grep checks, screenshots at 360, 768 and 1280 px in light and dark, and a sync of the docs | PRD section 18 |

The rules while building: reuse before writing, no scope beyond the PRD, and if a doc is wrong, fix the doc and the code together.

## What I found along the way, and what I did about it

### While building the first version

| # | What I found | What I did |
|---|---|---|
| 1 | `typescript-eslint` 8.71 only accepts TypeScript below 6.1, so TypeScript 7 can't be installed with it | Pinned `typescript ~6.0.3`. Bump TypeScript and `typescript-eslint` together once that's supported (02, section 1) |
| 2 | `concurrently` (every 9.2.x and 10.x release) pulls in `shell-quote`, which has a critical advisory | Dropped it. `scripts/dev.mjs` starts the API and the web app, and `npm audit` is clean (02, section 1; 05) |
| 3 | `better-sqlite3` 13 ships no TypeScript types | Added `@types/better-sqlite3` as an API dev dependency |
| 4 | The logged request path was `/` for routed requests, because `req.path` is relative to the router mount | The path is now read from `originalUrl` as the request arrives, with a regression test. I found it by smoke-testing the real server, which the unit tests had missed |
| 5 | Disabling the form or button while saving threw away keyboard focus | A saving control now uses `readOnly` or `aria-disabled`, with a guard that ignores clicks while saving, and the tests assert focus is kept |
| 6 | The shadcn CLI wrote `from "cn"` imports, added a `next-themes` dependency and made the destructive button `text-white` | Fixed once in the copied-in files: imports now come from `@/lib/utils`, Sonner uses `theme="system"`, and the destructive button uses the token |
| 7 | HTTP itself strips optional whitespace around header values | Doc 04 now says so. The server still does no trimming of its own |
| 8 | zod's "unrecognized key" message quotes the key the client sent | `presentation/parse.ts` replaces it with "Unknown field", so no input is echoed (06, S-08), with a test |
| 9 | The hook is called `useTaskBoard` (the list and its actions), not `useTasks`; `presentation/parse.ts` and `integration/test-app.ts` were added; and the API client takes an injectable `fetch` | The tree in doc 05 was updated |
| 10 | Playwright end-to-end tests and axe checks were only "optional" in the plan | I built them: flows, stale tabs, XSS, security headers, and axe checks with screenshots at 360, 768 and 1280 px in light and dark |
| 11 | `prettier --write .` reformatted Markdown, including the original assessment file | I restored that file, and `*.md` is now in `.prettierignore` |

### The second version: card editing, assignment and the board

| # | What I found | What I did |
|---|---|---|
| 12 | Editing and assignment clashed with the PRD's non-goals and with the idea that only status changes are audited | The scope was widened on purpose (PRD v2). Edits are audited field by field with the old and new value, so "who changed what" still holds |
| 13 | Existing `app.db` files contain real history | I wrote a real v1 to v2 migration, with tests, instead of "just delete the database" (doc 03, section 8) |
| 14 | A SQL `CHECK` passes when its value is NULL, again | The new `edited` branch uses `IS` and `IS NOT`, and each bad shape has a test |
| 15 | A dynamic `UPDATE … SET <only the changed fields>` would break the "static SQL only" rule | The store writes the full resulting values in one static statement |
| 16 | Trello puts "Add a card" at the bottom, but our API lists newest first | Cards in a column are shown oldest first, so a new card lands just above the button. The composer is only in To do (OD-6) |
| 17 | `role="status"` now appears twice, because dnd-kit adds its own live region | Tests find the actor hint by its text instead |
| 18 | The end-to-end tests shared one database, so a long column pushed a dragged card off screen | `clearBoard()` runs before the drag tests, which now start from an empty board |
| 19 | dnd-kit ignores the click that follows a drop for about 50 ms | A test waits for the move to finish saving before it clicks |
| 20 | Toasts slide in from off screen and made the document look wider than the screen at 360 px | The overflow check now measures the page content, not the document |
| 21 | An `<h3>` inside a `<button>` is invalid markup | The heading now contains the button |
| 22 | The client asked for a status dropdown that could also move a task **back**, but the brief says the flow only follows the order | I built it as one step either way, then **removed it in the final audit**, on the client's decision to follow the brief. `assessment.conformance.test.ts` now guards the rule |
| 23 | The drop column was chosen by how much the drag preview overlapped it, so a Done card dropped on Pending landed on In progress | Collision detection now uses where the pointer is, with overlap only as a fallback. A real-browser test found it |
| 24 | `aria-busy` checks in the end-to-end tests raced React's rendering | A `movedTo()` helper waits for the confirmation message, which only appears after the server answered and the board reloaded |
| 25 | The client asked for a Trello-like look from a reference screenshot | I took the structure, not a copy (doc 07, section 2.5): an ink-blue canvas, one translucent bar, 296 px columns, white cards with a small lift, and quick actions on hover and focus |
| 26 | Actions that only show on hover must still be reachable | They're only faded with `opacity`, never removed. Keyboard focus reveals them, they're always visible on touch, and they keep the same accessible names. A test checks hidden, then hover, then visible, then focus |
| 27 | Columns first stretched to the height of the window, then to the tallest column | The client wanted Trello's behaviour, so each column is only as tall as its cards. A valid drop column grows a "Drop here" slot while dragging, and the pointer position decides the drop |

### The final audit against the brief and against these docs

| # | What I found | What I did |
|---|---|---|
| 28 | The final check of the app against the assessment brief found one deviation: backward moves | Removed them (see 22). The README's stale claims were fixed as well (test counts, the assignee field, "single valid next step", the finding count), a conformance suite was added, and the docs were put back to the strict rule. Node 22 or newer stays, because of `better-sqlite3` 13, and is documented |
| 29 | Comparing the code with the PRD, tech spec, API contract and schema (a docs-versus-code audit) found documents that still described the first version: user stories US-1, US-2, US-4 and US-6, the list of components and files, the SQL statements and example in doc 03, the UI wording table, the motion section, and a "no code exists yet" note in the security review | Rewrote those documents so they describe what was actually built |
| 30 | The same audit found a stray `cn` package in `apps/web`, which the shadcn CLI had installed by mistake | Removed it, and added the lesson to doc 05 and to S-13 |
| 31 | The same audit found `ui/collapsible.tsx`, a copied-in component nothing used any more | Deleted it |
| 32 | The tech spec promised a coverage report, but no script existed | Added `npm run coverage` (about 95% of statements) |
| 33 | Two components used raw `white/…` colours, against the rule that components only use tokens | Added `--chrome-control-hover` and used the existing `chrome-control` token instead |

## Final verification

The commands are in the README. The last full run, from a clean `npm ci`: 412 unit and integration tests (including the 17 brief-conformance tests), 26 end-to-end tests, lint, typecheck, Prettier, build and `npm audit` (0 vulnerabilities).
