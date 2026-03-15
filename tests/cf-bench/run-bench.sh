#!/usr/bin/env bash
#
# Benchmark script for livestore CF adapter memory/write usage.
#
# Usage:
#   ./run-bench.sh <base-url>
#   ./run-bench.sh https://livestore-cf-bench.<your-subdomain>.workers.dev
#   ./run-bench.sh http://localhost:8787   # for local wrangler dev
#
# Runs increasing event loads and reports rowsWritten + timing.

set -euo pipefail

BASE_URL="${1:?Usage: $0 <base-url>}"
STORE_ID="bench-$(date +%s)"

# macOS `date` doesn't support %3N — use python for ms timestamps
now_ms() {
  python3 -c 'import time; print(int(time.time()*1000))'
}

# Helper: extract JSON field, exits on parse failure
json_field() {
  local json="$1" field="$2"
  python3 -c "import sys,json; d=json.loads(sys.argv[1]); print(d['$field'])" "$json" || {
    echo "ERROR: Failed to parse JSON response: $json" >&2
    exit 1
  }
}

# Helper: curl wrapper that checks HTTP status
curl_check() {
  local response http_code body
  response=$(curl -s -w "\n%{http_code}" "$@")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" -lt 200 ] || [ "$http_code" -ge 300 ]; then
    echo "ERROR: HTTP $http_code from $*" >&2
    echo "  Response: $body" >&2
    exit 1
  fi
  echo "$body"
}

echo "=== LiveStore CF Adapter Benchmark ==="
echo "URL:      $BASE_URL"
echo "Store ID: $STORE_ID"
echo ""

# Health check
echo -n "Health check... "
curl_check "$BASE_URL/health" > /dev/null
echo "OK"
echo ""

# Helper: create N todos via bulk endpoint (chunks of 500 to avoid DO timeout)
create_bulk() {
  local total=$1
  local prefix=$2
  local chunk=500
  local created=0

  while [ "$created" -lt "$total" ]; do
    local batch=$((total - created))
    if [ "$batch" -gt "$chunk" ]; then batch=$chunk; fi

    curl_check -X POST "$BASE_URL/store/todos/bulk?storeId=$STORE_ID" \
      -H 'content-type: application/json' \
      -d "{\"count\": $batch, \"prefix\": \"${prefix}-c${created}\"}" > /dev/null

    created=$((created + batch))
  done
}

# Helper: get metrics
get_metrics() {
  curl_check "$BASE_URL/store/metrics?storeId=$STORE_ID"
}

# Helper: reset metrics
reset_metrics() {
  curl_check -X DELETE "$BASE_URL/store/metrics?storeId=$STORE_ID" > /dev/null
}

# Helper: shutdown store (simulate cold start)
shutdown_store() {
  curl_check -X POST "$BASE_URL/store/shutdown?storeId=$STORE_ID" > /dev/null
}

# --- Boot cost ---
echo "--- Boot cost (first request) ---"
reset_metrics
START=$(now_ms)
create_bulk 1 "boot"
END=$(now_ms)
METRICS=$(get_metrics)
echo "  Rows written: $(json_field "$METRICS" totalRowsWritten)"
echo "  Duration:     $((END - START))ms"
echo ""

# --- Steady state ---
echo "--- Steady-state writes (rows_written resets between tiers) ---"
echo "  writes/todo = rows_written / todos added in tier (ideal: 1.0, VFS baseline: ~238)"
echo ""
TIERS=(10 100 1000 5000 10000 20000 50000 100000)

reset_metrics
TOTAL_CREATED=1  # boot todo

printf "  %6s | %14s | %11s | %8s\n" "total" "rows_written" "writes/todo" "duration"

for TIER in "${TIERS[@]}"; do
  BATCH=$((TIER - TOTAL_CREATED))
  if [ "$BATCH" -le 0 ]; then continue; fi

  reset_metrics

  START=$(now_ms)
  create_bulk "$BATCH" "tier-$TIER"
  END=$(now_ms)

  METRICS=$(get_metrics)
  ROWS=$(json_field "$METRICS" totalRowsWritten)
  TODOS=$(json_field "$METRICS" todoCount)
  DURATION=$((END - START))
  WRITES_PER=$(python3 -c "print(f'{$ROWS / $BATCH:.1f}')")

  printf "  %6d | %14d | %11s | %7dms\n" "$TODOS" "$ROWS" "$WRITES_PER" "$DURATION"
  TOTAL_CREATED=$TIER
done

echo ""

# --- Cold start cost ---
echo "--- Cold start cost (shutdown + reboot) ---"
shutdown_store
reset_metrics

START=$(now_ms)
create_bulk 1 "post-restart"
END=$(now_ms)

METRICS=$(get_metrics)
ROWS=$(json_field "$METRICS" totalRowsWritten)
TODOS=$(json_field "$METRICS" todoCount)
echo "  Rows written on cold start: $ROWS (with $TODOS todos in store)"
echo "  Duration: $((END - START))ms"
echo ""

# --- Post-restart steady state ---
echo "--- Post-restart steady-state ---"
reset_metrics

START=$(now_ms)
create_bulk 100 "post-restart-steady"
END=$(now_ms)

METRICS=$(get_metrics)
ROWS=$(json_field "$METRICS" totalRowsWritten)
WRITES_PER=$(python3 -c "print(f'{$ROWS / 100:.1f}')")
echo "  100 todos: $ROWS rows_written ($WRITES_PER writes/todo) in $((END - START))ms"
echo ""

echo "=== Done ==="
