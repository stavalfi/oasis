import { exec } from "child_process";
import { readFile } from "fs/promises";
import { promisify } from "util";

const execAsync = promisify(exec);

const TOKSCALE_BIN = "node_modules/@tokscale/cli-linux-x64-gnu/bin/tokscale";

class Postinstall {
  readonly #abortController = new AbortController();

  public constructor() {
    process.once("SIGTERM", () => this.#abortController.abort());
  }

  public async run(): Promise<void> {
    try {
      await Promise.all([this.#setupGitConfig(), this.#patchNixBinaries()]);
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

  async #setupGitConfig(): Promise<void> {
    const checkCmd =
      "git config --local --get-all --fixed-value include.path ../devex/shared.gitconfig";
    const addCmd = "git config --local --add include.path ../devex/shared.gitconfig";
    try {
      await execAsync(checkCmd, { signal: this.#abortController.signal });
    } catch {
      await execAsync(addCmd, { signal: this.#abortController.signal });
    }
  }

  async #patchNixBinaries(): Promise<void> {
    if (!(await this.#isNixOS())) {
      return;
    }

    let binExists = false;
    try {
      await readFile(TOKSCALE_BIN, { signal: this.#abortController.signal });
      binExists = true;
    } catch {
      // binary not installed (e.g. non-linux platform package)
    }
    if (!binExists) {
      return;
    }

    const { stdout: interpreter } = await execAsync("patchelf --print-interpreter $(which bash)", {
      signal: this.#abortController.signal,
    });
    await execAsync(`patchelf --set-interpreter ${interpreter.trim()} ${TOKSCALE_BIN}`, {
      signal: this.#abortController.signal,
    });
  }

  async #isNixOS(): Promise<boolean> {
    try {
      const osRelease = await readFile("/etc/os-release", {
        encoding: "utf8",
        signal: this.#abortController.signal,
      });
      return osRelease.split("\n").includes("ID=nixos");
    } catch {
      return false;
    }
  }
}

await new Postinstall().run();
