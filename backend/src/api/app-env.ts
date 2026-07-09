/**
 * app-env.ts
 *
 * The Hono environment type shared by every route and middleware: the typed
 * request-scoped variables (the logger, and the authenticated user id set by
 * the auth middleware).
 */
import type { Logger } from "../lib/logger.ts";

export interface AppEnv {
  Variables: {
    logger: Logger;
    userId: string;
  };
}
