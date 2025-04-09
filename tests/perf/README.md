## TODO

- [ ] Run tests on CI pipeline
  - Fail test if regression is detected
  - Save results to an external data source so that we can compare results over time
- [ ] Have the same CPU profile between tests
  - Potential solutions:
    - Calibrate and throttle CPU before tests. Requires https://developer.chrome.com/blog/new-in-devtools-134#calibrated-cpu-throttling to be accessible with the Chrome Devtools Protocol.
    - Run tests in a Docker container with a fixed CPU profile.
- [ ] Use production build of the test app
- [ ] Write README.md
- [ ] Document performance tests
  - Say we're confident Livestore is performant in X, and Y


- [ ] Test startup
  - Cold vs warm
  - Pending mutations from the backend
  - Pending mutations from the client
  - SSR

Client session
- [ ] Test throughput

Leader worker
- [ ] Test time to persist
- [ ] Test synchronization latency
- [ ] Test client session latency


