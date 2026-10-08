# 01 — Product requirements

| | |
|---|---|
| Product | Task log, a small internal task board |
| Kind | Take-home assessment, full stack (React + Express, TypeScript) |
| Version | v2: a board with drag and drop, card editing and assignment on top of the original status-change history. The status flow is still forward-only. |
| Related | [00 analysis](00-assessment-analysis.md) · [02 tech spec](02-tech-spec.md) · [03 schema](03-database-schema.md) · [04 API](04-api-contract.md) · [05 structure](05-folder-structure.md) · [06 security](06-security-review.md) · [07 UI](07-ui-design.md) |

## 1. What we're building

A small web app where an internal team keeps its tasks on a board, moves them through a fixed set of statuses, and can always see **who changed what, from what to what, and when**.

The point isn't the task features. The point is a **change history people can trust**: every change is recorded, and nothing in the record can be rewritten afterwards.

## 2. The problem

| What hurts today (from the brief) | What it causes | What this app does about it |
|---|---|---|
| Statuses change often and nobody knows who changed them | No accountability | Every change records an **actor** |
| It's hard to trace how data changed | Arguments and rework | An **append-only audit log** per task, in time order |
| The UI doesn't explain the history | People can't answer their own questions | An **Activity** view on every task, written as plain sentences |

## 3. Goals, non-goals and how we'll know it worked

**Goals**
- G1. Create, list and delete tasks.
- G2. Move a task only along `to_do → pending → in_progress → done`.
- G3. Make every change traceable to a person, impossible to alter, and consistent with the task's current state.
- G4. Keep the code and docs simple enough that the author can explain every decision.
- G5. Offer a Trello-style board: drag a card to its next column, add a task inline, open a card in a popup to edit its title and description, assign someone, and read its activity. Each of those changes is attributed and logged just like a status change.

**Not goals:** authentication, roles and permissions, reopening or rolling back a status, more than one assignee, comments, labels, attachments, checklists, due dates, search, filters, sorting controls, pagination, realtime sync, notifications, multiple tenants, translations, a native mobile app, Docker and CI.

**How we'll measure it**

| ID | Measure | Target |
|---|---|---|
| M1 | Each rule IV-1 to IV-9 (section 9) is covered by at least one automated test | All of them |
| M2 | Tasks whose status doesn't match their last audit entry (not deleted) | None, shown by a test over random sequences of operations |
| M3 | Audit rows that can be changed through the API or with raw SQL `UPDATE` / `DELETE` | None |
| M4 | Getting from a fresh clone to a working app | Three commands or fewer, written in the README |
| M5 | Time for a typical list, create or move request on local SQLite | Under 100 ms (informational, not load-tested) |
| M6 | Security findings rated high or medium with no fix and no documented acceptance | None (doc 06, section 4) |
| M7 | Edits whose audit entry carries the true previous value, even when two people edit at once | All, shown by a property test |

## 4. Who uses it

- **Team member.** One role. Opens the app, says who they are, and manages tasks. There is no login and no permission model, so everyone can do everything.
- **Reviewer.** Uses the same screen, opens a task's activity and finds out who did what and when.
- **The actors.** A fixed list that lives in code, not in the database: `john.doe`, `jane.smith`, `budi.santoso` and `siti.rahma`.
- **Where it runs.** A desktop browser (current Chrome, Firefox or Safari), one server process, localhost or a small network.

## 5. Words used in these docs

| Term | Meaning |
|---|---|
| Task | A piece of work with a title, an optional description and a status |
| Status | One of `to_do`, `pending`, `in_progress`, `done` |
| Transition | Moving a task from its current status to the next one |
| Actor | The predefined user making a change (picked from a dropdown, not authenticated) |
| Audit entry | An unchangeable record of one change: `created`, `status_changed`, `edited` or `deleted` |
| No-op | A request for the status the task already has. It succeeds and changes nothing |
| Soft delete | The task is hidden from the board but kept, together with its history |

## 6. The status model

```
 to_do ──▶ pending ──▶ in_progress ──▶ done
  (start)                              (end)
```

