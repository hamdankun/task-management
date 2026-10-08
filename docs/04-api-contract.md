# 04 — API contract

This is the agreement between the backend and the frontend. It follows the [PRD](01-PRD.md) requirements FR-1 to FR-21 and the [tech spec](02-tech-spec.md), section 3.

The zod schemas in `packages/shared` are the version a machine can check, and both sides use them. This document is the version people read. There's no OpenAPI file; it would be more paperwork than this small API needs.

## 1. Conventions

| Topic | Rule |
|---|---|
| Base path | `/api`, with no version number (not needed yet) |
| Format | JSON in UTF-8. A request body needs `Content-Type: application/json` |
| Timestamps | ISO-8601 in UTC with milliseconds, like `2025-01-01T10:00:00.000Z` |
| Ids | Tasks use a UUID v4 string. Audit entries use a positive integer that only ever grows |
| Who is acting | There's no login. Anything that changes data (`POST`, `PUT`, `PATCH`, `DELETE`) needs an `X-Actor: <username>` header. It must match a name from `GET /api/actors` exactly, including case. The server doesn't trim it (HTTP itself already strips optional spaces around a header value). A missing or unknown actor gets `400 INVALID_ACTOR`. Reading doesn't need it |
| Headers on every response | `X-Request-Id: <uuid>`, and `Cache-Control: no-store` on all `/api` responses, so clients always see fresh state |
| Unknown JSON keys | Rejected with `400 VALIDATION_ERROR`, because the schemas are strict |
| Unknown query parameters | Ignored. There is no pagination, filtering or sorting |
| CORS | None. In production it's the same origin; in development the Vite proxy forwards `/api` |
| Repeating a request | `PUT …/status` is idempotent (the same status again is a no-op). `POST /tasks` is **not**; there are no idempotency keys, and the UI disables the button while it's saving. `DELETE` isn't either (the second call gets a 404) |
| Body size | At most 10 kb |
| Security headers | Every `/api` response sends `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: no-referrer` and `Cross-Origin-Resource-Policy: same-origin`. It never sends `X-Powered-By` or an `ETag` |
| Which `Host` is allowed | The hostname has to be in `ALLOWED_HOSTS` (by default `localhost`, `127.0.0.1` and `[::1]`), otherwise the answer is `403 FORBIDDEN_HOST`. This is a defence against DNS rebinding, and it's checked before routing |
| Content type | A request with a body must be `application/json`, or it gets `400 VALIDATION_ERROR`. The actor is read **only** from `X-Actor`, never from a cookie, the query string or the body |

## 2. Types (`@tm/shared`)

```ts
type Status = 'to_do' | 'pending' | 'in_progress' | 'done';
type Actor  = 'john.doe' | 'jane.smith' | 'budi.santoso' | 'siti.rahma';  // sent as a plain string; the server owns the list

interface Task {
  id: string;
  title: string;                 // trimmed, 1–120 characters; no control characters (including new lines and tabs) or bidirectional text controls
  description: string | null;    // trimmed, at most 1000; "" becomes null; control characters are rejected except new lines and tabs; bidi controls are rejected
  status: Status;
  assignee: string | null;       // one of the names from GET /actors, or null
  createdAt: string;
  updatedAt: string;             // the last change of any kind (status, edit or delete); equals createdAt at first
}

interface AuditLog {
  id: number;
  taskId: string;
  taskTitle: string;             // the title at the time of the event
  action: 'created' | 'status_changed' | 'edited' | 'deleted';
  actor: string;
  fromStatus: Status | null;     // null for 'created' and 'edited'
  toStatus: Status | null;       // null for 'edited' and 'deleted'
  field: 'title' | 'description' | 'assignee' | null;   // only for 'edited'
  fromValue: string | null;      // the field's previous value (null means it was empty)
  toValue: string | null;        // the field's new value (null means it was cleared)
  createdAt: string;
}

interface ApiErrorBody { error: { code: ErrorCode; message: string; details?: unknown } }
```

