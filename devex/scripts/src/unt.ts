import { mkdir, writeFile } from "fs/promises";
import { parseArgs, promisify } from "util";
import { EOL } from "os";
import { createHash } from "crypto";
import { exec } from "child_process";
import path from "path";
import { setTimeout as sleep } from "timers/promises";
import { z } from "zod";

const execAsync = promisify(exec);

const LOG_DIR = "/tmp/utl";

const RawCliSchema = z
  .object({
    command: z.array(z.string().min(1)).min(1),
    "grep-args": z.array(z.string().min(1)).min(1),
    "interval-ms": z.string().regex(/^\d+$/u),
    "timeout-ms": z.string().regex(/^\d+$/u),
  })
  .refine((value) => value.command.length === value["grep-args"].length, {
    message:
      "--command count must match --grep-args count (pair each --command with one --grep-args)",
  });

const ExecErrorSchema = z.object({
  stderr: z.string().optional(),
  stdout: z.string().optional(),
});

interface CommandSpec {
  readonly index: number;
  readonly command: string;
  readonly grepArgs: string;
  readonly logFile: string;
}

class UntilRunner {
  readonly #abortController = new AbortController();
  readonly #argv: readonly string[];
  #intervalMs = 0;
  #timeoutMs = 0;
  #specs: readonly CommandSpec[] = [];

