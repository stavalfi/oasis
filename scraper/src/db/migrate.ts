/**
 * migrate.ts
 *
 * Applies the scraper's own Kysely migrations from ./migrations, then exits. Run
 * by scraper/scripts/start.ts before the service starts (and before its schema
 * types are generated), so the generated types always match the migrated table.
 *
 * Crucially, the scraper tracks its migrations in its OWN tables
 * (`scraper_kysely_migration` / `scraper_kysely_migration_lock`), separate from
 * the backend's default `kysely_migration`. Both services share one database but
 * never share a migration history, so neither sees the other's migrations as
 * "corrupted/unknown" and there is no cross-service migration race.
 */
import { promises as fileSystem } from "node:fs";
import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Pool } from "pg";
import { config } from "../config.ts";

class ScraperMigrationRunner {
  /** Build a short-lived Kysely instance for running migrations (DDL only). */
  static #createDb(): Kysely<Record<string, never>> {
    const pool = new Pool({
      database: config.postgres.database,
      host: config.postgres.host,
      max: config.constants.postgres.poolMax,
      password: config.postgres.password,
      port: config.postgres.port,
      user: config.postgres.user,
    });
    return new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool }) });
  }

  /** Apply every pending scraper migration in order, logging each result. */
  public static async run(): Promise<void> {
    const db = ScraperMigrationRunner.#createDb();
    const migrator = new Migrator({
      db,
      // Separate tracking tables so the scraper's migration history is fully
      // independent of the backend's (both live in the same database).
      migrationLockTableName: "scraper_kysely_migration_lock",
      migrationTableName: "scraper_kysely_migration",
      provider: new FileMigrationProvider({
        fs: fileSystem,
        migrationFolder: path.join(import.meta.dirname, "migrations"),
        path,
      }),
    });

    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === "Success") {
        console.log(`applied scraper migration: ${result.migrationName}`);
      } else if (result.status === "Error") {
        console.error(`failed scraper migration: ${result.migrationName}`);
      }
    }

    await db.destroy();

    if (error !== undefined) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

await ScraperMigrationRunner.run();
