/**
 * 003-tickets-project-recent-index.ts
 *
 * Recent Tickets is project-wide (every app user's tickets for the selected
 * project are candidates, then filtered by the acting user's Jira visibility),
 * so the query filters by `project_key` and pages newest-first with a keyset on
 * (`created_at`, `id`). The original `tickets_recent_idx` led with `user_id`,
 * which this query never filters on, so it could not serve the read. Replace it
 * with an index whose leading column is `project_key`.
 */
import type { Kysely } from "kysely";

/** Swap the user-led index for a project-led one matching the keyset order. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropIndex("tickets_recent_idx").ifExists().execute();
  await db.schema
    .createIndex("tickets_project_recent_idx")
    .on("tickets")
    .columns(["project_key", "created_at", "id"])
    .execute();
};

/** Restore the original user-led index. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropIndex("tickets_project_recent_idx").ifExists().execute();
  await db.schema
    .createIndex("tickets_recent_idx")
    .on("tickets")
    .columns(["user_id", "project_key", "created_at"])
    .execute();
};
