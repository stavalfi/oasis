import { Command } from "@commander-js/extra-typings";
import { ClaudeSandboxCommand } from "./claude-sandbox/index.ts";
import { CodegenCommand } from "./codegen/index.ts";
import { UpdateGdocCommand } from "./update-gdoc/index.ts";

export class DevexCommand {
  readonly #signal: AbortSignal;
  readonly #repoRoot: string;

  public constructor({ signal, repoRoot }: { signal: AbortSignal; repoRoot: string }) {
    this.#signal = signal;
    this.#repoRoot = repoRoot;
  }

  public register(parent: Command): void {
    const devex = new Command("devex").description("DevEx tooling operations");
    new ClaudeSandboxCommand({ repoRoot: this.#repoRoot, signal: this.#signal }).register(devex);
    new CodegenCommand({ repoRoot: this.#repoRoot, signal: this.#signal }).register(devex);
    new UpdateGdocCommand(this.#repoRoot).register(devex);
    parent.addCommand(devex);
  }
}
