import { exec } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout } from "node:timers/promises";

const execAsync = promisify(exec);

const INTERVAL_MS = 2000;

class PodWatcher {
  readonly #ac = new AbortController();
  readonly #extra: string[];
  #prevLines = 0;

  public constructor(extra: string[]) {
    this.#extra = extra;
    process.on("SIGINT", () => this.#ac.abort());
    process.on("SIGTERM", () => this.#ac.abort());
  }

  async #getContext(): Promise<string> {
    const { stdout } = await execAsync("kubectl config current-context", {
      signal: this.#ac.signal,
    });
    return stdout.trim();
  }

  async #getNamespace(): Promise<string> {
    const { stdout } = await execAsync(
      "kubectl config view --minify --output jsonpath={..namespace}",
      { signal: this.#ac.signal },
    );
    return stdout.trim();
  }

  async #getPods(): Promise<string> {
    const { stdout } = await execAsync(["kubectl", "get", "pod", ...this.#extra].join(" "), {
      signal: this.#ac.signal,
    });
    return stdout.trim();
  }

  async #render(): Promise<void> {
    const [context, namespace, pods] = await Promise.all([
      this.#getContext(),
      this.#getNamespace(),
      this.#getPods(),
    ]);

    if (this.#prevLines > 0) {
      console.log(`[${this.#prevLines}A[J`);
    }

    const output = `Context: ${context} | Namespace: ${namespace}\n${pods}\n`;
    console.log(output);
    this.#prevLines = output.split("\n").length - 1;
  }

  public async run(): Promise<void> {
    while (!this.#ac.signal.aborted) {
      try {
        await this.#render();
      } catch {
        if (this.#ac.signal.aborted) {
          break;
        }
      }
      try {
        await setTimeout(INTERVAL_MS, undefined, { signal: this.#ac.signal });
      } catch {
        break;
      }
    }
  }
}

const watcher = new PodWatcher(process.argv.slice(2));
await watcher.run();
