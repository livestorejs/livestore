# Root Cause Validation Plan

## Hypothesis 1: Resource Contention (8m55s vs 3m baseline)

**Test Design:**
```typescript
// Test A: Sequential execution (baseline)
- Run single worker process → measure time
- Run second worker process → measure time  
- Compare: should be similar if no resource contention

// Test B: Concurrent execution (contention test)
- Run 2 workers simultaneously → measure total time
- Run 4 workers simultaneously → measure total time
- Expected: if resource contention, time increases non-linearly

// Test C: Resource monitoring during contention
- Monitor CPU/memory during concurrent vs sequential
- Track process creation/destruction rates
- Measure context switching overhead
```

**Validation Criteria:**
- If resource contention: concurrent time >> sum of sequential times
- If not contention: concurrent time ≈ max(sequential times)

## Hypothesis 2: Process Management Overhead (8m27s pattern)

**Test Design:**
```typescript
// Test A: Process lifecycle measurement
- Measure: spawn() → ready → terminate() for single process
- Repeat 10x to get average lifecycle cost
- Compare: CI vs local timing ratios

// Test B: Process cleanup verification
- Count orphaned processes before/after tests
- Measure cleanup time for different process counts
- Track file descriptor leaks

// Test C: Process creation under load
- Create 1 process → measure time
- Create 5 processes → measure time per process
- Create 10 processes → measure time per process
```

**Validation Criteria:**
- If process overhead: creation time increases with active process count
- If not overhead: creation time remains constant

## Hypothesis 3: Missing Dependencies & Environment Issues

**Test Design:**
```typescript
// Test A: Dependency availability check
- Check all required modules are available in CI
- Measure module resolution time differences
- Test both require() and dynamic import() patterns

// Test B: File system type differences
- Compare CI filesystem (overlayfs/tmpfs) vs local (APFS/ext4)
- Measure basic I/O operations: create/read/write/delete
- Test SQLite performance specifically

// Test C: Environment variable impact
- Compare with/without specific env vars (NODE_OPTIONS, etc)
- Test different NODE_ENV settings
- Measure impact of CI-specific variables
```

**Validation Criteria:**
- If environment: significant timing differences for same operations
- If dependencies: module loading failures or dramatically slower imports

## Explicit Validation Test Implementation

Create `tests/integration/src/tests/node-sync/root-cause-validation.test.ts`:

1. **Controlled Concurrency Test:**
   - Run identical operations 1x, 2x, 4x concurrency
   - Measure scaling behavior: linear vs exponential time growth

2. **Process Lifecycle Profiling:**
   - Track spawn/ready/terminate phases separately
   - Compare CI vs local ratios for each phase

3. **Environment Parity Test:**
   - Replicate CI environment variables locally
   - Run same test with CI env → compare with normal local timing

4. **Resource Baseline Test:**
   - Run minimal test (no workers) → establish baseline
   - Add components one by one → identify which adds most overhead

## Expected Outcomes

**If Resource Contention is root cause:**
- Concurrent tests take 2-4x longer than sequential
- CPU/memory usage spikes during parallel execution
- Performance degrades with worker count

**If Process Management is root cause:**
- Process creation time increases with active process count
- Significant cleanup delays
- Orphaned process accumulation

**If Environment Issues are root cause:**
- Same operations have different timing profiles CI vs local
- Missing dependencies cause failures or fallback paths
- Environment variables significantly impact performance

## Implementation Priority

1. **Controlled Concurrency Test** (highest impact)
2. **Process Lifecycle Profiling** (medium impact)  
3. **Environment Parity Test** (validation)