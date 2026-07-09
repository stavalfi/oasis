#!/usr/bin/env bash
# Runs `npm install` if any of package.json / bun.lock / bunfig.toml differs
# between two git refs. Used by post-checkout / post-merge / post-rewrite to
# keep node_modules in sync after branch switches / merges / rebases.
#
# Usage: install-if-deps-changed.sh <from-ref> <to-ref>
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "${repo_root}"

from="${1}"
to="${2}"
if ! git diff --quiet "${from}" "${to}" -- package.json package-lock.json; then
  npm install
fi
