---
name: unt
description: Poll one or more shell commands on an interval until grep matches their output, with a hard timeout. Use when the user wants to "wait until X appears" — pods becoming ready, a log line showing up, a metric reaching a threshold, an API endpoint returning a specific value. Do NOT use for live tailing (use `stern`) or single one-shot checks.
argument-hint: <commands + per-command grep args + interval-ms + timeout-ms>
allowed-tools: Bash
---

# unt — poll until grep matches

**Binary is `unt`, NOT `until`** (`until` is a bash builtin). Substitute `unt` if the user says "until".

**Always show `unt` output to the user** — run foreground, quote the result line in your reply.

Script: `devex/scripts/src/unt.ts` (directly executable). `--help` for full usage.

## Behavior

- Runs every `--command` in parallel each `--interval-ms`.
- Saves output to `/tmp/utl/<sha256(command+grep-args)[:16]>.log` (collision-free).
- Greps each log with its paired `--grep-args`.
- First match wins → prints `cat <log> | grep <args>`, exits 0; siblings aborted.
- No match before `--timeout-ms` → exits 1.

## Rules

- Pair `--command` with `--grep-args` by order; counts must match.
- Single-quote both values — passed to `/bin/sh -c` verbatim.
- `--grep-args` = raw grep args: `'-E "err|fail"'`, `'-i ready'`.
- `--interval-ms` / `--timeout-ms` are global.

## When NOT to use

- Live tail → `stern`. Past logs → `victorialogs`. One-shot → run the command directly.

## Examples

Pod ready:

```bash
devex/scripts/src/unt.ts \
  --command 'kubectl --context dev -n main get pod my-pod -o json' \
  --grep-args '-E "\"ready\": *true"' \
  --interval-ms 2000 --timeout-ms 120000
```

Race success-vs-failure (finish on either, don't wait the full timeout for a failed job):

```bash
devex/scripts/src/unt.ts \
  --command 'kubectl -n main get job migrate -o jsonpath={.status.succeeded}' --grep-args '1' \
  --command 'kubectl -n main get job migrate -o jsonpath={.status.failed}'    --grep-args '[1-9]' \
  --interval-ms 3000 --timeout-ms 600000
```

HTTP health:

```bash
devex/scripts/src/unt.ts \
  --command 'curl -sS http://localhost:8080/health' \
  --grep-args '-i "status.*ok"' \
  --interval-ms 1000 --timeout-ms 30000
```
