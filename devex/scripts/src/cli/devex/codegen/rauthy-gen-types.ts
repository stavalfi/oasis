import { glob } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class RauthyGenTypes {
  readonly #repoRoot: string;
  readonly #signal: AbortSignal;

  public constructor({ repoRoot, signal }: { repoRoot: string; signal: AbortSignal }) {
    this.#repoRoot = repoRoot;
    this.#signal = signal;
  }

  public async run(): Promise<void> {
    const specs = await Array.fromAsync(
      glob("devex/configs/rauthy-openapi-*.json", { cwd: this.#repoRoot }),
    );

    if (specs.length === 0) {
      throw new Error(
        "No Rauthy OpenAPI specs found under devex/configs/ — run codegen rauthy-fetch-spec first.",
      );
    }

    await Promise.all(
      specs.map(async (spec) => {
        const version = path.basename(spec, ".json").replace("rauthy-openapi-", "");
        const outDir = `devex/generated/rauthy-${version}/src`;
        await execFileAsync(
          "bunx",
          ["@hey-api/openapi-ts", "-i", spec, "-o", outDir, "-c", "@hey-api/client-fetch"],
          { cwd: this.#repoRoot, signal: this.#signal },
        );
      }),
    );
  }
}
