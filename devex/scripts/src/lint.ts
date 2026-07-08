/**
 * Lint orchestrator. Runs all repo lint checks in parallel:
 *   - oxlint (with optional --fix)
 *   - shellcheck (on every shell script shfmt detects)
 *   - knip (unused files / exports / dependencies — repo-wide only,
 *     skipped when explicit paths are passed since knip's analysis is
 *     whole-graph)
 *   - no `.js` files committed
 *   - every tracked file ends in a newline
 *   - no `#!/usr/bin/env node` shebangs in `.ts` files
 *   - no tsconfig `noEmit: false`, `emitDeclarationOnly`, `outDir`, or `outFile`
 *     (this repo is type-check-only; TypeScript must never write output files)
 *
 * `--fix` is translated into oxlint's full auto-fix flag set. Other args:
 *   - flags (`--*`) are forwarded to oxlint + shellcheck
 *   - positional paths are routed by file type — JS/TS/JSON paths to oxlint,
 *     shell paths (detected via extension + shebang) to shellcheck. Per-file
 *     repo checks (no .js, EOF, shebang) are scoped to the passed paths.
 *   - with no paths, every tool runs repo-wide.
 */

import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { CompilerOptionsSchema } from "zod-tsconfig";

const execFileAsync = promisify(execFile);

const TsConfigFileSchema = z.looseObject({ compilerOptions: CompilerOptionsSchema.optional() });

// JS/TS source only — oxlint refuses pure-JSON inputs ("no files found").
const LINT_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

const ArgsSchema = z.object({
  fix: z.boolean(),
  passthrough: z.array(z.string()),
  verbose: z.boolean(),
});

interface TaskOutcome {
  name: string;
  ok: boolean;
  output: string;
}

interface TaskResult extends TaskOutcome {
  durationMs: number;
}

interface PartitionedArgs {
  flags: string[];
  paths: string[];
}

class Lint {
  readonly #abortController = new AbortController();
  readonly #args: z.infer<typeof ArgsSchema>;
  readonly #repoRoot: string;

