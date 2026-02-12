// Livestore Sync Providers dashboard
// Deep diagnostics for sync backends: Cloudflare DO, Electric, RPC/HTTP clients.
local g = import 'g.libsonnet';
local ls = import 'lib-livestore.libsonnet';
local at = ls.at;

local y = {
  statsRow: 0,
  stats: 1,
  cfRow: 5,
  cf: 6,
  electricRow: 16,
  electric: 17,
  rpcRow: 27,
  rpc: 28,
  errorsRow: 38,
  errors: 39,
};

g.dashboard.new('Livestore Sync Providers')
+ g.dashboard.withUid('ls-providers')
+ g.dashboard.withDescription('Sync provider deep diagnostics — Cloudflare DO, Electric, RPC/HTTP clients')
+ g.dashboard.graphTooltip.withSharedCrosshair()
+ g.dashboard.withTimezone('browser')
+ g.dashboard.withPanels([

  // Row: Stats
  at(g.panel.row.new('Provider Summary'), 0, y.statsRow, 24, 1),

  at(
    g.panel.stat.new('CF DO traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"@livestore/sync-cf:durable-object:.*"}', 'A', 100),
    ]),
    0, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('RPC client traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"rpc-sync-client:.*|http-sync-client:.*"}', 'A', 100),
    ]),
    6, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Electric traces')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.syncElectric + '"}', 'A', 100),
    ]),
    12, y.stats, 6, 4,
  ),

  at(
    g.panel.stat.new('Provider errors')
    + g.panel.stat.queryOptions.withTargets([
      ls.tempoQuery('{name=~"' + ls.spans.syncCf + '|' + ls.spans.syncElectric + '" && status.code=error}', 'A', 100),
    ])
    + g.panel.stat.options.withColorMode('value')
    + g.panel.stat.standardOptions.color.withMode('fixed')
    + g.panel.stat.standardOptions.color.withFixedColor('red'),
    18, y.stats, 6, 4,
  ),

  // Row: Cloudflare Durable Object
  at(g.panel.row.new('Cloudflare Durable Object'), 0, y.cfRow, 24, 1),

  at(
    ls.tempoTable(
      'CF DO traces (execDb, getEvents, appendEvents, fetch, RPC)',
      '{name=~"@livestore/sync-cf:durable-object:.*"}',
      'A',
      50,
    ),
    0, y.cf, 24, 10,
  ),

  // Row: Electric provider
  at(g.panel.row.new('Electric Sync Provider'), 0, y.electricRow, 24, 1),

  at(
    ls.tempoTable(
      'Electric provider traces (pull, push, ping)',
      '{name=~"' + ls.spans.syncElectric + '"}',
      'A',
      50,
    ),
    0, y.electric, 24, 10,
  ),

  // Row: RPC/HTTP clients
  at(g.panel.row.new('RPC / HTTP Sync Clients'), 0, y.rpcRow, 24, 1),

  at(
    ls.tempoTable(
      'RPC and HTTP sync client traces',
      '{name=~"rpc-sync-client:.*|http-sync-client:.*"}',
      'A',
      50,
    ),
    0, y.rpc, 24, 10,
  ),

  // Row: Errors
  at(g.panel.row.new('Provider Errors'), 0, y.errorsRow, 24, 1),

  at(
    ls.tempoTable(
      'Failed provider operations',
      '{name=~"' + ls.spans.syncCf + '|' + ls.spans.syncElectric + '" && status.code=error}',
      'A',
      20,
    ),
    0, y.errors, 24, 10,
  ),
])
