import { Command } from "@commander-js/extra-typings";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { DevexCommand } from "./devex/index.ts";
import { DevopsCommand } from "./devops/index.ts";

const execFileAsync = promisify(execFile);

class Cli {
  readonly #controller = new AbortController();

  public async run(): Promise<void> {
    process.on("SIGINT", () => this.#controller.abort());
    process.on("SIGTERM", () => this.#controller.abort());

    const { stdout: rootOut } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
      signal: this.#controller.signal,
    });

    const repoRoot = rootOut.trim();

    const program = new Command().name("devex").description("DevEx developer tooling CLI");
    new DevopsCommand({
      repoRoot,
      signal: this.#controller.signal,
    }).register(program);
    new DevexCommand({ repoRoot, signal: this.#controller.signal }).register(program);

    await program.parseAsync(process.argv);
  }
}

try {
  await new Cli().run();
} catch (error: unknown) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
