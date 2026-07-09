import type { Command } from "@commander-js/extra-typings";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { homedir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// nixos/nix image base-system hash — all /etc symlinks target this package.
// When we replace /nix/store with the host overlay, these paths must exist in
// the upperdir so the container can resolve uid 0 and read nix.conf before exec.
const BASE_SYSTEM = "08rpdijxwasq4xbr7liday9y4l8b4xa2-base-system";

export class ClaudeSandboxCommand {
  readonly #signal: AbortSignal;
  readonly #repoRoot: string;

  public constructor({ signal, repoRoot }: { signal: AbortSignal; repoRoot: string }) {
    this.#signal = signal;
    this.#repoRoot = repoRoot;
  }

  public register(parent: Command): void {
    parent
      .command("claude-sandbox")
      .description(
        "Launch Claude Code inside an isolated Docker container. Shares the host nix store via fuse-overlayfs (inside the container) so nix develop runs with zero downloads.",
      )
      .argument("[name]", "container name", "poc-sandbox")
      .action(async (name) => {
        await this.#run(name);
      });
  }

  async #run(name: string): Promise<void> {
    const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
    const home = homedir();

    const [{ stdout: bashStdout }, { stdout: fuseStdout }] = await Promise.all([
      execFileAsync("sh", ["-c", "which bash"]),
      execFileAsync("sh", ["-c", "which fuse-overlayfs"]),
    ]);
    const hostBash = bashStdout.trim();
    const hostFuseOverlayfs = fuseStdout.trim();

    const rows = process.stdout.rows ?? 24;
    const cols = process.stdout.columns ?? 80;

    // Inside the container:
    // 1. Plant BASE_SYSTEM /etc stubs in the overlay upperdir so /etc symlinks
    //    (which target this image-specific hash) resolve after we shadow /nix/store.
    // 2. Create fuse-overlayfs (writable overlay of /nix/store:ro) inside the
    //    container's own mount namespace using its user-namespace CAP_SYS_ADMIN.
    // 3. Bind-mount the merged view over /nix/store so nix sees a writable store.
    // 4. Use NIX_STATE_DIR to avoid the mode-600 lock files in /nix/var/nix/db.
    // 5. unshare --user --map-user=1000 maps container uid 0 → uid 1000 inside a
    //    new user namespace: claude sees uid 1000 (bypasses root check), but file
    //    accesses resolve back to uid 0 in the container ns, which owns the fuse mount.
    const etcUpper = `/tmp/store/upper/${BASE_SYSTEM}/etc`;
    const entrypoint = [
      `export PATH=/nix/var/nix/profiles/system/sw/bin:/usr/local/bin:$PATH`,
      `mkdir -p /bin && ln -sf $(which bash) /bin/sh`,
      `export TERM=xterm-256color`,
      `stty rows ${rows} cols ${cols}`,
      `mkdir -p ${etcUpper}/nix /tmp/store/work /tmp/store/merged`,
      `printf 'root:x:0:0:root:/root:/bin/sh\\n' > ${etcUpper}/passwd`,
      `printf 'root:x:0:\\n' > ${etcUpper}/group`,
      `printf 'root:!:1::\\:\\:\\:\\:\\n' > ${etcUpper}/shadow`,
      `printf 'extra-experimental-features = nix-command flakes\\nbuild-users-group =\\nsandbox = false\\n' > ${etcUpper}/nix/nix.conf`,
      `fuse-overlayfs -o lowerdir=/nix/store,upperdir=/tmp/store/upper,workdir=/tmp/store/work /tmp/store/merged`,
      `mount --bind /tmp/store/merged /nix/store`,
      `mkdir -p ${this.#repoRoot}`,
      `mkdir -p /tmp/nix-state/db /tmp/nix-state/temproots /tmp/nix-state/gcroots`,
      `cp /nix/var/nix/db/db.sqlite /tmp/nix-state/db/`,
      `cp /nix/var/nix/db/db.sqlite-shm /tmp/nix-state/db/ || true`,
      `cp /nix/var/nix/db/db.sqlite-wal /tmp/nix-state/db/ || true`,
      `touch /tmp/nix-state/db/big-lock /tmp/nix-state/db/reserved`,
      `export NIX_STATE_DIR=/tmp/nix-state`,
      `nix develop --no-warn-dirty --command unshare --user --map-user=1000 --map-group=1000 claude`,
    ].join(" && ");

    await execFileAsync("docker", ["rm", "-f", name]).catch(() => {});

    const child = spawn(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "host",
        "--cap-add",
        "SYS_ADMIN",
        "--device",
        "/dev/fuse",
        "-v",
        `/nix/store:/nix/store:ro`,
        "-v",
        `/nix/var/nix:/nix/var/nix:ro`,
        "-v",
        `${hostFuseOverlayfs}:/usr/local/bin/fuse-overlayfs`,
        "-v",
        `${this.#repoRoot}:${this.#repoRoot}`,
        "-v",
        `${home}/.claude.json:/root/.claude.json`,
        "-v",
        `${home}/.cache/nix:/root/.cache/nix`,
        "-v",
        `${home}/.claude:/root/.claude`,
        "-v",
        `${home}/.local/share/mkcert:/root/.local/share/mkcert:ro`,
        "-e",
        `ANTHROPIC_API_KEY=${apiKey}`,
        "-e",
        `IN_CLAUDE_SANDBOX=1`,
        "-e",
        `CAROOT=/root/.local/share/mkcert`,
        "-e",
        `NODE_EXTRA_CA_CERTS=/root/.local/share/mkcert/rootCA.pem`,
        "-e",
        `CURL_CA_BUNDLE=/root/.local/share/mkcert/rootCA.pem`,
        "-w",
        this.#repoRoot,
        "-i",
        "--tty",
        "nixos/nix",
        hostBash,
        "-c",
        entrypoint,
      ],
      { signal: this.#signal, stdio: "inherit" },
    );

    const [code] = await once(child, "close");
    if (code !== 0 && code !== null) {
      throw new Error(`docker exited with code ${code}`);
    }
  }
}
