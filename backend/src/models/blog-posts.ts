/**
 * blog-posts.ts
 *
 * Backend model for the `blog_posts` table (bonus NHI Blog Summary). This table is
 * owned entirely by the backend consumer: it records each post the consumer has
 * summarized and filed as a Jira issue. It is separate from the scraper's
 * `scraped_posts` table (the scraper never touches this one), so the two services
 * share no table. A row exists only after a ticket was created, which is what
 * makes the consumer idempotent under Kafka's at-least-once delivery. The only
 * backend code that reads or writes `blog_posts`.
 */
import { db } from "../db/database.ts";

export class BlogPostsModel {
  /**
   * Look up a filed post by its URL. Returns its Jira issue key if the post has
   * already been filed, or undefined if it has not, so the consumer can skip a
   * redelivered message.
   *
   * @param postUrl - the post URL from the Kafka message.
   */
  public static async findByUrl(postUrl: string): Promise<{ jiraIssueKey: string } | undefined> {
    const row = await db
      .selectFrom("blog_posts")
      .select("jira_issue_key")
      .where("post_url", "=", postUrl)
      .executeTakeFirst();
    if (row?.jira_issue_key === undefined || row.jira_issue_key === null) {
      return undefined;
    }
    return { jiraIssueKey: row.jira_issue_key };
  }

  /**
   * Record a post that was summarized and filed as a Jira issue. Does nothing if
   * a row for the URL already exists (`ON CONFLICT DO NOTHING`), so two consumers
   * racing the same message cannot create two rows.
   *
   * @param postUrl - the post URL (unique key).
   * @param title - the post title.
   * @param summary - the AI-generated summary stored for the record.
   * @param jiraIssueKey - the created Jira issue key.
   */
  public static async recordFiled({
    postUrl,
    title,
    summary,
    jiraIssueKey,
  }: {
    postUrl: string;
    title: string;
    summary: string;
    jiraIssueKey: string;
  }): Promise<void> {
    await db
      .insertInto("blog_posts")
      .values({
        jira_issue_key: jiraIssueKey,
        post_url: postUrl,
        summary,
        ticketed_at: new Date(),
        title,
      })
      .onConflict((onConflict) => onConflict.column("post_url").doNothing())
      .execute();
  }
}
