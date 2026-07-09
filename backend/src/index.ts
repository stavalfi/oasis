/**
 * index.ts
 *
 * Backend entry point. Runs on the Node.js runtime and serves the assembled
 * Hono app over HTTP (via @hono/node-server). Run (after migrations and type
 * generation) by backend/scripts/start.sh.
 */
import { serve } from "@hono/node-server";
import { app } from "./api/app.ts";
import { config } from "./config.ts";
import { logger } from "./lib/logger.ts";

serve(
  {
    fetch: app.fetch,
    port: config.server.port,
  },
  (info) => {
    const url = `http://localhost:${info.port}`;
    logger.info({ url }, `IdentityHub ready. Open the UI at ${url}`);
  },
);
