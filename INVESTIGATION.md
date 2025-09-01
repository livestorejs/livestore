# CI Performance Investigation: Node-Sync Test

## Problem Statement

The `node-sync` integration test is experiencing a **70x performance degradation** in CI:
- **Local performance:** ~8.5 seconds average
- **CI performance:** >10 minutes (timeout exceeded)
- **Impact:** Blocking CI pipeline with test failures

## Investigation Approach

This investigation uses a **multi-hypothesis testing methodology** to systematically identify the root cause(s). Each hypothesis is tested in isolation with comprehensive diagnostics.

## Hypotheses Being Tested

### 🚀 Hypothesis 1: Wrangler Server Startup Bottleneck
**Theory:** Wrangler Dev Server startup is extremely slow in CI due to cold starts, dependency downloads, or initialization overhead.

**Tests:**
- `H1.1`: Pure Wrangler startup timing
- `H1.2`: Concurrent startup stress test  
- `H1.3`: Dependency resolution timing
- `H1.4`: Port allocation timing
- `H1.5`: Network connectivity check

**File:** `tests/integration/src/tests/node-sync/hypothesis-1-wrangler.test.ts`

---

### 💾 Hypothesis 2: Resource Contention & Starvation  
**Theory:** CI runners have limited CPU/memory causing extreme slowdowns under load.

**Tests:**
- `H2.1`: Baseline resource usage
- `H2.2`: Single worker resource usage
- `H2.3`: Multiple worker scaling
- `H2.4`: Memory pressure simulation

**File:** `tests/integration/src/tests/node-sync/hypothesis-2-resources.test.ts`

---

### 🌐 Hypothesis 3: Network & Port Issues
**Theory:** CI environment has network restrictions, port conflicts, or DNS issues.

**Tests:**
- `H3.1`: Port allocation performance
- `H3.2`: DNS resolution and localhost connectivity  
- `H3.3`: Port binding and server startup
- `H3.4`: Wrangler networking performance

**File:** `tests/integration/src/tests/node-sync/hypothesis-3-network.test.ts`

---

### 📁 Hypothesis 4: File System Performance
**Theory:** CI uses slower storage (network-attached, overlay filesystems) causing I/O bottlenecks.

**Tests:**
- `H4.1`: Basic file I/O benchmark
- `H4.2`: SQLite performance benchmark
- `H4.3`: File system type analysis
- `H4.4`: Directory operations stress test
- `H4.5`: Simulated test workspace I/O
- `H4.6`: Disk pressure testing

**File:** `tests/integration/src/tests/node-sync/hypothesis-4-filesystem.test.ts`

---

### 🔄 Hypothesis 5: Process Management Overhead
**Theory:** Process tree operations are expensive in CI causing significant delays.

**Tests:**
- `H5.1`: Process tree analysis
- `H5.2`: Process spawning performance
- `H5.3`: Worker process lifecycle timing
- `H5.4`: Process cleanup timing
- `H5.5`: Concurrent process operations

**File:** `tests/integration/src/tests/node-sync/hypothesis-5-processes.test.ts`

---

### ⚡ Hypothesis 6: Test Framework Overhead
**Theory:** Vitest, Effect, or other framework initialization is extremely slow in CI.

**Tests:**
- `H6.1`: Framework initialization timing
- `H6.2`: Module loading performance
- `H6.3`: Property testing overhead
- `H6.4`: Test context creation overhead  
- `H6.5`: Effect vs native performance
- `H6.6`: Vitest-specific overhead
- `H6.7`: Memory allocation patterns

**File:** `tests/integration/src/tests/node-sync/hypothesis-6-framework.test.ts`

---

## Diagnostic Infrastructure

### Core Components
- **`diagnostics/index.ts`**: Shared diagnostic utilities, timing measurement, and report generation
- **`hypothesis-base.ts`**: Common test infrastructure and environment checks

### Data Collection
Each test automatically collects:
- **System snapshots**: Memory, CPU, process counts, disk usage
- **Timing measurements**: Per-operation with success/failure status
- **Resource monitoring**: Before/during/after each test phase
- **Error correlation**: Detailed failure analysis

### Report Generation
- **JSON reports**: Machine-readable detailed data
- **Markdown summaries**: Human-readable analysis
- **Comparative analysis**: Cross-hypothesis correlation

## Running Tests

### Locally (for development)
```bash
# Run individual hypothesis
direnv exec . vitest run tests/integration/src/tests/node-sync/hypothesis-1-wrangler.test.ts

# Run all hypotheses
direnv exec . vitest run tests/integration/src/tests/node-sync/hypothesis-*.test.ts
```

### In CI (automatic)
Push to `debug/ci-node-sync-perf-investigation` branch triggers:
- Matrix execution of all 6 hypotheses in parallel
- Isolated testing environment per hypothesis
- Comprehensive artifact collection
- Consolidated analysis report

## Expected Outcomes

1. **Quantified bottlenecks**: Precise identification of performance issues
2. **Environmental factors**: Understanding of CI-specific constraints  
3. **Correlation analysis**: Relationships between different factors
4. **Actionable fixes**: Clear optimization targets with expected impact
5. **Prevention strategies**: Avoid similar issues in future tests

## Artifacts Generated

- **Individual reports**: Per-hypothesis detailed analysis
- **Timing data**: JSON format for further analysis
- **System metrics**: Resource usage patterns
- **Consolidated summary**: Cross-hypothesis findings
- **Recommendations**: Prioritized fix implementation plan

## Next Steps

1. **Execute investigation**: Push branch to trigger CI analysis
2. **Review results**: Analyze reports from all hypotheses
3. **Identify primary cause**: Focus on highest-impact factors
4. **Implement fixes**: Target specific bottlenecks identified
5. **Validate improvements**: Re-test original scenario
6. **Document learnings**: Update project documentation

---

## Investigation Status

- [x] Branch created: `debug/ci-node-sync-perf-investigation`
- [x] Diagnostic infrastructure implemented
- [x] All 6 hypotheses implemented
- [x] CI workflow configured
- [ ] Investigation executed in CI
- [ ] Results analyzed
- [ ] Root cause identified
- [ ] Fixes implemented
- [ ] Performance validated