  public constructor() {
    process.once("SIGTERM", () => this.#abortController.abort());
    const rawArgs = process.argv.slice(2);
    const wantFix = rawArgs.includes("--fix");
    const wantVerbose = rawArgs.includes("--verbose");
    const passthrough = rawArgs.filter((arg) => arg !== "--fix" && arg !== "--verbose");
    this.#args = ArgsSchema.parse({ fix: wantFix, passthrough, verbose: wantVerbose });
    this.#repoRoot = path.resolve(import.meta.dirname, "../../..");
  }

  public async run(): Promise<void> {
    try {
      const { flags, paths } = this.#partitionArgs();
      const explicitPaths = paths.length > 0;
      const shellTargets = explicitPaths
        ? await this.#filterShellFiles(paths)
        : await this.#discoverShellFiles();
      const jsTargets = explicitPaths ? Lint.#filterJsFiles(paths) : [];
      const checkScope = explicitPaths ? paths : await this.#listGitFiles();

      // Discover TOML files via git ls-files when no explicit paths given.
      // Falling back to taplo's `.` arg lets it walk into .direnv/node_modules
      // and lint tens of thousands of vendor TOML files.
      const tomlTargets = explicitPaths
        ? Lint.#filterTomlFiles(paths)
        : Lint.#filterTomlFiles(checkScope);
      const yamlTargets = Lint.#filterYamlFiles(paths);
      const tfTargets = Lint.#filterTfFiles(explicitPaths ? paths : checkScope);
      // Trailing-newline enforcement lives in `format` (auto-fixable);
      // keeping it out of lint avoids a hard fail on something the next
      // task in the pre-commit chain would have repaired.
      const asyncResults = await Promise.all([
        Lint.#timed(() => this.#runOxlint({ explicitPaths, flags, jsTargets })),
        Lint.#timed(() => this.#runShellcheck({ flags, shellTargets })),
        Lint.#timed(() => this.#runTaplo({ flags, tomlTargets })),
        Lint.#timed(() => this.#runYamllint({ explicitPaths, yamlTargets })),
        Lint.#timed(() => this.#runTofuFmt({ explicitPaths, tfTargets })),
        Lint.#timed(() => this.#runEditorconfigChecker(paths)),
        Lint.#timed(() => this.#runConfigFileValidator(paths)),
        Lint.#timed(() => this.#runKnip(explicitPaths)),
        Lint.#timed(() => this.#checkNoShebangs(checkScope)),
        Lint.#timed(() => this.#checkSchemaDirectives(checkScope)),
        Lint.#timed(() => this.#checkNoTsEmit(checkScope)),
      ]);
      const syncStart = performance.now();
      const syncResult = Lint.#checkNoJsFiles(checkScope);
      const results = [
        { ...syncResult, durationMs: performance.now() - syncStart },
        ...asyncResults,
      ];
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
      if (this.#args.verbose) {
        const sorted = [...results].toSorted((a, b) => b.durationMs - a.durationMs);
        const maxNameLen = Math.max(...sorted.map((r) => r.name.length));
        console.log("\ndurations:");
        for (const r of sorted) {
          console.log(`  ${r.name.padEnd(maxNameLen)}  ${r.durationMs.toFixed(0)}ms`);
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

  static async #timed(fn: () => Promise<TaskOutcome>): Promise<TaskResult> {
    const start = performance.now();
    const result = await fn();
    return { ...result, durationMs: performance.now() - start };
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

  static #filterJsFiles(paths: string[]): string[] {
    return paths.filter((entry) => LINT_EXTENSIONS.has(path.extname(entry)));
  }

  static #filterTomlFiles(paths: string[]): string[] {
    return paths.filter((entry) => path.extname(entry) === ".toml");
  }

  static #filterYamlFiles(paths: string[]): string[] {
    return paths.filter((entry) => {
      const ext = path.extname(entry);
      return ext === ".yaml" || ext === ".yml";
    });
  }

  static #filterTfFiles(paths: string[]): string[] {
    return paths.filter((entry) => path.extname(entry) === ".tf");
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

  async #discoverShellFiles(): Promise<string[]> {
    // Scope to git-tracked files (gitignore-aware), then let shfmt pick
    // out the actual shell scripts via shebang/extension. This catches
    // .sh files anywhere in the repo without descending into node_modules
    // / .direnv / .pulumi / build outputs.
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
    /*
     * `--cached` (tracked) + `--others --exclude-standard` (untracked but not
     * gitignored). Without the `--others` half, newly-created files would be
     * invisible to lint until they're staged — a footgun that silently lets
     * lint pass on broken new files. CI sees committed state; local should
     * see committed + new-untracked to match the "next commit" preview.
     */
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
    /*
     * Skip files that git tracks but have been removed from disk (staged
     * deletions, dirty trees). `stat` rejects with ENOENT for those; we
     * treat that as "not present" rather than an error.
     */
    const present = await Promise.all(candidates.map((file) => this.#fileExists(file)));
    return candidates.filter((_, index) => present[index]);
  }

  async #fileExists(file: string): Promise<boolean> {
    try {
      await stat(path.resolve(this.#repoRoot, file));
      return true;
    } catch {
      return false;
    }
  }

  async #runOxlint({
    flags,
    jsTargets,
    explicitPaths,
  }: {
    flags: string[];
    jsTargets: string[];
    explicitPaths: boolean;
  }): Promise<TaskOutcome> {
    const fixFlags = this.#args.fix ? ["--fix", "--fix-suggestions", "--fix-dangerously"] : [];
    if (explicitPaths && jsTargets.length === 0) {
      return { name: "oxlint", ok: true, output: "" };
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "oxlint",
        [
          "--ignore-path=.gitignore",
          "--ignore-pattern=devex/scripts/test/lint/fixtures/**",
          ...fixFlags,
          ...flags,
          ...jsTargets,
        ],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "oxlint", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "oxlint" });
    }
  }

