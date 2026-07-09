import type { Command } from "@commander-js/extra-typings";
import { Crd2Pulumi } from "./crd2pulumi.ts";
import { JiraGenTypes } from "./jira-gen-types.ts";
import { RauthyFetchSpec } from "./rauthy-fetch-spec.ts";
import { RauthyGenTypes } from "./rauthy-gen-types.ts";

export class CodegenCommand {
  readonly #signal: AbortSignal;
  readonly #repoRoot: string;

  public constructor({ signal, repoRoot }: { signal: AbortSignal; repoRoot: string }) {
    this.#signal = signal;
    this.#repoRoot = repoRoot;
  }

  async #rauthyCodegen(): Promise<void> {
    await new RauthyFetchSpec({ repoRoot: this.#repoRoot, signal: this.#signal }).run();
    await new RauthyGenTypes({ repoRoot: this.#repoRoot, signal: this.#signal }).run();
  }

  public register(parent: Command): void {
    parent
      .command("codegen")
      .description("Run all code generation steps in parallel.")
      .action(async () => {
        await Promise.all([
          this.#rauthyCodegen(),
          new JiraGenTypes({ repoRoot: this.#repoRoot, signal: this.#signal }).run(),
          new Crd2Pulumi({ repoRoot: this.#repoRoot, signal: this.#signal }).run(),
        ]);
      });
  }
}
