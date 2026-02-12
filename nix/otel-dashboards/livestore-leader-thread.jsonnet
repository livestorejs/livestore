// Livestore Leader Thread dashboard
// Leader thread lifecycle: boot, sync, eventlog, devtools, materialization.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local leaderQuery = '{name=~"' + ls.spans.leaderThread + '"}';

local y = {
  statsRow: 0,
  stats: 1,
  trendsRow: 5,
  trends: 6,
  recentRow: 14,
  recent: 15,
  eventlogRow: 25,
  eventlog: 26,
  materializeRow: 36,
  materialize: 37,
  errorsRow: 47,
  errors: 48,
};

g.dashboard.new('Livestore Leader Thread')
+ g.dashboard.withUid('ls-leader')
+ g.dashboard.withDescription('Leader thread lifecycle — boot, eventlog, materialization, devtools')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('Leader Thread Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('Leader thread traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery(leaderQuery, 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Boot operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"@livestore/common:leader-thread:boot|@livestore/common:leader-thread:initial-sync-blocking"}', 'A', 100),
    ]),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Eventlog operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.eventlog + '"}', 'A', 100),
    ]),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Leader errors')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery(leaderQuery + ' && status=error', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Duration trends (regression detection)
  at(g.panel.row.new('Duration Trends'), 0, y.trendsRow, 24, 1),

  at(
    ls.durationTrend('Leader thread duration (p50/p95/p99)', leaderQuery),
    0, y.trends, 12, 8,
  ),

  at(
    ls.durationTrend('Eventlog duration', '{name=~"' + ls.spans.eventlog + '"}'),
    12, y.trends, 12, 8,
  ),

  // Row: Recent leader thread traces
  at(g.panel.row.new('Recent Leader Thread Traces'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'All leader thread traces',
      leaderQuery,
      'A',
      50,
    ),
    0, y.recent, 24, 10,
  ),

  // Row: Eventlog operations
  at(g.panel.row.new('Eventlog Operations'), 0, y.eventlogRow, 24, 1),

  at(
    ls.tempoTable(
      'Eventlog traces (getEvents, getSyncBackendCursorInfo)',
      '{name=~"' + ls.spans.eventlog + '"}',
      'A',
      50,
    ),
    0, y.eventlog, 24, 10,
  ),

  // Row: Materialization
  at(g.panel.row.new('Event Materialization'), 0, y.materializeRow, 24, 1),

  at(
    ls.tempoTable(
      'Materialize event traces',
      '{name=~"@livestore/common:leader-thread:materializeEvent|@livestore/common:LeaderSyncProcessor:materializeEventItems|client-session-sync-processor:materialize-event"}',
      'A',
      50,
    ),
    0, y.materialize, 24, 10,
  ),

  // Row: Errors
  at(g.panel.row.new('Leader Thread Errors'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'Failed leader thread operations',
      '{name=~"' + ls.spans.leaderThread + '|' + ls.spans.eventlog + '" && status=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
