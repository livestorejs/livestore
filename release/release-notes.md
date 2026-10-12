### Changed

- **SQLite schema tables:** Fixed Date fields in `State.SQLite.table({ schema })`
  so their codecs round-trip through SQLite in structs and `Schema.Class` rows
  while preserving Date checks and transformations, including nullable encoded
  Dates. Thanks @acusti for the original fix
  ([#1596](https://github.com/livestorejs/livestore/issues/1596),
  [#1597](https://github.com/livestorejs/livestore/pull/1597)).
- **Effect dependencies:** Updated the aligned Effect 4 dependency cohort from
  `4.0.0` to `4.0.3`, including its AI, OpenTelemetry, platform, SQLite, and
  Vitest packages. Applications using Effect should align their dependencies
  to `4.0.3` or a compatible later 4.x release
  ([#1669](https://github.com/livestorejs/livestore/pull/1669)).
- **Contributor meetings:** Added the canonical docs schedule for the next two
  fortnightly meetings at 19:00 Berlin, automatic Google Calendar publishing,
  and a stable Riverside room link
  ([#1635](https://github.com/livestorejs/livestore/pull/1635)).
- **Store commits:** Fixed the callback form of `store.commit` and its TypeScript
  overloads, including calls with commit options. Synchronous callbacks return
  an event array that is collected before materialization, and throwing callbacks
  apply no events ([#1611](https://github.com/livestorejs/livestore/issues/1611),
  [#1616](https://github.com/livestorejs/livestore/pull/1616)).
- **Cloudflare sync telemetry:** Added optional Effect tracer layers via `otel: layer`.
  Telemetry cleanup runs in the background, and finite WebSocket operations and
  DO-RPC pull streams now emit their sync spans
  ([#1618](https://github.com/livestorejs/livestore/issues/1618)).
- **Cloudflare adapter:** Track state database ownership and remove obsolete
  tracked state after successful boot, preserving the current state, eventlog
  and untracked files. Failed cleanup is retried on a later boot without
  blocking the completed store
  ([#1555](https://github.com/livestorejs/livestore/issues/1555)).
- **Schema rebuilds:** Batched eventlog replay to reduce repeated SQLite page
  writes, including billed row writes on Cloudflare Durable Objects. Replay order
  and recovery from incomplete rebuilds are preserved. Clients can tune the
  event-count batch per runtime with `params.stateRebuildBatchSize` (a positive
  integer, default 100); lower values trade more queries and writes for smaller batches
  ([#1555](https://github.com/livestorejs/livestore/issues/1555)).
- **State recovery:** Interrupted rematerialization is retried from clean derived
  state instead of reopening partial results. Completion is recorded after all
  migration hooks finish. Browser fast-path startup waits for recovery when its
  snapshot is incomplete. The eventlog and pending events are preserved
  ([#1605](https://github.com/livestorejs/livestore/issues/1605)).
- **Cloudflare sync:** Serialize push admission through pull publication so an
  accepted event cannot advance the backend head without notifying subscribers
  ([#1537](https://github.com/livestorejs/livestore/pull/1537)).
- **Cloudflare WebSocket sync:** Live pulls interrupted after the sync Durable
  Object hibernates now receive their terminal RPC `Exit`, matching interruption
  behavior before hibernation. Completed and protocol-defected pulls are also
  removed from persisted fan-out state
  ([#1418](https://github.com/livestorejs/livestore/issues/1418)).
- **Cloudflare sync:** Fixed live WebSocket pulls stopping permanently after a
  disconnect. Pulls now resume after reconnect without reloading the client,
  and HTTP transport failures also remain retryable. Offline pulls wait for
  reconnection rather than spinning, and resume as soon as the backend reports
  connected. Capped fallback probes cover stale connectivity signals and still
  wake immediately on later disconnect/reconnect transitions.
  Protocol failures stay terminal
  ([#1650](https://github.com/livestorejs/livestore/issues/1650)).
  For the root-cause analysis, thanks @bohdanbirdie.
- **Cloudflare DO-RPC sync:** A temporary Durable Object RPC failure no longer
  stops replication for good. A call that Cloudflare marks `retryable` (and not
  `overloaded`) now surfaces as `IsOfflineError`, so the leader retries the pull
  after a jittered exponential backoff (1 s doubling to 30 s) on a fresh stub.
  Interrupted catch-up streams also recover when Cloudflare drops the error
  flags or the stream stalls for 60 seconds, resuming after the last applied
  event. Idle live subscriptions do not time out. Explicit overload and
  non-retryable remote failures keep their previous terminal handling
  ([#1462](https://github.com/livestorejs/livestore/issues/1462),
  [#1649](https://github.com/livestorejs/livestore/pull/1649)).
- Removed redundant devenv package entries now owned by the task guard modules.
- **Sync correctness:** Prevented later client-session events from crossing an
  older rejected pending prefix, and made leader admission retain explicit
  reservation ownership through queue drain until apply, rejection, or stale
  dropping. Parent contiguity now compares DAG position independently of local
  rebase generation while stale epochs remain checked separately, avoiding
  duplicate materialization and ghost fences during multi-writer rebases
  ([#1530](https://github.com/livestorejs/livestore/pull/1530)).
- **Expo getting-started docs:** The manual install command now installs
  `@livestore/sync-cf` instead of the import subpath `@livestore/sync-cf/client`,
  which package managers resolved as a git URL and failed to install
  ([#1657](https://github.com/livestorejs/livestore/issues/1657),
  [#1667](https://github.com/livestorejs/livestore/pull/1667)).

### Breaking Changes

- **Effect 4 / LiveStore 0.5:** Upgrade application dependencies and schema APIs
  from Effect 3 to stable Effect 4. Follow the
  [0.4 to 0.5 upgrade guide](https://dev.docs.livestore.dev/misc/upgrading-0.4-to-0.5/)
  for peer packages, schema substitutions, removed utilities, commit callbacks
  and Cloudflare DO-RPC changes
  ([#1310](https://github.com/livestorejs/livestore/issues/1310),
  [#1647](https://github.com/livestorejs/livestore/pull/1647)).
- **Cloudflare adapter:** `createStoreDo`, `createStoreDoPromise` and
  `makeDoRpcSync` take `getSyncBackendStub: () => stub` instead of
  `syncBackendStub`. LiveStore calls it for every sync call, because Cloudflare
  leaves a stub broken after many exceptions. Replace
  `syncBackendStub: env.SYNC_BACKEND_DO.getByName(storeId)` with
  `getSyncBackendStub: () => env.SYNC_BACKEND_DO.getByName(storeId)`
  ([#1462](https://github.com/livestorejs/livestore/issues/1462),
  [#1649](https://github.com/livestorejs/livestore/pull/1649)).
- **Store commit callbacks:** Callbacks now synchronously return an event array.
  Replace `store.commit((commit) => { commit(event) })` with
  `store.commit(() => [event])` or `store.commit(event)`
  ([#1611](https://github.com/livestorejs/livestore/issues/1611),
  [#1616](https://github.com/livestorejs/livestore/pull/1616)).
- **Rebuild completion tracking:** The first open after upgrading from a version
  without the completion marker rebuilds derived state once. No application
  configuration changes are needed. Cloudflare deployments should budget for
  replay duration and row writes. Migration hooks must tolerate retries after
  interrupted rebuilds ([#1605](https://github.com/livestorejs/livestore/issues/1605)).
- **State schema fingerprints:** Replaced Effect-internal AST hashing with a
  LiveStore-owned canonical descriptor and a synchronous full-width SHA-256
  fingerprint. No application schema or configuration changes are required.
  The first open after upgrading intentionally creates a new state database and
  rematerializes it once from the event log, so Cloudflare deployments should
  plan for the corresponding row-write usage
  ([#1555](https://github.com/livestorejs/livestore/issues/1555)).

- **Effect dependency compatibility:** The peer range is `^4.0.0`, excluding
  beta/RC releases. Effect-only upgrades preserve state schema fingerprints,
  but changed event schema hashes can produce warnings on rematerialization
  ([#63](https://github.com/livestorejs/livestore/issues/63)). Refined
  `Schema.DateFromMillis` and `Schema.Uint8Array` retain INTEGER and BLOB storage
  ([#1557](https://github.com/livestorejs/livestore/issues/1557),
  [#1606](https://github.com/livestorejs/livestore/pull/1606),
  [#1647](https://github.com/livestorejs/livestore/pull/1647)).
  Thanks [@JamieMason](https://github.com/JamieMason) for the migration work.

### Internal Changes

For maintainers and contributors:

- **Unit-test tooling:** Local `mono test unit` and `devenv tasks run test:unit`
  now fail when any package's Vitest process exits nonzero, matching CI.
  Package output streams directly to the terminal instead of being buffered
  ([#683](https://github.com/livestorejs/livestore/issues/683)).

- **CI composition:** Aligned the megarepo setup with the automatic CI worktree
  policy and consolidated devenv resolver from
  [effect-utils#1207](https://github.com/overengineeringstudio/effect-utils/pull/1207).

- **Release tooling:** Pull-request CI now packs exact-head snapshot candidates
  for forks without secrets. Maintainers can allow npm publication for a fork's
  current and later PR heads with the revocable `ci:publish-snapshot` label
  ([#1559](https://github.com/livestorejs/livestore/issues/1559)). The trusted
  publisher leaves npm registry configuration unset so `actions/setup-node`
  does not inject its token-auth placeholder into the OIDC-only job.
- **Effect rc.111 API burndown:** Ported the internal Effect surface that moved
  between beta.99 and rc.111 — `Schema.TaggedErrorClass` →
  `Schema.TaggedError`, `Schema.UnknownFromJsonString` →
  `Schema.fromJsonString(Schema.Unknown)`, `Schema.toArbitraryLazy` →
  `Schema.toArbitrary`, `Schedule.andThen` → `Schedule.concat`, and the
  `SchemaIssue` constructors that dropped their `actual` argument. SQLite column
  inference now keys off the open `representation` annotation instead of the
  removed `typeConstructor`/`meta` annotations, and JSON-string columns are
  detected through the `application/json` content annotation now that
  `SchemaTransformation.fromJsonString` is a factory rather than a singleton.
  Schema issues no longer carry a `toString()`
  ([Effect-TS/effect#7093](https://github.com/Effect-TS/effect/pull/7093)), so
  the Durable Object RPC server renders decode failures through
  `SchemaIssue.makeFormatterDefault()` like the rest of the codebase.
  The `@effect/vitest` record-arbitrary workaround was dropped because
  [Effect-TS/effect#7148](https://github.com/Effect-TS/effect/pull/7148) fixed it
  upstream ([#1557](https://github.com/livestorejs/livestore/issues/1557)).
- **Effect rc.113 API burndown:** Replaced the removed MessagePack RPC layer
  with `SchemaBinary`, migrated sockets to the pull reader and scoped writer
  APIs, and updated CLI constructors and schema transformations to their rc.113
  names. The FastCheck-based `Vitest.asProp` helper was removed; use
  `Vitest.live.prop` with `arbitrary` options
  ([#1606](https://github.com/livestorejs/livestore/pull/1606)).
- **Tooling:** Shell entry no longer runs the full TypeScript build after
  dependency and generated-source setup. The shared Effect-utils
  `otel:profile:setup` task captures the strict setup graph through native
  devenv tracing and `otelite`; `otel:verify:setup` gates the connected trace
  shape without a repository-local orchestration module
  ([#1402](https://github.com/livestorejs/livestore/issues/1402)).
- **Tooling:** Unit-test failures now block merges. The `test-unit` job ran
  `packages/@livestore/webmesh` and `tests/package-common` through
  `Effect.ignore` on CI, so their failures produced a passing required check.
  Removing that also restores the intent-layer invariant suite as a real gate on
  `context/` changes ([#1404](https://github.com/livestorejs/livestore/issues/1404)).
- **Tooling:** The DevTools Playwright suite is currently broken (0/15) and
  carries a declared, expiring quarantine entry instead of an unrecorded
  `|| echo` wrapper. Its check does **not** gate merges yet — the quarantine
  records the failure with a reason, an issue, and an expiry date rather than
  hiding it ([#1489](https://github.com/livestorejs/livestore/issues/1489)).
- **Tooling:** Cloudflare sync-provider failures now block merges. All six `cf-*`
  matrix cells previously exited 0 on failure, which is why the Durable Object
  hibernation guards could not gate merges
  ([#1404](https://github.com/livestorejs/livestore/issues/1404)).
