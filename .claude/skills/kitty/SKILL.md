---
name: kitty
description: Configure kitty terminal keybindings, shell integration, and workarounds. Use when the user asks about kitty config, keybindings, prompt marks, or clipboard issues.
allowed-tools: Bash, Read, Edit, Write, Grep, Glob
---

# Kitty Terminal Configuration

Config file: `~/.config/kitty/kitty.conf`

## Key Gotchas

### p10k + kitty prompt marks

p10k disables kitty's prompt marks by default. Do NOT add manual precmd/preexec hooks to zshrc. Instead, add this to `~/.p10k.zsh`:

```zsh
typeset -g POWERLEVEL9K_TERM_SHELL_INTEGRATION=true
```

This preserves kitty shell integration features (prompt marks, `@last_cmd_output`, etc.) natively.

### Keybinding conflicts with zsh

Kitty keybindings are intercepted BEFORE the shell sees them — unless zsh has a `bindkey` for the same key, in which case zsh consumes it first. To let kitty handle a key:

```zsh
# in ~/.zshrc — unbind so kitty can handle it
bindkey -r '^K'
```

However, `bindkey -r` sets the key to `undefined-key` which still consumes it. If the kitty action needs the key to pass through, use `combine` in kitty.conf to also `send_key`:

```conf
map ctrl+k combine : clear_terminal scrollback active : send_key ctrl+l
```

### `--type=clipboard` does NOT work with scripts

When launching a script via `map ... launch`, `--type=clipboard` silently fails to run the script. Use `--type=background` instead and copy to clipboard from within the script using `wl-copy` (Wayland) or `xclip` (X11).

**Does NOT work:**

```conf
map ctrl+shift+a launch --type=clipboard --stdin-source=@last_cmd_output /path/to/script.sh
```

**Works:**

```conf
map ctrl+shift+a launch --type=background --stdin-source=@last_cmd_output /path/to/script.sh
```

With the script using `wl-copy`:

```sh
#!/bin/sh
output=$(cat)  # reads --stdin-source
# ... process ...
printf '%s' "$result" | wl-copy
```

Note: `kitty +kitten clipboard` also does NOT work inside `--type=background` launched scripts. Use `wl-copy`.

### `--type=clipboard` without a script DOES work

```conf
map ctrl+shift+a launch --type=clipboard --stdin-source=@last_cmd_output
```

This correctly copies `@last_cmd_output` to clipboard — the issue is only when combining with a script.

### close_window vs close_tab

To close only the focused split (not the entire tab), use `close_window`:

```conf
map ctrl+w close_window
```

`close_tab` closes ALL splits in the tab.

### @last_cmd_output vs command + output

`@last_cmd_output` captures only the output, not the command itself. There is no built-in kitty stdin-source for "command + output". To get both, use a background script that reads the command from `~/.zsh_history`:

```sh
#!/bin/sh
output=$(cat)
cmd=$(tail -1 ~/.zsh_history | sed 's/^[^;]*;//')
printf '$ %s\n%s' "$cmd" "$output" | wl-copy
```

### `kitty @ get-text --match recent:0`

This matches the most recently active window, which may NOT be the window the user is looking at (e.g., it could match a Claude Code session). Avoid relying on `--match recent:0` for getting text from the "current" window. Use `--stdin-source` in `launch` instead — it always targets the correct window.
