#!/usr/bin/env bash
# Generated file - DO NOT EDIT
# Source: nix-gc-race-retry.sh.genie.ts


run_nix_gc_race_retry() {
  local task="$1"
  local max="${NIX_GC_RACE_MAX_RETRIES:-10}"
  local heartbeat="${CI_PROGRESS_HEARTBEAT_SECONDS:-60}"
  local daemon_socket_retry_delay="${NIX_DAEMON_SOCKET_RETRY_DELAY_SECONDS:-2}"
  # Diagnostic threshold only: one bounded dump per attempt, never a deadline.
  local preparation_threshold="${CI_PREPARATION_DIAGNOSTIC_SECONDS:-120}"
  local attempt=1
  local repaired_missing_subpaths=()
  # The guillemets Nix wraps a flake reference in, built from their UTF-8 bytes so this
  # generator template stays ASCII: a non-ASCII literal here can be re-encoded by the
  # transpiler into an escape sequence that String.raw would emit verbatim.
  local flake_ref_open flake_ref_close nix_cache_root
  flake_ref_open=$'\302\253'
  flake_ref_close=$'\302\273'
  nix_cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/nix"
  local log log_dir stdout_pipe stderr_pipe rc path missing_subpath repaired_missing_subpath start now elapsed hb_pid stdout_tee_pid stderr_tee_pid flattened saw_invalid_path saw_cachix_signature saw_fetch_signature saw_github_archive_503 saw_daemon_socket_failure saw_missing_flake_subpath missing_subpath_was_repaired had_errexit preparation_start

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

  # Observe the existing tee log; leave the foreground command and its signals alone.
  preparation_diagnostics() {
    python3 - "$log" "$log_dir" "$$" "$hb_pid" "$stdout_tee_pid" "$stderr_tee_pid" "$1" "$preparation_threshold" <<'PY'
import os
import re
import subprocess
import sys

log, state, root, *args = sys.argv[1:]
excluded = set(args[:3])
elapsed, threshold = map(int, args[3:])
pending = {}
overflow = False
started = False
ansi = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
with open(log, errors="replace") as stream:
    for raw in stream:
        line = ansi.sub("", raw).strip()
        if re.search(r"(?:^|[\u2022\u2713]\s+)Running tasks\b", line):
            started = True
        activity = re.search(r"[\u2022\u2713]\s+(Building|Downloading)\s+(.+?)(?:\s+in\s+[\d.]+\s*[a-z]+)?$", line)
        if activity:
            kind, name = activity.groups()
            key = (kind, name)
            if "\u2713" in line:
                pending.pop(key, None)
            elif len(pending) < 24:
                pending[key] = None
            else:
                overflow = True
if started:
    marker = os.path.join(state, "tasks-started")
    if not os.path.exists(marker):
        open(marker, "w").close()
        print("::notice::[ci] phase: tasks started (observed devenv output)", flush=True)
    sys.exit()
marker = os.path.join(state, "preparation-dumped")
if elapsed < 0 or elapsed < threshold or os.path.exists(marker):
    sys.exit()
open(marker, "w").close()

def redact(value):
    # Do not expose URL credentials/query tokens, secret argv options, or known env secrets.
    value = re.sub(r"(?i)\b[a-z][a-z0-9+.-]*://[^\s]+", "[REDACTED_URL]", value)
    value = re.sub(r"""(?i)((?:--)?[\w-]*(?:token|password|secret|authorization|credential|api[_-]?key)[\w-]*[=:\s]+)(?:bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s]+)""", r"\1[REDACTED]", value)
    value = re.sub(r"\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b", "[REDACTED]", value)
    for key, secret in os.environ.items():
        if re.search(r"(?i)token|password|secret|credential|api.?key", key) and secret:
            value = value.replace(secret, "[REDACTED]")
    home = os.environ.get("HOME")
    return value.replace(home, "~") if home else value

snapshot = ["Preparation snapshot (best effort; no lock ownership inferred)"]
def probe(argv):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=2)
        return result.stdout if result.returncode == 0 else "unavailable"
    except (OSError, subprocess.SubprocessError):
        return "unavailable"

try:
    group = os.getpgid(int(root))
    # pgid is used only for selection; include wait channel and bounded argv in evidence.
    processes = probe(["ps", "-axo", "pid=,ppid=,pgid=,stat=,wchan:32=,etime=,args="])
    rows = [raw.split(None, 6) for raw in processes.splitlines()]
    rows = [row for row in rows if len(row) == 7 and all(x.isdigit() for x in row[:3])]
    if not rows:
        processes = probe(["ps", "-axo", "pid=,ppid=,pgid=,stat=,etime=,args="])
        for raw in processes.splitlines():
            fields = raw.split(None, 5)
            if len(fields) == 6 and all(x.isdigit() for x in fields[:3]):
                rows.append(fields[:4] + ["-"] + fields[4:])
    snapshot.append("pid ppid stat wchan etime args (argv truncated to 240 characters)")
    nix_pids = []
    for pid, parent, pgid, status, channel, age, argv in rows:
        if re.search(r"(?:^|/|\s)nix(?:-daemon|-store)?(?:\s|$)", argv):
            nix_pids.append(pid)
        if pgid == str(group):
            if len(snapshot) < 66:
                snapshot.append(f"{pid} {parent} {status} {channel} {age} {redact(argv)[:240]}")
            elif len(snapshot) == 66:
                snapshot.append("[truncated: process group]")
    if sys.platform == "darwin":
        daemon = "unavailable"
        for label in ["org.nixos.nix-daemon", "systems.determinate.nix-daemon"]:
            daemon = probe(["launchctl", "print", "system/" + label])
            if daemon != "unavailable":
                break
        daemon = "\n".join(daemon.splitlines()[:12])
    else:
        daemon = probe(["systemctl", "show", "nix-daemon.service",
            "--property=ActiveState,SubState,MainPID", "--no-pager"])
    snapshot.append("nix daemon: " + daemon[:1024])
    snapshot.append("open /nix/var/nix descriptors (not proof of lock ownership):")
    for pid in nix_pids[:16]:
        try:
            for fd in list(os.scandir(f"/proc/{pid}/fd"))[:256]:
                try:
                    target = os.readlink(fd.path)
                    if target.startswith("/nix/var/nix/"):
                        snapshot.append(f"pid={pid} fd={fd.name} {target}")
                except OSError:
                    pass
        except OSError:
            snapshot.append(f"pid={pid}: descriptors unavailable")
except (OSError, ValueError):
    snapshot.append("process group unavailable")

# The resolving child sets this directory too; derive it here because child env cannot
# propagate back to the retry wrapper. Each attempt has its own marker and snapshot.
diag = os.environ.get("NIX_STORE_DIAGNOSTICS_DIR") or os.path.join(
    os.environ.get("RUNNER_TEMP", state), "composition-state", "nix-store-diagnostics",
    "-".join(os.environ.get(key, default) for key, default in
        [("GITHUB_JOB", "job"), ("RUNNER_OS", "unknown"), ("GITHUB_RUN_ATTEMPT", "0")]))
try:
    import glob
    for path in sorted(glob.glob(os.path.join(diag, "locked-input-prefetch", "*.log")))[:8]:
        if not os.path.isfile(path):
            continue
        with open(path, "rb") as stream:
            stream.seek(max(0, os.fstat(stream.fileno()).st_size - 4096))
            snapshot.append("prefetch tail: " + os.path.basename(path))
            snapshot.extend(stream.read().decode(errors="replace").splitlines()[-20:])
    os.makedirs(diag, exist_ok=True)
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", prefix="preparation-", suffix=".log",
                                     dir=diag, delete=False) as stream:
        stream.write(redact("\n".join(snapshot))[:24576] + "\n")
