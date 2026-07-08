---
name: nix-install
description: Set up Nix with flakes, direnv, nix-direnv, and GitHub token on a fresh machine. Use when the user asks to install or set up Nix from scratch.
allowed-tools: Bash, Read, Edit, Write
---

## 1. Install Determinate Nix

```bash
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install
```

## 2. Configure Nix

Create `~/.config/nix/nix.conf`:

```
experimental-features = nix-command flakes
access-tokens = github.com=<github-classic-token-with-read:packages>
accept-flake-config = true
warn-dirty = false
```

The GitHub token must be a **classic** personal access token with `read:packages` scope and no expiration. Create it at https://github.com/settings/tokens/new — it cannot be created via API.

`accept-flake-config = true` lets project flakes set their own `nixConfig` (e.g. `pure-eval = false`) without re-prompting. Broad setting — any flake you run can change nix config silently.

## 3. Install direnv + nix-direnv

```bash
nix profile install nixpkgs#direnv nixpkgs#nix-direnv
```

## 4. Configure direnv

Create `~/.config/direnv/direnvrc`:

```bash
source $HOME/.nix-profile/share/nix-direnv/direnvrc
```

Create `~/.config/direnv/direnv.toml`:

```toml
[global]
hide_env_diff = true
warn_timeout = "20s"

[whitelist]
exact = [ "$HOME/projects/.envrc" ]
```

## 5. Add direnv hook to the user's shell

Detect the shell, then append the correct hook to the matching rc file.

```bash
shell="$(basename "${SHELL:-$(getent passwd "$USER" | cut -d: -f7)}")"
case "$shell" in
    zsh)
        printf '\neval "$(direnv hook zsh)"\n' >> "$HOME/.zshrc"
        ;;
    bash)
        printf '\neval "$(direnv hook bash)"\n' >> "$HOME/.bashrc"
        ;;
    fish)
        mkdir -p "$HOME/.config/fish"
        printf '\ndirenv hook fish | source\n' >> "$HOME/.config/fish/config.fish"
        ;;
    *)
        echo "Unsupported shell: $shell. Add 'direnv hook $shell' manually to its rc file." >&2
        exit 1
        ;;
esac
```

`$SHELL` is the usual source; if empty, fall back to the user's login shell from `/etc/passwd` via `getent passwd`.

If using zsh + Powerlevel10k, also set `typeset -g POWERLEVEL9K_INSTANT_PROMPT=quiet` in `~/.p10k.zsh` to suppress the console-output warning direnv prints during init.
