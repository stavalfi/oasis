/**
 * logger.ts
 *
 * One structured JSON logger (pino) for the whole backend, injected through the
 * layers. Secrets are never logged: tokens, API keys, cookies, the client
 * secret, and key hashes are redacted by the pino redaction list regardless of
 * where they appear in a logged object. Per-request child loggers (carrying
 * `request_id` and `user_id`) are created at the edge in middleware.
 */
import pino from "pino";
import type { Logger } from "pino";
import { config } from "./config.ts";

export type { Logger };

/**
 * Field paths pino redacts before writing. Covers the common shapes secrets
 * arrive in (headers, token fields, credentials) at any nesting depth.
 */
const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "*.authorization",
  "*.cookie",
  "*.access_token",
  "*.refresh_token",
  "*.accessToken",
  "*.refreshToken",
  "*.client_secret",
  "*.clientSecret",
  "*.key_hash",
  "*.keyHash",
  "*.apiKey",
  "*.password",
  "password",
];

/** The root logger. Import this, or a child of it, everywhere; never console.log. */
export const logger: Logger = pino({
  level: config.constants.logLevel,
  redact: { censor: "[redacted]", paths: REDACT_PATHS },
});
