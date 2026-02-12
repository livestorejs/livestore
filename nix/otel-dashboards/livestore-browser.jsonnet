// Livestore Browser dashboard
// Browser-specific traces: adapter-web, OPFS operations, shared/dedicated workers.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local y = {
  statsRow: 0,
  stats: 1,
  adapterRow: 5,
  adapter: 6,
  opfsRow: 16,
  opfs: 17,
  workerRow: 27,
  worker: 28,
  errorsRow: 38,
  errors: 39,
};

g.dashboard.new('Livestore Browser')
+ g.dashboard.withUid('ls-browser')
+ g.dashboard.withDescription('Browser-specific traces — adapter-web, OPFS, shared/dedicated workers')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('Browser Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('Adapter-web traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.adapterWeb + '"}', 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('OPFS operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.opfs + '"}', 'A', 100),
    ]),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Worker messages')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"@livestore/adapter-web:worker:.*"}', 'A', 100),
    ]),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Browser errors')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.adapterWeb + '|' + ls.spans.opfs + '" && status.code=error}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Adapter-web traces
  at(g.panel.row.new('Adapter Web'), 0, y.adapterRow, 24, 1),

  at(
    ls.tempoTable(
      'Adapter-web traces (client session, single-tab, shared-worker)',
      '{name=~"@livestore/adapter-web:client-session:.*|@livestore/adapter-web:single-tab:.*|@livestore/adapter-web:shared-worker:.*"}',
      'A',
      50,
    ),
    0, y.adapter, 24, 10,
  ),

  // Row: OPFS operations
  at(g.panel.row.new('OPFS Operations'), 0, y.opfsRow, 24, 1),

  at(
    ls.tempoTable(
      'OPFS file operations (read, write, exists, remove, buildTree)',
      '{name=~"' + ls.spans.opfs + '"}',
      'A',
      50,
    ),
    0, y.opfs, 24, 10,
  ),

  // Row: Worker message handling
  at(g.panel.row.new('Worker Messages'), 0, y.workerRow, 24, 1),

  at(
    ls.tempoTable(
      'Worker request/response traces (PushToLeader, StreamEvents, Export, etc.)',
      '{name=~"@livestore/adapter-web:worker:.*"}',
      'A',
      50,
    ),
    0, y.worker, 24, 10,
  ),

  // Row: Errors
  at(g.panel.row.new('Browser Errors'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'Failed browser operations',
      '{name=~"' + ls.spans.adapterWeb + '|' + ls.spans.opfs + '" && status.code=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
