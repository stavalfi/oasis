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
 */
import { Kafka, logLevel } from "kafkajs";
import type { Consumer, EachMessagePayload } from "kafkajs";
import type { Logger } from "../lib/logger.ts";
import { logger } from "../lib/logger.ts";
import { blogPostMessageSchema } from "./schemas.ts";
import type { BlogPostMessage } from "./schemas.ts";

/** Handles one validated blog-post message; throwing triggers redelivery. */
type BlogPostHandler = (message: BlogPostMessage) => Promise<void>;

export class BlogPostConsumer {
  readonly #consumer: Consumer;
  readonly #topic: string;
  readonly #handler: BlogPostHandler;
  readonly #logger: Logger;

  public constructor({
    brokers,
    clientId,
    groupId,
    topic,
    handler,
  }: {
    brokers: string[];
    clientId: string;
    groupId: string;
    topic: string;
    handler: BlogPostHandler;
  }) {
    this.#topic = topic;
    this.#handler = handler;
    this.#logger = logger.child({ component: "blog-post-consumer" });
    this.#consumer = new Kafka({ brokers, clientId, logLevel: logLevel.WARN }).consumer({
      groupId,
    });
  }

  /** Connect, subscribe from the beginning, and process messages until stopped. */
  public async start(): Promise<void> {
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
        await this.#handler(parsed);
      },
    });
    this.#logger.info({ topic: this.#topic }, "Blog-post consumer started.");
  }

  /** Disconnect the consumer (graceful shutdown). */
  public async stop(): Promise<void> {
    await this.#consumer.disconnect();
  }
}
