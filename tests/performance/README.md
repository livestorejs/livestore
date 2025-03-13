## TODO

- [ ] Use [parameterized tests](https://playwright.dev/docs/test-parameterize)
- [ ] Use [custom reporters](https://playwright.dev/docs/test-reporters#custom-reporters) to generate an HTML report
- [ ] Make memory leak test more reliable
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
