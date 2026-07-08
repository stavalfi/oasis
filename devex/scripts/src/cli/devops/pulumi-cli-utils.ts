import { execFile, spawn, type SpawnOptions } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";

const SEGMENT_RE = /^[a-z][a-z0-9]*$/u;

export type Env = "local" | "prod";

const execFileAsync = promisify(execFile);

export class PulumiCliUtils {
  /*
   * Branch naming convention: <env>/<developer>/<namespace>
   * Each segment: lowercase, starts with a letter, only [a-z0-9].
   */
  public static validateNamespaceSegment({ value, label }: { value: string; label: string }): void {
    if (!SEGMENT_RE.test(value)) {
      throw new Error(
        `Invalid ${label} '${value}': must be lowercase, start with a letter, and contain only [a-z0-9].`,
      );
    }
  }

  static #parseBranch(branch: string): { env: string; developer: string; namespace: string } {
    const parts = branch.split("/");
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new Error(
        `Branch '${branch}' does not follow the required format <env>/<developer>/<namespace>.`,
      );
    }
    PulumiCliUtils.validateNamespaceSegment({ label: "env", value: parts[0] });
    PulumiCliUtils.validateNamespaceSegment({ label: "developer", value: parts[1] });
    PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: parts[2] });
    return { developer: parts[1], env: parts[0], namespace: parts[2] };
  }

  /*
   * Resolves namespace and branch metadata from the CLI option or the current branch.
   * The branch must always follow <env>/<developer>/<namespace>; throws otherwise.
   */
  public static async resolveDeveloperAndNamespace({
    explicitNamespace,
    repoRoot,
    signal,
  }: {
    explicitNamespace: string | undefined;
    repoRoot: string;
    signal: AbortSignal;
  }): Promise<{
    readonly developer: string;
    readonly namespace: string;
    readonly branch: string;
  }> {
    const { stdout } = await execFileAsync("git", ["branch", "--show-current"], {
      cwd: repoRoot,
      signal,
    });
    const branch = stdout.trim();
    const parsed = PulumiCliUtils.#parseBranch(branch);

    const namespace = explicitNamespace ?? parsed.namespace;
    if (explicitNamespace !== undefined) {
      PulumiCliUtils.validateNamespaceSegment({ label: "namespace", value: explicitNamespace });
    }
    return { branch, developer: parsed.developer, namespace };
  }

  public static decryptPassphrase({
    secretRelPath,
    cwd,
    signal,
  }: {
    secretRelPath: string;
    cwd: string;
    signal: AbortSignal;
  }): Promise<string> {
    return PulumiCliUtils.decryptSecret({ cwd, field: "passphrase", secretRelPath, signal });
  }

  public static async decryptSecret({
    secretRelPath,
    cwd,
    signal,
    field,
  }: {
    secretRelPath: string;
    cwd: string;
    signal: AbortSignal;
    field: string;
  }): Promise<string> {
    if (!process.env["SOPS_AGE_KEY_CMD"]) {
      throw new Error(
        `SOPS_AGE_KEY_CMD is not set in the environment. This will cause decryption to fail. Please set SOPS_AGE_KEY_CMD and try again.`,
      );
    }
    const { stdout } = await execFileAsync("sops", ["-d", secretRelPath], { cwd, signal });
    const re = new RegExp(`^${field}:\\s*(?<value>.+)$`, "mu");
    const match = stdout.match(re);
    const value = match?.groups?.["value"];
    if (value === undefined) {
      throw new Error(`No '${field}:' field in ${secretRelPath} after sops decryption.`);
    }
    return value.trim();
  }

  public static pulumiBackendUrl({ env, s3ApiPort }: { env: Env; s3ApiPort?: number }): string {
    if (env === "prod") {
      return "s3://pulumi-state";
    }
    return `s3://pulumi-state?region=us-east-1&endpoint=localhost:${s3ApiPort}&s3ForcePathStyle=true&disableSSL=true`;
  }

  public static async runInherited({
    cmd,
    args,
    ...opts
  }: {
    cmd: string;
    args: string[];
  } & SpawnOptions): Promise<void> {
    const child = spawn(cmd, args, { stdio: "inherit", ...opts });
    const [code] = await once(child, "close");
    if (code !== 0) {
      throw new Error(`${cmd} exited with code ${code ?? "unknown"}`);
    }
  }
}
