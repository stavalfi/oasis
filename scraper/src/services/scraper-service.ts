/**
 * scraper-service.ts
 *
 * The scraper's long-running poll loop. Connects the Kafka producer, then runs a
 * scrape cycle every `pollIntervalSeconds`, logging and continuing on failure so
 * one bad cycle never stops the service. A single AbortController drives
 * shutdown: `requestStop` aborts it, which both ends the loop and makes the
 * interval wait (`scheduler.wait`) return immediately, so the service stops
 * promptly. The producer is disconnected in a `finally`. Deployed as a
 * single-replica StatefulSet, so exactly one instance polls at a time.
 */
import { scheduler } from "node:timers/promises";
import { config } from "../config.ts";
import type { Logger } from "../lib/logger.ts";
import { logger } from "../lib/logger.ts";
import type { KafkaProducer } from "../kafka/producer.ts";
import type { ScrapeCycle } from "./scrape-cycle.ts";

const MILLISECONDS_PER_SECOND = 1000;

export class ScraperService {
  readonly #scrapeCycle: ScrapeCycle;
  readonly #producer: KafkaProducer;
  readonly #logger: Logger;
  readonly #abortController = new AbortController();

  public constructor({
    scrapeCycle,
    producer,
  }: {
    scrapeCycle: ScrapeCycle;
    producer: KafkaProducer;
  }) {
    this.#scrapeCycle = scrapeCycle;
    this.#producer = producer;
    this.#logger = logger.child({ component: "scraper-service" });
  }

  /** Run the poll loop until stopped. Disconnects the producer on exit. */
  public async start(): Promise<void> {
    await this.#producer.connect();
    this.#logger.info(
      { pollIntervalSeconds: config.constants.pollIntervalSeconds },
      "Scraper started.",
    );
    const { signal } = this.#abortController;
    try {
      while (!signal.aborted) {
        try {
          await this.#scrapeCycle.runOnce();
        } catch (error: unknown) {
          this.#logger.error({ err: error }, "Scrape cycle failed; retrying next interval.");
        }
        try {
          await scheduler.wait(config.constants.pollIntervalSeconds * MILLISECONDS_PER_SECOND, {
            signal,
          });
        } catch {
          // The wait was aborted by requestStop: exit the loop.
          break;
        }
      }
    } finally {
      await this.#producer.disconnect();
      this.#logger.info("Scraper stopped.");
    }
  }

  /** Request a graceful stop: abort the loop and the current interval wait. */
  public requestStop(): void {
    this.#abortController.abort();
  }
}