The brief says status "hanya mengikuti urutan" (only follows the order) and that violations must be rejected. So a task moves **exactly one step forward**. Skipping a status and moving back are both refused.

| From \ To | to_do | pending | in_progress | done |
|---|---|---|---|---|
| to_do | no-op (200) | allowed | refused (422) | refused (422) |
| pending | refused (422) | no-op (200) | allowed | refused (422) |
| in_progress | refused (422) | refused (422) | no-op (200) | allowed |
| done | refused (422) | refused (422) | refused (422) | no-op (200) |

`done` is the end of the line: there are no further moves and no reopening. Every move writes one audit entry.

## 6a. The data, in short (full SQL is in doc 03)

| Entity | Fields |
|---|---|
| Task | id (uuid), title, description (optional), status, assignee (optional), createdAt, updatedAt. A `deletedAt` exists internally and is never sent to clients |
| Audit entry | id (a number that only goes up), taskId, taskTitle (a snapshot), action, actor, fromStatus and toStatus (for status changes), field with fromValue and toValue (for edits), createdAt |
| Actor | A username from a constant in the code; there is no table |

Tasks are listed newest first by the API (the board shows each column oldest first). Audit entries are always returned in id order.

## 7. Functional requirements

Priority **M** means the assessment demands it. **S** means it was my own call because it was cheap and sensible.

| ID | Requirement | Priority |
|---|---|---|
| FR-1 | Create a task with a required `title` and an optional `description`; it starts in `to_do` | M |
| FR-2 | List every task that isn't deleted | M |
| FR-3 | Change a task's status following section 6; the backend has the final say | M |
| FR-4 | Delete a task (a soft delete); it disappears from the board | M |
| FR-5 | Each status change writes exactly one audit entry (task, actor, from, to, time) | M |
| FR-6 | Asking for the status the task already has succeeds, writes nothing and answers `changed: false` | M |
| FR-7 | Show a task's audit entries oldest first | M |
| FR-8 | Audit entries can never be edited or removed, not even when the task is deleted | M |
| FR-9 | The actor is chosen from a predefined list in a dropdown and sent with every change | M |
| FR-10 | The backend rejects a change whose actor is missing or unknown | M |
| FR-11 | Log `created` and `deleted` as well | S |
| FR-12 | Fetch the actor list from the API so the UI and API can't drift apart | S |
| FR-13 | Offer one "move to next" action per card, and none once the task is `done` | S |
| FR-14 | Ask for confirmation before deleting | S |
| FR-15 | Remember the chosen actor across reloads (`localStorage`) | S |
| FR-16 | Edit a task's title and description in place (the description has Save and Discard changes) | M (v2) |
| FR-17 | Assign a task to one predefined user, or unassign it | M (v2) |
| FR-18 | Each edit or assignment writes one audit entry **per changed field**, with the old and new value, in the same transaction. Saving unchanged values writes nothing | M (v2) |
| FR-19 | A board with one column per status; dragging a card to the **next** column moves it (a button does the same for keyboard and touch users) | M (v2) |
| FR-20 | An inline "Add a task" at the bottom of the To do column (Enter adds and keeps it open, Escape closes it) | M (v2) |
| FR-21 | Clicking a card opens a popup with the title, assignee, description and the activity | M (v2) |

## 8. User stories and acceptance criteria

### US-1 Create a task (FR-1, FR-5, FR-11, FR-20)
- **Given** I've chosen who I am, **when** I type "Prepare Invoice" in the composer and press Enter, **then** a card appears in To do, directly above the composer, and the composer empties but stays open for the next task.
- Its activity then shows one entry: `john.doe created "Prepare Invoice"`.
- The title is trimmed. An empty or whitespace-only title shows an error under the field and creates nothing. A title over 120 characters or a description over 1000 is rejected with a 400.
- Duplicate titles are fine, because tasks are identified by id.
- Pressing Enter twice while it's saving must not create two tasks.

