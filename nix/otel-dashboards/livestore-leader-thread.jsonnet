// Livestore Leader Thread dashboard
// Leader thread lifecycle: boot, sync, eventlog, devtools, materialization.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local y = {
  statsRow: 0,
  stats: 1,
  recentRow: 5,
  recent: 6,
  eventlogRow: 16,
  eventlog: 17,
  materializeRow: 27,
  materialize: 28,
  errorsRow: 38,
  errors: 39,
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
      ls.tempoQuery('{name=~"' + ls.spans.leaderThread + '"}', 'A', 100),
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
      ls.tempoQuery('{name=~"' + ls.spans.leaderThread + '" && status.code=error}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Recent leader thread traces
  at(g.panel.row.new('Recent Leader Thread Traces'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'All leader thread traces',
      '{name=~"' + ls.spans.leaderThread + '"}',
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
      '{name=~"' + ls.spans.leaderThread + '|' + ls.spans.eventlog + '" && status.code=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
