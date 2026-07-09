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
   * The most recent app-created tickets for a project, newest first, capped at
   * `limit`. Project-scoped (not per-user): every app user's tickets for the
   * project appear, matching the "Recent Tickets for the selected project" view.
   */
  public static listRecent({
    projectKey,
    limit,
  }: {
    projectKey: string;
    limit: number;
  }): Promise<TicketRow[]> {
    return db
      .selectFrom("tickets")
      .selectAll()
      .where("project_key", "=", projectKey)
      .orderBy("created_at", "desc")
      .limit(limit)
      .execute();
  }
}
