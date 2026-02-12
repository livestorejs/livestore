// Livestore Overview dashboard
// Landing page with summary of all livestore-related trace activity.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local allSvc = '{resource.service.name=~"' + ls.allServicesRegex + '"}';

local y = {
  statsRow: 0,
  stats: 1,
  trendsRow: 5,
  trends: 6,
  recentRow: 14,
  recent: 15,
  errorsRow: 25,
  errors: 26,
};

g.dashboard.new('Livestore Overview')
+ g.dashboard.withUid('ls-overview')
+ g.dashboard.withDescription('Overview of all livestore-related traces across services')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('Total traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery(allSvc, 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Error traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery(allSvc + ' && status=error', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Sync traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.syncProcessor + '"}', 'A', 100),
    ]),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('SQL operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.execSql + '"}', 'A', 100),
    ]),
    18, y.stats, 6, 4,
  ),

  // Row: Duration trends (regression detection)
  at(g.panel.row.new('Duration Trends'), 0, y.trendsRow, 24, 1),

  at(
    ls.durationTrend('Sync processor duration', '{name=~"' + ls.spans.syncProcessor + '"}'),
    0, y.trends, 12, 8,
  ),

  at(
    ls.durationTrend('Leader thread duration', '{name=~"' + ls.spans.leaderThread + '"}'),
    12, y.trends, 12, 8,
  ),

  // Row: Recent traces
  at(g.panel.row.new('Recent Traces'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'Recent livestore traces (all services)',
      allSvc,
      'A',
      50,
    ),
    0, y.recent, 24, 10,
  ),

  // Row: Error traces
  at(g.panel.row.new('Errors'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'Recent error traces',
      allSvc + ' && status=error',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
