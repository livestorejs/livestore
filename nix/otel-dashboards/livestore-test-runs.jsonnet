// Livestore Test Runs dashboard
// Test execution visibility: vitest, playwright, perf tests, integration tests.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local testServicesRegex = 'vitest-runner|playwright|livestore-perf-tests|node-sync-test.*';

local y = {
  statsRow: 0,
  stats: 1,
  recentRow: 5,
  recent: 6,
  playwrightRow: 16,
  playwright: 17,
  perfRow: 27,
  perf: 28,
  errorsRow: 38,
  errors: 39,
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
      ls.tempoQuery('{resource.service.name=~"' + testServicesRegex + '"}', 'A', 100),
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
      ls.tempoQuery('{resource.service.name=~"' + testServicesRegex + '" && status.code=error}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Recent test traces
  at(g.panel.row.new('Recent Test Traces'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'All recent test traces',
      '{resource.service.name=~"' + testServicesRegex + '"}',
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
      '{resource.service.name=~"' + testServicesRegex + '" && status.code=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
