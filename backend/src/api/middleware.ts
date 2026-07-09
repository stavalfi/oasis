/**
 * middleware.ts
 *
 * Cross-cutting middleware: a per-request context (request id + child logger +
 * request summary log), and the two authentication guards. `requireSession`
 * protects the browser API (session cookie); `requireApiKey` protects the
 * machine API (bearer key). Both resolve the acting user and set it on the
 * context so handlers never re-check auth.
 */
import { randomUUID } from "node:crypto";
import { deleteCookie, getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { config } from "../lib/config.ts";
import { logger } from "../lib/logger.ts";
import { ApiKeysService } from "../services/api-keys.ts";
import { AuthService } from "../services/auth.ts";
import type { AppEnv } from "./app-env.ts";

const BEARER_PREFIX = "Bearer ";

export class Middleware {
  /** Attach a request id and child logger, and log a one-line request summary. */
  public static readonly requestContext = createMiddleware<AppEnv>(async (context, next) => {
    const requestId = context.req.header("x-request-id") ?? randomUUID();
    const requestLogger = logger.child({ request_id: requestId });
    context.set("requestId", requestId);
    context.set("logger", requestLogger);
    context.header("x-request-id", requestId);

    const startedAtMs = Date.now();
    const proceedToNext = next;
    await proceedToNext();
    requestLogger.info(
      {
        duration_ms: Date.now() - startedAtMs,
        method: context.req.method,
        route: routePath(context),
        status: context.res.status,
        user_id: context.get("userId"),
      },
      "request",
    );
  });

  /** Require a valid session cookie; resolve and set the acting user id. */
  public static readonly requireSession = createMiddleware<AppEnv>(async (context, next) => {
    const sessionId = getCookie(context, config.constants.sessionCookieName);
    if (sessionId === undefined) {
      throw new HTTPException(401, { message: "Authentication required." });
    }
    const userId = await AuthService.authenticateSession(sessionId);
    if (userId === undefined) {
      deleteCookie(context, config.constants.sessionCookieName);
      throw new HTTPException(401, { message: "Session expired." });
    }
    context.set("userId", userId);
    return next();
  });

  /** Require a valid, non-expired API key; resolve and set the owning user id. */
  public static readonly requireApiKey = createMiddleware<AppEnv>(async (context, next) => {
    const authorizationHeader = context.req.header("Authorization");
    const rawKey =
      authorizationHeader?.startsWith(BEARER_PREFIX) === true
        ? authorizationHeader.slice(BEARER_PREFIX.length)
        : undefined;
    if (rawKey === undefined || rawKey.length === 0) {
      throw new HTTPException(401, { message: "API key required." });
    }
    const userId = await ApiKeysService.authenticate(rawKey);
    if (userId === undefined) {
      throw new HTTPException(401, { message: "Invalid or expired API key." });
    }
    context.set("userId", userId);
    return next();
  });
}
