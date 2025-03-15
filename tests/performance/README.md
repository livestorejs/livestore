## TODO

- [ ] Use [parameterized tests](https://playwright.dev/docs/test-parameterize)
- [ ] Run tests on CI pipeline
  - Fail test if regression is detected
  - Save results to an external data source so that we can compare results over time
- [ ] Have the same CPU profile between tests
  - Potential solutions:
    - Calibrate and throttle CPU before tests. Requires https://developer.chrome.com/blog/new-in-devtools-134#calibrated-cpu-throttling to be accessible with the Chrome Devtools Protocol.
    - Run tests in a Docker container with a fixed CPU profile.
- [ ] Use production build of the test app
- [ ] Write README.md
- [ ] Document performance test results
- [ ] Test throughput
- [ ] Test startup
