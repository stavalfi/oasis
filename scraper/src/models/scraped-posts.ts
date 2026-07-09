/**
 * scraped-posts.ts
 *
 * The scraper's model for its own `scraped_posts` table. This is the ONLY code
 * that touches that table, and the backend never touches it, so the scraper's
 * "already sent" ledger is fully owned by the scraper.
 *
 * The ledger is checked BEFORE publishing and written AFTER a successful publish,
 * so a produce failure leaves no row and the post is re-published next cycle
 * (never lost). A rare duplicate publish is harmless: the backend consumer dedups
 * on its own `blog_posts` table.
 */
import { db } from "../db/database.ts";

export class ScrapedPostsModel {
  /**
   * Whether a post URL has already been recorded as sent.
   *
   * @param postUrl - the canonical post URL.
   */
  public static async exists(postUrl: string): Promise<boolean> {
    const row = await db
      .selectFrom("scraped_posts")
      .select("id")
      .where("post_url", "=", postUrl)
      .executeTakeFirst();
    return row !== undefined;
  }

  /**
   * Record that a post has been published to Kafka. Idempotent: does nothing if
   * the URL is already recorded (`ON CONFLICT DO NOTHING`).
   *
   * @param postUrl - the canonical post URL (unique key).
   * @param title - the post title.
   */
  public static async markSent({
    postUrl,
    title,
  }: {
    postUrl: string;
    title: string;
  }): Promise<void> {
    await db
      .insertInto("scraped_posts")
      .values({ post_url: postUrl, title })
      .onConflict((onConflict) => onConflict.column("post_url").doNothing())
      .execute();
  }
}
