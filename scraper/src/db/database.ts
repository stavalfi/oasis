/**
 * database.ts
 *
 * The scraper's single typed Kysely instance, backed by a Postgres connection
 * pool to the SAME database the backend uses (but a different, scraper-owned
 * table). Only the scraper's models import this. The schema type is generated
 * from the scraper's own migrated table (`scraped_posts` only), so it never
 * depends on the backend's tables.
 */
import { Kysely, PostgresDialect } from "kysely";
import { Pool } from "pg";
import { config } from "../config.ts";
import type { DB } from "./schema.ts";

/** The shared Postgres pool for the scraper. */
export const pool = new Pool({
  database: config.postgres.database,
  host: config.postgres.host,
  max: config.constants.postgres.poolMax,
  password: config.postgres.password,
  port: config.postgres.port,
  user: config.postgres.user,
});

/** Type-safe query builder. The scraper's single choke point for Postgres. */
export const db = new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
