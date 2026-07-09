/**
 * global-setup.ts
 *
 * Seeds an authenticated session for the e2e run. Real Jira OAuth can't be
 * scripted (password/SSO/MFA), so instead of logging in through the browser we
 * mint a session row for the already-connected Jira user and write it as a
 * Playwright storageState cookie. Every test then starts logged in as that user
 * and drives the real UI + real Jira from there.
 *
 * Requires the local Postgres (from docker-compose) to be reachable and at
 * least one row in `jira_connections` (i.e. you have logged in via the app once).
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const STORAGE_STATE = path.join(import.meta.dirname, ".auth", "state.json");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const globalSetup = async (): Promise<void> => {
  process.loadEnvFile(path.join(import.meta.dirname, "..", "..", ".env"));

  const pool = new Pool({
    database: process.env["POSTGRES_DB"],
    host: process.env["POSTGRES_HOST"],
    password: process.env["POSTGRES_PASSWORD"],
    port: Number(process.env["POSTGRES_PORT"]),
    user: process.env["POSTGRES_USER"],
  });

  const connected = await pool.query("select user_id from jira_connections limit 1");
  const userId: unknown = connected.rows[0]?.user_id;
  if (typeof userId !== "string") {
    await pool.end();
    throw new Error("No connected Jira user found. Log in via the app once, then re-run.");
  }

  const sessionId = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await pool.query("insert into sessions (session_id, user_id, expires_at) values ($1, $2, $3)", [
    sessionId,
    userId,
    expiresAt,
  ]);
  await pool.end();

  await mkdir(path.dirname(STORAGE_STATE), { recursive: true });
  await writeFile(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [
        {
          domain: "localhost",
          expires: Math.floor(expiresAt.getTime() / 1000),
          httpOnly: true,
          name: "ih_session",
          path: "/",
          sameSite: "Lax",
          secure: false,
          value: sessionId,
        },
      ],
      origins: [],
    }),
  );
};

// oxlint-disable-next-line import/no-default-export
export default globalSetup;