  async #runTaplo({
    flags,
    tomlTargets,
  }: {
    flags: string[];
    tomlTargets: string[];
  }): Promise<TaskOutcome> {
    if (tomlTargets.length === 0) {
      return { name: "taplo", ok: true, output: "" };
    }
    try {
      const { stdout, stderr } = await execFileAsync("taplo", ["lint", ...flags, ...tomlTargets], {
        cwd: this.#repoRoot,
        maxBuffer: 100 * 1024 * 1024,
        signal: this.#abortController.signal,
      });
      return { name: "taplo", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "taplo" });
    }
  }

  async #runYamllint({
    yamlTargets,
    explicitPaths,
  }: {
    yamlTargets: string[];
    explicitPaths: boolean;
  }): Promise<TaskOutcome> {
    if (explicitPaths && yamlTargets.length === 0) {
      return { name: "yamllint", ok: true, output: "" };
    }
    const targets = yamlTargets.length > 0 ? yamlTargets : ["."];
    try {
      const { stdout, stderr } = await execFileAsync("yamllint", ["--strict", ...targets], {
        cwd: this.#repoRoot,
        maxBuffer: 100 * 1024 * 1024,
        signal: this.#abortController.signal,
      });
      return { name: "yamllint", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "yamllint" });
    }
  }

  async #runTofuFmt({
    tfTargets,
    explicitPaths,
  }: {
    tfTargets: string[];
    explicitPaths: boolean;
  }): Promise<TaskOutcome> {
    if (explicitPaths && tfTargets.length === 0) {
      return { name: "tofu fmt", ok: true, output: "" };
    }
    if (tfTargets.length === 0) {
      return { name: "tofu fmt", ok: true, output: "" };
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "tofu",
        ["fmt", "-check", "-diff", ...tfTargets],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "tofu fmt", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "tofu fmt" });
    }
  }

  async #runConfigFileValidator(paths: string[]): Promise<TaskOutcome> {
    const targets = paths.length > 0 ? paths : ["."];
    try {
      const { stdout, stderr } = await execFileAsync(
        "config-file-validator",
        [
          "-gitignore",
          "-exclude-dirs",
          "node_modules,dist,.direnv,.git",
          // TOML owned by taplo; JSON/JSONC owned by oxfmt (parses before
          // formatting, so invalid JSON already fails there); YAML owned
          // by yamllint (lint) + oxfmt (format).
          "-exclude-file-types",
          "toml,json,jsonc,yaml,yml,tf",
          ...targets,
        ],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "config-file-validator", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "config-file-validator" });
    }
  }

  async #runEditorconfigChecker(paths: string[]): Promise<TaskOutcome> {
    try {
      const { stdout, stderr } = await execFileAsync("editorconfig-checker", paths, {
        cwd: this.#repoRoot,
        maxBuffer: 100 * 1024 * 1024,
        signal: this.#abortController.signal,
      });
      return { name: "editorconfig-checker", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "editorconfig-checker" });
    }
  }

  async #runKnip(explicitPaths: boolean): Promise<TaskOutcome> {
    /*
     * knip walks the whole import graph from configured entry points —
     * it can't meaningfully be scoped to one file. When a caller passes
     * explicit paths (e.g. pre-commit running on staged files only) we
     * skip knip rather than running it repo-wide every time and slowing
     * the per-file path down. Repo-wide invocation (no paths) still gets
     * the full check.
     *
     * `--no-progress` suppresses spinner output (CI/log noise);
     * `--no-config-hints` hides the "remove redundant entry pattern"
     * advisories — they're config-tuning suggestions, not violations.
     */
    if (explicitPaths) {
      return { name: "knip", ok: true, output: "" };
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "knip",
        ["--no-progress", "--no-config-hints"],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "knip", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "knip" });
    }
  }

  async #runShellcheck({
    flags,
    shellTargets,
  }: {
    flags: string[];
    shellTargets: string[];
  }): Promise<TaskOutcome> {
    if (shellTargets.length === 0) {
      return { name: "shellcheck", ok: true, output: "" };
    }
    try {
      const { stdout, stderr } = await execFileAsync(
        "shellcheck",
        ["--rcfile=devex/configs/src/shellcheckrc", ...flags, ...shellTargets],
        {
          cwd: this.#repoRoot,
          maxBuffer: 100 * 1024 * 1024,
          signal: this.#abortController.signal,
        },
      );
      return { name: "shellcheck", ok: true, output: stdout + stderr };
    } catch (error: unknown) {
      return Lint.#captureExecError({ error, name: "shellcheck" });
    }
  }

  static #checkNoJsFiles(scope: string[]): TaskOutcome {
    const offenders = scope.filter(
      (file) => file.endsWith(".js") && !file.startsWith("devops/crds/generated/"),
    );
    return {
      name: "no .js files",
      ok: offenders.length === 0,
      output: offenders.map((file) => `forbidden .js file: ${file}`).join("\n"),
    };
  }

  async #checkNoShebangs(scope: string[]): Promise<TaskOutcome> {
    const tsFiles = scope.filter((file) => file.endsWith(".ts"));
    const results = await Promise.all(
      tsFiles.map(async (file) => {
        const head = await readFile(path.resolve(this.#repoRoot, file), { encoding: "utf8" });
        return { file, hasShebang: head.startsWith("#!") };
      }),
    );
    const violations = results
      .filter((result) => result.hasShebang)
      .map((result) => `shebang in .ts file (run via \`node\` instead): ${result.file}`);
    return {
      name: "no shebang in .ts files",
      ok: violations.length === 0,
      output: violations.join("\n"),
    };
  }

  async #checkSchemaDirectives(scope: string[]): Promise<TaskOutcome> {
    /*
     * Every TOML / YAML file *anywhere in the repo* must declare its schema
     * inline at the top of the file so editors + CI agree on the contract
     * without needing a sidecar mapping.
     *
     * Exemption: SOPS-encrypted YAMLs (regardless of path). Their payload
     * is an opaque ciphertext-laden blob with a trailing `sops:` metadata
     * table that we detect by content — not by directory. A new SOPS file
     * dropped under any path (devops/secrets, devex/secrets, repo-root,
     * wherever) is auto-exempt; nothing else escapes the rule.
     */
    const TOML_DIRECTIVE = /^#:schema \S/u;
    const YAML_MODELINE = /^# yaml-language-server: \$schema=\S/u;
    const SOPS_METADATA_MARKER = /^sops:$/mu;

    // Pulumi.<stack>.yaml files are auto-generated by `pulumi stack select`
    // and contain only an encryption salt — no schema modeline is appropriate.
    const PULUMI_STACK_FILE = /(?:^|\/)Pulumi\.[^/]+\.ya?ml$/u;

    const targets = scope.filter((file) => /\.(?:toml|ya?ml)$/u.test(file));

    const results = await Promise.all(
      targets.map(async (file) => {
        if (PULUMI_STACK_FILE.test(file)) {
          return { file, ok: true };
        }
        const content = await readFile(path.resolve(this.#repoRoot, file), { encoding: "utf8" });
        const isYaml = file.endsWith(".yaml") || file.endsWith(".yml");
        if (isYaml && SOPS_METADATA_MARKER.test(content)) {
          return { file, ok: true };
        }
        const firstLine = content.split("\n", 1)[0] ?? "";
        const ok = file.endsWith(".toml")
          ? TOML_DIRECTIVE.test(firstLine)
          : YAML_MODELINE.test(firstLine);
        return { file, ok };
      }),
    );
    const violations = results
      .filter((result) => !result.ok)
      .map((result) =>
        result.file.endsWith(".toml")
          ? `missing #:schema directive on line 1: ${result.file}`
          : `missing # yaml-language-server: $schema=... modeline on line 1: ${result.file}`,
      );
    return {
      name: "schema directive",
      ok: violations.length === 0,
      output: violations.join("\n"),
    };
  }

  static #isRecord(val: unknown): val is Record<string, unknown> {
    return typeof val === "object" && val !== null;
  }

  async #readNoTsEmitExclude(): Promise<string[]> {
    try {
      const content = await readFile(path.resolve(this.#repoRoot, ".oxlintrc.json"), {
        encoding: "utf8",
      });
      const raw: unknown = JSON.parse(content);
      if (!Lint.#isRecord(raw) || !Lint.#isRecord(raw["rules"])) {
        return [];
      }
      const ruleConfig = raw["rules"]["poc-rules/no-tsconfig-emit"];
      const parsed = z
        .tuple([z.string(), z.looseObject({ exclude: z.array(z.string()).default([]) })])
        .rest(z.unknown())
        .safeParse(ruleConfig);
      return parsed.success ? parsed.data[1].exclude : [];
    } catch {
      return [];
    }
  }

  async #checkNoTsEmit(scope: string[]): Promise<TaskOutcome> {
    const exclude = await this.#readNoTsEmitExclude();
    const tsconfigs = scope.filter((file) => {
      // lint-staged passes absolute paths; the exclude prefixes are
      // repo-relative, so normalize before comparing.
      const relativePath = path.relative(this.#repoRoot, path.resolve(this.#repoRoot, file));
      return (
        /^tsconfig.*\.json$/u.test(path.basename(file)) &&
        !exclude.some((prefix) => relativePath.startsWith(prefix))
      );
    });
    const violations: string[] = [];

    await Promise.all(
      tsconfigs.map(async (file) => {
        let raw: unknown;
        try {
          const content = await readFile(path.resolve(this.#repoRoot, file), { encoding: "utf8" });
          raw = JSON.parse(content);
        } catch {
          return;
        }
        const result = TsConfigFileSchema.safeParse(raw);
        if (!result.success) {
          return;
        }
        const args = result.data["compilerOptions"];
        if (args === undefined) {
          return;
        }
        if (args.noEmit === false) {
          violations.push(`noEmit: false in ${file}`);
        }
        if (args.emitDeclarationOnly === true) {
          violations.push(`emitDeclarationOnly: true in ${file}`);
        }
        if (args.outDir !== undefined) {
          violations.push(`outDir is set in ${file}`);
        }
        if (args.outFile !== undefined) {
          violations.push(`outFile is set in ${file}`);
        }
      }),
    );

    violations.sort();
    return {
      name: "no tsconfig emit",
      ok: violations.length === 0,
      output: violations.join("\n"),
    };
  }

  static #captureExecError({ name, error }: { name: string; error: unknown }): TaskOutcome {
    /*
     * Only translate to a TaskOutcome when the tool actually ran and exited
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

await new Lint().run();
