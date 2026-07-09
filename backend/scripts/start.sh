#!/usr/bin/env bash
# Backend startup: run DB migrations, generate Kysely types from the live
# database, then start the server. The backend runs on the Node.js runtime
# (Node strips TypeScript types natively); Bun is only the package manager and
# the frontend runner. Fails fast if any step fails.
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "${repo_root}"

# Load .env into this shell so the discrete POSTGRES_* vars are available for
# composing the codegen URL below. Node commands pass --env-file=.env
# themselves; this `source` is only for the bash-level url composition.
set -a
# VSCode's shellcheck runs without our rcfile (no external-sources), so it can't
# follow .env; disable the "not following" info here. The CLI rcfile does follow
# .env, so it still sees the POSTGRES_* vars used below (no SC2154).
# shellcheck disable=SC1091
source .env
set +a

# Compose the Postgres URL for build-time tooling (kysely-codegen) from the
# discrete POSTGRES_* env vars. The application never uses a URL; this is only
# for the codegen CLI, which requires one.
db_url="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"

echo "==> Running database migrations"
node backend/src/db/migrate.ts

echo "==> Generating Kysely types from the database"
node node_modules/.bin/kysely-codegen --url "${db_url}" --dialect postgres --out-file backend/src/db/schema.ts

# Generate a self-signed TLS cert with the openssl CLI so the server can serve
# https://localhost with Secure cookies and an https OAuth callback. No sudo and
# no OS trust-store install (the browser shows a one-time warning to click
# through). Generated once; reused on later starts. Paths mirror config.server.
cert_dir="backend/certs"
cert_file="${cert_dir}/localhost.crt"
key_file="${cert_dir}/localhost.key"
if [[ ! -f "${cert_file}" || ! -f "${key_file}" ]]; then
  echo "==> Generating self-signed TLS certificate (openssl, no sudo)"
  mkdir -p "${cert_dir}"
  openssl req -x509 -newkey rsa:2048 -sha256 -days 365 -nodes \
    -keyout "${key_file}" -out "${cert_file}" \
    -subj "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1"
fi

echo "==> Building the frontend (served as static files by the backend)"
vite build

echo "==> Starting server"
node backend/src/index.ts | bunx pino-pretty --singleLine
