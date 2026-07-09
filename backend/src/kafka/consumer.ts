/**
 * consumer.ts
 *
 * The single class through which the backend consumes Kafka. It subscribes to
 * the blog-post topic, validates each message against the shared schema, and
 * hands valid messages to the injected handler. Delivery is at-least-once: if the
 * handler throws, the offset is not committed and Kafka redelivers, so a
 * transient failure (AI or Jira upstream) is retried. A message that fails schema
 * validation can never succeed, so it is logged and skipped (committed) rather
 * than retried forever.
 *
 * Rate limits are a special transient case: when the handler throws a
 * {@link RateLimitError} (an upstream 429 that outlived its own retries), the
 * handler sleeps for a fixed window before rethrowing (offset uncommitted).
 * Blocking here waits out the limit before Kafka redelivers, instead of
 * tight-looping on redelivery.
 */
import { scheduler } from "node:timers/promises";
import { Kafka, logLevel } from "kafkajs";
import type { Consumer, EachMessagePayload } from "kafkajs";
import { KafkaTopic } from "./ensure-topic.ts";
import { config } from "../config.ts";
import type { Logger } from "../lib/logger.ts";
import { logger } from "../lib/logger.ts";
import { RateLimitError } from "../lib/rate-limit-error.ts";
import { blogPostMessageSchema } from "./schemas.ts";
import type { BlogPostMessage } from "./schemas.ts";

/** Handles one validated blog-post message; throwing triggers redelivery. */
type BlogPostHandler = (message: BlogPostMessage) => Promise<void>;

export class BlogPostConsumer {
  readonly #kafka: Kafka;
  readonly #consumer: Consumer;
  readonly #topic: string;
  readonly #topicPartitions: number;
  readonly #handler: BlogPostHandler;
  readonly #logger: Logger;

  public constructor({
    brokers,
    clientId,
    groupId,
    topic,
    topicPartitions,
    handler,
  }: {
    brokers: string[];
    clientId: string;
    groupId: string;
    topic: string;
    topicPartitions: number;
    handler: BlogPostHandler;
  }) {
    this.#topic = topic;
    this.#topicPartitions = topicPartitions;
    this.#handler = handler;
    this.#logger = logger.child({ component: "blog-post-consumer" });
    this.#kafka = new Kafka({ brokers, clientId, logLevel: logLevel.WARN });
    this.#consumer = this.#kafka.consumer({ groupId });
  }

  /** Connect, subscribe from the beginning, and process messages until stopped. */
  public async start(): Promise<void> {
    // Create the topic if it does not exist yet, so the consumer can start
    // regardless of whether the scraper has produced anything (subscribing to a
    // missing topic otherwise fails).
    await KafkaTopic.ensure({
      kafka: this.#kafka,
      numPartitions: this.#topicPartitions,
      topic: this.#topic,
    });
    await this.#consumer.connect();
    await this.#consumer.subscribe({ fromBeginning: true, topic: this.#topic });
    await this.#consumer.run({
      eachMessage: async ({ message }: EachMessagePayload): Promise<void> => {
        const { value } = message;
        if (value === null) {
          return;
        }
        let parsed: BlogPostMessage;
        try {
          parsed = blogPostMessageSchema.parse(JSON.parse(value.toString()));
        } catch (error: unknown) {
          this.#logger.error({ err: error }, "Skipping malformed blog-post message.");
          return;
        }
        try {
          await this.#handler(parsed);
        } catch (error: unknown) {
          if (error instanceof RateLimitError) {
            this.#logger.warn(
              { pauseMs: config.constants.rateLimitPauseMs },
              "Upstream rate-limited (429); sleeping before redelivery.",
            );
            await scheduler.wait(config.constants.rateLimitPauseMs);
          }
          throw error;
        }
      },
    });
    this.#logger.info({ topic: this.#topic }, "Blog-post consumer started.");
  }

  /** Disconnect the consumer (graceful shutdown). */
  public async stop(): Promise<void> {
    await this.#consumer.disconnect();
  }
}
