/**
 * index.ts
 *
 * Scraper service entry point. Wires the blog client, Kafka producer, and scrape
 * cycle into the poll loop, runs it until a termination signal requests a
 * graceful stop, then closes the Postgres pool so the process exits cleanly. Run
 * (after migrations and type generation) by scraper/scripts/start.ts.
 */
import { OasisBlogClient } from "./blog/blog-client.ts";
import { config } from "./config.ts";
import { db } from "./db/database.ts";
import { KafkaProducer } from "./kafka/producer.ts";
import { logger } from "./lib/logger.ts";
import { ScrapeCycle } from "./services/scrape-cycle.ts";
import { ScraperService } from "./services/scraper-service.ts";

class ScraperApp {
  readonly #service: ScraperService;

  public constructor() {
    const brokers = config.kafka.brokers
      .split(",")
      .map((broker) => broker.trim())
      .filter((broker) => broker.length > 0);
    const producer = new KafkaProducer({
      brokers,
      clientId: config.constants.kafka.clientId,
      topic: config.constants.kafka.topic,
    });
    this.#service = new ScraperService({
      producer,
      scrapeCycle: new ScrapeCycle({ blogClient: new OasisBlogClient(), producer }),
    });
  }

  /** Register the shutdown signal, run the poll loop, and close the pool on exit. */
  public async run(): Promise<void> {
    process.once("SIGTERM", () => this.#service.requestStop());
    try {
      await this.#service.start();
    } catch (error: unknown) {
      logger.error({ err: error }, "Scraper service exited with an error.");
    } finally {
      await db.destroy();
    }
  }
}

await new ScraperApp().run();
