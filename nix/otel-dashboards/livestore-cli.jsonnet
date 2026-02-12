// Livestore CLI dashboard
// Traces from the livestore CLI (MCP runtime, import/export, module loading).
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local y = {
  statsRow: 0,
  stats: 1,
  recentRow: 5,
  recent: 6,
  mcpRow: 16,
  mcp: 17,
  errorsRow: 27,
  errors: 28,
};

g.dashboard.new('Livestore CLI')
+ g.dashboard.withUid('ls-cli')
+ g.dashboard.withDescription('Trace exploration for the livestore CLI — MCP runtime, import/export, sync')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('CLI Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('CLI traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{resource.service.name="' + ls.services.livestoreCli + '"}', 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('MCP operations')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"mcp-runtime:.*"}', 'A', 100),
    ]),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Import/Export')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"cli:export|cli:import"}', 'A', 100),
    ]),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('CLI errors')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{resource.service.name="' + ls.services.livestoreCli + '" && status.code=error}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Recent CLI traces
  at(g.panel.row.new('Recent CLI Traces'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'Recent CLI operations',
      '{resource.service.name="' + ls.services.livestoreCli + '"}',
      'A',
      50,
    ),
    0, y.recent, 24, 10,
  ),

  // Row: MCP operations
  at(g.panel.row.new('MCP Runtime'), 0, y.mcpRow, 24, 1),

  at(
    ls.tempoTable(
      'MCP runtime operations (init, query, commit, status)',
      '{name=~"mcp-runtime:.*"}',
      'A',
      50,
    ),
    0, y.mcp, 24, 10,
  ),

  // Row: Errors
  at(g.panel.row.new('Errors'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'CLI error traces',
      '{resource.service.name="' + ls.services.livestoreCli + '" && status.code=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
