Cleanup checklist (post-investigation)

Code flags and debug-only changes
- tests/integration/src/tests/node-sync/node-sync.test.ts
  - Remove or document `NODE_SYNC_DEBUG` env override block.
- packages/@livestore/common/src/leader-thread/LeaderSyncProcessor.ts
  - Remove extra ServerAheadError diagnostics if too verbose.
- packages/@livestore/sync-cf/src/cf-worker/durable-object.ts
  - Remove extra mismatch diagnostics if not needed.

CI/workflows
- Ensure no new workflow files were added.

Docs
- Consolidate hypothesis docs into a summary; keep or remove `debug/` folder as appropriate.

