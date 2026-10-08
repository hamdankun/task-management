# 06 — Security review

This reviews the design in docs 01 to 05 and then the built app, and it records what was found and what was done about it. The method: list what needs protecting and where the trust boundaries are, walk each boundary with the STRIDE checklist, write down findings, fix them in whichever document or file owns the problem, and review again.

Each finding ends with one of three verdicts:
- **Fixed:** the design or code was changed so the problem is gone.
- **Mitigated:** it's reduced, and what remains is stated.
- **Accepted:** I'm knowingly living with it, and it's written down. The brief explicitly excludes auth and roles, which is behind several of these.

## 1. What we're protecting and who might attack it

| Asset | Why it matters | What must hold |
|---|---|---|
| The audit log | It's the whole value of the product | Integrity (append-only) and attribution |
| Task data | Internal work items; people may type sensitive text | Integrity, and a little confidentiality |
| The machine running the API | A developer laptop or a small server | Availability, and no code execution |
| The public repository | It's what gets graded | No secrets and no data committed |

Data classification: there are no credentials and no personal data by design (the actors are made up). Free-text titles and descriptions are typed by users, so they're treated as **untrusted input that might be sensitive**. There's no encryption at rest (accepted, S-18).

## 2. Trust boundaries and who we assume the attacker is

```
 A web page (any origin) ──HTTP──▶ Express API ──SQL──▶ SQLite file ◀── someone with file access
        ▲ our React app (trusted code, untrusted data)        ▲
        └─ localStorage (untrusted, the user can edit it)     └─ npm dependencies (the supply chain)
```

Attackers I considered:
- (A) a malicious website open in the same browser
- (B) another machine on the network
- (C) a legitimate but malicious team member, who can pick any actor
- (D) someone sending hostile text (XSS or SQL injection payloads) through the UI or the API
- (E) a compromised dependency
- (F) someone with access to the database file

Not considered: a compromised operating system or root user, physical access, and state-level attackers.

## 3. A STRIDE overview

| | Threat | Where | Finding |
|---|---|---|---|
| **S**poofing | Claiming to be another actor | `X-Actor` | S-01 |
| **S**poofing | A foreign or rebound page acting as the user | Browser to API | S-02, S-03 |
| **T**ampering | Editing or deleting audit rows | Database and code | S-11, S-12 |
| **T**ampering | Injection and mass assignment | API input | S-04, S-06 |
| **R**epudiation | "I didn't do that" | The audit log | S-01 (the actor is a claim), S-11 |
| **I**nformation disclosure | Stack traces, SQL errors, logs | Errors and logs | S-08, S-09 |
| **I**nformation disclosure | Data stolen through XSS | The UI | S-05 |
| **D**enial of service | Floods, huge bodies, slow connections | The API | S-10 |
| **E**levation of privilege | Any actor can do anything | No authorization | S-17 |
| Supply chain | A malicious or vulnerable package | npm | S-13 |

## 4. Findings

Severity is impact times likelihood **for how this app is deployed**: an internal tool on localhost or a small network, with no auth, as the brief says.

