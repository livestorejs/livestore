// Livestore Sync dashboard
// Sync processor operations: push, pull, materialize, rollback.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local y = {
  statsRow: 0,
  stats: 1,
  recentRow: 5,
  recent: 6,
  pushPullRow: 16,
  pushPull: 17,
  errorsRow: 27,
  errors: 28,
};

g.dashboard.new('Livestore Sync')
+ g.dashboard.withUid('ls-sync')
+ g.dashboard.withDescription('Sync processor operations — push/pull, materialization, rollback')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('Sync Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('Sync operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.syncProcessor + '"}', 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Push operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"@livestore/common:LeaderSyncProcessor:.*push.*"}', 'A', 100),
    ]),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Pull operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"@livestore/common:LeaderSyncProcessor:.*pull.*"}', 'A', 100),
    ]),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Sync errors')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.syncProcessor + '" && status.code=error}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: All sync traces
  at(g.panel.row.new('Recent Sync Operations'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'All sync processor traces',
      '{name=~"' + ls.spans.syncProcessor + '"}',
      'A',
      50,
    ),
    0, y.recent, 24, 10,
  ),

  // Row: Push/Pull breakdown
  at(g.panel.row.new('Push / Pull Breakdown'), 0, y.pushPullRow, 24, 1),

  at(
    ls.tempoTable(
      'Push and pull operations',
      '{name=~"@livestore/common:LeaderSyncProcessor:backend-push.*|@livestore/common:LeaderSyncProcessor:backend-pull.*|@livestore/common:LeaderSyncProcessor:push|@livestore/common:LeaderSyncProcessor:materializeEventItems"}',
      'A',
      50,
    ),
    0, y.pushPull, 24, 10,
  ),

  // Row: Errors
  at(g.panel.row.new('Sync Errors'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'Failed sync operations',
      '{name=~"' + ls.spans.syncProcessor + '" && status.code=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
