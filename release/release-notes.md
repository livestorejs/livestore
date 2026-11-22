See the [documentation](https://docs.livestore.dev) for current features.
Install this release with `npm install @livestore/livestore@0.5.1`.

### Changed

- **Web adapter:** Concurrent writes that invalidate an OPFS snapshot during tab reload
  fall back to a leader-provided snapshot instead of failing store boot.
- **React:** `useStore` calls `React.use` on every render, passing a loaded
  store as an already-fulfilled thenable. This keeps suspended renders
  replayable: sequential stores stay distinct, a later `use` in the same
  component keeps its own value, and replay no longer causes hook-order
  errors. Retries revalidate expired registry entries instead of returning
  disposed stores, and mounted renders never suspend, so action transitions commit.
- **DevTools:** Direct-channel startup now waits for slow peers without failing a session after short ping retries. A non-answering peer waits until caller interruption or scope closure. Internal handshake messages no longer reach application listeners ([#262](https://github.com/livestorejs/livestore/issues/262)).
- **DevTools:** Direct-channel handshakes keep processing mesh control requests while waiting for port readiness, so reloading a peer can replace an abandoned handshake instead of leaving the panel stuck connecting. Reconnecting instances align directly with the peer's channel version instead of rebuilding every skipped generation.
- **DevTools:** Gracefully closed session channels release their responder registration before stopping consumers, allowing a reloaded panel to connect again without restarting the app, including when its request arrives during teardown.
- **DevTools:** Established direct channels rediscover same-name peer replacements when routes change.
- **Documentation:** Published corpus source links use the configured documentation
  origin even when Netlify supplies a different build URL
  ([#1723](https://github.com/livestorejs/livestore/issues/1723)).
- **Effect dependencies:** Updated the aligned Effect 4 dependency cohort from
  `4.0.3` to `4.1.4`, including its AI, OpenTelemetry, platform, SQLite, and
  Vitest packages. Applications using Effect should align their dependencies
  to `4.1.4` or a compatible later 4.x release. With Effect 4.1, successful
  spans exported through `@effect/opentelemetry` keep the `UNSET` status
  instead of `OK`. JSON column detection and storage fingerprints were adapted
  to the new Effect schema representation, so existing state databases are not
  rebuilt.
- **DevTools:** DevTools no longer requires a sponsor license ([#1511](https://github.com/livestorejs/livestore/issues/1511)).
- **DevTools:** Fixed web sessions getting stuck at "Connecting to session" by keeping worker connections alive until the session disconnects ([#1709](https://github.com/livestorejs/livestore/pull/1709)).
- **DevTools:** Updated the artifact to boot its UI-state store independently of the app's LiveStore package version while retaining protocol compatibility. This also includes the persisted reload snapshot repair ([#1739](https://github.com/livestorejs/livestore/issues/1739), [#1740](https://github.com/livestorejs/livestore/pull/1740), [producer fix](https://github.com/overengineeringstudio/overeng/pull/243)).
- **Web in-memory adapter:** Kept the optional DevTools shared-worker connection alive for the store's lifetime instead of disconnecting immediately after RPC client creation ([#1710](https://github.com/livestorejs/livestore/issues/1710)).
- **State storage:** Rebases roll back state through a materialization journal table instead of SQLite changesets carried in event metadata. Because the state system tables changed, existing state databases are rebuilt from the eventlog once after upgrading ([#1658](https://github.com/livestorejs/livestore/pull/1658)).
- **Query cache:** Cached query results are discarded when a journal or savepoint rollback changes the session database, so reads after a rebase no longer return rolled-back rows ([#1658](https://github.com/livestorejs/livestore/pull/1658)).
- **Store lifecycle:** Closing the scope a store was created in (for example when a store registry disposes an unused store) now sends events committed in the session to the leader before closing, like `store.shutdown()`. Previously such events could be dropped if the leader had not acknowledged them yet. Disposal can now wait up to one second ([#1437](https://github.com/livestorejs/livestore/issues/1437), [#1659](https://github.com/livestorejs/livestore/pull/1659)).
- **Development checks:** Side-effecting materializers are detected when the leader confirms a session's own event, including in web-worker adapters, where the previous leader-side check never ran ([#1660](https://github.com/livestorejs/livestore/pull/1660)).
- **Session sync:** Keep local edits and persisted state heads consistent during concurrent reconciliation by yielding between complete SQLite/model steps. Failed-processor admission no longer materializes events. Large pull batches can publish complete intermediate prefixes. A leader applies backend pages that are already waiting as one batch, so reconnecting with pending events rebases them once instead of once per page ([#1465](https://github.com/livestorejs/livestore/issues/1465), [#1663](https://github.com/livestorejs/livestore/pull/1663)).
- **Session rebases:** A session rebase step spends less time on bookkeeping per replayed event: the state head is written once per batch, journal records run in the caller's savepoint, and rollback reads journal records in batches. With a React list subscribed, the longest frame while rebasing 1,000 pending events falls from about 167 ms to 67 ms. Traces show one span per commit batch or pull step instead of per event ([#1685](https://github.com/livestorejs/livestore/pull/1685)).

### Internal Changes

For maintainers and contributors:

- **DevTools tests:** Keep the normal-version browser suite and run two additional
  real-session web scenarios with deliberate app/worker package-version skew
  ([#1740](https://github.com/livestorejs/livestore/pull/1740)).
- **Browser integration tests:** Automated fixture servers disable inherited browser
  OTLP exports so a local collector's CORS policy cannot fail DevTools tests.
  Interactive dev-server tracing remains available ([#1709](https://github.com/livestorejs/livestore/pull/1709)).
- **DevTools tests:** Persisted multi-tab fixtures use the adapter's shared client identity,
  while in-memory fixtures assert independent databases and reload behavior. The TodoMVC
  fixture keeps one store registry per document so aborted route renders cannot
  boot duplicate stores with the same DevTools mesh node IDs.
- **npm publishing:** Wait for npm to finish processing the full release group
  before checking publication success. Publishing retries keep the original
  build files, and preparation refuses to replace an existing release artifact
  ([#1728](https://github.com/livestorejs/livestore/pull/1728)).

- **Review delegation:** Package source outside credentialed runtime trees,
  changelogs, and implementation context allow independent agent review without
  a required Johannes code-owner approval. Vision, requirements, decisions,
  releases, install inputs, and credentialed workflow execution retain his gate,
  including previously ownerless launchers and transitive tooling. The docs
  changelog renders raw Markdown rather than compiling delegated frontmatter
  as an executable Astro module
  ([#1711](https://github.com/livestorejs/livestore/pull/1711),
  [#1701](https://github.com/livestorejs/livestore/issues/1701)).
- **Test tooling:** Extension-backed Playwright launches preserve caller-supplied
  Chromium arguments alongside extension flags. The DevTools undock locator
  selects the native button by role instead of matching its presentation host.
  The suite remains quarantined while session-discovery failures are investigated
  ([#1520](https://github.com/livestorejs/livestore/pull/1520),
  [#1489](https://github.com/livestorejs/livestore/issues/1489)).
- **Repository rules:** Declare GitHub's extra approval requirement for unattributed
  changes explicitly so the post-sync ruleset check matches the live policy
  ([failed reconcile](https://github.com/livestorejs/livestore/actions/runs/41331402268)).
- **CI tooling:** Pin effect-utils to `d883d18e` and use its trusted Namespace
  runner policy so Nix installation can create sandbox namespaces without
  granting privileged containers to fork pull requests ([#1691](https://github.com/livestorejs/livestore/pull/1691)).
- **Release tooling:** Treat npm's previously-staged version conflicts as
  pending publication, verify public visibility for core and DevTools packages,
  and fail with bounded, logged recovery instructions when approval or registry
  intervention is needed
  ([npm/cli#9889](https://github.com/npm/cli/issues/9889)).
- **SQLite services:** Leader and client-session code reach SQLite through the `StateSqliteDb`, `EventlogSqliteDb`, `StateHead` and `MaterializationJournal` Effect services ([#1658](https://github.com/livestorejs/livestore/pull/1658)). Thanks [@IGassmann](https://github.com/IGassmann).
- **Events:** `LiveStoreEvent.Client.EncodedWithMeta` is removed and events are plain values. Sync metadata travels beside events, and leader materializer hashes travel in `PullItem.materializerHashes`. Custom adapters that wrapped pushed events must pass them through unchanged ([#1660](https://github.com/livestorejs/livestore/pull/1660)).
- **Leader persistence:** A `LeaderPersistence` service makes each leader transition durable as a whole (rollback, materialization, journal, state and backend heads, eventlog inserts) and returns a receipt that the processor publishes ([#1661](https://github.com/livestorejs/livestore/pull/1661)).
- **Sync processors:** The leader and client-session sync processors are serialized single-owner state machines, as described in [RFC 0004](./contributor-docs/rfcs/0004-serialized-sync-processors.md) ([#1663](https://github.com/livestorejs/livestore/pull/1663)).
- **Integration testing:** Scope temporary Chromium profiles to each Playwright
  test and remove them after the browser closes, including launch and test
  failures. Teardown asserts profile removal; trace evidence remains in
  `test-results` ([#1722](https://github.com/livestorejs/livestore/pull/1722)).
