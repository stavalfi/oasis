/**
 * config.ts
 *
 * Single source of configuration for the scraper service. This is the ONLY file
 * that reads `process.env`; every other module imports `config`. The environment
 * is validated with a Zod schema at import time (unknown variables ignored) and
 * the exported object is deeply frozen. It also holds every magic value so none
 * are hard-coded elsewhere. Mirrors the backend's config conventions.
 */
import { deepFreeze } from "deep-freeze-es6";
import { z } from "zod";

/** Coerce an env string to a finite number, rejecting missing or non-numeric values. */
const numberFromEnv = z.coerce.number().refine(Number.isFinite, "must be a finite number");

/** Schema for the environment variables the scraper needs. Unknown variables are ignored. */
const envSchema = z.object({
  KAFKA_BROKERS: z.string().min(1),
  POSTGRES_DB: z.string().min(1),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_PORT: numberFromEnv,
  POSTGRES_USER: z.string().min(1),
});

const env = envSchema.parse(process.env);

/** Typed, deeply frozen scraper configuration. Import this; never read process.env directly. */
export const config = deepFreeze({
  constants: {
    // Oasis blog scraping (cheerio over the server-rendered Webflow HTML).
    blog: {
      listUrl: "https://www.oasis.security/blog",
      // Cap posts inspected per cycle, so the first run's backfill is bounded.
      maxPostsPerCycle: 20,
      // ky transport retries for the GETs (idempotent), jittered backoff.
      maxRetries: 3,
      requestTimeoutMs: 15_000,
      // Truncate each post body to this many characters before publishing, so a
      // Kafka message (and the downstream AI call) stays bounded.
      summaryInputMaxChars: 12_000,
      // A descriptive UA, so the blog's logs show who is fetching.
      userAgent: "IdentityHub-BlogSummary/1.0 (+https://oasis.security)",
    },
    // Kafka producer wiring. The topic must match the backend consumer's topic.
    kafka: {
      clientId: "identityhub-scraper",
      topic: "nhi-blog-posts",
    },
    // pino log level.
    logLevel: "info",
    // How many posts to process (check -> fetch body -> publish -> record)
    // concurrently within one scrape cycle. Keep this at or under the Postgres
    // pool size so workers don't starve for a connection.
    maxConcurrentPosts: 10,
    // How long to wait between scrape cycles.
    pollIntervalSeconds: 3600,
    // Sized to cover the concurrent per-post workers (maxConcurrentPosts) so a
    // worker never blocks waiting for a connection.
    postgres: {
      poolMax: 10,
    },
  },
  kafka: {
    brokers: env.KAFKA_BROKERS,
  },
  postgres: {
    database: env.POSTGRES_DB,
    host: env.POSTGRES_HOST,
    password: env.POSTGRES_PASSWORD,
    port: env.POSTGRES_PORT,
    user: env.POSTGRES_USER,
  },
} as const);

export type Config = typeof config;
