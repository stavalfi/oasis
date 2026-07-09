/**
 * schemas.ts
 *
 * The Kafka message contract for the blog-summary topic, shared by the producer
 * (the scraper service) and the consumer (this backend). One Zod schema is the
 * single source of truth for the event shape, so producer and consumer cannot
 * drift: the scraper validates before publishing and the consumer validates
 * every consumed message before acting on it.
 */
import { z } from "zod";

/**
 * A newly discovered blog post announced by the scraper. `content` is the post
 * body already extracted and truncated by the scraper, so the consumer never has
 * to fetch or parse the blog itself.
 */
export const blogPostMessageSchema = z.object({
  content: z.string().min(1),
  postUrl: z.string().min(1),
  title: z.string().min(1),
});

export type BlogPostMessage = z.infer<typeof blogPostMessageSchema>;
