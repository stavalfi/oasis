/**
 * start.ts
 *
 * Scraper launcher (Node). Applies the scraper's own migrations, generates its
 * Kysely types from the live database (filtered to the scraper's single table,
 * so the generated schema never depends on the backend's tables), then starts
 * the scraper. A single AbortController ties the child to the launcher, so
 * SIGINT/SIGTERM (or the scraper exiting) tears everything down cleanly. Run by
 * `npm run scraper`.
 */
import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { z } from "zod";

/** The discrete Postgres vars kysely-codegen needs, validated as non-empty. */
const postgresEnvSchema = z.object({
  POSTGRES_DB: z.string().min(1),
  POSTGRES_HOST: z.string().min(1),
  POSTGRES_PASSWORD: z.string().min(1),
  POSTGRES_PORT: z.string().min(1),
  POSTGRES_USER: z.string().min(1),
});

class ScraperLauncher {
  readonly #abortController = new AbortController();
  readonly #repoRoot = path.resolve(import.meta.dirname, "..", "..");

  public constructor() {
    process.once("SIGTERM", () => this.#abortController.abort());
  }

  public async run(): Promise<void> {
    await this.#runStep({
      args: ["scraper/src/db/migrate.ts"],
      command: "node",
      label: "Running scraper database migrations",
    });
    await this.#runStep({
      args: [
        "--url",
        ScraperLauncher.#databaseUrl(),
        "--dialect",
        "postgres",
        "--include-pattern",
        "scraped_posts",
        "--out-file",
        "scraper/src/db/schema.ts",
      ],
      command: "node_modules/.bin/kysely-codegen",
      label: "Generating scraper Kysely types (scraped_posts only)",
    });
    await this.#startScraper();
  }

  /** Spawn a child from the repo root, bound to the abort signal. */
  #spawnChild({ args, command }: { args: string[]; command: string }): ChildProcess {
    return spawn(command, args, {
      cwd: this.#repoRoot,
      env: process.env,
      signal: this.#abortController.signal,
      stdio: "inherit",
    });
  }

  /** Run one step to completion; throw if it exits non-zero. */
  async #runStep({
    args,
    command,
    label,
  }: {
    args: string[];
    command: string;
    label: string;
  }): Promise<void> {
    console.log(`==> ${label}`);
    await ScraperLauncher.#waitForExit({ child: this.#spawnChild({ args, command }), label });
  }

  /** Start the scraper service and wait for it to exit. */
  async #startScraper(): Promise<void> {
    console.log("==> Starting scraper");
    await ScraperLauncher.#waitForExit({
      child: this.#spawnChild({ args: ["scraper/src/index.ts"], command: "node" }),
      label: "Scraper",
    });
  }

  /** Compose the Postgres URL kysely-codegen needs from the discrete env vars. */
  static #databaseUrl(): string {
    const env = postgresEnvSchema.parse(process.env);
    return `postgres://${env.POSTGRES_USER}:${env.POSTGRES_PASSWORD}@${env.POSTGRES_HOST}:${env.POSTGRES_PORT}/${env.POSTGRES_DB}`;
  }

  /** Resolve on a clean exit; throw on a non-zero (non-abort) failure. */
  static async #waitForExit({
    child,
    label,
  }: {
    child: ChildProcess;
    label: string;
  }): Promise<void> {
    try {
      const [exitCode] = await once(child, "exit");
      if (typeof exitCode === "number" && exitCode !== 0) {
        throw new Error(`${label} failed with exit code ${exitCode}.`);
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }
      throw error;
    }
  }
}

await new ScraperLauncher().run();
