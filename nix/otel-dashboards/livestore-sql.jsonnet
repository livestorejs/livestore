// Livestore SQL dashboard
// SQL execution traces: execSql, execSqlPrepared, slow queries.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local y = {
  statsRow: 0,
  stats: 1,
  recentRow: 5,
  recent: 6,
  slowRow: 16,
  slow: 17,
  errorsRow: 27,
  errors: 28,
};

g.dashboard.new('Livestore SQL')
+ g.dashboard.withUid('ls-sql')
+ g.dashboard.withDescription('SQL execution traces — execSql, prepared statements, slow queries')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('SQL Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('SQL operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.execSql + '"}', 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Prepared statements')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name="@livestore/common:execSqlPrepared"}', 'A', 100),
    ]),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Slow queries (>100ms)')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.execSql + '" && duration > 100ms}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('orange'),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('SQL errors')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.execSql + '" && status.code=error}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Recent SQL traces
  at(g.panel.row.new('Recent SQL Operations'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'All SQL execution traces',
      '{name=~"' + ls.spans.execSql + '"}',
      'A',
      50,
    ),
    0, y.recent, 24, 10,
  ),

  // Row: Slow queries
  at(g.panel.row.new('Slow Queries (> 100ms)'), 0, y.slowRow, 24, 1),

  at(
    ls.tempoTable(
      'SQL operations exceeding 100ms — these are your performance bottlenecks',
      '{name=~"' + ls.spans.execSql + '" && duration > 100ms}',
      'A',
      50,
    ),
    0, y.slow, 24, 10,
  ),

  // Row: Errors
  at(g.panel.row.new('SQL Errors'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'Failed SQL operations',
      '{name=~"' + ls.spans.execSql + '" && status.code=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
