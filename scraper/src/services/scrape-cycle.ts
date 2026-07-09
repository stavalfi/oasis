/**
 * scrape-cycle.ts
 *
 * One scrape cycle: fetch the blog listing, then process each post concurrently
 * (bounded by `maxConcurrentPosts`). For each unseen post it fetches the body,
 * publishes to Kafka, and then records it in `scraped_posts`. Publishing before
 * recording means a produce failure leaves no row, so the post is retried next
 * cycle rather than lost; a rare duplicate publish is deduped by the backend
 * consumer. The per-post work is independent, so it parallelizes cleanly.
 */
import pLimit from "p-limit";
import type { BlogPostRef, OasisBlogClient } from "../blog/blog-client.ts";
import { config } from "../config.ts";
import type { Logger } from "../lib/logger.ts";
import { logger } from "../lib/logger.ts";
import { ScrapedPostsModel } from "../models/scraped-posts.ts";
import type { KafkaProducer } from "../kafka/producer.ts";

export class ScrapeCycle {
  readonly #blogClient: OasisBlogClient;
  readonly #producer: KafkaProducer;
  readonly #logger: Logger;

  public constructor({
    blogClient,
    producer,
  }: {
    blogClient: OasisBlogClient;
    producer: KafkaProducer;
  }) {
    this.#blogClient = blogClient;
    this.#producer = producer;
    this.#logger = logger.child({ component: "scrape-cycle" });
  }

  /**
   * Run one cycle: discover posts and process them concurrently, bounded by
   * `maxConcurrentPosts`. Throws if the listing cannot be parsed, so the caller
   * can log and retry next interval.
   */
  public async runOnce(): Promise<void> {
    const posts = await this.#blogClient.fetchPosts();
    // Bound the per-post work to `maxConcurrentPosts` concurrent tasks. p-limit
    // gives a rolling limit: a new post starts as soon as one finishes, rather
    // than lock-step batches.
    const limit = pLimit(config.constants.maxConcurrentPosts);
    const results = await Promise.all(posts.map((post) => limit(() => this.#processPost(post))));
    const announced = results.filter(Boolean).length;
    this.#logger.info({ announced, scanned: posts.length }, "Scrape cycle complete.");
  }

  /**
   * Process one post: skip it if already sent, else fetch its body, publish it,
   * and record it. Returns true if the post was announced (published).
   *
   * @param post - the discovered post reference.
   */
  async #processPost(post: BlogPostRef): Promise<boolean> {
    const alreadySent = await ScrapedPostsModel.exists(post.url);
    if (alreadySent) {
      return false;
    }
    // Publish BEFORE recording, so a produce failure leaves no row and the post
    // is retried next cycle rather than silently lost. A rare duplicate publish
    // is harmless: the backend consumer dedups on its own table.
    const content = await this.#blogClient.fetchContent(post);
    await this.#producer.publish({ content, postUrl: post.url, title: post.title });
    await ScrapedPostsModel.markSent({ postUrl: post.url, title: post.title });
    this.#logger.info({ postUrl: post.url, title: post.title }, "Announced new blog post.");
    return true;
  }
}