Shared zod exports (the API uses them to parse requests, and the web client uses them to check responses):
`StatusSchema`, `TaskSchema`, `AuditLogSchema`, `CreateTaskSchema`, `ChangeStatusSchema`, `UpdateTaskSchema`, `UpdateTaskResponseSchema`, `ActorsResponseSchema`, `TasksResponseSchema`, `TaskResponseSchema`, `ChangeStatusResponseSchema`, `AuditLogsResponseSchema`, `ApiErrorBodySchema`.

## 3. Endpoints

### `GET /api/actors`
Answers `200` with `{ "actors": string[] }`, which is `["john.doe","jane.smith","budi.santoso","siti.rahma"]`.

### `GET /api/tasks`
Returns the tasks that aren't deleted, newest first (then by `id`).
Answers `200` with `{ "tasks": Task[] }`, an empty array when there are none.

### `POST /api/tasks`
Body: `{ "title": string, "description"?: string | null }`
- `title` is required and trimmed, and must be 1 to 120 characters after trimming. It rejects control characters and text-direction controls (U+202A–202E, U+2066–2069, U+200E, U+200F, U+061C), because they could be used to disguise what an audit line says (06, S-07).
- `description` is optional, trimmed, at most 1000 characters, and stored as `null` if it's empty after trimming.

Answers `201` with `{ "task": Task }` and `Location: /api/tasks/{id}`. The status is `to_do`, and a `created` entry is written in the same transaction.
Errors: `400 VALIDATION_ERROR`, `400 INVALID_ACTOR`.

### `GET /api/tasks/:id`
Answers `200` with `{ "task": Task }`, or `404 TASK_NOT_FOUND` for an unknown, malformed or soft-deleted id.

### `PUT /api/tasks/:id/status`
Body: `{ "status": Status }`

| The requested status compared with the current one | What happens |
|---|---|
| The same as the current status | `200` with `{ task, changed: false, auditLog: null }`. Nothing is written |
| The next status after the current one | `200` with `{ task, changed: true, auditLog: AuditLog }`. Exactly one step forward, and the task and its entry are written together |
| Anything else (a skip, a move back, or anything from `done`) | `422 INVALID_TRANSITION` with `details: { from, to, allowed }`, where `allowed` is the only valid next status (`null` once the task is `done`) |

Errors: `400 VALIDATION_ERROR` (a missing or unknown status, or extra keys), `400 INVALID_ACTOR`, `404 TASK_NOT_FOUND`.

### `PATCH /api/tasks/:id`
Edits the title, the description and/or the assignee. The body is strict and needs at least one key. A key that's absent means "leave it as it is":

```json
{ "title"?: string, "description"?: string | null, "assignee"?: string | null }
```

- `title` follows the same rules as when creating (trimmed, 1–120, no control or bidi characters).
- `description` is trimmed and at most 1000 characters. `""` or `null` clears it.
- `assignee` is a name from `GET /api/actors`, or `null` to unassign. Anything else is a `400 VALIDATION_ERROR` with `details.fieldErrors.assignee = ["Choose a listed user"]`, and the value is never repeated back.

| What was sent | What happens |
|---|---|
| Every value equals the current one | `200` with `{ task, changed: false, auditLogs: [] }`. Nothing is written and `updatedAt` stays the same |
| Some values differ | `200` with `{ task, changed: true, auditLogs: AuditLog[] }`. **One `edited` entry per changed field**, in the order title, description, assignee, all with the same timestamp, written together with the change |

The status can never be changed here (the key would be rejected as unknown). The previous values in each entry come from the row read again inside the transaction, so if two people edit at the same time the history is still accurate about each write (the last write wins on the task itself).
Errors: `400 VALIDATION_ERROR`, `400 INVALID_ACTOR`, `404 TASK_NOT_FOUND` (an unknown, malformed or deleted id).

### `DELETE /api/tasks/:id`
A soft delete. It writes a `deleted` entry that records the status the task had, and answers `204` with no body.
Errors: `400 INVALID_ACTOR`, `404 TASK_NOT_FOUND` (this includes deleting the same task a second time).