### US-2 See the board (FR-2)
- There is one column per status, each with a count. The status of a card is the column it's in.
- A card shows its title, a small icon if it has a description, and the assignee's initials. Cards in a column are oldest first.
- Deleted tasks never appear. There are loading, empty ("Nothing waiting." and so on) and error states.
- After every change the board is fetched again, so it never shows a stale status.

### US-3 Change a status (FR-3, FR-5, FR-6, FR-13)
- **Given** a task in `pending`, **when** I choose "In progress" in the popup's Status dropdown, click the card's "Move to In progress" button, or drag the card to that column, **then** the task is in `in_progress` and one new entry exists: `john.doe changed "…" from "Pending" to "In progress" at <time>`.
- The dropdown lists all four statuses so the flow is visible, but only the **next** one can be chosen. The others are disabled, because the server refuses skips and moving back. Once a task is `done` the dropdown is disabled and the card has no move button.
- **Given** two tabs: tab A moves a card, and tab B (out of date) asks for the status the card already has. That is a harmless no-op (`changed: false`), no duplicate entry is written, and tab B refreshes to the real state.
- **Given** tab B asks for a status that is no longer the next one, the answer is `422 INVALID_TRANSITION`. The UI says "This task was changed in another tab. The list was refreshed." and reloads.
- While a request is in flight the card is busy: it can't be dragged or clicked again.

### US-4 Read the history (FR-7, FR-8)
- Clicking a card opens a popup. Its **Activity** pane lists the task's entries, oldest first.
- Each entry has a full sentence as its accessible text:
  - created: `john.doe created "T" at <time>`
  - status change: `john.doe changed "T" from "Pending" to "In progress" at <time>`
  - rename: `john.doe renamed "A" to "B" at <time>`
  - description: `john.doe added a description to "T"`, `changed the description of "T"` or `removed the description from "T"`
  - assignee: `john.doe assigned "T" to jane.smith`, `unassigned jane.smith from "T"` or `reassigned "T" from … to …`
  - deleted: `jane.smith deleted "T" at <time>`
- On screen the entry shows the actor, what happened, status badges or the old and new text, and the time. The task title isn't repeated, because the popup already shows it.
- Times appear in the viewer's local timezone as `YYYY-MM-DD HH:mm`, with the exact UTC time in a tooltip.
- The pane refreshes when the task changes while it's open, and it has loading, empty and error states.
- Nothing in the history can be edited or deleted from the UI.

### US-5 Delete a task (FR-4, FR-8, FR-11, FR-14)
- **When** I click Delete and confirm, **then** the card leaves the board and a `deleted` entry is recorded, along with the status the task had.
- The history can still be fetched with `GET /api/tasks/:id/audit-logs`. The UI doesn't show a deleted task's history (see OD-4).
- Deleting a task that is already gone returns 404; the UI shows the error and reloads the board.
- A task can be deleted in any status, including `done`.

### US-6 Say who you are (FR-9, FR-10, FR-12, FR-15)
- The "Acting as" dropdown lists the actors from `GET /api/actors`, and the choice is remembered in the browser.
- Under it the UI says "Not authenticated. This name is recorded in the history.", because the log records a claimed identity, not a verified one (06, S-01).
- Until an actor is chosen, adding, moving, editing and deleting are disabled, with the hint "Choose who you are to add or change tasks."
- The server independently rejects a missing or unknown actor with `400 INVALID_ACTOR`.
- If the remembered actor is no longer in the list, it's forgotten.

### US-7 Drag and drop (FR-19, FR-3)
- While you drag a card, the one valid column (the next status) gets a dashed outline and a "Drop here" slot, and the other columns fade.
- Dropping on the next column moves the card. It shows up there immediately, marked busy; the server's answer then confirms it or puts it back with an explanation.
- Dropping anywhere else changes nothing and explains why: "Tasks move one step at a time. This one can go to Pending." or "Done tasks can't move."
- Every card with a next step has a "Move to …" button, and the popup has a Status dropdown. Those are the alternatives for people who can't or don't want to drag.

