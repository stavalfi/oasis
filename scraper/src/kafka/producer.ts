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
import { KafkaTopic } from "#backend/kafka/ensure-topic.ts";
import { blogPostMessageSchema } from "#backend/kafka/schemas.ts";
import type { BlogPostMessage } from "#backend/kafka/schemas.ts";

export class KafkaProducer {
  readonly #kafka: Kafka;
  readonly #producer: Producer;
  readonly #topic: string;
  readonly #topicPartitions: number;

  public constructor({
    brokers,
    clientId,
    topic,
    topicPartitions,
  }: {
    brokers: string[];
    clientId: string;
    topic: string;
    topicPartitions: number;
  }) {
    this.#topic = topic;
    this.#topicPartitions = topicPartitions;
    this.#kafka = new Kafka({ brokers, clientId, logLevel: logLevel.WARN });
    // Set the partitioner explicitly to the modern default (silences kafkajs's
    // "switched default partitioner" migration warning without changing behavior).
    this.#producer = this.#kafka.producer({ createPartitioner: Partitioners.DefaultPartitioner });
  }

  /** Ensure the topic exists, then connect the producer (call once before publishing). */
  public async connect(): Promise<void> {
    await KafkaTopic.ensure({
      kafka: this.#kafka,
      numPartitions: this.#topicPartitions,
      topic: this.#topic,
    });
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
