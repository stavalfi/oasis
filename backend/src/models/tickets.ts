/**
 * tickets.ts
 *
 * Model for the `tickets` table: references to issues we created (issue key
 * plus created_at), scoped by user and by Jira site. Content lives in Jira;
 * this table decides which issues appear in Recent Tickets and in what order.
 * The only code that reads or writes `tickets`.
 */
import { db } from "../db/database.ts";
import type { TicketRow } from "./types.ts";

export class TicketsModel {
  /** Record an issue we created through the app. */
  public static insert({
    userId,
    cloudId,
    projectKey,
    jiraIssueKey,
  }: {
    userId: string;
    cloudId: string;
    projectKey: string;
    jiraIssueKey: string;
  }): Promise<TicketRow> {
    return db
      .insertInto("tickets")
      .values({
        cloud_id: cloudId,
        jira_issue_key: jiraIssueKey,
        project_key: projectKey,
        user_id: userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * A page of app-created tickets for a project, newest first, capped at
   * `limit`. Scoped to the acting user's Jira site (`cloud_id`) and not per-user
   * within it: every app user connected to the same site is a candidate, and
   * the service then drops any row the acting user cannot see in Jira. Scoping
   * by site is what keeps issue keys unambiguous, since a key like `KAN-4` is
   * only unique inside one Jira site. Because the visibility filter runs after
   * this read, the caller pages with `olderThan` (keyset on `created_at`, `id`)
   * until it has collected enough visible rows, instead of a single DB `LIMIT`
   * that would be truncated by the filter.
   *
   * @param olderThan - keyset cursor; returns only rows strictly older than it.
   */
  public static listRecentCandidates({
    cloudId,
    projectKey,
    limit,
    olderThan,
  }: {
    cloudId: string;
    projectKey: string;
    limit: number;
    olderThan: { createdAt: Date; id: string } | undefined;
  }): Promise<TicketRow[]> {
    let query = db
      .selectFrom("tickets")
      .selectAll()
      .where("cloud_id", "=", cloudId)
      .where("project_key", "=", projectKey);
    if (olderThan !== undefined) {
      const cursor = olderThan;
      query = query.where((eb) =>
        eb.or([
          eb("created_at", "<", cursor.createdAt),
          eb.and([eb("created_at", "=", cursor.createdAt), eb("id", "<", cursor.id)]),
        ]),
      );
    }
    return query.orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).execute();
  }
}
