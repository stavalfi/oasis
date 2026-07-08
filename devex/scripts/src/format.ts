/**
 * Format orchestrator. Runs oxfmt + shfmt + taplo + a generic
 * trailing-newline fixer in parallel.
 *
 *   - flags (`--*`) are forwarded to each tool
 *   - positional paths are routed by file type — JS/TS/JSON to oxfmt,
 *     shell paths (detected via extension + shebang) to shfmt, .toml to taplo,
 *     every other file goes through the trailing-newline fixer (.md, etc.)
 *   - with no paths, every tool runs on its default scope (oxfmt: cwd,
 *     shfmt: `devex/`, taplo: `.`, EOF newlines: every git-tracked file)
 *   - `--check` is intercepted and translated per tool
 */

import { execFile } from "node:child_process";
import { open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const OXFMT_EXTENSIONS = new Set([
  ".js",
  ".json",
  ".jsonc",
  ".jsx",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);

const ArgsSchema = z.object({
  check: z.boolean(),
  passthrough: z.array(z.string()),
});

interface TaskResult {
  name: string;
  ok: boolean;
  output: string;
}

interface PartitionedArgs {
  flags: string[];
  paths: string[];
}

class Format {
  readonly #abortController = new AbortController();
  readonly #args: z.infer<typeof ArgsSchema>;
  readonly #repoRoot: string;

  public constructor() {
    process.once("SIGTERM", () => this.#abortController.abort());
    const rawArgs = process.argv.slice(2);
    const wantCheck = rawArgs.includes("--check");
    const passthrough = rawArgs.filter((arg) => arg !== "--check");
    this.#args = ArgsSchema.parse({ check: wantCheck, passthrough });
    this.#repoRoot = path.resolve(import.meta.dirname, "../../..");
  }

  public async run(): Promise<void> {
    try {
      const { flags, paths } = this.#partitionArgs();
      const explicitPaths = paths.length > 0;
      const oxfmtTargets = explicitPaths ? Format.#filterOxfmtFiles(paths) : [];
      const tomlTargets = explicitPaths ? Format.#filterTomlFiles(paths) : [];
      const shellTargets = explicitPaths ? await this.#filterShellFiles(paths) : [];
      // The EOF-newline fixer applies to *every* tracked text file (no
      // extension filter) — that's what catches .md, .editorconfig, raw
      // `.envrc`, etc. that none of the dedicated formatters touch.
      const eofTargets = explicitPaths ? paths : await this.#listGitFiles();

      const results = await Promise.all([
        this.#runOxfmt({ explicitPaths, flags, oxfmtTargets }),
        this.#runShfmt({ explicitPaths, flags, shellTargets }),
        this.#runTaplo({ explicitPaths, flags, tomlTargets }),
        this.#fixEofNewlines(eofTargets),
      ]);
      let anyFailed = false;
      for (const result of results) {
        if (!result.ok) {
          anyFailed = true;
          console.log(`=== ${result.name} ✗ ===`);
          if (result.output.trim()) {
            console.log(result.output);
          }
        }
      }
      if (anyFailed) {
        process.exitCode = 1;
      }
    } catch (error: unknown) {
      if (!this.#abortController.signal.aborted) {
        this.#abortController.abort();
      }
      if (error instanceof Error && error.name === "AbortError") {
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  #partitionArgs(): PartitionedArgs {
    const flags: string[] = [];
    const paths: string[] = [];
    for (const arg of this.#args.passthrough) {
      if (arg.startsWith("-")) {
        flags.push(arg);
      } else {
        paths.push(arg);
      }
    }
    return { flags, paths };
  }

  static #filterOxfmtFiles(paths: string[]): string[] {
    return paths.filter((entry) => OXFMT_EXTENSIONS.has(path.extname(entry)));
  }

  static #filterTomlFiles(paths: string[]): string[] {
    return paths.filter((entry) => path.extname(entry) === ".toml");
  }

  async #filterShellFiles(paths: string[]): Promise<string[]> {
    if (paths.length === 0) {
      return [];
    }
    const { stdout } = await execFileAsync("shfmt", ["-f", ...paths], {
      cwd: this.#repoRoot,
      maxBuffer: 100 * 1024 * 1024,
      signal: this.#abortController.signal,
    });
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  }

  async #runOxfmt({
    flags,
    oxfmtTargets,
    explicitPaths,
  }: {
    flags: string[];
    oxfmtTargets: string[];
    explicitPaths: boolean;
  }): Promise<TaskResult> {
    if (explicitPaths && oxfmtTargets.length === 0) {
      return { name: "oxfmt", ok: true, output: "" };
    }
    const modeFlags = this.#args.check ? ["--check"] : [];
    try {
      const { stdout, stderr } = await execFileAsync(
        "oxfmt",
        [...modeFlags, ...flags, ...oxfmtTargets],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "oxfmt", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Format.#errorToResult({ error, name: "oxfmt" });
    }
  }

  async #runShfmt({
    flags,
    shellTargets,
    explicitPaths,
  }: {
    flags: string[];
    shellTargets: string[];
    explicitPaths: boolean;
  }): Promise<TaskResult> {
    if (explicitPaths && shellTargets.length === 0) {
      return { name: "shfmt", ok: true, output: "" };
    }
    const modeFlags = this.#args.check ? ["-d"] : ["-w"];
    // When no explicit paths were passed, scan ALL git-tracked files
    // (gitignore-aware) and let shfmt detect the shell scripts.
    const targets = shellTargets.length > 0 ? shellTargets : await this.#discoverShellFiles();
    if (targets.length === 0) {
      return { name: "shfmt", ok: true, output: "" };
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "shfmt",
        [...modeFlags, ...flags, ...targets],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "shfmt", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Format.#errorToResult({ error, name: "shfmt" });
    }
  }

  async #discoverShellFiles(): Promise<string[]> {
    const gitFiles = await this.#listGitFiles();
    if (gitFiles.length === 0) {
      return [];
    }
    const { stdout } = await execFileAsync("shfmt", ["-f", ...gitFiles], {
      cwd: this.#repoRoot,
      maxBuffer: 100 * 1024 * 1024,
      signal: this.#abortController.signal,
    });
    return stdout
      .trim()
      .split("\n")
      .filter((line) => line.length > 0);
  }

  async #listGitFiles(): Promise<string[]> {
    // tracked + untracked-not-gitignored; matches lint.ts (see comment there).
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: this.#repoRoot,
        maxBuffer: 100 * 1024 * 1024,
        signal: this.#abortController.signal,
      },
    );
    const candidates = stdout.split("\0").filter((entry) => entry.length > 0);
    const present = await Promise.all(
      candidates.map((file) =>
        stat(path.join(this.#repoRoot, file))
          .then(() => true)
          .catch(() => false),
      ),
    );
    return candidates.filter((_, index) => present[index]);
  }

  async #runTaplo({
    flags,
    tomlTargets,
    explicitPaths,
  }: {
    flags: string[];
    tomlTargets: string[];
    explicitPaths: boolean;
  }): Promise<TaskResult> {
    if (explicitPaths && tomlTargets.length === 0) {
      return { name: "taplo", ok: true, output: "" };
    }
    const modeFlags = this.#args.check ? ["--check"] : [];
    const targets = tomlTargets.length > 0 ? tomlTargets : ["."];
    try {
      const { stdout, stderr } = await execFileAsync(
        "taplo",
        ["format", ...modeFlags, ...flags, ...targets],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "taplo", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Format.#errorToResult({ error, name: "taplo" });
    }
  }

  async #fixEofNewlines(scope: string[]): Promise<TaskResult> {
    /*
     * Generic per-file trailing-newline fixer. Read the last byte, if it
     * isn't 0x0A append one. In `--check` mode (the same flag we pass to
     * oxfmt / taplo) we only report violations and exit non-zero — matches
     * lint.ts's `checkEofNewlines` so format --check ≡ lint for this rule.
     */
    const violations: string[] = [];
    await Promise.all(
      scope.map(async (file) => {
        const fullPath = path.resolve(this.#repoRoot, file);
        const handle = await open(fullPath, "r");
        let needsFix = false;
        try {
          const fileStat = await handle.stat();
          if (fileStat.size === 0) {
            return;
          }
          const buffer = Buffer.alloc(1);
          await handle.read(buffer, 0, 1, fileStat.size - 1);
          // ASCII '\n' = 10.
          needsFix = buffer[0] !== 10;
        } finally {
          await handle.close();
        }
        if (!needsFix) {
          return;
        }
        if (this.#args.check) {
          violations.push(`missing trailing newline: ${file}`);
          return;
        }
        const existing = await readFile(fullPath);
        await writeFile(fullPath, Buffer.concat([existing, Buffer.from([10])]));
      }),
    );
    return {
      name: "trailing newline",
      ok: violations.length === 0,
      output: violations.join("\n"),
    };
  }

  static #errorToResult({ name, error }: { name: string; error: unknown }): TaskResult {
    /*
     * Only translate to a TaskResult when the tool actually ran and exited
     * non-zero (its stdout/stderr are attached). System failures (ENOENT,
     * OOM, signal kills) must propagate so they're visible.
     */
    if (error instanceof Error && "stdout" in error && "stderr" in error) {
      const stdoutText = String(error.stdout ?? "");
      const stderrText = String(error.stderr ?? "");
      return { name, ok: false, output: stdoutText + stderrText };
    }
    throw error;
  }
}

await new Format().run();
