# LiveStore’s performance tests

This package contains the performance tests for LiveStore. The tests measure the latency and memory usage across various user interaction scenarios.

These scenarios were inspired by the [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark), which is the most popular benchmark for JavaScript frameworks.

The tests are executed against a [minimal LiveStore + React web application](./test-app) running on a headless Chromium browser. The tests are run using [Playwright](https://playwright.dev/) to simulate user interactions with the application.

## Goals

1. Identify bugs (memory leaks, crashes, race conditions, irresponsive tab)
2. Identify optimization opportunities (bottlenecks, edge cases)
3. Prevent regressions (compare between code changes, set perf standards)
4. Guide development decisions (architecture, tech, config choices)
5. Set user expectations (share system limits)

## Dashboard

The results of the performance tests can be visualized on a [Grafana dashboard](https://livestore.grafana.net/d/ee4353fc-fd9a-4f9d-96fa-ac0c8f3a47e7/performance-tests). The dashboard is updated automatically after each test run on GitHub Actions.

> [!WARNING]
> Due to [some limitations](https://grafana.com/docs/grafana/latest/dashboards/share-dashboards-panels/shared-dashboards/#limitations) of Grafana, the dashboard isn't publicly accessible. If you want to access it, please reach out to us on [Discord](https://discord.gg/RbMcjUAPd7).

The dashboard features a bar chart that shows latency or memory usage for the selected test scenario across different commits over time. This chart helps analyze LiveStore's performance over time and identify any regressions or improvements.

The chart legend shows the percentage difference between the first and last commit within the selected time range. Use the dashboard's time range selector to calculate the difference between any two commits.

You can click on each percentile in the legend to toggle its visibility, enabling you to focus on all or a specific one.

Clicking on a specific bar in the chart will open the corresponding commit in GitHub, where you can view the changes made in that commit.

## Measurements

### Latency

Latency is measured using the [Event Timing API](https://web.dev/articles/custom-metrics#event-timing-api). This API captures the time (**rounded to 8 ms** for security and privacy reasons) between when the browser receives the interaction event until it's able to paint the next frame after finishing executing all synchronous code initiated from the event handlers.

Each latency test scenario is run **15 times** to reduce the impact of any outliers, and provide more stable and reliable metrics. We summarize these runs using:
- **Median (instead of mean/average)**: represents typical performance, resistant to outliers.
- **IQR (Interquartile Range)**: measures the variability within the core 50% of measurements. A tight IQR points to stable performance, while a broad IQR indicates less predictability.
- **Min/Max**: captures the full range of observed latencies to identify potential outliers or boundary conditions.

### Memory usage

Memory usage is measured using the Chrome DevTools Protocol's `Runtime.getHeapUsage` command. This command implicitly triggers garbage collection and then captures the JavaScript heap usage.

> [!NOTE]
> Since Playwright [doesn't support](https://github.com/microsoft/playwright/issues/22992) sending Chrome DevTools Protocol commands to targets other than the main thread, we currently measure memory usage only for the main thread.

Memory usage for each scenario is captured with a single measurement as it's generally stable enough and not prone to significant fluctuations.

## Running the tests

The tests are executed on GitHub Actions for every commit on `main` and opened pull request. Results can be visualized on the GitHub Actions logs and on the [Grafana dashboard](#dashboard).

You can also run the tests locally to see how the performance changes between your code changes:

```shell
pnpm test
```

> [!NOTE]
> Local test results are only comparable to other local test results executed on the same machine. The results are not comparable to the results on GitHub Actions, as the environment is different.

If you want to record a performance profile for each test, you can use the following command. This will record a performance profile for each test scenario and save it as `./test-results/<test-scenario>/perf-profile.json`. This can be useful for investigating performance issues or for analyzing the performance in more detail.

```shell
pnpm test:profiler
```

> [!NOTE]
> Recording a performance profile has a significant impact on the test results.

## Future improvements

### General
- [ ] Automatically detect performance regressions and fail the workflow job on GitHub Actions if the performance is significantly degraded.
- [ ] Being able to easily compare test results between branches on the dashboard.
- [ ] Run the tests (on GitHub Actions) for old versions of LiveStore to see how the performance has changed between versions.
- [ ] Have a consistent testing environment between test runs for more reliable results.
  - See https://aakinshin.net/posts/github-actions-perf-stability/ 
  - Potential solutions:
    - Calibrate and throttle CPU before tests. Requires https://developer.chrome.com/blog/new-in-devtools-134#calibrated-cpu-throttling to be accessible with the Chrome Devtools Protocol.
    - Use dedicated GitHub Actions runners. Requires a paid plan.


### Test scenarios
- [ ] Test throughput within a client session
  - Could help inform LiveStore's runtime parameters such as batch size, timeouts, etc. 
- [ ] Test startup latency
  - Cold vs. warm
  - With pending events from the backend
  - With pending events from the client
  - With SSR
- [ ] Test latency to persist events
- [ ] Test client<>backend synchronization latency
- [ ] Test client-session<>client-session latency

### Test dimensions
- [ ] Test on different browsers (Chrome, Firefox, Safari)
- [ ] Test on different device types (desktop, mobile)

