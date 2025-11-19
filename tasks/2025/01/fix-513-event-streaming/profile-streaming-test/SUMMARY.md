# Streaming Performance Test Profiling - Summary

## Completed Work

Successfully added two profiling capabilities to the streaming performance test:

### 1. CPU Profiling (Chrome DevTools Protocol)

**Files Modified:**
- `tests/perf-streaming-loopback/tests/fixtures.ts` - Added `cpuProfiler` fixture using CDP
- `tests/perf-streaming-loopback/tests/suites/simple-streaming.test.ts` - Integrated profiling

**Usage:**
```bash
cd tests/perf-streaming-loopback
CPU_PROFILER=1 direnv exec . pnpm playwright test --project=chromium simple-streaming.test.ts
```

**Output:**
- `streaming-cold.cpuprofile` - Cold run profile (~8000ms)
- `streaming-warm.cpuprofile` - Warm run profile (~800ms)

**Analysis:** Open `.cpuprofile` files in Chrome DevTools Performance tab

### 2. OTEL Tracing

**Files Created:**
- `tests/perf-streaming-loopback/test-app/src/otel.ts` - OTEL tracer setup

**Files Modified:**
- `tests/perf-streaming-loopback/test-app/src/main.tsx` - Integrated OTEL tracer
- `tests/perf-streaming-loopback/package.json` - Added OTEL dependencies

**Usage:**
```bash
# Console output (default)
cd tests/perf-streaming-loopback
direnv exec . pnpm playwright test --project=chromium simple-streaming.test.ts

# Export to Grafana/Tempo
VITE_OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \\
  direnv exec . pnpm playwright test --project=chromium simple-streaming.test.ts
```

**Output:**
- OTEL spans logged to browser console (visible in Playwright output)
- Optional: Spans exported to OTEL backend for visualization

## Key Findings

### Test Performance
- **Cold run**: 7887ms to stream 500 events (~63 events/second)
- **Warm run**: 712ms to stream 500 events (~702 events/second)
- **Speedup**: ~11x faster after JIT compilation

### What to Profile

The tools capture different aspects:

**CPU Profiler:**
- Function-level timing
- JavaScript execution paths
- React rendering overhead
- JSON.stringify, array operations
- Where CPU cycles are spent

**OTEL Traces:**
- LiveStore operations (`streamEvents:segment`)
- Batch processing (cursor, target, batchSize)
- Database queries
- System-level operation flow

## Analysis Workflow

1. **Run both profilers** to get comprehensive data:
   ```bash
   CPU_PROFILER=1 direnv exec . pnpm playwright test simple-streaming.test.ts
   ```

2. **Analyze CPU profiles** to find function-level bottlenecks:
   - Open `.cpuprofile` in Chrome DevTools
   - Look for high "Self Time" functions
   - Identify React re-render overhead
   - Find expensive operations (JSON, array slicing)

3. **Analyze OTEL traces** to understand operation flow:
   - Review console logs for span timings
   - Check `streamEvents:segment` batch sizes and durations
   - Identify which operations slow down the cold run

4. **Compare cold vs warm** runs:
   - CPU Profile: See JIT compilation impact
   - OTEL Traces: See consistent operation timing

5. **Identify optimizations**:
   - Reduce unnecessary re-renders
   - Optimize batch sizes
   - Minimize JSON serialization
   - Cache expensive computations

## Documentation

- **CPU Profiling**: `tasks/.../profile-streaming-test/usage.md`
- **OTEL Tracing**: `tasks/.../profile-streaming-test/otel-usage.md`
- **Research**: `tasks/.../profile-streaming-test/research.md`

## Next Steps

1. Analyze the collected profiles to identify specific bottlenecks
2. Prioritize optimizations based on impact
3. Implement optimizations
4. Re-run profilers to measure improvements
5. Iterate until performance targets are met

## Files Changed

```
tests/perf-streaming-loopback/
├── tests/
│   ├── fixtures.ts                          # Added cpuProfiler fixture
│   └── suites/simple-streaming.test.ts      # Integrated profiling
├── test-app/src/
│   ├── otel.ts                              # Created: OTEL setup
│   └── main.tsx                             # Added: OTEL tracer integration
└── package.json                              # Added: OTEL dependencies

tasks/2025/01/fix-513-event-streaming/profile-streaming-test/
├── README.md                                 # Overview
├── research.md                               # Problem analysis
├── usage.md                                  # CPU profiling guide
├── otel-setup.md                            # OTEL implementation notes
├── otel-usage.md                            # OTEL tracing guide
└── SUMMARY.md                               # This file
```
