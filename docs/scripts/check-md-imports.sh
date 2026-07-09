#!/usr/bin/env bash
set -euo pipefail

matches="$(grep -rl '^import ' src/content/docs --include='*.md' 2>/dev/null || true)"
violations="$(printf '%s\n' "$matches" | grep -v '^src/content/docs/api/' || true)"

if [[ -n "$violations" ]]; then
  echo "Error: Found .md files with import statements. These must be renamed to .mdx:"
  printf '%s\n' "$violations" | while IFS= read -r path; do
    [[ -n "$path" ]] && echo "  - docs/$path"
  done
  exit 1
fi
