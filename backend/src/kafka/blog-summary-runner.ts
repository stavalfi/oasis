/**
 * blog-summary-runner.ts
 *
 * Wires and runs the blog-summary Kafka consumer. Whether the feature runs is
 * decided entirely by `config.blogSummary`, which the config layer validates as
 * an all-or-none group (none set -> undefined -> disabled; partially set -> a
 * startup error). So this runner only has to check for undefined: if the config
 * is present it constructs the AI client, the handler, and the consumer, and
 * starts consuming.
 */
import { AiSummaryClient } from "../ai/ai-client.ts";
import { config } from "../config.ts";
import { logger } from "../lib/logger.ts";
import { BlogSummaryService } from "../services/blog-summary.ts";
import { BlogPostConsumer } from "./consumer.ts";

export class BlogSummaryRunner {
  #consumer: BlogPostConsumer | undefined;

  /** Start the consumer if the blog-summary feature is configured. */
  public async start(): Promise<void> {
    const { blogSummary } = config;
    if (blogSummary === undefined) {
      logger.info("Blog-summary consumer disabled: no blog-summary configuration set.");
      return;
    }
    const service = new BlogSummaryService({
      aiClient: new AiSummaryClient(blogSummary.aiApiKey),
      jiraSummary: blogSummary.jira,
    });
    this.#consumer = new BlogPostConsumer({
      brokers: [...blogSummary.brokers],
      clientId: config.constants.kafka.clientId,
      groupId: config.constants.kafka.consumerGroupId,
      handler: (message): Promise<void> => service.handle(message),
      topic: config.constants.kafka.topic,
    });
    await this.#consumer.start();
  }

  /** Stop the consumer if it was started. */
  public async stop(): Promise<void> {
    if (this.#consumer !== undefined) {
      await this.#consumer.stop();
    }
  }
}