  public constructor(argv: readonly string[]) {
    process.once("SIGTERM", () => this.#abortController.abort());
    this.#argv = argv;
  }

  public async run(): Promise<void> {
    try {
      if (this.#argv.length === 0 || this.#argv.includes("--help") || this.#argv.includes("-h")) {
        UntilRunner.#printHelp();
        return;
      }
      this.#parseCli();
      await this.#execute();
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "AbortError") {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  #normalizeArgv(): string[] {
    const valueOpts = new Set(["--command", "--grep-args", "--interval-ms", "--timeout-ms"]);
    const normalized: string[] = [];
    for (let i = 0; i < this.#argv.length; i++) {
      const current = this.#argv[i];
      if (current === undefined) {
        // Skip — argv slot empty
      } else if (
        valueOpts.has(current) &&
        i + 1 < this.#argv.length &&
        this.#argv[i + 1] !== undefined
      ) {
        normalized.push(`${current}=${this.#argv[i + 1]}`);
        i++;
      } else {
        normalized.push(current);
      }
    }
    return normalized;
  }

  static #printHelp(): void {
    console.log(
      [
        "unt — poll commands on an interval until grep matches any of their output.",
        "",
        "USAGE:",
        "  unt --command <cmd> --grep-args <args> [--command <cmd> --grep-args <args>]... \\",
        "      --interval-ms <ms> --timeout-ms <ms>",
        "",
        "OPTIONS:",
        "  --command <cmd>      Shell command to run (repeatable). Pair with --grep-args by order.",
        "  --grep-args <args>   grep arguments applied to that command's log file (repeatable).",
        "  --interval-ms <ms>   Polling interval in milliseconds (global).",
        "  --timeout-ms <ms>    Give-up timeout in milliseconds (global).",
        "  -h, --help           Show this help and exit.",
        "",
        "BEHAVIOR:",
        "  - Each tick runs every --command in parallel.",
        "  - Each command's output is written to /tmp/utl/<sha256(command+grep-args)>.log.",
        "  - grep runs on that log file with the paired --grep-args.",
        "  - First command whose grep matches wins; siblings are aborted.",
        "  - On match: prints `cat <log> | grep <grep-args>` to stdout, exits 0.",
        "  - On timeout: throws, exits 1.",
        "",
        "EXAMPLES:",
        "  # Smoke-test (passes immediately — verifies the tool is wired up):",
        "  unt --command 'echo ok' --grep-args 'ok' --interval-ms 100 --timeout-ms 1000",
        "",
        "  # Poll a pod's readiness:",
        String.raw`  unt --command 'kubectl -n main get pod foo -o json' --grep-args '-E "\"ready\": *true"' --interval-ms 2000 --timeout-ms 120000`,
      ].join(EOL),
    );
  }

  #parseCli(): void {
    const { values } = parseArgs({
      allowPositionals: false,
      args: this.#normalizeArgv(),
      options: {
        command: {
          multiple: true,
          type: "string",
        },
        "grep-args": {
          multiple: true,
          type: "string",
        },
        help: {
          short: "h",
          type: "boolean",
        },
        "interval-ms": {
          type: "string",
        },
        "timeout-ms": {
          type: "string",
        },
      },
      strict: true,
    });
    const parsed = RawCliSchema.parse(values);
    this.#intervalMs = Number.parseInt(parsed["interval-ms"], 10);
    this.#timeoutMs = Number.parseInt(parsed["timeout-ms"], 10);
    this.#specs = parsed.command.map((command, index): CommandSpec => {
      const grepArgs = parsed["grep-args"][index];
      if (grepArgs === undefined) {
        throw new Error(`missing --grep-args at index ${index}`);
      }
      const hash = createHash("sha256")
        .update(command)
        .update("\0")
        .update(grepArgs)
        .digest("hex")
        .slice(0, 16);
      return {
        command,
        grepArgs,
        index,
        logFile: path.join(LOG_DIR, `${hash}.log`),
      };
    });
  }

  async #execute(): Promise<void> {
    await mkdir(LOG_DIR, { recursive: true });
    const deadline = Date.now() + this.#timeoutMs;
    while (Date.now() < deadline && !this.#abortController.signal.aborted) {
      const winner = await this.#tickAll();
      if (winner !== undefined) {
        console.log(`cat ${winner.logFile} | grep ${winner.grepArgs}`);
        this.#abortController.abort();
        return;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        break;
      }
      const waitMs = Math.min(this.#intervalMs, remaining);
      await sleep(waitMs, undefined, {
        signal: this.#abortController.signal,
      });
    }
    if (this.#abortController.signal.aborted) {
      process.exitCode = 1;
      return;
    }
    throw new Error(`timeout after ${this.#timeoutMs}ms — no command matched its --grep-args`);
  }

  async #tickAll(): Promise<CommandSpec | undefined> {
    try {
      return await Promise.any(this.#specs.map((spec) => this.#tickSpecOrReject(spec)));
    } catch (error: unknown) {
      if (error instanceof AggregateError) {
        return undefined;
      }
      throw error;
    }
  }

  async #tickSpecOrReject(spec: CommandSpec): Promise<CommandSpec> {
    const matched = await this.#tickSpec(spec);
    if (!matched) {
      throw new Error("no match");
    }
    return spec;
  }

  async #tickSpec(spec: CommandSpec): Promise<boolean> {
    const output = await this.#runCommand(spec.command);
    const trimmed = output.replace(/\n+$/u, "");
    // First write only the command's output so grep can't false-match
    // The literal command text. If grep matches, rewrite the file with
    // The command prepended (blank-line-separated) for readability.
    await writeFile(spec.logFile, trimmed + EOL, {
      signal: this.#abortController.signal,
    });
    const matched = await this.#grepFile({ file: spec.logFile, grepArgs: spec.grepArgs });
    if (matched) {
      await writeFile(spec.logFile, spec.command + EOL + EOL + trimmed + EOL);
    }
    return matched;
  }

  async #runCommand(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        maxBuffer: 100 * 1024 * 1024,
        signal: this.#abortController.signal,
      });
      return stdout + stderr;
    } catch (error: unknown) {
      if (this.#abortController.signal.aborted) {
        throw error;
      }
      const parsed = ExecErrorSchema.safeParse(error);
      if (parsed.success) {
        return (parsed.data.stdout ?? "") + (parsed.data.stderr ?? "");
      }
      if (error instanceof Error) {
        return error.message;
      }
      return String(error);
    }
  }

  async #grepFile({ file, grepArgs }: { file: string; grepArgs: string }): Promise<boolean> {
    const quotedFile = JSON.stringify(file);
    try {
      await execAsync(`grep ${grepArgs} ${quotedFile}`, {
        signal: this.#abortController.signal,
      });
      return true;
    } catch (error: unknown) {
      if (this.#abortController.signal.aborted) {
        throw error;
      }
      return false;
    }
  }
}

await new UntilRunner(process.argv.slice(2)).run();
