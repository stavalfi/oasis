/**
 * 001-scraped-posts.ts
 *
 * The scraper's OWN table, migrated and touched only by the scraper service. It
 * is the scraper's dedup ledger: one row per blog post the scraper has seen, so
 * a post is announced to Kafka exactly once. `post_url` is unique, which makes
 * insert-if-new the single point of dedup even across overlapping scrape cycles.
 *
 * This table is deliberately separate from the backend's `blog_posts` table so
 * the two services never share a table or a migration history. The scraper's
 * migrations are tracked in their own `scraper_kysely_migration` table (see
 * scraper/src/db/migrate.ts), independent of the backend's migrations.
 */
import { sql } from "kysely";
import type { Kysely } from "kysely";

/** Create the scraped_posts dedup ledger. */
export const up = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema
    .createTable("scraped_posts")
    .addColumn("id", "uuid", (col) => col.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn("post_url", "text", (col) => col.notNull().unique())
    .addColumn("title", "text", (col) => col.notNull())
    .addColumn("discovered_at", "timestamptz", (col) => col.notNull().defaultTo(sql`now()`))
    .execute();
};

/** Drop the scraped_posts table. */
export const down = async (db: Kysely<unknown>): Promise<void> => {
  await db.schema.dropTable("scraped_posts").ifExists().execute();
};