except OSError:
    pass

def safe_name(value):
    # Only basenames: never replay paths, URL credentials/query strings or argv.
    value = value.split("?", 1)[0].split("#", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    return re.sub(r"[^a-zA-Z0-9_.+-]", "_", value)[:120] or "unknown"

lines = ["::notice::[ci] preparation diagnostics begin (observed pending activities; not lock ownership)"]
try:
    result = subprocess.run(
        ["ps", "-axo", "pid=,ppid=,etime=,comm="],
        capture_output=True, text=True, timeout=2, check=True,
    )
    rows = [line.split(None, 3) for line in result.stdout.splitlines()]
    children = [row for row in rows if len(row) == 4 and row[1] == root and row[0] not in excluded]
    tree = list(children)
    for row in tree:
        tree.extend(child for child in rows if len(child) == 4 and child[1] == row[0])
    for pid, parent, age, command in tree[:8]:
        lines.append(f"process pid={pid} parent={parent} elapsed={age} command={safe_name(command)}")
    if len(tree) > 8:
        lines.append("[truncated: process tree exceeds 8 entries]")
    if not tree:
        lines.append("process tree unavailable (invocation may have exited)")
except (OSError, subprocess.SubprocessError):
    lines.append("process tree unavailable (probe failed or exceeded 2 s)")
for kind, name in pending:
    lines.append(f"pending {kind.lower()}: {safe_name(name)}")
if not pending:
    lines.append("pending Nix activities: unknown (no unmatched output markers)")
if overflow:
    lines.append("[truncated: more than 24 pending activities observed]")
lines.append("::notice::[ci] preparation diagnostics end")
payload = "\n".join(lines)
if len(lines) > 40 or len(payload.encode()) > 8192:
    payload = "\n".join(lines[:38]).encode()[:8000].decode(errors="ignore") + "\n[truncated: diagnostic output cap]"
print(payload, flush=True)
PY
  }

  while [ "$attempt" -le "$max" ]; do
    echo "::notice::[ci] starting $task (attempt $attempt/$max)"
    log=$(mktemp)
    log_dir=$(mktemp -d)
    echo "::notice::[ci] phase: environment realization started (attempt $attempt/$max)"
    preparation_start=$(date +%s)
    stdout_pipe="$log_dir/stdout"
    stderr_pipe="$log_dir/stderr"
    mkfifo "$stdout_pipe" "$stderr_pipe"
    tee -a "$log" < "$stdout_pipe" &
    stdout_tee_pid=$!
    tee -a "$log" < "$stderr_pipe" >&2 &
    stderr_tee_pid=$!
    (
      hb_pid=$BASHPID
      heartbeat_sleep_pid=''
      trap '[ -z "$heartbeat_sleep_pid" ] || kill "$heartbeat_sleep_pid" 2>/dev/null || true; exit 0' TERM INT
      while true; do
        sleep "$heartbeat" &
        heartbeat_sleep_pid=$!
        wait "$heartbeat_sleep_pid" || exit 0
        now=$(date +%s)
        elapsed=$((now - start))
        echo "::notice::[ci] $task still running after $elapsed s (attempt $attempt/$max)"
        preparation_diagnostics "$((now - preparation_start))" || true
      done
    ) &
    hb_pid=$!
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
    kill "$hb_pid" 2>/dev/null || true
    wait "$hb_pid" 2>/dev/null || true

    # Always report task start even for commands shorter than one heartbeat.
    preparation_diagnostics -1 || true
    rm -rf "$log_dir"

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
    saw_github_archive_503=false
    saw_daemon_socket_failure=false
    saw_missing_flake_subpath=false
    [ -n "$path" ] && saw_invalid_path=true
    [ -n "$missing_subpath" ] && saw_missing_flake_subpath=true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*.*Failed to convert config\.cachix to JSON' && saw_cachix_signature=true || true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*.*while evaluating the option.*cachix\.package' && saw_cachix_signature=true || true
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*cannot read file from tarball:[[:space:]]*Truncated tar archive detected while reading data' && saw_fetch_signature=true || true
    printf '%s' "$flattened" | grep -Eq "unable to download 'https://api\\.github\\.com/repos/[^[:space:]']+/tarball/[^[:space:]']+': HTTP error 503|Failed to open archive .*HTTP error 503" && saw_github_archive_503=true || true
    # fetchurl gives up after its own curl retries with this exact wording; an origin 5xx
    # (GitHub release assets) is a transient network failure, not a build defect.
    printf '%s' "$flattened" | grep -Eq 'error:[[:space:]]*cannot download [^[:space:]]+ from any mirror' && saw_fetch_signature=true || true
    # Nix can resume an already complete body at EOF after an HTTP/2 drop; the server
    # correctly returns 416. No nix.conf setting fixes this resume-at-EOF bug.
    printf '%s' "$flattened" | grep -Eq "error:[[:space:]]*unable to download '[^']+': HTTP error 416([^0-9]|$)" && saw_fetch_signature=true || true
    # Cachix can return a transient conflict for narinfo GETs; Nix treats 409 as permanent.
    printf '%s' "$flattened" | grep -Eq "error:[[:space:]]*unable to download 'https?://[^']+\\.narinfo': HTTP error 409([^0-9]|$)" && saw_fetch_signature=true || true
    # A successful HTTP status does not imply a successful NAR transfer. Match
    # terminal Nix errors, not retry warnings that can precede an unrelated task failure.
    printf '%s' "$flattened" | grep -Eq "error:[[:space:]]*unable to download 'https?://[^']+': HTTP error [0-9]+ \\(curl error: (Failed sending data to the peer|Failure when receiving data from the peer|Timeout was reached)\\)" && saw_fetch_signature=true || true
    printf '%s' "$flattened" | grep -Eq "error:[[:space:]]*some substitutes for the outputs of derivation '/nix/store/[^']+\\.drv' failed \\(usually happens due to networking issues\\)" && saw_fetch_signature=true || true
    printf '%s' "$flattened" | grep -Eq "error:[[:space:]]*cannot connect to socket at '/nix/var/nix/daemon-socket/socket'" && saw_daemon_socket_failure=true || true
    rm -f "$log"

    # The guillemet form can also describe a path that upstream removed permanently, which
    # no amount of cache purging fixes. Repair each exact path once; a repeated failure for
    # that same path is reported as the permanent path error it is, with its own summary
    # note, rather than falling through to the generic "no transient signature" message or
    # burning $max attempts.
    missing_subpath_was_repaired=false
    if [ "$saw_missing_flake_subpath" = true ] && [ "${repaired_missing_subpaths[0]+present}" = present ]; then
      for repaired_missing_subpath in "${repaired_missing_subpaths[@]}"; do
        if [ "$repaired_missing_subpath" = "$missing_subpath" ]; then
          missing_subpath_was_repaired=true
          break
        fi
      done
    fi
    if [ "$missing_subpath_was_repaired" = true ]; then
      echo "::error::Nix flake input subpath still missing for $task after one cache repair: $missing_subpath; treating it as a permanent missing path"
      write_summary failure "Nix flake input subpath still missing after one cache repair: $missing_subpath"
      return "$rc"
    fi

    if [ "$saw_invalid_path" != true ] && [ "$saw_cachix_signature" != true ] && [ "$saw_fetch_signature" != true ] && [ "$saw_github_archive_503" != true ] && [ "$saw_daemon_socket_failure" != true ] && [ "$saw_missing_flake_subpath" != true ]; then
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
      repaired_missing_subpaths+=("$missing_subpath")
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