### US-8 Add a task inline (FR-1, FR-20)
- "Add a task" sits at the **bottom** of the To do column. Enter adds the task and keeps the composer open and focused. Escape or Cancel closes it and throws the draft away.
- New tasks always start in To do, because that's where the status flow starts, so only that column has a composer.
- A description is optional ("Add description"). Validation errors show under the field. The composer is disabled until an actor is chosen.

### US-9 Open a card and edit it (FR-16, FR-17, FR-21)
- Clicking anywhere on a card (or its title, with the keyboard) opens the popup: the Status dropdown, the title, the assignee, the description, the created and updated times, and the Activity pane. On small screens the Activity pane sits underneath.
- **Title:** click it to edit. Enter or leaving the field saves; Escape cancels. A blank title is refused with a message under the field.
- **Description:** click it to edit. **Save** and **Discard changes** are explicit, and an "Unsaved changes" hint shows while the text differs. Saving an empty description clears it.
- **Assignee:** one user from the predefined list, or Unassigned. The card shows the assignee's initials.
- Pressing Escape while editing cancels only that edit. Pressing it otherwise closes the popup.
- Until an actor is chosen the popup is read-only, though the history stays readable.
- Each saved change shows up in Activity right away.

## 9. Business rules and invariants

| ID | Rule | Enforced by |
|---|---|---|
| BR-1 / IV-1 | Exactly one step forward: no skip, no moving back, and `done` is the end | `assertTransition` in the domain, the `tasks_status_flow` trigger in the database, the conformance tests |
| BR-2 / IV-2 | Asking for the current status gives a 200 and writes no entry | The service's no-op branch, plus a database check that `from` differs from `to` |
| BR-3 / IV-3 | Audit entries are append-only | No code path or route, plus database triggers |
| BR-4 / IV-4 | A task's change and its audit entry happen together or not at all | One transaction, with the task re-read inside it |
| BR-5 / IV-5 | Deleting is soft, so entries outlive their task | `deleted_at` and a `RESTRICT` foreign key |
| BR-6 / IV-6 | The actor must be in the predefined list | The service, and the route before it |
| IV-7 | Entries are ordered by an id that only grows, never by timestamp | `ORDER BY id` |
| IV-8 | A deleted task accepts no more changes | 404 on edit, move and delete |
| BR-7 | Title 1–120 characters after trimming; description at most 1000 | The zod schemas, the database CHECKs, hints in the UI |
| BR-8 / IV-9 | Editing or assigning is audited: one `edited` entry per changed field with the old and new value, written together with the change. Unchanged values write nothing, and an edit never touches status or earlier entries | `TaskService.updateTask`, `buildLog`, the database CHECKs, the property test |
| BR-9 | The assignee must be one of the predefined users (the same list as the actors) | `assertAssignee` in the service |

## 10. Edge cases and what should happen

