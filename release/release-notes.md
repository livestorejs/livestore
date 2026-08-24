### Changed

- **Cloudflare sync:** Serialize push admission through pull publication so an
  accepted event cannot advance the backend head without notifying subscribers
  ([#1537](https://github.com/livestorejs/livestore/pull/1537)).
- **Effect v4 dependency cohort:** Updated the repository-wide Effect v4
  dependency family from `4.0.0-beta.99` to `4.0.0-rc.111`. Applications must
  use rc.111 or a compatible later Effect 4 release. Effect removed
  `Schema.isDateValid` because `Schema.DateFromString` and
  `Schema.DateFromMillis` now reject invalid dates on their own, so
  `Schema.DateFromString.check(Schema.isDateValid())` becomes plain
  `Schema.DateFromString`. SQLite column inference also preserves INTEGER and
  BLOB storage for refined `Schema.DateFromMillis` and `Schema.Uint8Array`
  ([#1557](https://github.com/livestorejs/livestore/issues/1557),
  [Effect-TS/effect#6620](https://github.com/Effect-TS/effect/pull/6620)).
  Thanks [@JamieMason](https://github.com/JamieMason) for the migration work.
- Removed redundant devenv package entries now owned by the task guard modules.
- **Sync correctness:** Prevented later client-session events from crossing an
  older rejected pending prefix, and made leader admission retain explicit
  reservation ownership through queue drain until apply, rejection, or stale
  dropping. Parent contiguity now compares DAG position independently of local
  rebase generation while stale epochs remain checked separately, avoiding
  duplicate materialization and ghost fences during multi-writer rebases
  ([#1530](https://github.com/livestorejs/livestore/pull/1530)).

### Internal Changes

For maintainers and contributors:

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
