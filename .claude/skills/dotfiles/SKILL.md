---
name: dotfiles
description: Commit and push changes to the dotfiles bare git repo (~/.cfg, work-tree /). Use when the user asks to commit or push changes to home-manager config, NixOS config, or any file tracked by the dotfiles repo.
allowed-tools: Bash, Read
---

The dotfiles repo is a bare git repo at `~/.cfg` with work-tree `/`. All git operations use:

```bash
git --git-dir=$HOME/.cfg --work-tree=/ <subcommand>
```

The alias `config` is not always available; use the full form above.

## Committing and pushing

1. Check what changed:

   ```bash
   git --git-dir=$HOME/.cfg --work-tree=/ status
   git --git-dir=$HOME/.cfg --work-tree=/ diff
   ```

2. Check recent commits for message style:

   ```bash
   git --git-dir=$HOME/.cfg --work-tree=/ log --oneline -5
   ```

3. Stage and commit:

   ```bash
   git --git-dir=$HOME/.cfg --work-tree=/ add <file> [file ...]
   git --git-dir=$HOME/.cfg --work-tree=/ commit -m "<message>"
   ```

4. Push:
   ```bash
   git --git-dir=$HOME/.cfg --work-tree=/ push
   ```

Stage specific files by path — never use `add -A` or `add .` as the work-tree is `/` and would sweep the entire filesystem.
