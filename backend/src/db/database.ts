/**
 * database.ts
 *
 * The single typed Kysely instance backed by a Postgres connection pool. Only
 * the models layer imports this; nothing else touches Postgres. The pool is
 * fixed-size: node-postgres has no `min` option, so a constant pool is
 * approximated with `max` connections and idle eviction disabled, giving
 * predictable behavior under load with no ramp-up or idle churn.
 */
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { config } from "../config.ts";
import type { DB } from "./schema.ts";

/** The shared Postgres pool. Exposed for pool-usage metrics and shutdown. */
export const pool = new Pool({
  allowExitOnIdle: false,
  database: config.postgres.database,
  host: config.postgres.host,
  // Keep every opened connection alive so the pool stays at a constant size.
  idleTimeoutMillis: 0,
  max: config.postgres.poolMax,
  password: config.postgres.password,
  port: config.postgres.port,
  user: config.postgres.user,
});

/** Type-safe query builder. The single choke point for Postgres access. */
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
