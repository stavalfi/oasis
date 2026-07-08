// Generate the typed Jira Cloud client from the vendored Atlassian OpenAPI v3
// spec using @hey-api/openapi-ts. The generation is driven by
// devex/configs/jira-openapi-ts.config.mjs, which filters the spec down to the
// operations IdentityHub calls. Output is written to devex/generated/jira/src.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class JiraGenTypes {
  readonly #repoRoot: string;
  readonly #signal: AbortSignal;

  public constructor({ repoRoot, signal }: { repoRoot: string; signal: AbortSignal }) {
    this.#repoRoot = repoRoot;
    this.#signal = signal;
  }

  public async run(): Promise<void> {
    await execFileAsync(
      "bunx",
      ["@hey-api/openapi-ts", "-f", "devex/configs/jira-openapi-ts.config.mjs"],
      { cwd: this.#repoRoot, signal: this.#signal },
    );
  }
}
