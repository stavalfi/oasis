/**
 * producer.ts
 *
 * The single class through which the scraper produces to Kafka. It validates
 * every message against the shared schema (imported from the backend) before
 * sending, so producer and consumer cannot drift. The post URL is used as the
 * message key, so all events for a post land on the same partition.
 */
import { Kafka, Partitioners, logLevel } from "kafkajs";
import type { Producer } from "kafkajs";
import { blogPostMessageSchema } from "#backend/kafka/schemas.ts";
import type { BlogPostMessage } from "#backend/kafka/schemas.ts";

export class KafkaProducer {
  readonly #producer: Producer;
  readonly #topic: string;

  public constructor({
    brokers,
    clientId,
    topic,
  }: {
    brokers: string[];
    clientId: string;
    topic: string;
  }) {
    this.#topic = topic;
    // Set the partitioner explicitly to the modern default (silences kafkajs's
    // "switched default partitioner" migration warning without changing behavior).
    this.#producer = new Kafka({ brokers, clientId, logLevel: logLevel.WARN }).producer({
      createPartitioner: Partitioners.DefaultPartitioner,
    });
  }

  /** Connect the producer (call once before publishing). */
  public async connect(): Promise<void> {
    await this.#producer.connect();
  }

  /** Disconnect the producer (graceful shutdown). */
  public async disconnect(): Promise<void> {
    await this.#producer.disconnect();
  }

  /**
   * Validate and publish one blog-post event.
   *
   * @param message - the event payload (post url, title, content).
   */
  public async publish(message: BlogPostMessage): Promise<void> {
    const validated = blogPostMessageSchema.parse(message);
    await this.#producer.send({
      messages: [{ key: validated.postUrl, value: JSON.stringify(validated) }],
      topic: this.#topic,
    });
  }
}
