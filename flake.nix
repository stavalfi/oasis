{
  description = "poc";

  # Pinned to the same commit as ~/.config/home-manager/flake.lock so every
  # tool in this dev shell resolves against the same nixpkgs as the host system.
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/9eac87a12312b8f60dd52e1c6e1a265f6fc7f5fc";
  # Separate pin for Claude Code only, so its version can move independently
  # without disturbing the shared nixpkgs above (kept in sync with home-manager).
  # This commit packages claude-code 2.1.193.
  inputs.nixpkgs-claude.url = "github:NixOS/nixpkgs/3d46470bb3030020f7e1361f33514854f5bfa86d";

  outputs = { self, nixpkgs, nixpkgs-claude }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; config.allowUnfree = true; };
      pkgsClaude = import nixpkgs-claude { inherit system; config.allowUnfree = true; };

      flipt = pkgs.stdenv.mkDerivation rec {
        pname = "flipt";
        version = "2.8.0";
        src = pkgs.fetchurl {
          url = "https://github.com/flipt-io/flipt/releases/download/v${version}/flipt_linux_x86_64.tar.gz";
          sha256 = "sha256-skMVRb8XknlQmm7zN0sbg+9/aZAj7Ol92gxmtpzFl9Y=";
        };
        sourceRoot = ".";
        nativeBuildInputs = [ pkgs.autoPatchelfHook ];
        installPhase = ''
          install -Dm755 flipt $out/bin/flipt
        '';
      };

      # Boeing's config-file-validator — checks the syntax of every config
      # file format in the repo (JSON/YAML/TOML/INI/.gitconfig/.editorconfig).
      # Not in nixpkgs; statically-linked Go binary from the GitHub release.
      # Installed as both `validator` (upstream binary name) and
      # `config-file-validator` (clearer alias).
      configFileValidator = pkgs.stdenv.mkDerivation rec {
        pname = "config-file-validator";
        version = "2.2.2";
        src = pkgs.fetchurl {
          url = "https://github.com/Boeing/config-file-validator/releases/download/v${version}/validator-v2.2-linux-amd64.tar.gz";
          sha256 = "7d9bb40f128d8c0944cdf00c78287ec3e17bdbbb0669a5a03d5eee32c964c887";
        };
        sourceRoot = ".";
        installPhase = ''
          install -Dm755 validator $out/bin/config-file-validator
        '';
      };

      microsandbox = pkgs.stdenv.mkDerivation rec {
        pname = "microsandbox";
        version = "0.5.5";
        src = pkgs.fetchurl {
          url = "https://github.com/superradcompany/microsandbox/releases/download/v${version}/microsandbox-linux-x86_64.tar.gz";
          sha256 = "0pl3pbk5kb03abxak2cj01gfaf0q5lhk8wg532dizl00285vgwql";
        };
        sourceRoot = ".";
        nativeBuildInputs = [ pkgs.autoPatchelfHook ];
        # libcap_ng and libkrunfw from nixpkgs; libgcc_s/glibc handled by autoPatchelfHook.
        # libmicrosandbox_go_ffi.so is microsandbox-specific and installed from the tarball.
        buildInputs = [
          pkgs.libcap_ng
          pkgs.gcc.cc.lib
          pkgs.libkrunfw
        ];
        installPhase = ''
          install -Dm755 msb $out/bin/msb
          install -Dm755 libmicrosandbox_go_ffi.so $out/lib/libmicrosandbox_go_ffi.so
          # msb dlopen's libkrunfw by exact versioned filename; symlink nixpkgs version to match
          ln -s ${pkgs.libkrunfw}/lib/libkrunfw.so.5 $out/lib/libkrunfw.so.5.2.1
        '';
      };

      rtk = pkgs.stdenv.mkDerivation rec {
        pname = "rtk";
        version = "0.42.3";
        src = pkgs.fetchurl {
          url = "https://github.com/rtk-ai/rtk/releases/download/v${version}/rtk-x86_64-unknown-linux-musl.tar.gz";
          sha256 = "sha256-XfdkpjNwnLhdJIJY0IXSTslfqovKDmg1qTzVfK3E654=";
        };
        sourceRoot = ".";
        installPhase = ''
          install -Dm755 rtk $out/bin/rtk
        '';
      };

      # the version from nix has bugs. we use this instead
      pulumi = pkgs.stdenv.mkDerivation rec {
        pname = "pulumi";
        version = "3.232.0";
        src = pkgs.fetchurl {
          url = "https://get.pulumi.com/releases/sdk/pulumi-v${version}-linux-x64.tar.gz";
          sha256 = "08s4fbf7hvi2yyi3m7n5832cmjizpg8df1v9bkg0wlv6iffwcwlb";
        };
        sourceRoot = "pulumi";
        nativeBuildInputs = [ pkgs.autoPatchelfHook ];
        buildInputs = [ pkgs.gcc.cc.lib ];
        installPhase = ''
          mkdir -p $out/bin
          install -Dm755 pulumi $out/bin/pulumi
          for f in pulumi-*; do
            install -Dm755 "$f" "$out/bin/$f"
          done
        '';
      };

      pinned = {
        # HTTP client used by every shell script that hits a URL (health
        # checks, file downloads). Replaces the system curl for reproducibility.
        curl = { pkg = pkgs.curl; version = "8.20.0"; };
        # Standard git CLI — the dev shell version, separate from any host git.
        git = { pkg = pkgs.git; version = "2.54.0"; };
        # GitHub CLI — `gh pr create`, `gh issue …`, auth via keyring.
        gh = { pkg = pkgs.gh; version = "2.94.0"; };
        # Helm package manager for Kubernetes (used by Pulumi via the
        # `kubernetes:helm.sh/v3:Release` resource for cert-manager, trust-manager, etc.).
        kubernetes-helm = { pkg = pkgs.kubernetes-helm; version = "4.2.0"; };
        # Istio CLI — installed in the dev shell so devops scripts that
        # reference istioctl work even though Istio isn't deployed yet.
        istioctl = { pkg = pkgs.istioctl; version = "1.30.1"; };
        # K9s — terminal UI for browsing/debugging Kubernetes clusters.
        k9s = { pkg = pkgs.k9s; version = "0.51.0"; };
        # `git diff` pager with syntax highlighting + side-by-side view.
        delta = { pkg = pkgs.delta; version = "0.19.2"; };
        # kubectl client — the version pinned here is what every script
        # in the repo expects.
        kubectl = { pkg = pkgs.kubectl; version = "1.36.1"; };
        # kubectl plugin: OIDC browser-based login flow (kubectl-oidc_login binary).
        # Invoked via the `exec:` block in per-user kubeconfigs.
        kubelogin-oidc = { pkg = pkgs.kubelogin-oidc; version = "1.36.2"; };
        # kubectx + kubens (the binary brings both) — switch contexts/namespaces
        # interactively. Aliased to `kx` / `kns`.
        kubectx = { pkg = pkgs.kubectx; version = "0.11.0"; };
        # Multi-pod log tail — `stern <pattern>` follows logs across many pods.
        stern = { pkg = pkgs.stern; version = "1.34.0"; };
        # `killport <port>` — find and kill processes bound to a port.
        # Used in scripts when a stale port-forward is in the way.
        killport = { pkg = pkgs.killport; version = "1.1.0"; };
        # Fast grep (`rg`). Replaces grep for code search.
        ripgrep = { pkg = pkgs.ripgrep; version = "15.1.0"; };
        # Local CA generator. `mkcert -install` registers a per-laptop root
        # CA in the system + browser NSS trust stores; Pulumi reads
        # ~/.local/share/mkcert/rootCA{,-key}.pem and uses them as the
        # cert-manager CA Issuer, so Rauthy's TLS cert is browser-trusted
        # locally (no `NET::ERR_CERT_AUTHORITY_INVALID` click-through).
        mkcert = { pkg = pkgs.mkcert; version = "1.4.4"; };
        # `certutil` from nss.tools — mkcert needs it to install its CA into
        # Chrome/Firefox NSS databases without sudo.
        nss-tools = { pkg = pkgs.nss.tools; version = "3.112.5"; };
        # Password manager + Secret Service provider for the user session.
        # `gh`/`git`/Chrome retrieve credentials through KeePassXC's
        # FdoSecrets interface.
        keepassxc = { pkg = pkgs.keepassxc; version = "2.7.12"; };
        # YAML processor — `yq .field file.yaml`. Go port of yq.
        yq-go = { pkg = pkgs.yq-go; version = "4.53.3"; };
        # JSON processor (`jq`).
        jq = { pkg = pkgs.jq; version = "1.8.1"; };
        # GNU awk — pinned to override BSD awk on macOS / system awks.
        gawk = { pkg = pkgs.gawk; version = "5.4.0"; };
        # GNU grep — same reason as gawk; ensures `grep -P` etc. work.
        gnugrep = { pkg = pkgs.gnugrep; version = "3.12"; };
        # Flipt feature-flag server (the local-binary build). Used by devex
        # scripts to read flag state.
        flipt = { pkg = flipt; version = "2.8.0"; };
        # `bat` — `cat` with syntax highlighting + git diff hunks.
        bat = { pkg = pkgs.bat; version = "0.26.1"; };
        # GNU parallel — for fan-out batch jobs in shell scripts.
        parallel = { pkg = pkgs.parallel; version = "20260422"; };
        # Fuzzy finder — used by some shell helpers / picker prompts.
        fzf = { pkg = pkgs.fzf; version = "0.73.1"; };
        # Chromium (ungoogled build, no telemetry/sync). Used by the
        # bookmark-sync Chrome extension dev loop and playwright tests.
        chromium = { pkg = pkgs.ungoogled-chromium; version = "149.0.7827.114"; };
        # Goss — server validation tool (YAML-based health checks).
        # Devops scripts use it to validate cluster state.
        goss = { pkg = pkgs.goss; version = "0.4.9"; };
        # Pulumi CLI — built from upstream tarball (not the broken nixpkgs
        # build). The dev-shell entry the `pulumi:*:local` npm scripts call.
        pulumi = { pkg = pulumi; version = "3.232.0"; };
        # Bun — JS/TS runtime + package manager. The repo runs `.ts` files
        # directly via bun (faster than node + tsx).
        bun = { pkg = pkgs.bun; version = "1.3.13"; };
        # Slim Node runtime — used for tools that don't work under bun yet
        # (esp. some Pulumi providers / native modules).
        nodejs-slim_26 = { pkg = pkgs."nodejs-slim_26"; version = "26.3.0"; };
        # btop — process / resource monitor in the terminal.
        btop = { pkg = pkgs.btop; version = "1.4.7"; };
        # Pin the same zsh as the host shell so devex/configs work
        # consistently regardless of OS.
        zsh = { pkg = pkgs.zsh; version = "5.9.1"; };
        # Claude Code CLI itself, pinned so version updates are explicit
        # (no upstream surprise breakage in a shared dev shell).
        claude-code = { pkg = pkgsClaude.claude-code; version = "2.1.193"; };
        # vim — minimal editor when a full IDE is overkill (esp. SSH on
        # nodes via the node-ssm skill).
        vim = { pkg = pkgs.vim; version = "9.2.0389"; };
        # GNU sed — same portability reason as gawk/gnugrep.
        gnused = { pkg = pkgs.gnused; version = "4.9"; };
        # ShellCheck — static analysis for the .sh scripts under devex/.
        shellcheck = { pkg = pkgs.shellcheck; version = "0.11.0"; };
        # shfmt — shell-script formatter. Pairs with the format CI step.
        shfmt = { pkg = pkgs.shfmt; version = "3.13.1"; };
        # Taplo — TOML toolkit (format/lint). The flake/lockfile-friendly
        # TOML linter; used in lint/format scripts.
        taplo = { pkg = pkgs.taplo; version = "0.10.0"; };
        # editorconfig-checker — verifies files match the project's .editorconfig.
        editorconfig-checker = { pkg = pkgs.editorconfig-checker; version = "3.7.0"; };
        # Boeing's config-file-validator — generic syntax check for
        # JSON/YAML/TOML/INI/etc. Built from an upstream tarball above.
        config-file-validator = { pkg = configFileValidator; version = "2.2.2"; };
        # yamllint — stricter YAML linting (style + structure).
        yamllint = { pkg = pkgs.yamllint; version = "1.37.1"; };
        # check-jsonschema — validate JSON/YAML files against schemas.
        # Used to validate Pulumi config files and devex configs.
        check-jsonschema = { pkg = pkgs.check-jsonschema; version = "0.37.2"; };
        # `kind` — Kubernetes In Docker. Hosts the local k8s cluster.
        # `kind create cluster --config devops/local-k8s-helper/setup-kind.yaml`.
        kind = { pkg = pkgs.kind; version = "0.31.0"; };
        # podman-compose — `docker compose` is wired to call this under the
        # hood. Used for any ad-hoc docker-compose workloads in devex/.
        podman-compose = { pkg = pkgs.podman-compose; version = "1.5.0"; };
        # `mc` — Minio client. Used by the OpenTofu local-exec provisioner in
        # devops/local-tf to create the pulumi-state bucket on first apply.
        minio-client = { pkg = pkgs.minio-client; version = "2025-08-13T08-35-41Z"; };
        # OpenTofu — open-source Terraform fork. Manages the MinIO docker
        # container (Pulumi state backend) via devops/local-tf/main.tf.
        opentofu = { pkg = pkgs.opentofu; version = "1.12.1"; };
        # terraform-ls — HashiCorp Terraform Language Server. Provides LSP
        # features (completion, hover, validation) for .tf files in VS Code
        # via the hashicorp.terraform extension. Calls `terraform` (shell
        # alias in devex/shell-aliases → tofu) so it runs on OpenTofu.
        terraform-ls = { pkg = pkgs.terraform-ls; version = "0.38.7"; };
        # RTK — token-optimization CLI proxy for Claude Code. Rewrites bash
        # commands (git status → rtk git status) to strip noise before tokens
        # are sent upstream. Not in nixpkgs; built from the musl static binary.
        rtk = { pkg = rtk; version = "0.42.3"; };
        fuse-overlayfs = { pkg = pkgs.fuse-overlayfs; version = "1.17"; };
        # crd2pulumi — generates Pulumi TypeScript types from CRD YAML files.
        # Used to generate strongly-typed wrappers under devops/src/generated/crd2pulumi/.
        crd2pulumi = { pkg = pkgs.crd2pulumi; version = "1.6.2"; };
      };

      assertVersion = name: { pkg, version }:
        assert pkg.version == version ||
          builtins.throw "${name}: expected ${version}, got ${pkg.version}. Update the pinned version or revert flake.lock.";
        pkg;
    in {
      devShells.${system}.default = pkgs.mkShell {
        packages = builtins.attrValues (builtins.mapAttrs assertVersion pinned)
          ++ [ pkgs.libsecret ];

        PULUMI_SKIP_UPDATE_CHECK = "1";
        PULUMI_DIY_BACKEND_IGNORE_DEPRECATION_WARNING = "1";

        # Credentials for the local Minio S3-compatible service that backs
        # the Pulumi state. These match MINIO_ROOT_{USER,PASSWORD} in
        # devex/docker-compose.yml. Safe to keep in-repo — it's a local-only
        # dev service, not a real cloud account.
        AWS_ACCESS_KEY_ID = "user";
        AWS_SECRET_ACCESS_KEY = "password";
        AWS_REGION = "us-east-1";

        # Route every `claude` invocation through the Headroom compression
        # proxy running in docker-compose (see devex/docker-compose.yml:headroom).
        # Anthropic SDKs read ANTHROPIC_BASE_URL at startup; the proxy
        # listens on :8787 and forwards to api.anthropic.com after
        # compressing the prompt. If the container isn't running, claude
        # calls will fail — `bun run docker-compose:up` brings it up.
        # ANTHROPIC_BASE_URL = "http://127.0.0.1:8787";

        # Paths that depend on the current project directory are exported at
        # shell-entry time via $PWD — purer than reading getEnv "PWD" at nix
        # eval (which would require `nixConfig.pure-eval = false;`).
        shellHook = ''
          export PATH="$PWD/devex/shell-aliases:$PATH"
          export CLAUDE_SHELL_OUTPUT_DIR="$PWD/devex/output/claude-shell-output-logs"
          # Podman socket — used by OpenTofu's kreuzwerker/docker provider when
          # managing local containers (MinIO S3 backend). The provider reads
          # DOCKER_HOST automatically; we set it here so every tool in the dev
          # shell (tofu, docker-compose, etc.) uses Podman without extra config.
          export DOCKER_HOST="unix://$XDG_RUNTIME_DIR/podman/podman.sock"
        '';
      };
    };
}
