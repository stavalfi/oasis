/**
 * logger.ts
 *
 * One structured JSON logger (pino) for the scraper service. Kept separate from
 * the backend logger so the scraper depends only on its own config. No secrets
 * are logged here (the scraper handles no credentials beyond the Postgres/Kafka
 * connection settings, which are never logged).
 */
import pino from "pino";
import type { Logger } from "pino";
import { config } from "../config.ts";

export type { Logger };

/** The root logger for the scraper. Import this everywhere; never console.log. */
export const logger: Logger = pino({ level: config.constants.logLevel });
