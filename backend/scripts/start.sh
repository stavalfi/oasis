#!/usr/bin/env bash
# Backend startup: run DB migrations, generate Kysely types from the live
# database, then start the server. The backend runs on the Node.js runtime
# (Node strips TypeScript types natively); Bun is only the package manager and
# the frontend runner. Fails fast if any step fails.
set -euo pipefail

# Compose the Postgres URL for build-time tooling (kysely-codegen) from the
# discrete POSTGRES_* env vars. The application never uses a URL; this is only
# for the codegen CLI, which requires one. These vars come from the environment
# (`bun run backend` loads .env before invoking this script), so shellcheck
# cannot see their assignment.
# shellcheck disable=SC2154
db_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

echo "==> Running database migrations"
node backend/src/db/migrate.ts

echo "==> Generating Kysely types from the database"
bunx kysely-codegen --url "${db_url}" --dialect postgres --out-file backend/src/db/schema.ts

echo "==> Starting server"
node backend/src/index.ts
