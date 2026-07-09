# IdentityHub - Backend Design Document

Proof of concept: report NHI (Non-Human Identity) findings as Jira tickets.
Multi-tenant, secure credential handling, plus a machine facing REST API.
This document covers the backend only. The UI is in
[docs/frontend-design.md](./frontend-design.md).

## Contents

- [Stack](#stack)
- [Code structure and conventions](#code-structure-and-conventions)
- [Tenancy model](#tenancy-model)
- [Two authentication paths](#two-authentication-paths)
- [Authentication and authorization](#authentication-and-authorization)
- [Backend for Frontend (BFF) rule](#backend-for-frontend-bff-rule)
- [Session management](#session-management)
- [Multi-tenant isolation](#multi-tenant-isolation)
- [Credential storage](#credential-storage)
- [API keys](#api-keys)
- [API surface](#api-surface)
- [Typed client, OpenAPI, and health](#typed-client-openapi-and-health)
- [REST API for machine callers](#rest-api-for-machine-callers)
- [Jira client and rate limiting](#jira-client-and-rate-limiting)
- [Caching](#caching)
- [Observability (logs)](#observability-logs)
- [Data model](#data-model)
- [Run locally](#run-locally)
- [Login and token lifecycle flows](#login-and-token-lifecycle-flows)
  - [1. First login ever](#1-first-login-ever)
  - [2. Second login (second tab)](#2-second-login-second-tab-session-still-valid)
  - [3. Third login (backend session expired)](#3-third-login-backend-session-expired)
  - [4. Fourth login (Jira access token expired)](#4-fourth-login-jira-access-token-expired-session-still-valid)
  - [5. Fifth login (refresh token expired)](#5-fifth-login-refresh-token-expired-about-90-days)
  - [6. Machine caller (REST API)](#6-machine-caller-rest-api-no-session)
  - [Logout](#logout)
- [Scope decisions](#scope-decisions)
- [Assumptions and decisions](#assumptions-and-decisions)

## Stack

- Runtime: Node.js runs the backend (it strips TypeScript types natively, so the
  `.ts` sources run without a build step). Bun is only the package manager;
  Vite builds the frontend. Language: TypeScript.
- Backend: Hono, with `@hono/zod-openapi` so one Zod schema per route both
  validates the request and types the handler.
- Database: Postgres, accessed statelessly (see Multi-tenant isolation).
- Cache: Redis, plus a per-process in-memory tier.
- Database access: Kysely (type-safe query builder) with Kysely migrations.
- Jira client: generated from Atlassian's OpenAPI spec with `@hey-api/openapi-ts`
  (typed operations, no hand-written calls). Its transport is `ky`, which adds
  retry honoring `Retry-After` on 429/503.
- TypeScript in strictest mode; oxlint and oxfmt in strict mode, no warnings.
- Transport: the server runs over plain HTTP locally on a single origin
  (`http://localhost:3000`). The session cookie is not marked `Secure` (a Secure
  cookie is never sent over HTTP). There is no TLS/self-signed-certificate code.
- Single origin: the backend also serves the Vite-built React SPA as static
  files from `frontend/dist` (via `@hono/node-server/serve-static`, with an
  `index.html` SPA fallback for client-side routes). Because the app and the API
  share one origin, the session cookie and the OAuth callback work with no proxy
  and no CORS.
- Frontend: minimal React SPA, built with Vite (`vite.config.ts` at the repo
  root, `root = frontend/src`, `outDir = frontend/dist`).
- One command runs everything (see Run locally).

## Code structure and conventions

Layered, one direction of dependency: `api -> service -> model / redis`. Nothing
skips a layer, and only the model and redis layers touch external stores.

The repository has two top-level app folders: `backend/` and `frontend/`.

```
backend/src/
  api/          HTTP routes, request parsing, response shaping (Hono). No business logic.
  services/     business logic. Orchestrates models, redis, and the Jira client.
  models/       the ONLY code that talks to Postgres (via Kysely).
  redis/        the ONLY code that talks to Redis.
  jira/         Atlassian client. A single `jira.ts` class is the ONLY code that
                calls Atlassian (token exchange, accessible-resources, identity,
                createmeta, issue create/read). Nothing else talks to Jira.
  db/
    migrations/ Kysely migration files.
    schema.ts   typed database schema for Kysely.
  lib/          crypto (field-level encryption), logger.
  config.ts     the single env reader + typed, frozen config (next to index.ts).
  index.ts      entry point, wires the layers together.
```

Rules:

- `api` never imports `models` or `redis` directly; it calls `services`.
- `services` never run raw SQL or raw Redis commands; they call `models` and
  `redis` functions.
- `models` is the single choke point for Postgres. `redis` is the single choke
  point for Redis. This keeps data access and cache access auditable in one place.
- Database access uses Kysely only. No raw SQL strings in `api` or `services`.
- No database transactions unless we must. Use one only when several writes must
  succeed or fail together (for example creating a ticket row and its side
  effects atomically). Single-statement reads and writes run without a transaction.
- Stateless database access. Never set state on a connection or a transaction
  (no `SET`, `SET LOCAL`, `set_config`, session variables, or `SET ROLE`). Every
  query is self-contained and carries its own parameters, so any pooled
  connection is interchangeable and nothing leaks between requests.

Migrations and types: Kysely migrations live under `db/migrations`. The backend
launcher (`backend/scripts/start.ts`, a TypeScript program run by `bun run
backend` as `node --env-file .env backend/scripts/start.ts`) does, in order: (1)
apply migrations, (2) generate the Kysely schema types from the live database
with `kysely-codegen` into `db/schema.ts`, (3) run `vite build` to produce
`frontend/dist`, (4) start a background `vite build --watch` so frontend edits
rebuild automatically, then (5) start the server (its JSON logs piped through
`pino-pretty`). A single `AbortController` ties every child process to the
launcher, so `SIGINT`/`SIGTERM` (or the server exiting) tears the watcher and
pretty-printer down cleanly. So the types always match the migrated database, and
`db/schema.ts` is generated, never hand-edited. Schema changes are always a new
migration.

Connection pool: fixed size, `min = max = 10`. The pool holds a constant 10
Postgres connections, so behavior under load is predictable and there is no
ramp-up or idle-connection churn.

Strictness:

- TypeScript strictest: `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`.
- oxlint and oxfmt in strict mode; the build fails on any warning.

Configuration:

- A single `backend/src/config.ts` is the only file that reads the environment
  (`process.env` / `Bun.env`). It validates the whole environment with a Zod
  schema at startup (unknown vars ignored) and exposes a typed, deeply frozen
  config object (recursively frozen with `deep-freeze-es6`).
- No other file reads the environment directly. Everything imports from `config`.
- Every magic value lives in `config.ts`, never inline. Code references named
  config values, not literals.

Environment-derived values (validated by the Zod schema, no defaults; required):

| Name               | Description                              | Type   | Default  |
| ------------------ | ---------------------------------------- | ------ | -------- |
| JIRA_CLIENT_ID     | Atlassian OAuth app client id            | string | required |
| JIRA_CLIENT_SECRET | Atlassian OAuth app client secret        | string | required |
| OAUTH_CALLBACK_URL | OAuth redirect target                    | string | required |
| ENCRYPTION_KEY     | Symmetric key for field-level encryption | string | required |
| PORT               | Backend HTTP port                        | number | required |
| POSTGRES_USER      | Postgres username                        | string | required |
| POSTGRES_PASSWORD  | Postgres password                        | string | required |
| POSTGRES_DB        | Postgres database name                   | string | required |
| POSTGRES_HOST      | Postgres host                            | string | required |
| POSTGRES_PORT      | Postgres port                            | number | required |
| REDIS_PASSWORD     | Redis password                           | string | required |
| REDIS_HOST         | Redis host                               | string | required |
| REDIS_PORT         | Redis port                               | number | required |

Constant values (hard-coded in `config.ts`, not from the environment):

| Name                                      | Description                             | Type          | Default     |
| ----------------------------------------- | --------------------------------------- | ------------- | ----------- |
| constants.recentTicketsLimit              | Max tickets in the Recent Tickets view  | number        | 10          |
| constants.cache.meAndProjectsTtlSeconds   | Cache TTL for /api/me and /api/projects | number (s)    | 300         |
| constants.cache.recentTicketsTtlSeconds   | Cache TTL for recent tickets            | number (s)    | 10          |
| constants.cache.assignableUsersTtlSeconds | Cache TTL for a project's assignees     | number (s)    | 60          |
| constants.sessionTtlSeconds               | Session lifetime                        | number (s)    | 43200 (12h) |
| constants.apiKeyMaxExpiryDays             | Upper bound on a requested key lifetime | number (days) | 3650        |
| constants.validation.titleMaxLength       | Max title (Jira summary) length         | number        | 255         |
| constants.validation.descriptionMaxLength | Max description length                  | number        | 32767       |
| postgres.poolMin                          | Postgres pool min connections           | number        | 10          |
| postgres.poolMax                          | Postgres pool max connections           | number        | 10          |

Comment conventions:

- Every file begins with a short comment stating what the file does.
- Every important function has a JSDoc comment describing what it does, its
  parameters, and its return value.

## Tenancy model

One user equals one tenant equals one connected Jira site.

- Login uses Atlassian OAuth 2.0 (3LO) with Resource-level access, so a user's
  token is scoped to the single Jira site they pick during consent.
- Every row we own (`jira_connections`, `sessions`, `api_keys`, `tickets`) is
  keyed by `user_id`. There is no shared data between users.
- "Tenant" and "user" mean the same thing in this document. The word tenant is
  used when emphasizing isolation.
- Two different users may connect the same Jira site. They are still separate
  tenants: each has their own tokens, their own sessions, and sees only their
  own app-created tickets.

## Two authentication paths

| Caller                | Auth method    | Identifies user by |
| --------------------- | -------------- | ------------------ |
| Human (browser)       | Session cookie | session record     |
| Machine (scanner, CI) | API key        | hashed key lookup  |

Both paths end at the same place: look up the acting user's encrypted Jira
tokens, decrypt, call Jira scoped to that user.

## Authentication and authorization

Every endpoint is authenticated and authorized. There is no endpoint that reads
or writes tenant data without both checks.

Authentication (who is calling):

- Browser routes require a valid session (session cookie). Missing or invalid
  -> 401.
- Machine routes (`/api/v1/*`) require a valid, non-expired, non-revoked API key
  -> 401 otherwise.
- The only unauthenticated routes carry no tenant data: `GET /` (the SPA shell,
  served before JS loads) and the login routes themselves (`/auth/login`,
  `/auth/callback`, and `POST /auth/logout`).

Authorization (are they allowed this object):

- Every data access is object-level scoped to the acting `user_id`. Establishing
  who the user is (authentication) is never enough; the specific object must
  belong to them.
- Id-based routes (`DELETE /api/api-keys/:id`, reading a ticket by key, etc.)
  must filter by `user_id` in the same query, never by id alone. This prevents
  IDOR, where a user names another tenant's id in the URL.
- On an ownership miss we return 404, not 403, so we do not reveal that an object
  with that id exists for another tenant.
- Enforced at the `models` choke point: every model function takes the acting
  `user_id` and includes it in the query, so authorization cannot be forgotten in
  a handler.

## Backend for Frontend (BFF) rule

The browser never holds a Jira token. The client secret and all Jira tokens
live only on the backend. The browser holds only an opaque session cookie.

## Session management

- `session_id`: random opaque value. Not a JWT, not derived from the Jira token.
- Stored server side: `session_id -> user_id, expires_at`.
- Cookie flags: `HttpOnly` (JS cannot read it) and `SameSite=Lax` (not sent on
  cross site requests, blocks CSRF). Not `Secure`: the POC is served over plain
  HTTP and a Secure cookie is never sent over HTTP. In production over HTTPS this
  would be `Secure`.
- Rolling (sliding) session. TTL is 12 hours of inactivity. On each authenticated
  request the backend extends `expires_at` to now + 12h, so an active user stays
  logged in and only 12 hours of no activity expires the session.
- Rotated on every login. Revocable by deleting the row.
- Session expiry is ours and independent of Jira token expiry.

Session renewal alternatives considered:

| Approach                                                                    | How a returning user stays logged in                                                                   | Decision                                                                            |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Rolling session (extend `expires_at` by the TTL on each request)            | Active use keeps the same session alive; only inactivity expires it                                    | Chosen                                                                              |
| Fixed-TTL session, re-OAuth on expiry                                       | Session expires at a hard 12h; expiry triggers a silent OAuth re-login that also mints new Jira tokens | Not chosen (re-runs OAuth and mints tokens unnecessarily)                           |
| Persistent-login token (rotating refresh-token pattern for our own session) | A separate long-lived token renews the session locally, no OAuth, with reuse detection                 | Not doing (production upgrade; adds a second credential, rotation, reuse detection) |
| JWT session (claims in the browser)                                         | Stateless validation, no lookup                                                                        | Not chosen (weakens revocation, puts claims in the browser)                         |

Chosen: rolling session. It gives "come back later and still be logged in" for
active users with no extra credential, and expiry is enforced server-side by
comparing `expires_at` to now, never by trusting the cookie.

## Multi-tenant isolation

Strict scoping stops one tenant from reading another tenant's rows: every query
filters by the authenticated `user_id`.

- It is enforced in one place: the `models` layer is the single choke point for
  Postgres, and every model function takes the acting `user_id` and includes it
  in the query. Nothing else touches the database, so scoping is auditable in one
  directory and covered by tests.
- This is fully stateless: the `user_id` is a query parameter, not connection or
  transaction state, which satisfies the stateless database rule.
- Row-Level Security is not used. Per-user RLS requires setting connection or
  transaction state (`SET`/`set_config`), which the stateless rule forbids. The
  models choke point plus tests is the stateless equivalent.

Field-level encryption (see Credential storage) is a separate, defense-in-depth
measure. It protects credentials at rest against a stolen database. It does not
by itself isolate row reads between tenants, so it is not counted as an
isolation layer here.

Encryption key: one symmetric app key from an environment variable for the POC.

Isolation and encryption techniques, and where we draw the line:

| Technique                                                                             | What it stops                                                   | Decision                                                                          |
| ------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Strict scoping (every query filters by `user_id`, enforced at the models choke point) | Cross-tenant reads via queries                                  | Chosen                                                                            |
| Row-Level Security (Postgres policies)                                                | Cross-tenant reads even if a query forgets to scope             | Not doing (needs connection/transaction state; conflicts with the stateless rule) |
| Field-level encryption (encrypt tokens and API keys at rest)                          | A stolen database file or dump                                  | Chosen                                                                            |
| Single app encryption key (from env)                                                  | Same as field-level, one shared key                             | Chosen for the POC                                                                |
| Per-tenant keys (a key per tenant)                                                    | A bug returning another tenant's row (renders it undecryptable) | Not doing (future)                                                                |
| Envelope encryption (data keys wrapped by a master key)                               | Managing many keys safely                                       | Not doing (future)                                                                |
| KMS (hardened master-key service)                                                     | The master key itself being stolen                              | Not doing (future)                                                                |

The chosen set is standard for a POC: strict scoping at the models choke point
plus encryption of the sensitive columns. The rest is production hardening for
highly sensitive data,
which a real security product would move toward but which adds key-management
complexity beyond this exercise.

## Credential storage

- Jira `access_token` and `refresh_token`: encrypted (field-level) at rest.
- API keys: stored as a hash only (like a password). The raw key is shown once
  at creation and never again.
- `refresh_token` rotates on each refresh; the stored value is overwritten.
- Refresh trigger: the backend checks `access_token_expires_at` before calling
  Jira and refreshes proactively if it has passed, rather than waiting for a 401.

## API keys

API keys are how machines authenticate. They are created by a human, then
configured into a scanner or CI system.

- Creation: a logged-in user calls `POST /api/api-keys` with `{ name,
expiresInDays }` (`name` is a human label for the service account, for example
  `prod-scanner`; `expiresInDays` is how long the key stays valid, bounded by
  `constants.apiKeyMaxExpiryDays` = 3650). The UI offers presets (1 day, 30 days,
  12 months) or a custom number of days. The backend generates a random key and
  returns it once, along with `id`, `name`, `createdAt`, and `expiresAt`. It
  stores only the key hash, bound to that user.
- Listing: `GET /api/api-keys` returns metadata only (`id`, `name`, `createdAt`,
  `lastUsedAt`, `expiresAt`), never the raw key.
- Use: the machine sends `Authorization: Bearer <api_key>`. The backend hashes
  the presented key, finds the owning user, and acts as that user.
- Expiry: each key has `expires_at` (from the requested `expiresInDays`). The
  machine auth path rejects an expired or revoked key with 401.
- Rotation without downtime: create a new key, update the machine to use it,
  then revoke the old one. A user may hold more than one active key.
- Revocation: `DELETE /api/api-keys/:id` deletes the row; the key stops working
  immediately. A revoked key no longer matches any stored hash, so it is
  rejected as invalid.

An API key's lifetime is independent of the user's Jira OAuth connection. The key
only identifies which user a machine call acts as; the actual Jira access uses
that user's stored OAuth tokens. Atlassian refresh tokens rotate on each refresh
and lapse after roughly 90 days of inactivity, so if a key sits unused past that
window (and no human logs in), the refresh token expires. A machine call with a
still-valid API key then fails with 401 "Your Jira connection needs to be
re-established" until a human re-authenticates through the browser OAuth flow,
which mints a fresh refresh token. The API key itself is not invalidated.

## API surface

Two route groups, versioned differently on purpose.

Public machine API, versioned because it is an external contract:

| Method and path       | Purpose                                     |
| --------------------- | ------------------------------------------- |
| POST /api/v1/findings | Create an NHI finding ticket (API key auth) |

Internal browser API, unversioned because it ships with the frontend:

| Method and path                  | Purpose                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| GET /                            | Serve the SPA shell (public, sent before JS loads)                                   |
| GET /auth/login                  | Start OAuth login                                                                    |
| GET /auth/callback               | OAuth redirect target                                                                |
| POST /auth/logout                | End the session                                                                      |
| GET /api/me                      | Current user profile and connected Jira site                                         |
| GET /api/projects                | List creatable projects with their issue types and required fields (from createmeta) |
| GET /api/projects/:key/assignees | Users who can be assigned issues in the project (for the assignee picker)            |
| POST /api/tickets                | Create a ticket from the UI                                                          |
| GET /api/tickets?projectKey=...  | Recent tickets for a project (max 10)                                                |
| GET /api/api-keys                | List the user's API keys (metadata only)                                             |
| POST /api/api-keys               | Create an API key (returned once)                                                    |
| DELETE /api/api-keys/:id         | Revoke an API key                                                                    |

Operational, unauthenticated:

| Method and path   | Purpose                                     |
| ----------------- | ------------------------------------------- |
| GET /openapi.json | OpenAPI spec (generated from route schemas) |
| GET /docs         | Swagger UI                                  |
| GET /health/live  | Liveness probe                              |
| GET /health/ready | Readiness probe (checks Postgres and Redis) |

## Typed client, OpenAPI, and health

### Typed frontend client (no codegen)

- Routes are defined with `@hono/zod-openapi`, so each has Zod input and output
  schemas.
- The backend exports its app type: `export type AppType = typeof app`.
- The frontend imports that type and builds a client with Hono RPC:
  `hc<AppType>(baseUrl)` from `hono/client`. Request and response are fully typed
  end to end, with no generated types and no generated client. It is a plain
  type import across the monorepo, so the types cannot drift from the routes.
- The client sends the session cookie with each request (credentials included).

### Input validation

- Every request input (path params, query, body) is validated by schema at the
  route boundary, never hand-parsed.
- Because routes are declared with `@hono/zod-openapi`, one Zod schema per route
  validates the request, types it, and generates its OpenAPI entry. Validation,
  types, and docs come from the same source.
- Invalid input returns 400 with a message naming the offending field.

### OpenAPI and Swagger

- The Zod schemas on each route generate the OpenAPI document automatically.
- `GET /openapi.json` serves the spec; `GET /docs` serves Swagger UI via
  `@hono/swagger-ui`. No hand-written OpenAPI.

### Health probes

- `GET /health/live` (liveness): returns 200 if the process is up. No dependency
  checks. A failure tells the orchestrator to restart the process.
- `GET /health/ready` (readiness): returns 200 only if Postgres and Redis are
  both reachable, otherwise 503. A failure tells the orchestrator to stop routing
  traffic until dependencies recover.

## REST API for machine callers

- `POST /api/v1/findings`, REST conventions.
- Auth: `Authorization: Bearer <api_key>`.
- Validates input against the project's createmeta: projectKey required, title
  required (non-empty, max `titleMaxLength` 255), description required (non-empty,
  max `descriptionMaxLength`), plus any field the project marks required. Curated
  optional fields (priority, labels, assignee, due date, components) are accepted
  when provided and validated against their `allowedValues`. The same length
  limits are enforced here as in the UI, from the same config values, so a
  bypassed or malicious client cannot exceed them.
- Field value shaping: each curated/required field is converted to the shape Jira
  expects before create. A user field (assignee) is sent as `{ accountId }`;
  priority/option fields as `{ id }`; date fields as a `yyyy-MM-dd` string; the
  `labels` array as `string[]`; other array fields as `[{ id }]`.
- Status codes: 201 created; 400 for bad input, a missing required field, or a
  field value Jira rejects (see error surfacing below); 401 bad/missing/expired
  key; 404 project not found; 502 only for a genuine Jira upstream failure.
- Returns the created issue key and url.

Error surfacing: when Jira returns a 4xx (it received the request but rejected
our data, for example an invalid field value), the backend extracts Jira's own
reason from its `{ errorMessages, errors: { <field>: <reason> } }` body and
returns it as a 400 so the caller can fix the input. Only true upstream failures
(5xx or network errors) stay a 502 "We couldn't reach Jira". Every error response
has the same body shape, `{ message }`.

## Jira client and rate limiting

The Jira REST client is generated, not hand-written, and rate-limit retry is
handled by the transport, not by us.

Single choke point: all Atlassian traffic goes through one class,
`backend/src/jira/jira.ts` (`JiraClient`). Both the generated REST operations and
the few hand-written OAuth calls are wrapped as methods on this one class, so
every Jira call, its auth, and its transport are configured in a single
auditable place. No other file calls Atlassian.

Generated client:

- Generated from Atlassian's Jira Cloud OpenAPI v3 spec with
  `@hey-api/openapi-ts` (already a repo dependency). The spec is vendored to
  `devex/configs/jira-openapi-v3.json`; the generation config
  (`devex/configs/jira-openapi-ts.config.mjs`) filters it to only the operations
  we call, and the output lands in `devex/generated/jira` (gitignored, produced
  by `bun run codegen`, mirroring the existing rauthy client). This gives typed
  operations for the endpoints we use (per-project createmeta
  `getCreateIssueMetaIssueTypes` and `getCreateIssueMetaIssueTypeId`,
  `searchProjects`, `createIssue`, `getIssue`), with no hand-written request code
  or response types. The older bulk createmeta is deprecated and not used.
- Direct `fetch` is banned repo-wide by lint; the generated client's transport is
  overridden with `ky` (see Rate limiting). We do not write fetch calls or Jira
  types by hand.
- Not covered by the filtered generated client: the OAuth token exchange
  (`auth.atlassian.com/oauth/token`), `accessible-resources`, the `/me` identity
  call (both on `api.atlassian.com`), and the assignable-users search
  (`/rest/api/3/user/assignable/search?project=<key>`, capped at
  `constants.jira.assignableUsersPageSize` = 100). Those are small hand-written
  calls (also `ky`) that live as methods on the same `JiraClient`.

Rate limiting:

- Jira Cloud returns HTTP 429 when a rate limit is exceeded (and some 503s),
  usually with a `Retry-After` header. We do not hand-roll retry logic.
- The generated client is configured to use `ky` as its transport. `ky` retries,
  honoring `Retry-After` on 429 and 503, otherwise exponential backoff, capped
  at 4 retries (5 attempts total).
- `ky` retries only idempotent methods by default (GET and similar), so a `POST`
  is never blindly retried into duplicate tickets. For the create-issue `POST`
  we enable retry on 429 only: a rate-limited request was rejected before being
  processed, so retrying it cannot create a duplicate. A `POST` is still never
  retried on 5xx or network errors, where Jira may already have processed the
  create, matching Atlassian's guidance.
- If retries are exhausted, the Jira call fails and the caller gets 502 (or the
  create endpoint surfaces a clear "Jira is rate limiting, try again" message).
- Retries and rate-limit responses are logged, so 429s and backoff are visible in
  the structured logs.

## Caching

Every cached read uses the same two-tier cache. Each endpoint has its own key,
TTL, and invalidation rule.

- L1, in memory: a per-process map, fastest, not shared across instances.
- L2, Redis: shared across all backend instances, survives a single process.
- Every cache key includes `{user_id}`, so one tenant is never served another
  tenant's cached data.

### Per-endpoint cache policy

| Endpoint                         | Cache key                                  | TTL  | Invalidated by                          |
| -------------------------------- | ------------------------------------------ | ---- | --------------------------------------- |
| GET /api/me                      | `me:{user_id}`                             | 300s | logout, reconnect                       |
| GET /api/projects                | `projects:{user_id}`                       | 300s | reconnect (new Jira connection)         |
| GET /api/projects/:key/assignees | `assignable_users:{user_id}:{project_key}` | 60s  | TTL only (short, so new users show up)  |
| GET /api/tickets?projectKey      | `recent_tickets:{user_id}:{project_key}`   | 10s  | ticket create for that user and project |

`GET /api/api-keys` is not cached: key lists change on explicit user action and
must always reflect the current state.

Write endpoints are never cached and invalidate the related key:

- POST /api/tickets and POST /api/v1/findings delete
  `recent_tickets:{user_id}:{project_key}`.
- Auth routes are never cached.

### Auth runs before the cache

The cache is never consulted for an unauthenticated or invalid request. The auth
middleware validates the `session_id` (exists, not expired, not revoked) and
resolves the `user_id` before any handler runs. An invalid session returns 401
and never reaches the cache. Because every cache key is built from that validated
`user_id`, the key cannot even be computed without a valid session, so a revoked
or expired user can never be served cached data, and no user can reach another
user's key.

### Read and write path (applies to every cached read)

Read path:

1. Look in L1. If present and not expired, return it.
2. Else look in Redis. If present, populate L1 and return it.
3. Else read from the source (the `users` and `jira_connections` tables for me;
   Jira for projects; the `tickets` table for recent-ticket references plus a
   live Jira fetch for their current titles), then write the result to Redis and
   L1, and return it.

Write path: on a write for `user_id` (and `project_key` where relevant), delete
the related key in both L1 and Redis so the change appears immediately instead
of waiting for the TTL.

```mermaid
flowchart TD
  Req[cached GET] --> L1{in L1 and fresh?}
  L1 -- yes --> Ret[return]
  L1 -- no --> R{in Redis and fresh?}
  R -- yes --> FillL1[fill L1] --> Ret
  R -- no --> Src[read source: Jira or DB] --> Fill[write Redis + L1] --> Ret
  Write[write endpoint] --> Inval[delete related key in L1 + Redis]
```

## Observability (logs)

Structured logs are the observability surface for this POC. Metrics
(Prometheus/OpenTelemetry) are intentionally out of scope for a home assignment;
they are the obvious production follow-up but add wiring that does not change the
functional result here.

### Logs

- Structured JSON logs via `pino`. One logger, injected through the layers.
- The request middleware attaches that logger to the request context and logs a
  one-line summary per request. There is no `request_id` (no `x-request-id`
  header, no per-request child logger); it was dropped as unnecessary for the POC.
- Standard fields on request logs: `method`, `route`, `status`, `duration_ms`,
  and `user_id` when authenticated.
- Secrets are never logged: tokens, API keys, cookies, and the client secret are
  redacted by a pino redaction list.
- Log levels: `error` for handled failures and 5xx, `warn` for 4xx and auth
  rejections, `info` for lifecycle and request summaries, `debug` for detail
  behind a flag.

## Data model

```
users(id, atlassian_account_id, email, created_at)

jira_connections(
  user_id PK, cloud_id, site_url,
  enc_access_token, enc_refresh_token, access_token_expires_at
)   -- one connected Jira site per user (the tenant)

sessions(session_id, user_id, expires_at)

api_keys(id, user_id, name, key_hash, created_at, last_used_at, expires_at)

tickets(id, user_id, project_key, jira_issue_key, created_at)
```

Notes:

- `jira_connections` holds the per-user Jira site and its encrypted tokens, so
  `user_id`, `cloud_id`, and the tokens live together. This is the tenant record.
- `tickets` stores only a reference to each issue we created (`jira_issue_key`
  plus the immutable `created_at`), never the issue content. Content like the
  title can be edited in the Jira UI, so Recent Tickets fetches the current title
  live from Jira by key. Our table decides which issues and their order; Jira
  provides the up-to-date display. It is scoped by `user_id`, so a user sees only
  tickets they created through the app. Tickets created directly in Jira are not
  shown.

---

## Login and token lifecycle flows

### 1. First login ever

```mermaid
sequenceDiagram
  participant Browser
  participant Backend
  participant DB
  participant Redis
  participant Auth as auth.atlassian.com
  participant Jira as api.atlassian.com

  Browser->>Backend: GET /auth/login
  Backend->>Redis: store random state (CSRF), short TTL
  Backend-->>Browser: 302 to authorize URL (client_id, scopes, redirect_uri, state)
  Browser->>Auth: GET /authorize
  Note over Browser,Auth: user logs in and clicks Allow (first time only)
  Auth-->>Browser: 302 /auth/callback?code&state
  Browser->>Backend: GET /auth/callback?code&state
  Backend->>Redis: verify state matches (single use, then deleted)
  Backend->>Auth: POST /oauth/token (code + client_secret)
  Auth-->>Backend: access_token + refresh_token + expires_in
  Backend->>Jira: GET /oauth/token/accessible-resources
  Jira-->>Backend: cloud_id + site url
  Backend->>Jira: GET /me
  Jira-->>Backend: atlassian_account_id + email
  Backend->>DB: upsert users row
  Backend->>DB: encrypt tokens, store jira_connections (user, cloud_id)
  Backend->>DB: create session (random session_id, expiry)
  Backend-->>Browser: Set-Cookie session_id (HttpOnly, SameSite=Lax), 302 to /
```

### 2. Second login (second tab, session still valid)

```mermaid
sequenceDiagram
  participant Tab2 as Browser (2nd tab)
  participant Backend
  participant DB

  Note over Tab2: same origin, shares the session cookie
  Tab2->>Backend: GET / (serves SPA shell, public)
  Tab2->>Backend: GET /api/me (cookie session_id)
  Backend->>DB: look up session_id, valid and not expired
  Backend-->>Tab2: profile returned, app renders, Atlassian not involved
```

### 3. Third login (backend session expired)

```mermaid
sequenceDiagram
  participant Browser
  participant Backend
  participant DB
  participant Redis
  participant Auth as auth.atlassian.com

  Browser->>Backend: GET /api/... (cookie session_id)
  Backend->>DB: look up session_id, expired
  Backend-->>Browser: 401 (the frontend redirects to /auth/login)
  Browser->>Backend: GET /auth/login
  Backend->>Redis: store new random state (CSRF), short TTL
  Backend-->>Browser: 302 to authorize URL (state)
  Browser->>Auth: GET /authorize
  Note over Browser,Auth: Atlassian cookie still valid and already consented, silent, no prompt
  Auth-->>Browser: 302 /auth/callback?code&state
  Browser->>Backend: GET /auth/callback?code&state
  Backend->>Redis: verify state matches (single use, then deleted)
  Backend->>Auth: POST /oauth/token (code + client_secret)
  Auth-->>Backend: new access_token + refresh_token
  Backend->>DB: overwrite encrypted tokens (jira_connections)
  Backend->>DB: create NEW session
  Backend-->>Browser: Set-Cookie new session_id, 302 to /
```

### 4. Fourth login (Jira access token expired, session still valid)

```mermaid
sequenceDiagram
  participant Browser
  participant Backend
  participant DB
  participant Auth as auth.atlassian.com
  participant Jira as api.atlassian.com

  Browser->>Backend: POST /api/tickets (valid session)
  Backend->>DB: read tenant tokens (decrypt)
  Note over Backend: access_token_expires_at passed, refresh needed
  Backend->>Auth: POST /oauth/token (grant_type=refresh_token + client_secret)
  Auth-->>Backend: new access_token + new rotated refresh_token
  Backend->>DB: overwrite encrypted tokens
  Backend->>Jira: POST issue (Bearer new access_token)
  Jira-->>Backend: created (issue key)
  Backend->>DB: record ticket, delete recent-tickets cache key
  Backend-->>Browser: 201 ticket created
  Note over Browser,Backend: fully transparent, no re-login
```

### 5. Fifth login (refresh token expired, about 90 days)

```mermaid
sequenceDiagram
  participant Browser
  participant Backend
  participant DB
  participant Auth as auth.atlassian.com

  Browser->>Backend: POST /api/tickets (valid session)
  Backend->>DB: read tenant tokens (decrypt)
  Note over Backend: access_token expired, try refresh
  Backend->>Auth: POST /oauth/token (grant_type=refresh_token)
  Auth-->>Backend: 400 invalid_grant (refresh token expired)
  Backend-->>Browser: 401 reconnect required, redirect /auth/login
  Note over Browser,Auth: full consent flow again, same as first login
```

### 6. Machine caller (REST API, no session)

```mermaid
sequenceDiagram
  participant Scanner as Scanner or CI
  participant Backend
  participant DB
  participant Jira as api.atlassian.com

  Scanner->>Backend: POST /api/v1/findings (Bearer api_key, JSON)
  Backend->>Backend: validate input
  Backend->>DB: hash api_key, find owner user (a revoked key has no row), check not expired
  alt invalid, missing, expired, or revoked key
    Backend-->>Scanner: 401 Unauthorized
  else valid
    Backend->>DB: read tenant tokens (decrypt)
    Backend->>Jira: POST issue (Bearer access_token)
    Jira-->>Backend: created (issue key)
    Backend->>DB: record ticket, delete recent-tickets cache key
    Backend-->>Scanner: 201 Created {key, url}
  end
```

### Logout

```mermaid
sequenceDiagram
  participant Browser
  participant Backend
  participant DB

  Browser->>Backend: POST /auth/logout (cookie)
  Backend->>DB: delete session row
  Backend-->>Browser: clear cookie
  Note over Backend,DB: Jira tokens kept unless user disconnects. Session is gone
```

---

## Run locally

One command starts the backend, frontend, Postgres, and Redis. Required
configuration lives in `.env` at the repo root, which is gitignored.

| Variable           | Purpose                                     |
| ------------------ | ------------------------------------------- |
| JIRA_CLIENT_ID     | Atlassian OAuth app client id               |
| JIRA_CLIENT_SECRET | Atlassian OAuth app client secret           |
| OAUTH_CALLBACK_URL | `http://localhost:3000/auth/callback`       |
| ENCRYPTION_KEY     | Symmetric key for field-level encryption    |
| POSTGRES_USER      | Postgres username                           |
| POSTGRES_PASSWORD  | Postgres password                           |
| POSTGRES_DB        | Postgres database name                      |
| POSTGRES_HOST      | Postgres host                               |
| POSTGRES_PORT      | Postgres port                               |
| REDIS_PASSWORD     | Redis password                              |
| REDIS_HOST         | Redis host                                  |
| REDIS_PORT         | Redis port                                  |
| PORT               | Backend port; 3000 matches the callback URL |

Postgres and Redis run from `devex/docker-compose.yml`, which reads these same
variables. `config.ts` is the only code that reads them.

The OAuth app must be registered in the Atlassian Developer Console with the
callback URL above and the scopes listed in Assumptions.

---

## Scope decisions

The assignment lets us choose which Jira projects and fields to support. What we
chose and why.

| Area                        | Decision                                                                                                                                                                                                                                                          | Reason                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projects                    | Only projects the user can create issues in, from the per-project createmeta endpoints (`getCreateIssueMetaIssueTypes`, `getCreateIssueMetaIssueTypeId`)                                                                                                          | `project/search` also returns browse-only projects that would 403 on create. The bulk `createmeta` is deprecated.                                                          |
| Issue type                  | Always `Task`, validated per project, falling back to the first issue type the project allows if `Task` is absent                                                                                                                                                 | A finding maps to a task; no value in exposing Bug or Story.                                                                                                               |
| Base fields                 | Title to `summary` and Description to `description`, both always shown and both required                                                                                                                                                                          | Required by the assignment; minimal and intuitive.                                                                                                                         |
| Required fields             | Every field the project marks required is rendered dynamically                                                                                                                                                                                                    | So create never fails on a project that requires extra fields.                                                                                                             |
| Optional fields             | A curated set shown only when the project exposes them: priority, labels, assignee, due date, components                                                                                                                                                          | Useful for a real finding without supporting every field.                                                                                                                  |
| Field rendering             | Text fields as inputs, date fields as a date picker (submitting only valid `yyyy-MM-dd`), enum fields (priority, selects) as dropdowns of their `allowedValues`, the assignee (user) field as a dropdown of the project's assignable users, labels as a tag input | Driven by createmeta `required` flag, `schema.type`, and `allowedValues`; the assignee list comes from the assignable-users endpoint so only a valid account is ever sent. |
| Marking app-created tickets | Our `tickets` table stores only issue keys we created (scoped by user; titles fetched live from Jira) plus a Jira label `identityhub-finding`                                                                                                                     | Table is the source of truth for the Recent view; the label is durable and survives a DB reset.                                                                            |
| Out of scope                | Optional fields outside the curated set, arbitrary custom fields, editing/transitioning/deleting issues, attachments, JSM request types, subtasks, epics, links                                                                                                   | Not needed for the POC.                                                                                                                                                    |

---

## Assumptions and decisions

- Atlassian OAuth 2.0 (3LO), Resource-level access, so each user token is scoped
  to the single site the user selects. Different users can be on different sites.
- Jira scopes (classic, per the spec's security definitions for the operations
  we call): `read:jira-work` (createmeta, project search, issue read) and
  `write:jira-work` (issue create), plus `read:me` for the identity call on
  `api.atlassian.com`, plus `offline_access` for refresh tokens.
- One user equals one tenant equals one connected Jira site (see Tenancy model).
- Recent Tickets shows only the acting user's app-created tickets from our own
  `tickets` table, filtered by selected project, capped at 10. Tickets created
  directly in Jira are out of scope by design.
- Machine callers use API keys created by a human in the UI, then configured into
  the scanner or CI system.
- Callback URL for local run: `http://localhost:3000/auth/callback`.
- Not built (documented as future work): per-tenant keys, envelope encryption,
  KMS, OIDC federation for machine callers, rate limiting of our own API.
