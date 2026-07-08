import { exec } from "node:child_process";
import pino from "pino";
import { promisify } from "node:util";
import { setTimeout as sleep } from "node:timers/promises";

const execAsync = promisify(exec);

const logger = pino({
  base: { name: "liveness" },
  mixin: () => ({ uptime: `${process.uptime().toFixed(0)}s` }),
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
});

type RunStatus = { status: "success" } | { status: "failure"; stdout: string };

export interface LivenessChecksOptions {
  readonly ac: AbortController;
  readonly gossFilePath: string;
  readonly showFirstErrorAfterSeconds: number;
  readonly refreshIntervalSeconds: number;
}

export class LivenessChecks {
  readonly #ac: AbortController;
  readonly #gossFilePath: string;
  readonly #showFirstErrorAfterSeconds: number;
  readonly #refreshIntervalSeconds: number;

  public constructor(options: LivenessChecksOptions) {
    this.#ac = options.ac;
    this.#gossFilePath = options.gossFilePath;
    this.#showFirstErrorAfterSeconds = options.showFirstErrorAfterSeconds;
    this.#refreshIntervalSeconds = options.refreshIntervalSeconds;
  }

  public async run(): Promise<void> {
    let lastRunStatus: RunStatus | { status: "not-run-yet" } = { status: "not-run-yet" };
    const startMs = Date.now();

    logger.info("Running liveness checks...");

    const tick = async (): Promise<void> => {
      const current = await this.#runGoss();
      if (current.status === "cancel-signal") {
        return;
      }

      if (current.status === "success") {
        if (lastRunStatus.status !== "success") {
          logger.info("All services are up and running");
        }
      } else {
        const msSinceStart = Date.now() - startMs;
        if (msSinceStart < this.#showFirstErrorAfterSeconds * 1000) {
          return;
        }

        const shouldShow =
          lastRunStatus.status === "success" ||
          lastRunStatus.status === "not-run-yet" ||
          (lastRunStatus.status === "failure" && current.stdout !== lastRunStatus.stdout);

        if (shouldShow) {
          logger.error({ failures: current.stdout }, "Some services are down");
        }
      }

      lastRunStatus = current;
    };

    await tick();

    while (true) {
      await sleep(this.#refreshIntervalSeconds * 1000, undefined, { signal: this.#ac.signal });
      await tick();
    }
  }

  async #runGoss(): Promise<RunStatus | { status: "cancel-signal" }> {
    try {
      await execAsync("goss validate --max-concurrent 100 --retry-timeout 2s --sleep 500ms", {
        env: { ...process.env, GOSS_FILE: this.#gossFilePath, GOSS_USE_ALPHA: "1" },
        signal: this.#ac.signal,
      });
      return { status: "success" };
    } catch (error) {
      if (this.#ac.signal.aborted) {
        return { status: "cancel-signal" };
      }
      let e: Error;
      if (error instanceof Error) {
        e = error;
      } else {
        e = new Error(String(error));
      }
      let stdout: string;
      if ("stdout" in e) {
        stdout = String(e.stdout);
      } else {
        stdout = "";
      }
      let stderr: string;
      if ("stderr" in e) {
        stderr = String(e.stderr);
      } else {
        stderr = e.message;
      }
      return {
        status: "failure",
        stdout:
          LivenessChecks.#cleanError(stdout) ||
          stdout.split("\n").filter(Boolean).join("\n") ||
          stderr.split("\n").filter(Boolean).join("\n"),
      };
    }
  }

  static #cleanError(error: string): string {
    return error
      .split("\n")
      .slice(1)
      .filter(Boolean)
      .filter((line) => !line.includes("Total Duration:"))
      .join("\n");
  }
}
