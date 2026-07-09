/**
 * 002-jira-connection-version.ts
 *
 * Adds an optimistic-concurrency `version` to jira_connections. Token refresh
 * reads the row, then writes conditionally on this version, so even if the
 * per-user refresh lock is ever bypassed (Redis failover, a lost auto-extend), a
 * slow writer can never clobber a newer, already-rotated token pair.
 */
import { sql } from "kysely";
import type { Kysely } from "kysely";

/** Add the version column (existing rows start at 1). */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .alterTable("jira_connections")
    .addColumn("version", "integer", (col) => col.notNull().defaultTo(sql`1`))
    .execute();
};

/** Drop the version column. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.alterTable("jira_connections").dropColumn("version").execute();
};
