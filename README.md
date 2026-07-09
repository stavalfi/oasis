# IdentityHub

Proof of concept: report NHI (Non-Human Identity) findings as Jira tickets.
Design docs: [backend](docs/backend-design.md), [frontend](docs/frontend-design.md).

## Prerequisites

- Nodejs v26 (runtime), Bun (as package manager & frontend runner), Docker (for Postgres and Redis).
- A `.env` file with the Jira OAuth credentials and Postgres/Redis settings
  (see the Run locally section of the backend design doc for the full list).

## Setup

```bash
bun install
bun run docker-compose:up   # start Postgres and Redis
```

## Run

```bash
bun run backend    # migrate DB -> generate Kysely types -> start server + serve the frontend
```

now go to: https://localhost:3000
