// Shared constants and helpers for livestore dashboards.
// Extends the upstream lib.libsonnet with livestore-specific service names and span patterns.
local lib = import 'lib.libsonnet';

{
  // Upstream helpers re-exported for convenience
  tempoQuery:: lib.tempoQuery,
  tempoStat:: lib.tempoStat,
  tempoTable:: lib.tempoTable,
  tempoMetricsQuery:: lib.tempoMetricsQuery,
  durationTimeSeries:: lib.durationTimeSeries,
  at:: lib.at,
  fullWidth:: lib.fullWidth,
  halfWidth:: lib.halfWidth,

  // =========================================================================
  // Service names
  // =========================================================================

  services:: {
    mono: 'mono',
    vitestRunner: 'vitest-runner',
    livestoreCli: 'livestore-cli',
    perfTests: 'livestore-perf-tests',
    playwright: 'playwright',
    syncCfDo: 'sync-cf-do',
    nodeLeaderThread: 'livestore-node-leader-thread',
    nodeSyncTest: 'node-sync-test',
  },

  // Regex matching all livestore-related services
  allServicesRegex:: 'mono|vitest-runner|livestore-cli|livestore-perf-tests|playwright|sync-cf-do|livestore-node-leader-thread|node-sync-test.*',

  // =========================================================================
  // Span name patterns (TraceQL regex fragments)
  // =========================================================================

  spans:: {
    // Leader thread lifecycle
    leaderThread: '@livestore/common:leader-thread:.*',
    // Sync processor operations
    syncProcessor: '@livestore/common:LeaderSyncProcessor:.*',
    // SQL execution
    execSql: '@livestore/common:execSql.*',
    // Eventlog operations
    eventlog: '@livestore/common:eventlog:.*',
    // Adapter-web spans
    adapterWeb: '@livestore/adapter-web:.*',
    // Adapter-node spans
    adapterNode: '@livestore/adapter-node:.*',
    // CLI spans
    cli: 'cli:.*|mcp-runtime:.*|module-loader:.*|sync:.*',
    // Sync CF (Cloudflare Durable Object) spans
    syncCf: '@livestore/sync-cf:.*|rpc-sync-client:.*|http-sync-client:.*',
    // Electric sync provider
    syncElectric: 'electric-provider:.*',
    // OPFS browser utilities
    opfs: '@livestore/utils:Opfs\\..*',
    // Store lifecycle
    store: 'createStore.*|LiveStore.*|@livestore/livestore.*',
    // Client session
    clientSession: '@livestore/common:make-client-session.*',
  },
}
