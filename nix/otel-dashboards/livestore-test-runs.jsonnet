// Livestore Test Runs dashboard
// Test execution visibility: vitest, playwright, perf tests, integration tests.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local testServicesRegex = 'vitest-runner|playwright|livestore-perf-tests|node-sync-test.*';
local testQuery = '{resource.service.name=~"' + testServicesRegex + '"}';

local y = {
  statsRow: 0,
  stats: 1,
  trendsRow: 5,
  trends: 6,
  recentRow: 14,
  recent: 15,
  playwrightRow: 25,
  playwright: 26,
  perfRow: 36,
  perf: 37,
  errorsRow: 47,
  errors: 48,
};

g.dashboard.new('Livestore Test Runs')
+ g.dashboard.withUid('ls-tests')
+ g.dashboard.withDescription('Test execution traces — vitest, Playwright, perf tests, integration tests')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('Test Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('All test traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery(testQuery, 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Vitest traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{resource.service.name="' + ls.services.vitestRunner + '"}', 'A', 100),
    ]),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Playwright traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{resource.service.name="' + ls.services.playwright + '"}', 'A', 100),
    ]),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Test failures')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery(testQuery + ' && status.code=error', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Duration trends (regression detection)
  at(g.panel.row.new('Duration Trends'), 0, y.trendsRow, 24, 1),

  at(
    ls.durationTrend('Vitest run duration (p50/p95/p99)', '{resource.service.name="' + ls.services.vitestRunner + '"}'),
    0, y.trends, 12, 8,
  ),

  at(
    ls.durationTrend('Perf test duration', '{resource.service.name="' + ls.services.perfTests + '"}'),
    12, y.trends, 12, 8,
  ),

  // Row: Recent test traces
  at(g.panel.row.new('Recent Test Traces'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'All recent test traces',
      testQuery,
      'A',
      50,
    ),
    0, y.recent, 24, 10,
  ),

  // Row: Playwright
  at(g.panel.row.new('Playwright Browser Tests'), 0, y.playwrightRow, 24, 1),

  at(
    ls.tempoTable(
      'Playwright test traces',
      '{resource.service.name="' + ls.services.playwright + '"}',
      'A',
      50,
    ),
    0, y.playwright, 24, 10,
  ),

  // Row: Perf tests
  at(g.panel.row.new('Performance Tests'), 0, y.perfRow, 24, 1),

  at(
    ls.tempoTable(
      'Perf test traces',
      '{resource.service.name="' + ls.services.perfTests + '"}',
      'A',
      50,
    ),
    0, y.perf, 24, 10,
  ),

  // Row: Errors
  at(g.panel.row.new('Test Failures'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'Failed test traces',
      testQuery + ' && status.code=error',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