### `GET /api/tasks/:id/audit-logs`
Returns the entries oldest first, ordered by entry `id` and not by timestamp. It works for soft-deleted tasks too.
Answers `200` with `{ "auditLogs": AuditLog[] }`. It answers `404 TASK_NOT_FOUND` only if the id never existed (or is malformed).

**There is no route that changes or deletes audit entries.** A `PUT`, `PATCH`, `POST` or `DELETE` to `/api/tasks/:id/audit-logs` (or to anything under `/api/audit-logs/`) matches nothing and gets `404 ROUTE_NOT_FOUND`.

## 4. Which statuses each endpoint can return

| Endpoint | Success | 400 | 404 | 422 | 500 |
|---|---|---|---|---|---|
| GET /actors | 200 | | | | possible |
| GET /tasks | 200 | | | | possible |
| POST /tasks | 201 | VALIDATION, ACTOR | | | possible |
| GET /tasks/:id | 200 | | TASK | | possible |
| PATCH /tasks/:id | 200 | VALIDATION, ACTOR | TASK | | possible |
| PUT /tasks/:id/status | 200 | VALIDATION, ACTOR | TASK | TRANSITION | possible |
| DELETE /tasks/:id | 204 | ACTOR | TASK | | possible |
| GET /tasks/:id/audit-logs | 200 | | TASK | | possible |
| Anything else | | | ROUTE | | |

On top of that, **any** request with a `Host` that isn't allowed gets `403 FORBIDDEN_HOST` before it reaches routing, so that applies to every row above.

The checks run in a fixed order, so clients get predictable errors: host, then actor header, then id format, then body, then whether the task exists, then the transition. For example, an unknown id with a bad body gets a `400` first, while an unknown id with a valid body gets a `404`.

## 5. Errors

Every error looks like `{ "error": { "code", "message", "details"? } }`.

