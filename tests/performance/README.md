## TODO

- [ ] Improve placement of `performance.mark()` calls
- [ ] Refactor to use Effect
  - [ ] Send metrics to Tempo+Grafana
- [ ] Create store manually and interact with it directly without using React bindings
  - [ ] Write startup performance tests
- [ ] Use production build of the test app
- [ ] Use `window.__debugLiveStore._.mutate()` and `window.__debugLiveStore._.query()` to run operations over the functions manually added to `window`
- [ ] Use [parameterized tests](https://playwright.dev/docs/test-parameterize)
- [ ] Use [custom reporters](https://playwright.dev/docs/test-reporters#custom-reporters) to generate HTML reports
- [ ] Figure out a way to properly run many repetitions of the same test to get stable performance results.
- [ ] Write README.md
- [ ] Document performance test results
- [ ] Run tests on CI pipeline
- [ ] Have the same CPU profile between tests.
  - Potential solution: Calibrate and throttle CPU before tests. Requires https://developer.chrome.com/blog/new-in-devtools-134#calibrated-cpu-throttling to be accessible with the Chrome Devtools Protocol.
  - Potential solution: Run tests in a Docker container with a fixed CPU profile.
