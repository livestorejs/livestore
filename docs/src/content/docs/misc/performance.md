---
title: Performance
sidebar:
  order: 5
---

LiveStore is designed with performance in mind. To ensure consistent speed and minimal resource consumption, we maintain a suite of performance tests that run automatically on every commit to `main` and every pull request. These tests help us detect regressions early and identify performance bottlenecks for implementing optimizations.

## Performance tests

Our current test suite focuses on two key metrics: **latency** and **memory usage**.

We measure these two metrics across various user interaction scenarios on a minimal LiveStore+React test app.

We select scenarios that help stress-test LiveStore’s ability to handle common underlying tasks that are part of common user interactions.

To learn more about our testing methodology, check out the [README](https://github.com/livestorejs/livestore/blob/main/tests/perf/README.md) of our performance tests.

> **Future expansions:** We [plan](https://github.com/livestorejs/livestore/blob/main/tests/perf/README.md#future-improvements) to measure throughput and bundle size, as well as expand the selection of scenarios and dimensions for the tests.

## Latest test results

You can view the latest performance test results on our [public dashboard](https://livestore.grafana.net/public-dashboards/4a9a3b7941464bcebbc0fa2cdddc3130).

Otherwise, you can view the latest test results by inspecting the logs of the `perf-test` job in our [GitHub Actions workflow](https://github.com/livestorejs/livestore/actions/workflows/ci.yml).

## Reporting a performance issue

We’re committed to transparency and continuous improvement. If you find performance gaps or regressions in your own usage, please [file an issue](https://github.com/livestorejs/livestore/issues/new)
