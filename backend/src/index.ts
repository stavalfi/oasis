/**
 * index.ts
 *
 * Backend entry point. Runs on the Node.js runtime and serves the assembled
 * Hono app over HTTPS (via @hono/node-server) using a locally-trusted
 * certificate, so Secure cookies and the https OAuth callback behave locally as
 * in production. Run (after migrations and type generation) by
 * backend/scripts/start.sh.
 */
import { createServer } from "node:https";
import { serve } from "@hono/node-server";
import { app } from "./api/app.ts";
import { config } from "./lib/config.ts";
import { logger } from "./lib/logger.ts";
import { Tls } from "./lib/tls.ts";

const tls = await Tls.getLocal();

serve(
  {
    createServer,
    fetch: app.fetch,
    port: config.server.port,
    serverOptions: { cert: tls.cert, key: tls.key },
  },
  (info) => {
    logger.info({ port: info.port }, "IdentityHub backend listening over https");
  },
);
