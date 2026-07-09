/**
 * index.ts
 *
 * Backend entry point. Runs on the Node.js runtime and serves the assembled
 * Hono app over HTTP (via @hono/node-server). After the server is listening it
 * starts the optional blog-summary Kafka consumer (bonus): a failure there is
 * logged but never stops the web API. Run (after migrations and type generation)
 * by backend/scripts/start.ts.
 */
import { serve } from "@hono/node-server";
import { app } from "./api/app.ts";
import { config } from "./config.ts";
import { BlogSummaryRunner } from "./kafka/blog-summary-runner.ts";
import { logger } from "./lib/logger.ts";

class BackendServer {
  readonly #blogSummaryRunner = new BlogSummaryRunner();

  /**
   * Serve the HTTP app, then start the blog-summary consumer after the server is
   * already listening, so a slow or failed Kafka connection never delays or
   * blocks the web API. A consumer start failure is logged, not fatal.
   */
  public async run(): Promise<void> {
    serve({ fetch: app.fetch, port: config.server.port }, (info) => {
      const url = `http://localhost:${info.port}`;
      logger.info({ url }, `IdentityHub ready. Open the UI at ${url}`);
    });
    process.once("SIGTERM", async (): Promise<void> => {
      await this.#blogSummaryRunner.stop();
    });
    try {
      await this.#blogSummaryRunner.start();
    } catch (error: unknown) {
      logger.error(
        { err: error },
        "Blog-summary consumer failed to start; the web API is unaffected.",
      );
    }
  }
}

await new BackendServer().run();
