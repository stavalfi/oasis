/**
 * ensure-topic.ts
 *
 * Creates a Kafka topic if it does not already exist, so a consumer can subscribe
 * (or a producer can publish) without racing broker auto-creation. Idempotent:
 * `createTopics` is a no-op when the topic already exists. Shared by the backend
 * consumer and the scraper producer, so either service can be the first to start.
 */
import type { Kafka } from "kafkajs";

export class KafkaTopic {
  /**
   * Ensure a topic exists with the given partition count. Connects a short-lived
   * admin client, creates the topic (no-op if present), and disconnects.
   *
   * @param kafka - the Kafka client to administer.
   * @param topic - the topic name.
   * @param numPartitions - partitions to create the topic with, if it is new.
   */
  public static async ensure({
    kafka,
    topic,
    numPartitions,
  }: {
    kafka: Kafka;
    topic: string;
    numPartitions: number;
  }): Promise<void> {
    const admin = kafka.admin();
    await admin.connect();
    try {
      // List first and create only when missing, so the common "already exists"
      // case does not make kafkajs log a noisy CreateTopics error.
      const existing = await admin.listTopics();
      if (!existing.includes(topic)) {
        await admin.createTopics({ topics: [{ numPartitions, topic }] });
      }
    } finally {
      await admin.disconnect();
    }
  }
}
