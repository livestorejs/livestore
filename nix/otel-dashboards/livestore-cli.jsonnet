// Livestore CLI dashboard
// Traces from the livestore CLI (MCP runtime, import/export, module loading).
// The CLI runs under the "mono" service name with root span "cli".
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

// The mono service is the CLI entrypoint
local monoQuery = '{resource.service.name="' + ls.services.mono + '"}';

local y = {
  statsRow: 0,
  stats: 1,
  trendsRow: 5,
  trends: 6,
  recentRow: 14,
  recent: 15,
  mcpRow: 25,
  mcp: 26,
  errorsRow: 36,
  errors: 37,
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
      ls.tempoQuery(monoQuery, 'A', 100),
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
      ls.tempoQuery(monoQuery + ' && status.code=error', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Duration trends (regression detection)
  at(g.panel.row.new('Duration Trends'), 0, y.trendsRow, 24, 1),

  at(
    ls.durationTrend('CLI command duration (p50/p95/p99)', monoQuery),
    0, y.trends, 12, 8,
  ),

  at(
    ls.durationTrend('MCP operation duration', '{name=~"mcp-runtime:.*"}'),
    12, y.trends, 12, 8,
  ),

  // Row: Recent CLI traces
  at(g.panel.row.new('Recent CLI Traces'), 0, y.recentRow, 24, 1),

  at(
    ls.tempoTable(
      'Recent CLI operations',
      monoQuery,
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
      monoQuery + ' && status.code=error',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
