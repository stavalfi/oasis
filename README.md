# IdentityHub

Proof of concept: report NHI (Non-Human Identity) findings as Jira tickets.
Design docs: [backend](docs/backend-design.md), [frontend](docs/frontend-design.md).

## Prerequisites

- Bun, Docker (for Postgres and Redis).
- A `.env` file with the Jira OAuth credentials and Postgres/Redis settings
  (see the Run locally section of the backend design doc for the full list).

## Setup

```bash
bun install
bun run docker-compose:up   # start Postgres and Redis
```

## Run

Two commands, run each in its own terminal.

```bash
bun run backend    # migrate DB -> generate Kysely types -> start server
bun run frontend   # start the React dev server (Bun bundler + hot reload)
```

- `bun run backend` runs `backend/scripts/start.sh`, which (1) applies database
  migrations, (2) generates the Kysely schema types from the live database, then
  (3) starts the Hono server.
- `bun run frontend` runs `bun --hot frontend/src/index.html`, which serves the
  React app with Bun's bundler and hot reload.

The backend serves over HTTPS locally at `https://localhost:3000` using a
locally-trusted certificate from `devcert` (first run may prompt for sudo to
install its root CA). It serves the API, Swagger UI at `/docs`, and health
probes at `/health/live` and `/health/ready`.
