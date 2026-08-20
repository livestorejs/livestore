#!/usr/bin/env bash
# Generated file - DO NOT EDIT
# Source: resolve-devenv.sh.genie.ts


DEVENV_GC_ROOT_DIR="${RUNNER_TEMP:-/tmp}/genie-nix-gc-roots"
DEVENV_GC_ROOT_ID=$(printf '%s' "${GITHUB_RUN_ID:-local-$$}-${GITHUB_RUN_ATTEMPT:-0}-${GITHUB_JOB:-job}" | tr -c 'A-Za-z0-9._-' '_')
DEVENV_GC_ROOT="$DEVENV_GC_ROOT_DIR/devenv-$DEVENV_GC_ROOT_ID"

resolve_devenv_once() {
  mkdir -p "$DEVENV_GC_ROOT_DIR"
  nix build \
    --accept-flake-config \
    --option extra-substituters https://devenv.cachix.org \
    --option extra-trusted-public-keys devenv.cachix.org-1:w1cLUi8dv3hnoSPGAuibQv+f9TZLr6cv/Hm9XgU50cw= \
    --out-link "$DEVENV_GC_ROOT" \
    --print-out-paths \
    "github:cachix/devenv/$DEVENV_REV#devenv"
}

resolve_devenv() {
  local invalid_path
  local log
  local rc

  log=$(mktemp)
  if resolve_devenv_once 2>"$log"; then
    cat "$log" >&2
    rm -f "$log"
    return 0
  else
    rc=$?
  fi
  cat "$log" >&2
  invalid_path=$(grep -E -o "error:[[:space:]]*path '/nix/store/[^']*'[[:space:]]*is not( a)? valid( store path)?" "$log" |
    head -1 | grep -o "/nix/store/[^']*" || true)
  rm -f "$log"
  [ -n "$invalid_path" ] || return "$rc"

  echo "::warning::devenv resolution hit an invalid Nix store path; clearing the client eval cache and retrying once: $invalid_path" >&2
  rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/nix/eval-cache-"* ~/.cache/nix/eval-cache-*
  nix-store --repair-path "$invalid_path" >/dev/null 2>&1 ||
    nix-store --realise "$invalid_path" >/dev/null 2>&1 || true
  if resolve_devenv_once; then
    if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
      echo '### Recovered Nix store lifecycle incident' >> "$GITHUB_STEP_SUMMARY"
      echo "- Invalid path: $invalid_path" >> "$GITHUB_STEP_SUMMARY"
      echo '- Attempts: 2/2' >> "$GITHUB_STEP_SUMMARY"
    fi
    return 0
  else
    return $?
  fi
}