| ID | Finding | Severity | Verdict | What we do about it (and where) | How it's tested |
|---|---|---|---|---|---|
| S-01 | **The actor is self-asserted** (`X-Actor`). Anyone can claim to be any user, so the audit log records a *claim*, not an identity | Medium | Accepted (the brief allows a hardcoded list) | Documented everywhere. The UI says plainly "Not authenticated. This name is recorded in the history." The first upgrade would be to derive the actor from a session or SSO. The actor is never accepted from a cookie, the query string or the body | The actor is read only from the header (Supertest) |
| S-02 | **A request to the local API from another site** (CSRF-style) | Medium | Mitigated | There are no cookies or ambient credentials. Changes need the custom `X-Actor` header and `Content-Type: application/json`, so browsers must run a CORS preflight, and the API sends **no** `Access-Control-*` headers, so the preflight fails. The server also rejects non-JSON bodies and a missing actor with a 400 (04, section 1; 02, section 3) | A foreign-origin preflight gets no ACAO header; a `text/plain` POST is rejected |
| S-03 | **DNS rebinding and network exposure.** Other machines, or a rebound hostname, could reach the API and enable S-01 and S-02 remotely | Medium | Fixed | `HOST` defaults to `127.0.0.1`. The `hostGuard` middleware only allows `Host` names in `ALLOWED_HOSTS` (default `localhost,127.0.0.1,[::1]`) and answers `403 FORBIDDEN_HOST` otherwise. The Vite proxy keeps `changeOrigin: false` (02, sections 3.1 and 4.1; 04, section 5) | `Host: evil.com` gets a 403 |
| S-04 | **SQL injection** through the title, description, ids or headers | High if it existed | Fixed | Only parameterised, prepared statements, created once in the store. No SQL is built from strings, and there's no dynamic `ORDER BY` or identifier. An ESLint rule forbids template literals and concatenation in `.prepare` and `.exec` calls, and `exec` is only used for the static schema files (02, section 4.3; 05, section 5) | Payloads like `'); DROP TABLE tasks;--` are stored as typed or give a 404, and the tables stay intact |
| S-05 | **Stored or reflected XSS** through a title, description, actor name or history sentence | High if it existed | Fixed | Data is only ever rendered as React text. ESLint's `no-restricted-syntax` bans `dangerouslySetInnerHTML`, assigning to `innerHTML` and `eval`. No URL is built from data. The API sends `X-Content-Type-Options: nosniff` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, so a JSON response can never be rendered as HTML (02, sections 3.1 and 5) | A title like `<img src=x onerror=…>` or `<script>` shows as plain text; the headers are asserted |
| S-06 | **Mass assignment and prototype pollution**: a client setting `id`, `status`, `createdAt` or `__proto__` | Medium | Fixed | The zod schemas are `.strict()`, so unknown keys (including `__proto__` and `constructor`) give a 400. Only the server sets ids, status and timestamps (04, section 1) | Extra keys and `__proto__` bodies give a 400 |
| S-07 | **Visual spoofing in the history** with control or text-direction characters (for example U+202E) or new lines in a title, making an entry read differently from what happened | Low to medium | Fixed | A title rejects control characters (new lines and tabs included) and the direction controls U+202A–202E, U+2066–2069, U+200E, U+200F and U+061C. A description does the same but allows new lines and tabs. It's done once, in the shared schema, for both the API and the UI (04, section 2) | Each class of character is rejected with a 400 |
| S-08 | **Information leaking through errors**: stack traces, SQL, file paths, echoed input | Medium | Fixed | A 500 returns only a generic message and the request id. The `details` of a 4xx never contain raw input values. The `INVALID_ACTOR` message doesn't repeat what was sent. Parser errors, which can quote the input, are replaced with a fixed message. A schema's "unknown key" message is replaced with "Unknown field". `NODE_ENV` doesn't change any of this (02, section 3.3; 04, section 5) | A throwing store gives a body without stack, SQL or path; 400 bodies never contain the secret string that was posted |
| S-09 | **Log injection and log flooding** (CR, LF or ANSI codes in a path or `X-Actor`) | Low | Fixed | Logs are **JSON lines** (`JSON.stringify` escapes control characters), never built by joining strings. An incoming `X-Request-Id` is ignored. User-controlled fields are cut to 200 characters. Bodies, headers and the query string are never logged (02, section 3.1) | A path or actor with `\r\n` still logs as one JSON line |
| S-10 | **Running out of resources**: huge or slow bodies, hoarded connections, unlimited task creation, and (since editing exists) an unlimited number of audit entries per task | Medium | Mitigated | `express.json({ limit: '10kb' })`; `requestTimeout` and `headersTimeout` of 10 s, `keepAliveTimeout` of 5 s; every value is capped (title 120, description and audit values 1000 characters). **What remains (accepted):** there's no rate limit and no cap on the number of tasks or edits, so one actor could fill the disk. The upgrade is `express-rate-limit` and a limit on active tasks (02, section 8; PRD, section 14) | An oversized body gives a 400; a slow request being closed was checked by hand |
| S-11 | **Tampering with the audit log in storage**: SQL run against the file, dropped or edited triggers, editing the file | Medium | Mitigated | Triggers, CHECK constraints and the foreign key (03). **Triggers are re-created from `schema.sql` on every start** (`DROP TRIGGER IF EXISTS` then `CREATE`), so an altered trigger is repaired at the next restart. The data folder is `0700` and the database file `0600`, set with `umask 077` before anything is created, so there's no moment when they're readable by others. `trusted_schema=OFF`. The app never executes raw SQL from users. **What remains:** whoever holds the file *while the app runs* can still change data. The next steps would be hash-chaining rows (`prev_hash`), a database role without `UPDATE` and `DELETE`, or exporting the log to write-once storage (03, sections 1 and 2; 02, section 6) | A tampered trigger is restored when the database is opened again; the file modes are checked (POSIX) |
| S-12 | **Race conditions** that could leave a state without an entry, or two entries | Medium | Fixed | The re-read and the write happen in one `BEGIN IMMEDIATE` transaction, the store checks that exactly one row changed, and the database repeats the status rule as a trigger (02, section 2.3) | The property test and the stale-tab tests |
| S-13 | **The supply chain**: a vulnerable or malicious dependency, a look-alike package name, install scripts, and brand-new major versions (TypeScript 7, Vite 8, Vitest 5) | Medium | Mitigated | Few dependencies (05, section 2). The UI adds Tailwind, shadcn, Radix, Sonner, Lucide and Fontsource, all widely used. shadcn components are source we copied in and reviewed after generation (07, section 10). The package names are listed exactly (no look-alikes), `package-lock.json` is committed and `npm ci` is used, `npm audit --omit=dev` is reviewed before submitting, and there's no `postinstall` script of ours. `better-sqlite3` ships a native binary, which is accepted because it's widely used. The major-version smoke test is required. **A real incident, found by the docs-versus-code audit:** the shadcn CLI once installed an unrelated npm package called `cn` while generating an import. It was unused, and it was removed | `npm audit` is clean; a check for unused dependencies runs as part of the audit |
| S-14 | **Secrets or data in the public repository** | Low | Fixed | There are no secrets (the configuration isn't secret). `.gitignore` covers `.env*`, `apps/api/data/`, `*.db`, `*.db-wal`, `*.db-shm`, `.claude/settings.local.json` and `coverage/`. The config loader never prints environment values. Before submitting, review `git ls-files` for stray database or env files (05, section 1) | A checklist item |
| S-15 | **Clickjacking and missing browser hardening on the web app** (it's served by Vite) | Low | Mitigated | The API sends `frame-ancestors 'none'`. The web page has no session to hijack; what remains is that a framed page could trick someone into clicking Delete. A real deployment should serve the app from a server that sets a CSP and `X-Frame-Options`. It's documented | Not tested |
| S-16 | **Exposing the dev server** (Vite with `--host`, and past file-serving bugs) | Low | Fixed | Never run Vite with `--host`. It binds to localhost by default. Keep Vite on the latest patch and leave `server.allowedHosts` at its default. Only `/api` is proxied (02, section 8) | Not tested |
| S-17 | **No authorization**: every actor can move or delete anyone's task | Medium | Accepted | The brief says "no auth, no roles". Documented. Roles would be the second upgrade | None |
| S-18 | **No TLS and no encryption at rest** | Low | Accepted | Plain HTTP on localhost. Terminate TLS at a reverse proxy if it's ever deployed. The SQLite file isn't encrypted (SQLCipher is the upgrade) | None |
| S-19 | **Telling that a deleted task existed**: the audit endpoint answers 200 for a deleted id and 404 for one that never existed | Info | Accepted | UUID v4 ids can't be guessed, there's no auth to protect anyway, and FR-8 requires this behaviour | None |
| S-20 | **ReDoS and parser abuse** | Info | Fixed | The schemas only use simple linear character-class patterns, with no nested quantifiers. JSON depth is bounded by the 10 kb limit, and `express.json` runs in strict mode (objects and arrays only) | A long string within the limit |
| S-21 | **Unsafe framework defaults** (`X-Powered-By`, ETag and 304 caching, trusting proxy headers) | Low | Fixed | `x-powered-by` is off, `etag` is off, `Cache-Control: no-store` is set, and `trust proxy` stays **false** so `X-Forwarded-*` is never trusted (02, sections 3.1 and 8) | Header assertions |
| S-22 | **Open redirects and SSRF** through a base URL set by the client | Info | Fixed (not applicable) | The client only uses relative `/api` URLs. No user-supplied URL is fetched anywhere, and the server makes no outgoing requests | None |

### 4.1 Findings added with card editing, assignment and the board (v2)

| ID | Finding | Severity | Verdict | What we do about it | How it's tested |
|---|---|---|---|---|---|
| S-23 | **A new way to write data:** `PATCH /api/tasks/:id` accepts free text and an assignee | Medium | Fixed | The same rules as creating: a strict zod schema (unknown keys, `__proto__`, `status`, `id` and timestamps all give a 400), trimmed and length-limited values, control and bidi characters rejected, the fixed order of checks (host, actor, id, body, existence), a JSON content type, and no CORS | The PATCH blocks in `app.test.ts` and `security.test.ts` |
| S-24 | **The assignee is a second identity field** that could be forged or used to spoof the history | Low to medium | Fixed | It must be one of the server's own users (`assertAssignee`), checked in the service so it can't be bypassed. The rejection names the field and never the value, and the database has a length CHECK as a last line | The service and app tests |
| S-25 | **Edits could rewrite history:** changing a title could make older audit lines read differently | Medium | Fixed | Each entry stores the **old and new values** when it's written (`from_value` and `to_value`) and a snapshot of the title. Entries stay append-only, so renaming a task never changes what earlier entries say. Edit rows have database CHECKs (no statuses, `from` differs from `to`, a title is never null) | The schema and property tests |
| S-26 | **A lost update:** when two people edit the same card, the last write wins | Low | Accepted | Each write records the value it actually replaced (read inside the transaction), so nothing is lost from the *history*, though the task keeps the last write. Optimistic locking is the upgrade | The property test |
| S-27 | **Audit values are user text shown in the Activity pane** (stored XSS or spoofing) | High if it existed | Fixed | Shown as React text only. Quoted values use text nodes or `<q>`, are clamped, and whitespace is controlled. Control and bidi characters are rejected on the way in, and the sentence read by assistive technology is plain text | The web tests, and an E2E test showing a script in a description as text |
| S-28 | **A schema migration on a database with real history** could lose or change audit rows | Medium | Fixed | The migration runs in one transaction, copies rows with their ids, and the append-only triggers are re-created afterwards. It's tested on a v1 database with data, including that a failure rolls back and that a newer database is refused | `migration.test.ts` |
| S-29 | **Drag and drop sends nothing the server trusts:** the UI's decision (`dropDecision`) is only advice | Info | Fixed | A drop only ever calls the same `PUT …/status`. The server enforces the flow (a 422), and the database trigger repeats it | The stale-tab and drag E2E tests |
| S-30 | **A new dependency,** `@dnd-kit/core` (pointer events and the DOM) | Low | Mitigated | A stable 6.x release with no network access and no way to inject HTML. It's installed from the lockfile, and `npm audit` is clean | `npm audit` |
| S-31 | **Moving a task backward would weaken the forward-only flow** that the brief asks to enforce | Not applicable | Closed | A "one step back" variant was built and then **removed on review**. The flow is strictly forward-only in the domain, in the database trigger and in the UI, and the conformance tests fail if backward moves return | `assessment.conformance.test.ts` |

## 5. Security requirements (these feed the PRD, section 12)

- SR-1. Treat all request data as hostile, and validate it at the boundary with strict schemas.
- SR-2. SQL only through parameterised statements in `sqlite-task-store.ts`.
- SR-3. No way to inject HTML into the UI.
- SR-4. No CORS, a local bind, a Host allowlist, and JSON-only changes with a required custom header.
- SR-5. Errors and logs never leak internals or repeat input, and logs are structured JSON.
- SR-6. Audit integrity is defended in the code, the database and at startup (triggers re-created each start, file permissions).
- SR-7. Every request has limits on input size and time.
- SR-8. Dependencies are few, locked and audited before submitting.
- SR-9. No secrets or data files in git.
- SR-10. The limitations (S-01, S-17, S-18, no rate limit) are stated in the README.
- SR-11. Every edit is audited with its old and new values, and the actor and assignee are validated on the server against the predefined list.

## 6. Checklist before submitting

- [x] `npm ci && npm test && npm run lint && npm run typecheck` pass (this includes `security.test.ts`).
- [x] `npm audit` was reviewed and reports no vulnerabilities.
- [ ] `git ls-files | grep -E '\.(db|env)|data/'` returns nothing. (The folder isn't a git repository yet. Run `git init` and check before pushing, to confirm `.gitignore` works.)
- [x] No HTML injection points and no dynamic SQL (this is also enforced by lint):
  ```sh
  grep -rnE 'dangerouslySetInnerHTML|innerHTML|eval\(' apps/web/src          # expect nothing
  grep -rnE '\.(prepare|exec)\(' apps/api/src                               # review: only static strings
  ```
- [x] A server started with the defaults is only reachable on 127.0.0.1.
- [x] The README states the accepted risks (S-01, S-17, S-18 and rate limiting).

At implementation time (2026-10-08) everything above passed: a clean install with tests, lint and typecheck green; `npm audit` reporting 0 vulnerabilities; no HTML injection points or dynamic SQL in the non-test code, where the only `prepare` and `exec` calls take static strings; the default bind on `127.0.0.1`; and no `.env` or `*.db` files outside ignored paths.

## 7. Review log

| Pass | What happened |
|---|---|
| 1 | 22 findings recorded; fixes applied to docs 01–05 and `CLAUDE.md` |
| 2 | Re-checked the fixes for consistency, and for new attack surface the fixes themselves create (section 8) |
| 3 | One ordering inconsistency (the actor check) fixed |
| 4 | A full re-read: five small items fixed (logging before the guard, the incoming request id, parser messages leaking input, the permission window closed with `umask`, `trusted_schema=OFF`) |
| 5 | A full re-read with nothing further to report |
| v2 | Card editing, assignment and the board: S-23 to S-30 added and closed (section 4.1) |
| Audit | The final alignment audit against the brief closed S-31 (backward moves removed), and a docs-versus-code check found and removed a stray `cn` dependency (S-13) |

## 8. Second-order checks (fixes that could cause risks of their own)

- **Dropping triggers at start-up.** It happens inside one transaction before the server starts listening. If creating one fails, the transaction rolls back and the process exits, so there is never a window with a trigger missing.
- **The host guard** compares `req.hostname` (without the port) against an exact list, with no wildcard or suffix matching, which avoids `localhost.evil.com`.
- **`FORBIDDEN_HOST` before routing:** it runs right after the request id and logging, and before routing and body parsing. An unknown route can't be used to probe from a rebound host, yet the rejected request is still logged.
- **Control-character rules:** the same schema runs in the UI for quick feedback, but the server is the authority.
- **`no-store` and no ETag** mean more bytes on each reload, which doesn't matter at this scale.
- **File permissions:** `chmod` only works on POSIX systems and is ignored on Windows (documented).
