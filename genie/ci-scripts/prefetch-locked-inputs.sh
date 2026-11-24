#!/usr/bin/env bash
# Generated file - DO NOT EDIT
# Source: prefetch-locked-inputs.sh.genie.ts


# Read only the checkout lock: no flake evaluation, package builds or mutable refs.
locked_shell_inputs() {
  jq -er '
    . as $lock |
    def resolve($edge; $depth):
      if $depth > 100 then error("cyclic follows")
      elif $edge | type == "string" then $edge
      elif $edge | type == "array" then
        reduce $edge[] as $name ($lock.root;
          resolve($lock.nodes[.].inputs[$name]; $depth + 1))
      else error("invalid input edge") end;
    def walk($id; $seen):
      if $seen | index($id) then empty else
        $id, (($lock.nodes[$id].inputs // {})[] |
          resolve(.; 0) | walk(.; $seen + [$id]))
      end;
    [$lock.nodes[$lock.root].inputs | to_entries[] |
      select(.key != "devenv") | resolve(.value; 0) | walk(.; []) |
      $lock.nodes[.].locked | select(.type == "github") |
      select((.rev | type == "string") and (.narHash | type == "string")) |
      select(.rev | test("^[0-9a-f]{40}$")) |
      select(.narHash | startswith("sha256-")) |
      select((keys - ["type", "owner", "repo", "rev", "narHash", "lastModified", "host"]) == [])] |
    unique | .[] |
    "github:\(.owner | @uri)/\(.repo | @uri)/\(.rev)?narHash=\(.narHash | @uri)" +
      (if .host then "&host=\(.host | @uri)" else "" end)
  ' "$1"
}

# Each worker owns and joins its fetch process, including on timeout/termination.
locked_input_worker() {
  local child='' ref failed=0
  trap '[ -z "$child" ] || { kill "$child" 2>/dev/null || true; wait "$child" 2>/dev/null || true; }' EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT
  while IFS= read -r ref; do
    nix flake prefetch --json "$ref" > /dev/null 2>> "$2" &
    child=$!
    if ! wait "$child"; then failed=1; fi
    child=''
  done < "$1"
  trap - EXIT TERM INT
  return "$failed"
}

# Two workers overlap immutable fetches with executable resolution. Failures are
# optional: the authoritative shell resolver still checks every locked identity.
prefetch_locked_inputs() {
  local lock_file="$1" work_dir="$2" child failed=0
  local children=()
  mkdir -p "$work_dir"
  trap 'for child in "${children[@]}"; do kill "$child" 2>/dev/null || true; done; for child in "${children[@]}"; do wait "$child" 2>/dev/null || true; done' EXIT
  trap 'exit 143' TERM
  trap 'exit 130' INT
  if ! locked_shell_inputs "$lock_file" > "$work_dir/inputs" 2> "$work_dir/parse.log"; then
    # jq -e also reports no selected inputs as unsuccessful; an empty list is safe.
    if [ -s "$work_dir/parse.log" ]; then
      echo '::warning::Locked shell-input prefetch skipped: lock parsing failed.' >&2
      trap - EXIT TERM INT
      return 0
    fi
  fi
  jq -Rn '[inputs] | to_entries | .[] | select(.key % 2 == 0) | .value' -r < "$work_dir/inputs" > "$work_dir/worker-0"
  jq -Rn '[inputs] | to_entries | .[] | select(.key % 2 == 1) | .value' -r < "$work_dir/inputs" > "$work_dir/worker-1"
  locked_input_worker "$work_dir/worker-0" "$work_dir/fetch-0.log" &
  children+=("$!")
  locked_input_worker "$work_dir/worker-1" "$work_dir/fetch-1.log" &
  children+=("$!")
  for child in "${children[@]}"; do
    if ! wait "$child"; then failed=1; fi
  done
  children=()
  if [ "$failed" -ne 0 ]; then
    echo '::warning::Locked shell-input prefetch failed; normal shell resolution remains authoritative.' >&2
  fi
  trap - EXIT TERM INT
}
