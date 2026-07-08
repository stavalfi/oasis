/**
 * app-env.ts
 *
 * The Hono environment type shared by every route and middleware: the typed
 * request-scoped variables (request id, per-request logger, and the
 * authenticated user id set by the auth middleware).
 */
import { type Logger } from "../lib/logger.ts";

export interface AppEnv {
  Variables: {
    requestId: string;
    logger: Logger;
    userId: string;
  };
}
