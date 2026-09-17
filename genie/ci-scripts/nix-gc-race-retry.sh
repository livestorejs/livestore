#!/usr/bin/env bash
# Generated file - DO NOT EDIT
# Source: nix-gc-race-retry.sh.genie.ts


run_nix_gc_race_retry() {
  local task="$1"
  local max="${NIX_GC_RACE_MAX_RETRIES:-10}"
  local heartbeat="${CI_PROGRESS_HEARTBEAT_SECONDS:-60}"
  local daemon_socket_retry_delay="${NIX_DAEMON_SOCKET_RETRY_DELAY_SECONDS:-2}"
  local attempt=1
  local missing_subpath_repairs=0
  # The guillemets Nix wraps a flake reference in, built from their UTF-8 bytes so this
  # generator template stays ASCII: a non-ASCII literal here can be re-encoded by the
  # transpiler into an escape sequence that String.raw would emit verbatim.
  local flake_ref_open flake_ref_close nix_cache_root
  flake_ref_open=$'\302\253'
  flake_ref_close=$'\302\273'
  nix_cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/nix"
  local log log_dir stdout_pipe stderr_pipe rc path missing_subpath start now elapsed hb_pid stdout_tee_pid stderr_tee_pid flattened saw_invalid_path saw_cachix_signature saw_fetch_signature saw_daemon_socket_failure saw_missing_flake_subpath had_errexit

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
    # A flake input whose source landed in the local fetcher/Git/tarball caches
    # incompletely renders as an error naming a path INSIDE a flake reference:
    #   error: path 'FLAKE_REF/<subpath>' does not exist
    # where Nix wraps FLAKE_REF in guillemets. A genuinely absent store path is reported
    # with the same wording, so the match is anchored on the guillemet-wrapped form
    # (built above from its UTF-8 bytes) and on 'path' directly following 'error:'.
    missing_subpath=$(printf '%s' "$flattened" |
      grep -o "error:[[:space:]]*path '${flake_ref_open}[^']*${flake_ref_close}[^']*' does not exist" |
      head -1 |
      sed -E "s/^error:[[:space:]]*path '//; s/' does not exist$//" || true)
    saw_invalid_path=false
    saw_cachix_signature=false
    saw_fetch_signature=false
    saw_daemon_socket_failure=false
    saw_missing_flake_subpath=false
    [ -n "$path" ] && saw_invalid_path=true
    [ -n "$missing_subpath" ] && saw_missing_flake_subpath=true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*.*Failed to convert config\.cachix to JSON' && saw_cachix_signature=true || true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*.*while evaluating the option.*cachix\.package' && saw_cachix_signature=true || true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*cannot read file from tarball:[[:space:]]*Truncated tar archive detected while reading data' && saw_fetch_signature=true || true
    printf '%s' "$flattened" | grep -Eq "unable to download 'https://api\\.github\\.com/repos/[^[:space:]']+/tarball/[^[:space:]']+': HTTP error 503|Failed to open archive .*HTTP error 503" && saw_github_archive_503=true || true
    printf '%s' "$flattened" | grep -Eq "error:[[:space:]]*cannot connect to socket at '/nix/var/nix/daemon-socket/socket'" && saw_daemon_socket_failure=true || true
    rm -f "$log"

    # The guillemet form can also describe a path that upstream removed permanently, which
    # no amount of cache purging fixes. Repair it once; a second identical failure is
    # reported as the permanent path error it is, with its own summary note, rather than
    # falling through to the generic "no transient signature" message or burning $max
    # attempts.
    if [ "$saw_missing_flake_subpath" = true ] && [ "$missing_subpath_repairs" -ge 1 ]; then
      echo "::error::Nix flake input subpath still missing for $task after one cache repair: $missing_subpath; treating it as a permanent missing path"
      write_summary failure "Nix flake input subpath still missing after one cache repair: $missing_subpath"
      return "$rc"
    fi

    if [ "$saw_invalid_path" != true ] && [ "$saw_cachix_signature" != true ] && [ "$saw_fetch_signature" != true ] && [ "$saw_daemon_socket_failure" != true ] && [ "$saw_missing_flake_subpath" != true ]; then
      echo "::warning::[ci] $task failed after $elapsed s without a detected transient Nix failure"
      write_summary failure "No transient Nix failure signature detected"
      return "$rc"
    fi

    if [ "$saw_daemon_socket_failure" = true ]; then
      echo "::warning::Nix daemon socket failure detected for $task (attempt $attempt/$max); waiting $daemon_socket_retry_delay s for host supervision before retrying without mutating the host daemon"
    elif [ "$saw_missing_flake_subpath" = true ]; then
      echo "::warning::Incomplete Nix flake input cache detected for $task (attempt $attempt/$max): $missing_subpath; retrying with a refreshed input cache"
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
    # Both cache roots: the legacy HOME-relative path and the XDG root this helper resolves,
    # which diverge whenever XDG_CACHE_HOME is set away from $HOME/.cache.
    rm -rf ~/.cache/nix/eval-cache-* "$nix_cache_root"/eval-cache-*
    if [ "$saw_missing_flake_subpath" = true ]; then
      # Determinate Nix versions these caches, so the bare legacy names match nothing.
      # The sqlite globs intentionally cover the -shm/-wal sidecars: leaving those behind
      # next to a deleted database is what turns a repair into a corrupt-cache failure.
      rm -rf "$nix_cache_root"/tarball-cache-v* "$nix_cache_root"/tarball-cache
      rm -rf "$nix_cache_root"/gitv*
      rm -f "$nix_cache_root"/fetcher-cache-v*.sqlite*
      missing_subpath_repairs=$((missing_subpath_repairs + 1))
    fi
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
