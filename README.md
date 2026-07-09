# IdentityHub

Proof of concept: report NHI (Non-Human Identity) findings as Jira tickets.
Design docs: [backend](docs/backend-design.md), [frontend](docs/frontend-design.md).

## Prerequisites

- nodejs v26
- Docker (for Postgres and Redis)
- chromium (for frontend e2e tests)
- A `.env` file with the Jira OAuth credentials and Postgres/Redis settings
  (see the Run locally section of the backend design doc for the full list).

## Setup

```bash
npm install
npm run docker-compose:up   # start Postgres and Redis
```

## Run

```bash
npm run backend    # migrate DB -> generate Kysely types -> start server + serve the frontend
npm run scraper    # migrate DB -> generate Kysely types -> start scraper -->> bonus task
```

now go to: http://localhost:3000
