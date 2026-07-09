---
name: stern
description: Live-tail Kubernetes pod/container logs with stern. Use when the user wants to stream/follow/tail logs in real time, especially when matching multiple pods by regex across containers/namespaces. Do NOT use for searching past logs — use the `victorialogs` skill instead.
argument-hint: [pod regex or description of what to tail]
allowed-tools: Bash, AskUserQuestion
---

# Tail Kubernetes logs with stern

Use `stern` to tail logs from one or more pods/containers.

## Required behavior

1. **Always pass `--color=always`.** stern auto-disables color when its stdout is a pipe. Passing `--color=always` keeps the pod/container prefix colored when the developer later pipes the output to `grep` or similar tools.

2. **Always show the full `stern` command** you're about to run in a fenced code block before executing it. The developer should be able to copy, tweak, and re-run it themselves.

3. **Ask the developer for the inputs below before running** — use `AskUserQuestion` if multiple are missing, or ask in plain text if only one is missing. Do not guess.

## Questions to ask

Always gather these four pieces of information. If the user already provided one, skip that question.

### 1. Which pods / containers to track

- Pod regex (the positional argument to stern, e.g. `istio-gateway|nginx-test`)
- Optionally: `-c <regex>` to narrow to specific containers within those pods
- Or "all" → use `.*`

### 2. Since when

- Relative time: `1m`, `10m`, `1h`, `24h` → flag is `--since 10m`
- Or "from now" → omit `--since`
- Or "a specific time" → use `--since <duration>` computed from now

### 3. Which k8s context

- Pass as `--context <name>` (e.g. `--context test03`, `--context dev`)
- Never assume the current context; ask

### 4. Which namespace(s)

- Single namespace → `-n <ns>`
- All namespaces → `-A` (short for `--all-namespaces`)
- Multiple specific namespaces → stern supports `-n ns1,ns2,...` via repeated flags, but simpler: use `-A` and filter pod regex

## Common flags to remember

| Flag                  | What it does                                                                      |
| --------------------- | --------------------------------------------------------------------------------- |
| `--color=always`      | **Required.** Keep ANSI colors even when piping                                   |
| `--context <name>`    | kubeconfig context                                                                |
| `-n <ns>` / `-A`      | Namespace selection                                                               |
| `-c <regex>`          | Container name regex filter                                                       |
| `--since <dur>`       | Tail from this duration ago                                                       |
| `--tail <N>`          | Show last N lines per container before following                                  |
| `--no-follow`         | Print matching lines then exit (don't stream)                                     |
| `--only-log-lines`    | Suppress `+ pod › container` / `- pod › container` notices, only show log content |
| `--include <regex>`   | Keep only log lines matching regex (stern-side filter)                            |
| `--exclude <regex>`   | Drop log lines matching regex                                                     |
| `-l <label-selector>` | Select pods by label instead of name regex                                        |

## Example flow

User: "tail istio-gateway logs"

Assistant asks (via AskUserQuestion or plain text):

- Which pods/containers? → `istio-gateway` (user) / container `istio-proxy` (user)
- Since when? → `10m` (user)
- Which context? → `test03` (user)
- Which namespace? → `all` (user)

Assistant shows:

```bash
stern --color=always --context test03 -A -c istio-proxy --since 10m --only-log-lines 'istio-gateway'
```

Then runs it.

## Tips

- If the user says they want to grep the output, add `--only-log-lines` automatically so the `+ ns pod › container` announcements don't get in the way.
- If the developer wants highlighted keyword matches, the right pipeline is:
  ```bash
  stern --color=always ... | grep --color=always --line-buffered '<keyword>'
  ```
  (See the `grep` skill for why `--line-buffered` matters in a pipe.)
