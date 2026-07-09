---
name: branch
description: Create a new git branch from origin/env/stg. Use when the user asks to create a branch, start work on a ticket, or begin a new feature.
argument-hint: <branch-name>
allowed-tools: Bash
---

Create a new branch from the latest `origin/env/stg`:

```bash
git fetch origin
git checkout -b $ARGUMENTS origin/env/stg
```

$ARGUMENTS
