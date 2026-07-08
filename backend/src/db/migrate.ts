/**
 * migrate.ts
 *
 * Applies all pending Kysely migrations from ./migrations to the configured
 * Postgres database, then exits. Run by backend/scripts/start.sh before the
 * server starts and before schema-type generation, so the generated types
 * always match the migrated database. Exits non-zero if any migration fails.
 */
import { promises as fileSystem } from "node:fs";
import path from "node:path";
import { Kysely, PostgresDialect } from "kysely";
import { FileMigrationProvider, Migrator } from "kysely/migration";
import { Pool } from "pg";
import { config } from "../lib/config.ts";

class MigrationRunner {
  /** Build a short-lived Kysely instance for running migrations (DDL only). */
  static #createDb(): Kysely<Record<string, never>> {
    const pool = new Pool({
      database: config.postgres.database,
      host: config.postgres.host,
      max: config.postgres.poolMax,
      password: config.postgres.password,
      port: config.postgres.port,
      user: config.postgres.user,
    });
    return new Kysely<Record<string, never>>({ dialect: new PostgresDialect({ pool }) });
  }

  /** Apply every pending migration in order, logging each result. */
  public static async run(): Promise<void> {
    const db = MigrationRunner.#createDb();
    const migrator = new Migrator({
      db,
      provider: new FileMigrationProvider({
        fs: fileSystem,
        migrationFolder: path.join(import.meta.dirname, "migrations"),
        path,
      }),
    });

    const { error, results } = await migrator.migrateToLatest();

    for (const result of results ?? []) {
      if (result.status === "Success") {
        console.log(`applied migration: ${result.migrationName}`);
      } else if (result.status === "Error") {
        console.error(`failed migration: ${result.migrationName}`);
      }
    }

    await db.destroy();

    if (error !== undefined) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

await MigrationRunner.run();
