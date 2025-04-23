# LiveStore’s performance tests

This package contains performance tests for LiveStore. The tests measure the latency and memory usage across various scenarios.

These scenarios were taken from the [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), which is the most popular benchmark for JavaScript frameworks.

## Running the tests

The tests are executed on GitHub Actions for every commit on `main` and opened pull request. Results can be visualized on the GitHub Actions logs and on a [Grafana dashboard](https://livestore.grafana.net/d/ee4353fc-fd9a-4f9d-96fa-ac0c8f3a47e7/performance-tests).

You can also run the tests locally for investigation purposes with the following command:

```shell
pnpm test
```

If you want to record a performance profile for each test, you can use the following command. This will record a performance profile for each test and save it as `./test-results/<test-title>/perf-profile.json`.

```shell
pnpm test:profiler
```

## Goals

1. Identify bugs (memory leaks, crashes, race conditions, irresponsive tab)
2. Identify optimization opportunities (bottlenecks, edge cases)
3. Prevent regressions (compare between code changes, set perf standards)
4. Guide development decisions (architecture, tech, config choices)
5. Set user expectations (share system limits)

## Future improvements

### General
- [ ] Automatically detect performance regressions and fail the workflow job on GitHub Actions if the performance is significantly degraded.
- [ ] Have a consistent testing environment between test runs for more reliable results.
  - Potential solutions:
    - Calibrate and throttle CPU before tests. Requires https://developer.chrome.com/blog/new-in-devtools-134#calibrated-cpu-throttling to be accessible with the Chrome Devtools Protocol.
    - Use dedicated GitHub Actions runners. Requires a paid plan.

### Test scenarios
- [ ] Test startup latency
  - Cold vs. warm
  - With pending events from the backend
  - With pending events from the client
  - With SSR
- [ ] Test throughput within a client session
- [ ] Test latency to persist events
- [ ] Test client<>backend synchronization latency
- [ ] Test client-session<>client-session latency

### Test dimensions
- [ ] Test on different browsers (Chrome, Firefox, Safari)
- [ ] Test on different device types (desktop, mobile)

