#!/usr/bin/env bash
# Generated file - DO NOT EDIT
# Source: nix-gc-race-retry.sh.genie.ts


run_nix_gc_race_retry() {
  local task="$1"
  local max="${NIX_GC_RACE_MAX_RETRIES:-10}"
  local heartbeat="${CI_PROGRESS_HEARTBEAT_SECONDS:-60}"
  local daemon_socket_retry_delay="${NIX_DAEMON_SOCKET_RETRY_DELAY_SECONDS:-2}"
  local attempt=1
  local log log_dir stdout_pipe stderr_pipe rc path start now elapsed hb_pid stdout_tee_pid stderr_tee_pid flattened saw_invalid_path saw_cachix_signature saw_fetch_signature saw_github_archive_503 saw_daemon_socket_failure had_errexit

  shift
  start="$(date +%s)"

  write_summary() {
    [ -n "${GITHUB_STEP_SUMMARY:-}" ] || return 0
    {
      echo "### CI Task"
      echo "- Task: $task"
      echo "- Status: $1"
      echo "- Duration: $elapsed s"
      echo "- Attempts: $attempt/$max"
      [ -z "${2:-}" ] || echo "- Note: $2"
    } >> "$GITHUB_STEP_SUMMARY"
  }

  while [ "$attempt" -le "$max" ]; do
    echo "::notice::[ci] starting $task (attempt $attempt/$max)"
    (
      while sleep "$heartbeat"; do
        now=$(date +%s)
        elapsed=$((now - start))
        echo "::notice::[ci] $task still running after $elapsed s (attempt $attempt/$max)"
      done
    ) &
    hb_pid=$!

    log=$(mktemp)
    log_dir=$(mktemp -d)
    stdout_pipe="$log_dir/stdout"
    stderr_pipe="$log_dir/stderr"
    mkfifo "$stdout_pipe" "$stderr_pipe"
    tee -a "$log" < "$stdout_pipe" &
    stdout_tee_pid=$!
    tee -a "$log" < "$stderr_pipe" >&2 &
    stderr_tee_pid=$!
    had_errexit=false
    case $- in
      *e*) had_errexit=true ;;
    esac
    set +e
    "$@" > "$stdout_pipe" 2> "$stderr_pipe"
    rc=$?
    if [ "$had_errexit" = true ]; then
      set -e
    fi
    wait "$stdout_tee_pid" 2>/dev/null || true
    wait "$stderr_tee_pid" 2>/dev/null || true
    rm -rf "$log_dir"

    kill "$hb_pid" 2>/dev/null || true
    wait "$hb_pid" 2>/dev/null || true

    now=$(date +%s)
    elapsed=$((now - start))

    if [ "$rc" -eq 0 ]; then
      echo "::notice::[ci] completed $task in $elapsed s"
      if [ "$attempt" -gt 1 ]; then
        write_summary success "Recovered from transient Nix failure after retry"
      else
        write_summary success
      fi
      rm -f "$log"
      return 0
    fi

    flattened=$(tr '\r\n' '  ' < "$log" | sed -E $'s/\x1B\\[[0-9;]*m//g')
    path=$(printf '%s' "$flattened" |
      grep -o "error:[[:space:]]*path '/nix/store/[^']*'[[:space:]]*is not valid" |
      head -1 |
      grep -o "/nix/store/[^']*" |
      tr -d '[:space:]' || true)
    saw_invalid_path=false
    saw_cachix_signature=false
    saw_fetch_signature=false
    saw_github_archive_503=false
    saw_daemon_socket_failure=false
    [ -n "$path" ] && saw_invalid_path=true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*.*Failed to convert config\.cachix to JSON' && saw_cachix_signature=true || true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*.*while evaluating the option.*cachix\.package' && saw_cachix_signature=true || true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*cannot read file from tarball:[[:space:]]*Truncated tar archive detected while reading data' && saw_fetch_signature=true || true
    printf '%s' "$flattened" | grep -Eq "unable to download 'https://api\\.github\\.com/repos/[^[:space:]']+/tarball/[^[:space:]']+': HTTP error 503|Failed to open archive .*HTTP error 503" && saw_github_archive_503=true || true
    printf '%s' "$flattened" | grep -Eq "error:[[:space:]]*cannot connect to socket at '/nix/var/nix/daemon-socket/socket'" && saw_daemon_socket_failure=true || true
    rm -f "$log"

    if [ "$saw_invalid_path" != true ] && [ "$saw_cachix_signature" != true ] && [ "$saw_fetch_signature" != true ] && [ "$saw_github_archive_503" != true ] && [ "$saw_daemon_socket_failure" != true ]; then
      echo "::warning::[ci] $task failed after $elapsed s without a detected transient Nix failure"
      write_summary failure "No transient Nix failure signature detected"
      return "$rc"
    fi

    if [ "$saw_daemon_socket_failure" = true ]; then
      echo "::warning::Nix daemon socket failure detected for $task (attempt $attempt/$max); waiting $daemon_socket_retry_delay s for host supervision before retrying without mutating the host daemon"
    elif [ "$saw_github_archive_503" = true ]; then
      github_archive_delay_base="${NIX_GITHUB_ARCHIVE_503_BASE_DELAY_SECONDS:-15}"
      github_archive_delay=$((github_archive_delay_base * attempt + RANDOM % github_archive_delay_base))
      echo "::warning::GitHub archive fetch returned HTTP 503 for $task (attempt $attempt/$max); retrying after ${github_archive_delay}s backoff"
      sleep "$github_archive_delay"
    elif [ "$saw_fetch_signature" = true ]; then
      echo "::warning::Nix source fetch corruption detected for $task (attempt $attempt/$max); retrying with a refreshed eval cache"
    elif [ "$saw_cachix_signature" = true ] && [ -n "$path" ]; then
      echo "::warning::Nix store validity race detected for $task via cachix eval wrapper (attempt $attempt/$max): $path"
    elif [ "$saw_cachix_signature" = true ]; then
      echo "::warning::Nix store validity race detected for $task via cachix eval wrapper without extracted store path (attempt $attempt/$max)"
    else
      echo "::warning::Nix store validity race detected for $task (attempt $attempt/$max): $path"
    fi

    [ -z "$path" ] || nix-store --realise "$path" 2>/dev/null || true
    rm -rf ~/.cache/nix/eval-cache-*
    if [ "$saw_daemon_socket_failure" = true ] && [ "$attempt" -lt "$max" ]; then
      sleep "$daemon_socket_retry_delay"
    fi
    attempt=$((attempt + 1))
  done

  now=$(date +%s)
  elapsed=$((now - start))
  echo "::error::Transient Nix retry exhausted for $task ($max attempts)"
  write_summary failure "Transient Nix retry exhausted"
  return 1
}

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
  invalid_path=$(grep -o "error:[[:space:]]*path '/nix/store/[^']*'[[:space:]]*is not valid" "$log" |
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