| Code | HTTP | `details` |
|---|---|---|
| VALIDATION_ERROR | 400 | `{ formErrors: string[], fieldErrors: Record<string, string[]> }` (zod's `flattenError`). It's also used for malformed JSON, a missing body, the wrong content type and a body that's too large |
| INVALID_ACTOR | 400 | None. The message never repeats the value that was sent |
| FORBIDDEN_HOST | 403 | None |
| TASK_NOT_FOUND | 404 | None |
| ROUTE_NOT_FOUND | 404 | None |
| INVALID_TRANSITION | 422 | `{ from: Status, to: Status, allowed: Status \| null }` |
| INTERNAL_ERROR | 500 | `{ requestId: string }`. The message is generic and the real cause is only logged on the server |

`message` is plain English and safe to show in the UI. Clients should decide what to do from `code`, never from `message`.

**An error body never contains a stack trace, SQL, a file path or a raw value the client sent.** That includes JSON parser messages, which can quote the bad input; those are replaced with a fixed message. `details` only ever holds field names and messages. A 500 returns only a generic message and the request id.

## 6. Examples

**Create**
```http
POST /api/tasks
X-Actor: john.doe
Content-Type: application/json

{ "title": "  Prepare Invoice ", "description": "" }

201 Created
Location: /api/tasks/3f2c8a54-0b1e-4c63-9a52-7d1f0e6b9a10
{ "task": { "id":"3f2c8a54-…","title":"Prepare Invoice","description":null,"status":"to_do",
            "assignee":null,"createdAt":"2025-01-01T09:00:00.000Z","updatedAt":"2025-01-01T09:00:00.000Z" } }
```

**A valid move**
```http
PUT /api/tasks/3f2c8a54-…/status
X-Actor: john.doe
{ "status": "in_progress" }                      (the task is currently pending)

200 { "task": { …,"status":"in_progress","updatedAt":"2025-01-01T10:00:00.000Z" },
      "changed": true,
      "auditLog": { "id":3,"taskId":"3f2c8a54-…","taskTitle":"Prepare Invoice","action":"status_changed",
                    "actor":"john.doe","fromStatus":"pending","toStatus":"in_progress",
                    "field":null,"fromValue":null,"toValue":null,
                    "createdAt":"2025-01-01T10:00:00.000Z" } }
```

**Asking for the status it already has (a no-op)**
```http
PUT … { "status": "in_progress" }                (the task is already in_progress)
200 { "task": { …,"status":"in_progress" }, "changed": false, "auditLog": null }
```

**A move that isn't allowed**
```http
PUT … { "status": "done" }                       (the task is currently pending)
422 { "error": { "code":"INVALID_TRANSITION",
      "message":"Cannot move from pending to done",
      "details": { "from":"pending","to":"done","allowed":"in_progress" } } }
```

**Editing a card**
```http
PATCH /api/tasks/3f2c8a54-…
X-Actor: jane.smith
{ "title": "Prepare invoice v2", "assignee": "john.doe" }

200 { "task": { …,"title":"Prepare invoice v2","assignee":"john.doe",… },
      "changed": true,
      "auditLogs": [
        { "id":4,"action":"edited","actor":"jane.smith","field":"title",
          "fromValue":"Prepare Invoice","toValue":"Prepare invoice v2",… },
        { "id":5,"action":"edited","actor":"jane.smith","field":"assignee",
          "fromValue":null,"toValue":"john.doe",… } ] }
```

**Validation**
```http
POST /api/tasks   { "title": "   " }
400 { "error": { "code":"VALIDATION_ERROR","message":"Invalid request",
      "details": { "formErrors":[], "fieldErrors": { "title":["Title is required"] } } } }
```

**A bad actor**
```http
DELETE /api/tasks/3f2c8a54-…        (no X-Actor header)
400 { "error": { "code":"INVALID_ACTOR","message":"X-Actor must be one of the known users" } }
```

**The history of a deleted task**
```http
GET /api/tasks/3f2c8a54-…/audit-logs
200 { "auditLogs": [ {id:1,action:"created",fromStatus:null,toStatus:"to_do",…},
                     {id:2,action:"status_changed",fromStatus:"to_do",toStatus:"pending",…},
                     {id:3,action:"deleted",fromStatus:"pending",toStatus:null,…} ] }
```

## 7. How the UI turns an entry into a sentence

These sentences are made by the UI from an `AuditLog`. They're never stored. Status words use the UI labels (`to_do` is "To do", `pending` is "Pending", `in_progress` is "In progress", `done` is "Done"). The sentence is each entry's accessible text; how an entry looks on screen is in [07](07-ui-design.md), section 5.2. Time is the viewer's local time as `YYYY-MM-DD HH:mm`, with the exact UTC time in the `title` attribute.

- created: `{actor} created "{taskTitle}" at {time}`
- status change: `{actor} changed "{taskTitle}" from "{fromStatus}" to "{toStatus}" at {time}`
- deleted: `{actor} deleted "{taskTitle}" at {time}`
- edited, title: `{actor} renamed "{fromValue}" to "{toValue}" at {time}`
- edited, description: `{actor} added a description to "{taskTitle}"`, or `changed the description of "{taskTitle}"`, or `removed the description from "{taskTitle}"`, followed by `at {time}`. The text itself is shown in the visible entry, not in the sentence.
- edited, assignee: `{actor} assigned "{taskTitle}" to {toValue}`, or `unassigned {fromValue} from "{taskTitle}"`, or `reassigned "{taskTitle}" from {fromValue} to {toValue}`, followed by `at {time}`.

For edits, `taskTitle` is the title **after** the edit.

## 8. Behaviour that matters for security (see [06](06-security-review.md))

The server never sends CORS headers. A page on another site can't read the responses, and the custom `X-Actor` header plus the JSON content type force the browser to ask permission first, which fails. Mass assignment isn't possible, because the schemas are strict and the server sets the id, the status and the timestamps itself. The actor is a *claim*, not an identity (S-01).

## 9. Contract tests (see the tech spec, section 7)

Every row of section 4 has a Supertest case. Every response body is parsed with its shared zod schema. Every error code in section 5 is produced at least once, and the header rules (`X-Request-Id`, `Cache-Control`, `Location`) are asserted.
