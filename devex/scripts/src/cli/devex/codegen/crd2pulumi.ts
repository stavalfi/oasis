import { execFile } from "node:child_process";
import { glob, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OUTPUT_DIR = "devops/crds/generated/crds2pulumi/src";
const TSCONFIG = "devops/crds/generated/crds2pulumi/tsconfig.json";

// crd2pulumi emits these alongside the TypeScript source; they are only
// needed when publishing the output as a standalone npm package.
const GENERATED_ARTIFACTS_TO_REMOVE = [
  ".gitattributes",
  ".gitignore",
  "package.json",
  "README.md",
  "scripts",
  "tsconfig.json",
];

export class Crd2Pulumi {
  readonly #repoRoot: string;
  readonly #signal: AbortSignal;

  public constructor({ repoRoot, signal }: { repoRoot: string; signal: AbortSignal }) {
    this.#repoRoot = repoRoot;
    this.#signal = signal;
  }

  public async run(): Promise<void> {
    const yamls = await Array.fromAsync(
      glob("devops/crds/external/**/*.yaml", { cwd: this.#repoRoot }),
    );

    if (yamls.length === 0) {
      throw new Error("No YAML files found under devops/crds/external/");
    }

    await rm(path.join(this.#repoRoot, OUTPUT_DIR), { force: true, recursive: true });

    await execFileAsync("crd2pulumi", [`--nodejsPath=${OUTPUT_DIR}`, ...yamls], {
      cwd: this.#repoRoot,
      signal: this.#signal,
    });

    await Promise.all(
      GENERATED_ARTIFACTS_TO_REMOVE.map((name) =>
        rm(path.join(this.#repoRoot, OUTPUT_DIR, name), { force: true, recursive: true }),
      ),
    );

    // Compile the generated CJS TypeScript to .js + .d.ts so the main ESM
    // Pulumi program can import them without a TypeScript loader.
    // --build is required because composite:true projects only emit via the
    // incremental build protocol; --project skips emission in TypeScript 6.
    await execFileAsync("node_modules/.bin/tsc", ["--build", TSCONFIG], {
      cwd: this.#repoRoot,
      signal: this.#signal,
    });
  }
}
