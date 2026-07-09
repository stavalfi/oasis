/**
 * start.ts
 *
 * Backend launcher (Node). Applies database migrations, generates Kysely types
 * from the live database, builds the frontend and keeps rebuilding it on
 * change, then starts the server (its JSON logs are piped through pino-pretty).
 *
 * A single AbortController ties every child process to the launcher: on
 * SIGINT/SIGTERM, or once the server exits, the signal aborts and the
 * background frontend watcher and log pretty-printer are torn down with it.
 * Run by `npm run backend`.
 */
import type { ChildProcess, StdioOptions } from "node:child_process";
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

class BackendLauncher {
  readonly #abortController = new AbortController();
  readonly #repoRoot = path.resolve(import.meta.dirname, "..", "..");

  public constructor() {
    process.once("SIGTERM", () => this.#abortController.abort());
  }

  public async run(): Promise<void> {
    await this.#runStep({
      args: ["-f", "backend/jira-client/openapi-ts.config.mjs"],
      command: "node_modules/.bin/openapi-ts",
      label: "Generating the Jira client (@hey-api/openapi-ts)",
    });
    await this.#runStep({
      args: ["backend/src/db/migrate.ts"],
      command: "node",
      label: "Running database migrations",
    });
    await this.#runStep({
      args: [
        "--url",
        BackendLauncher.#databaseUrl(),
        "--dialect",
        "postgres",
        "--out-file",
        "backend/src/db/schema.ts",
      ],
      command: "node_modules/.bin/kysely-codegen",
      label: "Generating Kysely types from the database",
    });
    await this.#runStep({
      args: ["build"],
      command: "node_modules/.bin/vite",
      label: "Building the frontend (served as static files by the backend)",
    });

    this.#watchFrontend();
    await this.#startServer();
  }

  /**
   * Spawn a child from the repo root, bound to the abort signal. Every command
   * runs here, so cwd/env/signal are set in exactly one place.
   */
  #spawnChild({
    args,
    command,
    stdio = "inherit",
  }: {
    args: string[];
    command: string;
    stdio?: StdioOptions;
  }): ChildProcess {
    return spawn(command, args, {
      cwd: this.#repoRoot,
      env: process.env,
      signal: this.#abortController.signal,
      stdio,
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
    await BackendLauncher.#waitForExit({ child: this.#spawnChild({ args, command }), label });
  }

  /** Build the frontend once more and keep rebuilding it in the background. */
  #watchFrontend(): void {
    console.log("==> Watching the frontend for changes");
    const watcher = this.#spawnChild({
      args: ["build", "--watch"],
      command: "node_modules/.bin/vite",
    });
    // The watcher is torn down via the abort signal; swallow the resulting
    // AbortError so it does not surface as an unhandled 'error' event.
    watcher.once("error", BackendLauncher.#ignoreAbortError);
  }

  /** Start the server, piping its JSON logs through pino-pretty. */
  async #startServer(): Promise<void> {
    console.log("==> Starting server");
    const server = this.#spawnChild({
      args: ["backend/src/index.ts"],
      command: "node",
      stdio: ["inherit", "pipe", "inherit"],
    });
    const prettyPrinter = this.#spawnChild({
      args: ["--singleLine"],
      command: "node_modules/.bin/pino-pretty",
      stdio: ["pipe", "inherit", "inherit"],
    });
    prettyPrinter.once("error", BackendLauncher.#ignoreAbortError);
    if (server.stdout && prettyPrinter.stdin) {
      server.stdout.pipe(prettyPrinter.stdin);
    }
    try {
      await BackendLauncher.#waitForExit({ child: server, label: "Server" });
    } finally {
      // Tear down the frontend watcher and pretty-printer.
      this.#abortController.abort();
    }
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
      // once() resolves with the "exit" args and rejects if the child emits
      // "error" (spawn failure, or the AbortError from an intentional teardown).
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

  static #ignoreAbortError(error: Error): void {
    if (error.name !== "AbortError") {
      throw error;
    }
  }
}

await new BackendLauncher().run();
