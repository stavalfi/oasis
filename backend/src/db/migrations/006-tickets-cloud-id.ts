/**
 * 006-tickets-cloud-id.ts
 *
 * A ticket references a Jira issue key, which is only unique inside a single
 * Jira site: two users on different sites can each have a "KAN" project, so a
 * project-scoped Recent Tickets feed keyed by `project_key` alone leaks rows
 * across tenants and shows duplicates. Add `cloud_id` (the Jira site) to the
 * ticket, and rebuild the recent-tickets index so the read filters by
 * (`cloud_id`, `project_key`). Existing rows are dropped: they carry no
 * `cloud_id` and cannot be safely backfilled to a specific site.
 */
import { sql } from "kysely";
import type { Kysely } from "kysely";

/** Add cloud_id (after clearing rows) and rebuild the recent-tickets index. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropIndex("tickets_project_recent_idx").ifExists().execute();
  await sql`DELETE FROM tickets`.execute(db);
  await db.schema
    .alterTable("tickets")
    .addColumn("cloud_id", "text", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("tickets_project_recent_idx")
    .on("tickets")
    .columns(["cloud_id", "project_key", "created_at", "id"])
    .execute();
};

/** Drop cloud_id and restore the previous (project-only) recent-tickets index. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropIndex("tickets_project_recent_idx").ifExists().execute();
  await db.schema.alterTable("tickets").dropColumn("cloud_id").execute();
  await db.schema
    .createIndex("tickets_project_recent_idx")
    .on("tickets")
    .columns(["project_key", "created_at", "id"])
    .execute();
};
