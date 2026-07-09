---
name: grep
description: Run grep on the command line (NOT the Grep tool for code search). Use when the user wants to pipe command output through grep, filter a stream, or grep a file as part of a shell pipeline.
argument-hint: [pattern and files, or description of what to filter]
allowed-tools: Bash
---

# grep (CLI)

Use this when the user is constructing a **shell pipeline** that includes `grep`, or wants to filter streaming output (like `stern`, `kubectl logs -f`, `tail -f`, `journalctl -f`).

This is **not** the tool for searching code in the repo — use the `Grep` tool for that.

## Required behavior

1. **Always pass `--line-buffered`** when grep is in a pipeline reading from a streaming source.

   Without it, grep buffers its output in blocks (typically 4 KB). In a live tail, you'll see output arrive in chunks — or appear to hang for minutes — rather than line-by-line.

   `--line-buffered` forces grep to flush after every matching line, which is what the developer almost always wants when filtering streams.

2. **Always pass `--color=always`** when the grep output will be seen by a human (typical case). grep auto-disables color when stdout is a pipe; many users want to pipe to `less -R` or similar and still see highlighting.

## Canonical form

```bash
<streaming command> | grep --color=always --line-buffered '<pattern>'
```

Multiple keywords (OR):

```bash
... | grep --color=always --line-buffered -E 'err|warn|fail'
```

Case-insensitive:

```bash
... | grep --color=always --line-buffered -i 'pattern'
```

Inverted (drop matches):

```bash
... | grep --color=always --line-buffered -v 'noise'
```

## When `--line-buffered` is critical

- Live log tailing (`stern`, `kubectl logs -f`, `tail -f`)
- Real-time metrics streams
- Any pipeline where the developer expects output _as it happens_

## When `--line-buffered` is unnecessary (but harmless)

- Grepping a finite file: `grep foo file.log`
- Grepping a command that completes quickly: `ls | grep foo`

Still pass it — it's zero-cost and future-proofs the pipeline if the developer edits it later.

## Combining with other tools

When piping **into** grep from a tool that has its own color auto-detection (stern, rg, etc.), make sure **both** sides force color:

```bash
stern --color=always ... | grep --color=always --line-buffered 'keyword'
```

Otherwise stern strips color when piped → grep has nothing colored to pass through.

When piping grep output **into a pager**:

```bash
... | grep --color=always --line-buffered 'keyword' | less -R
```

`less -R` passes ANSI escape codes through so highlighting stays.

## Counter-example

Don't do this:

```bash
# bad — grep buffers, developer thinks stream is stuck
stern -A 'foo' | grep error
```

Do this:

```bash
stern --color=always -A 'foo' | grep --color=always --line-buffered error
```
