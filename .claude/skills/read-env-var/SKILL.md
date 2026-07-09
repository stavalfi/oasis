---
name: read-env-var
description: Read an environment variable in a Bash command. Use whenever you need a value from an env var (auth tokens, API keys, config). Triggers on any need to use $VAR-style values.
allowed-tools: Bash
---

Always use `printenv VAR` (or `$(printenv VAR)`) instead of `$VAR` / `echo $VAR`.

## Why

In some shell setups (notably zsh + nix-direnv), an env var can be present in the process environment but **not** as a shell variable in subshells. When that happens:

- `printenv VAR` → returns the value
- `echo $VAR` → returns empty
- `${VAR}` / `${#VAR}` → expands to empty / length 0

`printenv` reads directly from the process environment, so it's reliable across all shells and contexts (interactive shell, `bash -c`, nix-wrapped subprocesses, CI).

## Usage

```bash
# Inline in a command
curl -H "Authorization: $(printenv LINEAR_API_KEY)" https://...
curl --header "PRIVATE-TOKEN: $(printenv GITLAB_TOKEN)" https://...

# Assign to a local var first if reused
TOKEN=$(printenv GITLAB_TOKEN)
curl -H "PRIVATE-TOKEN: $TOKEN" url1
curl -H "PRIVATE-TOKEN: $TOKEN" url2

# Check if set (printenv exits non-zero if unset)
if printenv GITLAB_TOKEN >/dev/null; then echo "set"; fi

# In Python — env vars work normally there, no workaround needed
python3 -c "import os; print(os.environ['GITLAB_TOKEN'])"
```

## Don't

```bash
# Unreliable — may expand to empty even when the var is exported
curl -H "PRIVATE-TOKEN: $GITLAB_TOKEN" https://...
echo $GITLAB_TOKEN
```
