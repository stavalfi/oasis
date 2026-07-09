/**
 * 005-blog-posts.ts
 *
 * Bonus NHI Blog Summary table. The scraper service inserts one row per blog post
 * it discovers (`post_url` unique, so a post is recorded once even across
 * overlapping scrape cycles) and produces a Kafka event only when the insert
 * actually created a row. The backend's Kafka consumer later fills `summary`,
 * `jira_issue_key`, and `ticketed_at`; a non-null `jira_issue_key` marks the post
 * as already ticketed, which makes the consumer idempotent under Kafka's
 * at-least-once delivery. This table is not tenant-scoped: summary tickets are
 * filed by a service account (a hard-coded Jira API token), not a user.
 */
import { sql } from "kysely";
import type { Kysely } from "kysely";

/** Create the blog_posts table shared by the scraper and the backend consumer. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable("blog_posts")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    // Stable per-post URL (Webflow slug); the dedup key for discovery and the
    // idempotency key for the consumer.
    .addColumn("post_url", "text", (col) => col.notNull().unique())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("discovered_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    // Filled by the backend consumer once the post has been summarized and filed.
    .addColumn("summary", "text")
    .addColumn("jira_issue_key", "text")
    .addColumn("ticketed_at", "timestamptz")
    .execute();
};

/** Drop the blog_posts table. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("blog_posts").ifExists().execute();
};
