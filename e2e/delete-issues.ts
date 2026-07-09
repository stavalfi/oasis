/**
 * delete-issues.ts
 *
 * Deletes the given Jira issue keys, used by the e2e per-test cleanup. Reads the
 * connected user from the DB, gets a fresh access token, and DELETEs each issue.
 * Run: `node --env-file=.env e2e/delete-issues.ts KAN-1 KAN-2 ...`.
 */
// A short-lived cleanup script that opens the app's DB/Redis pools; exit() is
// the simplest way to stop it from hanging on those open handles.
// oxlint-disable unicorn/no-process-exit
import ky from "ky";
import { Pool } from "pg";
import { config } from "#backend/config.ts";
import { JiraAccess } from "#backend/services/jira-access.ts";

const issueKeys = process.argv.slice(2);
if (issueKeys.length === 0) {
  process.exit(0);
}

const pool = new Pool({
  database: process.env["POSTGRES_DB"],
  host: process.env["POSTGRES_HOST"],
  password: process.env["POSTGRES_PASSWORD"],
  port: Number(process.env["POSTGRES_PORT"]),
  user: process.env["POSTGRES_USER"],
});
const { rows } = await pool.query("select user_id from jira_connections limit 1");
await pool.end();
const userId: unknown = rows[0]?.user_id;
if (typeof userId !== "string") {
  process.exit(0);
}

await JiraAccess.withConnection({
  operation: async (connection) => {
    await Promise.all(
      issueKeys.map((key) =>
        ky.delete(
          `${config.constants.jira.apiBaseUrl}/${connection.cloudId}/rest/api/3/issue/${key}`,
          {
            headers: { Authorization: `Bearer ${connection.accessToken}` },
            throwHttpErrors: false,
          },
        ),
      ),
    );
  },
  userId,
});
console.log(`deleted ${issueKeys.length} issue(s): ${issueKeys.join(", ")}`);
process.exit(0);
