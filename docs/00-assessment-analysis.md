# 00 — Reading the assessment

This is where I started: what the brief really asks for, where it is vague, and which calls I made because of that.

## What is actually being judged

The brief says it plainly: it isn't counting features. It looks at how clear the code structure is, whether the frontend and backend agree with each other, how well I can explain my trade-offs, and whether I can explain my own solution. AI is welcome, as long as I understand what it produced.

So the plan was a small scope, a few rules that never bend, and a written reason for each choice.

## The core problem

Task statuses change and nobody can tell who changed them or when. The app has to make that history trustworthy: every change recorded, nothing in the record ever edited or removed.

## What the brief requires

| # | Requirement | How it is handled |
|---|---|---|
| R1 | Create, list and delete tasks; update a task's status | The tasks API (`/api/tasks`) |
| R2 | Status only follows `to_do → pending → in_progress → done` | `nextStatus` in the domain. A skip or a move back gets a `422`, and a database trigger enforces the same rule |
| R3 | Every status change writes an audit entry (which task, who, from → to, when) | A `status_changed` row, written in the same transaction as the change |
| R4 | The audit log is never changed or deleted, even when its task is deleted | No code path that edits it, database triggers that block it, and soft delete for tasks |
| R5 | Updating a task never removes old entries; entries show in chronological order | Append-only table, read back in id order |
| R6 | Asking for the status a task already has creates no new entry | A no-op branch in the service, covered by tests |
| R7 | A task's status and its audit log always agree | One database transaction covers both |
| R8 | The backend enforces the flow; checking in the frontend is optional | The backend is the authority; the UI only offers valid actions |
| R9 | The actor comes from a hardcoded user list, picked in a dropdown | `GET /api/actors` and the `X-Actor` header |
| R10 | React + TypeScript, Node + Express + TypeScript, a public repo, a README with specific answers | Monorepo, README, `JAWABAN.md` |
| R11 | No auth, roles or complicated UI | Left out on purpose |

## Where the brief is vague, and what I assumed

1. **What a task looks like.** The brief leaves the "minimum structure" blank. I used `id`, `title`, an optional `description`, `status`, `createdAt` and `updatedAt`. (An optional `assignee` came later, see below.)
2. **Deleting versus never deleting logs.** These two clash, so deleting a task is a soft delete (`deleted_at`). The task disappears from the lists, but its history stays and can still be read.
3. **Should creating and deleting be logged?** The brief only asks for status changes. I log them too, because "who changed what" is the whole pain point and it costs almost nothing.
4. **Starting status.** New tasks start in `to_do`.
5. **Skips and moving back.** Both are rejected. Asking for the status a task already has isn't an error; it's a harmless no-op (HTTP 200).
6. **The actor on create and delete.** It's required there as well, sent in the same `X-Actor` header.
7. **Storage.** SQLite, because its transactions and triggers let me actually prove the "never changes" and "always in sync" rules.

## Traps I noticed

- Asking for the same status again must not write an entry, but it also must not fail. It answers `200` with `changed: false`.
- Deleting a task for real would break the "never delete the log" rule (or the foreign key), hence soft delete.
- Two people updating the same task at once. The service re-reads the task inside the transaction, so both can't slip through the same check.
- The brief warns about over-engineering: no auth, no queues, no state-management library.

## Scope

**Planned from the start:** the task endpoints and delete, the actors list, the audit view, tests and the README.

**Left out from the start:** auth, roles, pagination, WebSockets, undo, translations and Docker.

**Added later, at the product owner's request:** a Trello-style board with drag and drop, editing a card's title and description, assigning a user, and a Tailwind/shadcn interface. All of that sits on top of the same audited core, and an edit or an assignment is itself written to the audit log. They are extras beyond the brief.

## Decision: the status flow only goes forward

The brief says status changes must follow the order and that anything that breaks the flow must be rejected. During the build I briefly implemented a "one step back" option (a Trello-style status dropdown that could also move a card backward). On review I **removed it**, because it contradicts both of those sentences.

The app now refuses skips and backward moves in three places: the domain code, a database trigger and the UI. `done` is the end of the line. The test file `apps/api/src/integration/assessment.conformance.test.ts` fails if that ever changes.
