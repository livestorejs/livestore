#!/usr/bin/env bash
# Generated file - DO NOT EDIT
# Source: run-with-nix-gc-race-retry.sh.genie.ts

set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <label> <shell-command>" >&2
  exit 2
fi

label="$1"
command="$2"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=genie/ci-scripts/nix-gc-race-retry.sh
. "$script_dir/nix-gc-race-retry.sh"

run_nix_gc_race_retry "$label" bash -euo pipefail -c "$command"
