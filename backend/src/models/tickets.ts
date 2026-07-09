/**
 * tickets.ts
 *
 * Model for the `tickets` table: references to issues we created (issue key plus
 * created_at), scoped by user. Content lives in Jira; this table decides which
 * issues appear in Recent Tickets and in what order. The only code that reads or
 * writes `tickets`.
 */
import { db } from "../db/database.ts";
import type { TicketRow } from "./types.ts";

export class TicketsModel {
  /** Record an issue we created through the app. */
  public static insert({
    userId,
    projectKey,
    jiraIssueKey,
  }: {
    userId: string;
    projectKey: string;
    jiraIssueKey: string;
  }): Promise<TicketRow> {
    return db
      .insertInto("tickets")
      .values({ jira_issue_key: jiraIssueKey, project_key: projectKey, user_id: userId })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  /**
   * A page of app-created tickets for a project, newest first, capped at
   * `limit`. Project-scoped (not per-user): every app user's tickets for the
   * project are candidates; the service then drops any the acting user cannot
   * see in Jira. Because that visibility filter runs after this read, the caller
   * pages with `olderThan` (keyset on `created_at`, `id`) until it has collected
   * enough visible rows, instead of a single DB `LIMIT` that would be truncated
   * by the filter.
   *
   * @param olderThan - keyset cursor; returns only rows strictly older than it.
   */
  public static listRecentCandidates({
    projectKey,
    limit,
    olderThan,
  }: {
    projectKey: string;
    limit: number;
    olderThan: { createdAt: Date; id: string } | undefined;
  }): Promise<TicketRow[]> {
    let query = db.selectFrom("tickets").selectAll().where("project_key", "=", projectKey);
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