| Case | Expected behaviour |
|---|---|
| An unknown status in a move request | 400 `VALIDATION_ERROR` |
| Malformed JSON or the wrong content type | 400 `VALIDATION_ERROR`, with no stack trace |
| An id that isn't a UUID | 404 `TASK_NOT_FOUND`, never a 500 |
| An unknown route or method (including any attempt to change audit entries) | 404 `ROUTE_NOT_FOUND`; there is no route that could change them |
| The database write fails halfway through a move | The transaction rolls back, so status and entry are both unchanged. The client gets a 500 with a generic message |
| Two moves of the same task at once | SQLite takes them one at a time, so the second sees the new status and becomes a no-op or a 422. Never two entries for one move |
| The server restarts | The data is still there (it's in a SQLite file) |
| The API can't be reached | An error banner with Retry. Nothing fails silently |
| A very long title or description | It wraps instead of breaking the layout |
| The clock is wrong | Ordering uses the entry id, so a bad timestamp can't reorder history |
| HTML or SQL typed into a title | Shown as plain text, stored as typed, and sent through parameterised SQL |
| Control characters, new lines or right-to-left overrides in a title | Rejected with a 400. Descriptions may contain new lines and tabs, nothing else |
| A request from another website, or with a `Host` that isn't loopback | There is no CORS, so the browser blocks it; a wrong `Host` gets a 403 |
| Someone edits the database file or drops a trigger | The triggers are restored on the next start, and the file mode is 0600. The remaining risk is written down |
| Someone floods the app with tasks | Accepted risk (there is no rate limit); request size and time are limited |

## 11. The screen

Colours, components, wording, states, motion and accessibility are specified in **[07-ui-design.md](07-ui-design.md)** (shadcn/ui and Tailwind v4). In outline:

```
Task log                                             Acting as [👤 john.doe ▾]
Who changed what, and when.            Not authenticated. This name is recorded in the history.
────────────────────────────────────────────────────────────────────────────────
● To do   1     ● Pending   0     ● In progress  1     ● Done  1
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ Book venue ☰ │ │ Nothing      │ │ Prepare inv. │ │ Ship report  │
│              │ │ pending.     │ │              │ │              │
│ + Add a task │ │              │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
click a card, and a popup opens:
   Status [In progress ▾]                                │ Activity
   Title (click to edit)                                 │ ⊕ john.doe created the task
   Assignee [JD jane.smith ▾]                            │ ⇄ john.doe moved it  To do → Pending
   Description          [Save]  Discard changes          │ ✎ jane.smith assigned this to …
```

- A card's status is the column it's in (and its `data-status` attribute). Status words come from one place (`STATUS_LABEL`), so columns, buttons, history and messages all say the same thing.
- Accessibility: real buttons and inputs with labels; the board is a region of four sections, each named by its heading; the popup is a labelled dialog that traps focus and gives it back to the card; errors use `role="alert"`; colour is never the only signal; every drag has a button alternative.
- Responsive: with room for it you see four columns. When the window is narrower the board scrolls sideways inside itself (the page never does), and the popup stacks its two panes.

## 12. Non-functional requirements

| Area | Requirement |
|---|---|
| Idempotency | FR-6 and IV-2 |
| Consistency | IV-4 and M2 |
| Persistence | A SQLite file (`DB_PATH`) that survives restarts |
| Validation | The server is the authority; the client may add hints |
| Errors | One error shape, `{error: {code, message, details?}}`. No swallowed exceptions, and a 500 never leaks internals |
| Security | No auth, by design, and documented as a limitation. The binding requirements SR-1 to SR-11 are in [06](06-security-review.md): strict input validation, parameterised SQL only, no HTML injection points, no CORS plus loopback bind plus a Host allowlist, no internals in errors or logs, audit integrity enforced in code, database and boot, limits on input size and request time, few and audited dependencies, no secrets or data in git |
| Performance | An unpaginated list is fine at assessment scale (under 1,000 tasks); noted as a risk |
| Maintainability | Layered architecture, shared types, tests next to the code, strict TypeScript, clean lint |
| Testability | The domain and service can be tested without a server or a database |
| Observability | One log line per request and an error log with a request id; no personal data |
| Compatibility | Node 22 or newer, current browsers |
| Portability | No external services; works offline |

## 13. Assumptions

1. The brief leaves a task's structure blank, so a task is `id`, `title`, an optional `description`, `status`, an optional `assignee`, `createdAt` and `updatedAt`.
2. The actor is **trusted, not authenticated**; the brief allows a hardcoded list.
3. Creating and deleting are audited too (FR-11).
4. A task moves exactly one step forward. Skipping and moving back are refused, and `done` is the end, which is the brief's rule.
5. There is one server instance and little concurrency.
6. Timestamps are stored in UTC and shown in local time.
7. The brief's example endpoints are suggestions. The contract in doc 04 is the real one.

## 14. Risks and what we do about them

| Risk | Effect | Mitigation |
|---|---|---|
| "Delete a task" clashes with "never delete the log" | Breaks R4 | Soft delete, a `RESTRICT` foreign key, and triggers |
| The actor can be faked | Weak accountability | Documented limitation; taking the actor from a session is the first upgrade |
| Over-engineering | The brief penalises it | The scope guard in `CLAUDE.md` and the list of non-goals |
| AI-written code nobody understands | Fails the "explain it yourself" test | A review checklist, the README's AI section, small files |
| New major versions (TypeScript 7, Vite 8, Vitest 5) not working together | Lost time | A smoke test after scaffolding; TypeScript was pinned to 6.0 because `typescript-eslint` doesn't support 7 yet |
| Unlimited task creation or an unpaginated list | Slowdown or a full disk | Accepted; the upgrade is pagination, a rate limit and a cap |
| Self-asserted actor (S-01) and no authorization (S-17) | The log shows a claim, not an identity | Stated in the README and in the UI; session-based actors come first |
| A vulnerable or malicious dependency (S-13) | Compromise | Few dependencies, a lockfile, `npm ci`, and `npm audit` before submitting |

## 15. Deliverables

1. A public GitHub repository (monorepo) with a working frontend and backend.
2. `README.md`: how to run both, the architecture, assumptions, trade-offs, and what I'd improve with more time.
3. Written answers to the brief's questions: how audit-log tampering is prevented, what is riskiest with many users, and what to refactor first (in the README, and in Indonesian in `JAWABAN.md`).
4. An AI-usage note: which parts AI helped with and how I checked each.
5. Tests that pass with `npm test`.

## 16. The original time plan (3–5 hours)

| # | Slice | Estimate |
|---|---|---|
| 1 | Scaffold the monorepo and the shared package, with tests | 30 min |
| 2 | Domain, service and a fake store, with tests | 45 min |
| 3 | SQLite schema and store, with integrity tests (triggers, rollback) | 45 min |
| 4 | Express routes and middleware, with Supertest | 45 min |
| 5 | React UI with Testing Library | 60 min |
| 6 | README, answers, AI note, final review | 30 min |

## 17. How the brief maps to this document

| The brief says | Where it is covered |
|---|---|
| Create, list and delete a task; update its status | FR-1 to FR-4 |
| The order of statuses is enforced | Section 6, BR-1 |
| Each status change is audited (task, actor, from → to, when) | FR-5, US-3 |
| The actor comes from a hardcoded dropdown | FR-9, US-6 |
| The log can't be changed, and updates don't remove old entries | FR-8, BR-3 |
| The log is in chronological order | FR-7, IV-7 |
| An update to the same status is idempotent | FR-6, BR-2 |
| Data stays consistent | IV-4, M2 |
| Persistence in any form | Section 12 |
| Domain validation in the backend | BR-1, section 6 |
| No over-engineering | Section 3 (non-goals) |
| A per-task log in the UI | US-4 |
| README, three answers, AI usage | Section 15 |

## 18. Definition of done

- [x] Every requirement in section 7 is implemented and every criterion in section 8 holds (US-1 to US-9; checked by the component tests and the Playwright tests).
- [x] IV-1 to IV-9 each have an automated test, and the property test for M2 exists.
- [x] `npm test`, `npm run typecheck` and `npm run lint` pass from a clean clone.
- [x] Docs 03 and 04 match the code; the README is complete (section 15).
- [x] The security checklist in [06, section 6](06-security-review.md) passes, and the accepted risks are in the README.
- [ ] The author can walk through every file and justify each trade-off. (That one is mine to do.)

## 19. Open decisions and what I chose

| ID | Question | What I chose | The alternative |
|---|---|---|---|
| OD-1 | Log create and delete? | Yes | Only status changes |
| OD-2 | What does a same-status request return? | 200 with no change | 409 |
| OD-3 | How is the actor sent? | The `X-Actor` header | A field in the body |
| OD-4 | Show a deleted task's history in the UI? | No, the API only | A "deleted tasks" view |
| OD-5 | Allow moving back, or reopening `done`? | **No, forward only**, as the brief says. A one-step-back variant was built and then removed on review | One step back, which departs from the brief |
| OD-6 | Put a composer in every column? | Only in To do | Creating straight into a later column, which would need several moves and several log entries, and the `created` entry would no longer say `to_do` |
| OD-7 | Two people edit the same card at once | The last write wins, and each write logs the value it actually replaced | Optimistic locking with a version |
| OD-8 | Warn before closing the popup with an unsaved description? | No; the hint shows and closing discards the draft | A confirmation dialog |
