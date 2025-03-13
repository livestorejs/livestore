## TODO

- [ ] Use [custom reporters](https://playwright.dev/docs/test-reporters#custom-reporters) to generate HTML report
- [ ] Use [parameterized tests](https://playwright.dev/docs/test-parameterize)
- [ ] Figure out a way to properly run many repetitions of the same test to get stable performance results.
- [ ] Refactor to use Effect
  - [ ] Send metrics to Tempo+Grafana
- [ ] Only enable Chromium tracing profiling on a flag
- [ ] Use production build of the test app
- [ ] Run tests on CI pipeline
- [ ] Write README.md
- [ ] Document performance test results
- [ ] Test throughput
- [ ] Test startup
- [ ] Have the same CPU profile between tests
  - Potential solutions:
    - Calibrate and throttle CPU before tests. Requires https://developer.chrome.com/blog/new-in-devtools-134#calibrated-cpu-throttling to be accessible with the Chrome Devtools Protocol.
    - Run tests in a Docker container with a fixed CPU profile.
