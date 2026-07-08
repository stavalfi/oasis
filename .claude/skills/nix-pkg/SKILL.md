---
name: nix-pkg
description: Add, remove, or update a package in the Nix flake dev shell. Use when the user asks to install/uninstall a tool, change a package version, or update all packages.
argument-hint: <add|remove|update> <package-name> [package-name ...]
allowed-tools: Bash, Read, Edit
---

The project uses a Nix flake at `flake.nix` in the repo root with version-pinned packages. Each package has an explicit version assertion in the `pinned` attrset. Run all `nix` commands below from the repo root.

## Adding a package

For each package in $ARGUMENTS:

1. Find the correct nixpkgs attribute name (not always the same as the command name, e.g. `kubernetes-helm` for `helm`, `yq-go` for `yq`, `gh` for `github-cli`):

   ```bash
   nix search nixpkgs <package-name> --json | head -20
   ```

2. Get the version:

   ```bash
   nix eval "nixpkgs#<attr>.version" | tr -d '"'
   ```

3. Add to the `pinned` attrset in `flake.nix`:

   ```nix
   <attr> = { pkg = pkgs.<attr>; version = "<version>"; };
   ```

4. Test: `nix develop --command true`
5. Rebuild direnv cache: `direnv allow`

## Removing a package

1. Remove the entry from the `pinned` attrset in `flake.nix`.
2. Test: `nix develop --command true`

## Updating a specific package version

1. Run `nix flake update` to bump nixpkgs to the latest revision.
2. Get the new version: `nix eval "nixpkgs#<attr>.version" | tr -d '"'`
3. Update the version string in the `pinned` attrset.
4. Test: `nix develop --command true`

Note: updating one package means bumping nixpkgs which may change ALL package versions. After `nix flake update`, run `nix develop --command true` — any version mismatch will error with the expected vs actual version. Update all mismatched versions.

## Updating all packages

1. `nix flake update`
2. `nix develop --command true` — will fail listing every version mismatch.
3. Update each version in the `pinned` attrset to match.
4. Test again until it passes.

$ARGUMENTS
